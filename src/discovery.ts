namespace Fedi {
  type PublicTimeline = "local" | "federated";
  export const discovery = {
    timeline: "federated" as PublicTimeline,
    local: [] as string[],
    federated: [] as string[],
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
  function eligibleDiscoveryPosts(posts: Post[]): Post[] {
    return filterByLanguages(undiscoveredPosts(posts), state.discoveryLanguages).filter((post) => {
      const relationship = state.relationships.get(post.author.id);
      return post.visibility === "public" && !post.warning && !post.replyTo && !post.isReply &&
        post.author.id !== (state.session?.account.id || "you") &&
        !relationship?.blocking && !relationship?.blocked_by && !relationship?.muting;
    });
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
    const candidates = [...new Map(eligibleDiscoveryPosts(posts).map((post) => [discoveryIdentity(post), post])).values()];
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
    return eligibleDiscoveryPosts(posts).filter((post) => post.kind === "article").slice(0, 3);
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
  export function discoveryTimelineView(): string {
    const timeline = discovery.timeline;
    const label = timeline === "local" ? "Local" : "Federated";
    const ids = new Set(discovery[timeline]);
    const posts = eligibleDiscoveryPosts(state.posts).filter((post) => ids.has(discoveryIdentity(post)))
      .sort((a, b) => b.created.localeCompare(a.created)).slice(0, 3);
    return `<section class="discover-section discover-timelines" aria-label="Public timelines"><h2>Public timelines</h2>
      <div class="timeline-tabs" aria-label="Public timeline preview">${(["federated", "local"] as const).map((name) => `<button data-action="discovery-timeline" data-id="${name}" class="${name === timeline ? "active" : ""}" aria-pressed="${name === timeline}">${name === "local" ? "Local" : "Federated"}</button>`).join("")}</div>
      <div class="feed" aria-label="${label} preview">${posts.map((post) => postCard(post)).join("")}</div>
      ${state.loading && !posts.length ? '<p class="muted" role="status">Finding public posts…</p>' : ""}
      ${!state.loading && discovery.errors[timeline] ? `<p class="muted" role="status">${escapeHTML(discovery.errors[timeline])} ${action("refresh", "Try again", "", "text-button")}</p>` : ""}
      ${!state.loading && !posts.length && !discovery.errors[timeline] ? '<p class="muted">No new public posts match your discovery preferences yet.</p>' : ""}
      <a class="text-button discover-more" href="#discover?timeline=${timeline}">More from ${label} ${icon("arrow")}</a></section>`;
  }
  export async function loadDiscovery(api: API | null, signal: AbortSignal, current: () => boolean): Promise<void> {
    const owner = discoveryOwner();
    const previous = discovery.owner === owner ? discovery.posts : [];
    if (discovery.owner !== owner) {
      discovery.local = [];
      discovery.federated = [];
      discovery.cursors = {};
      discovery.timeline = "federated";
    }
    discovery.owner = owner;
    discovery.errors = { local: "", federated: "" };
    state.posts = previous;
    state.accounts = [];
    state.searchTags = [];
    state.next = undefined;
    state.error = "";
    state.loading = true;
    render();
    void loadSuggestions();
    const history = historyForDiscovery();
    const publicPosts: Record<PublicTimeline, Post[]> = { local: [], federated: [] };
    const errors: Record<PublicTimeline, string> = { local: "", federated: "" };
    const cursors = { ...discovery.cursors };
    async function publicTimeline(timeline: PublicTimeline): Promise<void> {
      if (!api) {
        demoState.posts.forEach((post) => {
          if (!post.language && demoAuthors.some((author) => author.id === post.author.id)) post.language = "en";
        });
        publicPosts[timeline] = demoState.posts.filter((post) => timeline === "federated" || post.local);
        return;
      }
      let cursor: string | undefined;
      const visited = new Set<string>();
      try {
        for (let page = 0; page < 3 && current(); page++) {
          const result = await api.timeline(timeline, cursor, signal);
          if (!current()) return;
          rememberDiscoveryLikes(result.posts);
          publicPosts[timeline].push(...result.posts);
          const fresh = new Set(eligibleDiscoveryPosts(publicPosts[timeline])
            .filter((post) => post.kind === "article" && !history.seen.has(discoveryIdentity(post))).map(discoveryIdentity));
          const next = page === 0 && fresh.size < 3 ? discovery.cursors[timeline] || result.next : result.next;
          cursors[timeline] = next;
          if (!next || visited.has(next) || fresh.size >= 3) break;
          cursor = next;
          visited.add(cursor);
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
      if (api) {
        const lists = await Promise.allSettled(shuffled(interests.lists).slice(0, 2).map((list) => api.timeline(`list:${list.id}`, undefined, signal)));
        if (!current()) return;
        for (const result of lists) if (result.status === "fulfilled") { learn(result.value.posts); extras.push(...result.value.posts); }
        const topics = shuffled([...tags.keys()].filter((tag) => hashtagName(`#${tag}`))).slice(0, 3);
        const results = await Promise.allSettled(topics.map((tag) => api.timeline(`tag:${tag}`, undefined, signal)));
        if (!current()) return;
        for (const result of results) if (result.status === "fulfilled") extras.push(...result.value.posts);
      }
      if (!current()) return;
      const candidates = [...publicPosts.federated, ...publicPosts.local, ...extras];
      rememberDiscoveryLikes(candidates);
      state.posts = rankDiscoveryPosts(candidates, tags, authors);
      discovery.errors = errors;
      if (errors.local && errors.federated && !state.posts.length) {
        state.posts = previous;
        state.error = "Could not refresh Discover. Please try again.";
      } else {
        discovery.local = publicPosts.local.map(discoveryIdentity);
        discovery.federated = publicPosts.federated.map(discoveryIdentity);
        discovery.cursors = cursors;
      }
      discovery.posts = state.posts;
      if (api) {
        void api.relationships([...new Set(state.posts.map((post) => post.author.id))]).then((rows) => {
          if (!current()) return;
          rows.forEach((row) => state.relationships.set(row.id, row));
          render();
        }).catch(() => { /* Optional follow metadata must not block reading. */ });
      }
    } catch (error) {
      if (current()) { state.error = (error as Error).message; state.posts = previous; }
    } finally {
      if (current()) { state.loading = false; render(); }
    }
  }
}
