namespace Fedi {
  type PublicTimeline = "local" | "federated";
  const discoveryBatch = 20;
  export const discovery = {
    limit: discoveryBatch,
    autoLoad: true,
    errors: { local: "", federated: "" },
    owner: "",
    posts: [] as Post[],
    cursors: {} as Partial<Record<PublicTimeline, string>>,
  };
  interface DiscoveryHistory {
    owner: string;
    liked: Set<string>;
    seen: Set<string>;
  }
  let discoveryHistory: DiscoveryHistory | undefined;
  function discoveryOwner(): string {
    return JSON.stringify([state.session?.server || state.api?.server || "demo", state.session?.account.id || "you"]);
  }
  function historyForDiscovery(): DiscoveryHistory {
    const owner = discoveryOwner();
    if (discoveryHistory?.owner !== owner) {
      const stored = readStore<{ liked?: unknown; seen?: unknown }>(`discovery:${owner}`, {}, state.session?.remember !== true);
      const strings = (value: unknown) => new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
      discoveryHistory = { owner, liked: strings(stored.liked), seen: strings(stored.seen) };
    }
    return discoveryHistory;
  }
  function saveDiscoveryHistory(): void {
    const history = historyForDiscovery();
    writeStore(`discovery:${history.owner}`, { liked: [...history.liked], seen: [...history.seen].slice(-500) }, state.session?.remember !== true);
  }
  function discoveryIdentity(post: Post): string { return post.url || `id:${post.id}`; }
  export function rememberDiscoveryLikes(posts: Post[]): void {
    const history = historyForDiscovery();
    let changed = false;
    for (const post of posts) {
      if (!post.liked) continue;
      for (const key of [`id:${post.id}`, discoveryIdentity(post)]) {
        if (!history.liked.has(key)) { history.liked.add(key); changed = true; }
      }
    }
    if (changed) saveDiscoveryHistory();
  }
  export function undiscoveredPosts(posts: Post[]): Post[] {
    const history = historyForDiscovery();
    return posts.filter((post) => !post.liked && !history.liked.has(`id:${post.id}`) && !history.liked.has(discoveryIdentity(post)));
  }
  function discoveryCandidates(posts: Post[]): Post[] {
    return undiscoveredPosts(posts).filter((post) => {
      const relationship = state.relationships.get(post.author.id);
      return post.visibility === "public" && !post.warning && !post.replyTo && !post.isReply &&
        post.author.id !== (state.session?.account.id || "you") &&
        !relationship?.blocking && !relationship?.blocked_by && !relationship?.muting;
    });
  }
  export function visibleDiscoveryPosts(posts = state.posts): Post[] {
    return discoveryCandidates(posts).filter((post) => matchesPublication(post));
  }
  function shuffled<T>(values: T[]): T[] {
    return values.map((value) => ({ value, order: Math.random() })).sort((a, b) => a.order - b.order).map(({ value }) => value);
  }
  interface DiscoveryInterests {
    likes: Post[];
    tags: FollowedTag[];
    lists: UserList[];
  }
  let interestCache: { api: API; revision: number; updated: number; value: DiscoveryInterests } | undefined;
  async function discoveryInterests(api: API, signal: AbortSignal, current: () => boolean): Promise<DiscoveryInterests> {
    const revision = feedCacheGeneration();
    if (interestCache?.api === api && interestCache.revision === revision && Date.now() - interestCache.updated < 300000)
      return interestCache.value;
    const [likes, tags, lists] = await Promise.allSettled([
      api.favourites(undefined, signal),
      api.followedTags(undefined, signal),
      api.get<UserList[]>("/api/v1/lists", signal),
    ]);
    const value = {
      likes: likes.status === "fulfilled" ? likes.value.posts : [],
      tags: tags.status === "fulfilled" ? tags.value.tags : [],
      lists: lists.status === "fulfilled" ? lists.value : state.lists,
    };
    if (current() && revision === feedCacheGeneration())
      interestCache = { api, revision, updated: Date.now(), value };
    return value;
  }
  function rankDiscoveryPosts(posts: Post[], tags: Map<string, number>, authors: Set<string>): Post[] {
    const history = historyForDiscovery();
    const seenOrder = new Map([...history.seen].map((key, index) => [key, index + 1]));
    const unique = new Map<string, Post>();
    for (const post of discoveryCandidates(posts)) {
      const key = discoveryIdentity(post);
      if (!unique.has(key)) unique.set(key, post);
    }
    const candidates = [...unique.values()];
    const ranked = candidates.map((post) => {
      const affinity = post.tags.reduce((sum, tag) => sum + Math.min(4, tags.get(tag.toLowerCase()) || 0), 0) + (authors.has(post.author.id) ? 2 : 0);
      return { post, seen: seenOrder.get(discoveryIdentity(post)) || 0, score: -Math.log(Math.max(Number.EPSILON, Math.random())) / (1 + Math.min(10, affinity)) };
    });
    const result: Post[] = [], usedAuthors = new Set<string>(), usedServers = new Set<string>();
    const server = (post: Post) => post.author.acct.split("@")[1] || state.api?.server || "local";
    while (ranked.length) {
      const penalty = (post: Post) => (usedAuthors.has(post.author.id) ? 4 : 0) + (usedServers.has(server(post)) ? 1 : 0);
      ranked.sort((a, b) => a.seen - b.seen || (a.score + penalty(a.post)) - (b.score + penalty(b.post)));
      const { post } = ranked.shift()!;
      result.push(post);
      // Notes in the pool must not consume the diversity slots for articles.
      if (post.kind === "article") { usedAuthors.add(post.author.id); usedServers.add(server(post)); }
    }
    return result;
  }
  export function discoveryArticles(posts = state.posts): Post[] {
    return visibleDiscoveryPosts(posts).filter((post) => post.kind === "article").slice(0, 3);
  }
  let shownArticles = "";
  export function rememberDiscoveryArticles(posts: Post[]): void {
    if (state.loading) return;
    const history = historyForDiscovery();
    const keys = posts.map(discoveryIdentity);
    const selection = JSON.stringify([history.owner, keys]);
    if (selection === shownArticles) return;
    shownArticles = selection;
    for (const key of keys) { history.seen.delete(key); history.seen.add(key); }
    history.seen = new Set([...history.seen].slice(-500));
    saveDiscoveryHistory();
  }
  export function discoveryTimelineView(visible = visibleDiscoveryPosts()): string {
    const posts = visible.slice(0, discovery.limit);
    const errors = Object.entries(discovery.errors).filter(([, error]) => error);
    return `<section class="discover-section discover-timelines" aria-label="Mixed public feed"><div class="section-heading"><h2>For you</h2>${feedFilters()}</div>
      <div class="feed" aria-label="Local and federated posts">${posts.slice(0, discoveryBatch).map((post) => postCard(post)).join("")}${suggestionsView(true)}${posts.slice(discoveryBatch).map((post) => postCard(post)).join("")}</div>
      ${!state.loading ? errors.map(([timeline, error]) => `<p class="muted" role="status">${timeline === "local" ? "Local" : "Federated"}: ${escapeHTML(error)} ${action("refresh", "Try again", "", "text-button")}</p>`).join("") : ""}
      ${state.error ? `<p class="error-panel" role="alert">${escapeHTML(state.error)}</p>` : ""}
      ${!posts.length && !state.loading && !state.error && state.next ? '<p class="end-note">No matching posts in the loaded results.</p>' : ""}
      ${state.loading ? '<div class="loading" role="status">Finding more posts…</div>' : state.next
        ? `<div id="discovery-more" class="load-more">${action("load-more", "Load more posts", "", "button subtle")}</div>`
        : `<p class="end-note">${posts.length ? "You’ve reached the end." : "No new public posts match your discovery preferences yet."}</p>`}</section>`;
  }
  let discoveryObserver: IntersectionObserver | undefined;
  export function setupDiscoveryScroll(): void {
    discoveryObserver?.disconnect();
    discoveryObserver = undefined;
    if (state.view !== "discover" || !state.exploring || state.query || state.loading ||
        !state.next || !discovery.autoLoad || typeof IntersectionObserver === "undefined") return;
    const more = document.getElementById("discovery-more");
    if (!more) return;
    const observer = new IntersectionObserver((entries) => {
      if (discoveryObserver !== observer || !entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      discoveryObserver = undefined;
      if (!state.loading && state.view === "discover" && state.exploring && !state.query && state.next)
        void loadFeed(true);
    }, { rootMargin: "600px 0px" });
    discoveryObserver = observer;
    observer.observe(more);
  }
  export function discoveryNext(): string | undefined {
    return visibleDiscoveryPosts(state.posts).length > discovery.limit || Object.values(discovery.cursors).some(Boolean)
      ? "discovery" : undefined;
  }
  export function restoreDiscovery(): boolean {
    if (discovery.owner !== discoveryOwner() || !discovery.posts.length) return false;
    state.posts = discovery.posts;
    state.accounts = [];
    state.searchTags = [];
    state.next = discoveryNext();
    render();
    return true;
  }
  export async function loadDiscovery(api: API | null, signal: AbortSignal, current: () => boolean, append = false, quiet = false): Promise<void> {
    const visible = () => JSON.stringify([state.posts, state.next, state.error, discovery.errors,
      discovery.limit, [...state.relationships.values()]]);
    let shown = quiet ? visible() : "";
    const update = () => {
      if (quiet && state.loading) return;
      const next = quiet ? visible() : "";
      if (!quiet || shown !== next) { render(); shown = next; }
    };
    const owner = discoveryOwner();
    const previous = discovery.owner === owner ? discovery.posts : [];
    const previousVisible = Math.min(discovery.limit, visibleDiscoveryPosts(previous).length);
    if (discovery.owner !== owner) {
      discovery.cursors = {};
      append = false;
    }
    discovery.owner = owner;
    discovery.limit = append ? discovery.limit + discoveryBatch : quiet ? discovery.limit : discoveryBatch;
    if (append && visibleDiscoveryPosts(previous).length >= discovery.limit) {
      state.posts = previous;
      state.next = discoveryNext();
      render();
      return;
    }
    discovery.errors = { local: "", federated: "" };
    state.posts = previous;
    state.accounts = [];
    state.searchTags = [];
    state.next = undefined;
    state.error = "";
    state.loading = true;
    update();
    if (!append && !quiet) void loadSuggestions();
    const existing = new Set(append ? previous.map(discoveryIdentity) : []);
    const publicPosts: Record<PublicTimeline, Post[]> = { local: [], federated: [] };
    const errors: Record<PublicTimeline, string> = { local: "", federated: "" };
    const cursors = { ...discovery.cursors };
    async function publicTimeline(timeline: PublicTimeline): Promise<void> {
      if (append && !cursors[timeline]) return;
      if (!api) {
        demoState.posts.forEach((post) => {
          if (!post.language && demoAuthors.some((author) => author.id === post.author.id)) post.language = "en";
        });
        publicPosts[timeline] = demoState.posts.filter((post) => timeline === "federated" || post.local);
        return;
      }
      let cursor = append ? cursors[timeline] : undefined;
      const visited = new Set<string>();
      try {
        for (let page = 0; page < (quiet ? 1 : 3) && current(); page++) {
          if (cursor) visited.add(cursor);
          const result = await api.timeline(timeline, cursor, signal);
          if (!current()) return;
          rememberDiscoveryLikes(result.posts);
          publicPosts[timeline].push(...result.posts);
          const fresh = new Set(visibleDiscoveryPosts(publicPosts[timeline])
            .map(discoveryIdentity).filter((id) => !existing.has(id)));
          const next = result.next && !visited.has(result.next) ? result.next : undefined;
          cursors[timeline] = next;
          if (!next || fresh.size >= discoveryBatch) break;
          cursor = next;
        }
      } catch (error) { errors[timeline] = (error as Error).message; }
    }
    try {
      const [interests] = await Promise.all([
        api && state.session ? discoveryInterests(api, signal, current) : Promise.resolve({ likes: !api ? demoState.posts.filter((post) => post.liked) : [], tags: [] as FollowedTag[], lists: [] as UserList[] }),
        publicTimeline("federated"), publicTimeline("local"),
      ]);
      if (!current()) return;
      rememberDiscoveryLikes(interests.likes);
      const tags = new Map<string, number>(), authors = new Set<string>();
      const learn = (posts: Post[]) => posts.forEach((post) => {
        authors.add(post.author.id);
        post.tags.forEach((tag) => tags.set(tag.toLowerCase(), (tags.get(tag.toLowerCase()) || 0) + 1));
      });
      learn(interests.likes);
      interests.tags.forEach((tag) => { if (tag.following !== false) tags.set(tag.name.toLowerCase(), 4); });
      const extras: Post[] = [];
      if (api && !append && !quiet) {
        const lists = await Promise.allSettled(shuffled(interests.lists).slice(0, 2).map((list) => api.timeline(`list:${list.id}`, undefined, signal)));
        if (!current()) return;
        for (const result of lists) if (result.status === "fulfilled") { learn(result.value.posts); extras.push(...result.value.posts); }
        const topics = shuffled([...tags.keys()].filter((tag) => hashtagName(`#${tag}`))).slice(0, 3);
        const results = await Promise.allSettled(topics.map((tag) => api.timeline(`tag:${tag}`, undefined, signal)));
        if (!current()) return;
        for (const result of results) if (result.status === "fulfilled") extras.push(...result.value.posts);
      }
      if (!current()) return;
      const candidates: Post[] = [];
      for (let i = 0; i < Math.max(publicPosts.local.length, publicPosts.federated.length); i++) {
        if (publicPosts.federated[i]) candidates.push(publicPosts.federated[i]);
        if (publicPosts.local[i]) candidates.push(publicPosts.local[i]);
      }
      candidates.push(...extras);
      if (quiet) candidates.push(...previous);
      rememberDiscoveryLikes(candidates);
      let ranked = rankDiscoveryPosts(candidates, tags, authors);
      if (quiet) {
        const refreshed = new Map(ranked.map((post) => [discoveryIdentity(post), post]));
        const old = new Set(previous.map(discoveryIdentity));
        ranked = [...ranked.filter((post) => !old.has(discoveryIdentity(post))),
          ...previous.flatMap((post) => refreshed.get(discoveryIdentity(post)) || [])];
      }
      state.posts = append ? [...previous, ...ranked.filter((post) => !existing.has(discoveryIdentity(post)))] : ranked;
      discovery.errors = errors;
      if (errors.local && errors.federated && !state.posts.length) {
        state.posts = previous;
        state.error = "Could not refresh Discover. Please try again.";
      } else {
        discovery.cursors = cursors;
      }
      discovery.posts = state.posts;
      if (api) {
        void api.relationships([...new Set(state.posts.map((post) => post.author.id))]).then((rows) => {
          if (!current()) return;
          rows.forEach((row) => state.relationships.set(row.id, row));
          update();
        }).catch(() => { /* Optional follow metadata must not block reading. */ });
      }
    } catch (error) {
      if (current()) { state.error = (error as Error).message; state.posts = previous; }
    } finally {
      if (current()) {
        state.next = discoveryNext();
        discovery.autoLoad = !state.error && !discovery.errors.local && !discovery.errors.federated &&
          (!append || Math.min(discovery.limit, visibleDiscoveryPosts(state.posts).length) > previousVisible);
        state.loading = false;
        update();
      }
    }
  }
}
