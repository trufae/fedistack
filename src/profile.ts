namespace Fedi {
  export type ProfileTab = "posts" | "replies" | "likes" | "boosts" | "followers" | "following";
  export interface ProfileState {
    id: string;
    account: Account | null;
    owner: boolean;
    tab: ProfileTab;
    api: API | null;
    server: string;
    posts: Post[];
    people: Account[];
    next?: string;
    visited: Set<string>;
    loading: boolean;
    error: string;
    updated: number;
    generation: number;
    cacheKey: string;
    controller?: AbortController;
  }
  const profileTabs: ProfileTab[] = ["posts", "replies", "likes", "boosts", "followers", "following"];

  type ProfileCache = Pick<ProfileState, "account" | "posts" | "people" | "next" | "updated" | "generation">;
  const profileCache = new Map<string, ProfileCache>();
  let profileImageUpload: { api: API; kind: ProfileImage } | undefined;
  let profileImageError: { api: API; message: string } | undefined;
  let profileImageVersion = 0;

  export function profileImageUpdating(): boolean {
    return !!state.api && profileImageUpload?.api === state.api;
  }

  function checkProfileImage(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const finish = (loaded: boolean) => {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        if (loaded) resolve();
        else reject(new Error("The server saved your profile, but the image could not be loaded. Try refreshing your profile; if it still fails, check your server’s media URL and file access."));
      };
      const timer = setTimeout(() => finish(false), 15000);
      image.referrerPolicy = "no-referrer";
      image.onload = () => finish(image.naturalWidth > 0);
      image.onerror = () => finish(false);
      image.src = url;
    });
  }

  export function chooseProfileImage(kind: ProfileImage): void {
    const api = state.api, session = state.session, p = state.profile;
    if (!api || !session || !p?.owner || p.server || state.view !== "profile" || profileImageUpload?.api === api) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file && state.api === api && state.session === session)
        void updateProfileImage(kind, file).catch(formError);
    }, { once: true });
    input.click();
  }

  export async function updateProfileImage(kind: ProfileImage, file: File): Promise<void> {
    const api = state.api, session = state.session;
    if (!api || !session || profileImageUpload?.api === api) return;
    const upload = profileImageUpload = { api, kind };
    const current = () => state.api === api && state.session === session;
    profileImageError = undefined;
    render();
    try {
      if (file.type && !file.type.startsWith("image/")) throw new Error("Choose an image file.");
      if (!file.size) throw new Error("This image is empty. Choose a different image.");
      const account = await api.updateProfileImage(kind, file);
      if (!current()) return;
      if (account.id !== session.account.id) throw new Error("The server returned a different account. Refresh your profile and try again.");
      const p = state.profile;
      const posts = [...state.posts, ...state.ownPosts,
        ...(p && !p.server ? p.posts : []),
        ...(state.readerServer ? [] : [...state.comments, ...(state.reading ? [state.reading] : [])]),
        ...state.conversations.flatMap((c) => c.messages)];
      const accounts = [session.account, ...state.accounts, ...state.suggestions,
        ...(p && !p.server ? [...p.people, ...(p.account ? [p.account] : [])] : []),
        ...state.conversations.flatMap((c) => c.accounts), ...posts.map((post) => post.author)];
      accounts.filter((a) => a.id === account.id).forEach((a) => Object.assign(a, account));
      profileImageVersion++;
      profileCache.clear();
      clearFeedCache();
      const saved = writeStore("session", session, session.remember !== true);
      await checkProfileImage(account[kind]!);
      if (!current()) return;
      toast(`${kind === "avatar" ? "Profile picture" : "Background image"} updated.${saved ? "" : " Browser storage is unavailable; the change is saved on your server."}`);
    } catch (error) {
      if (current()) {
        profileImageError = { api, message: (error as Error).message };
        throw error;
      }
    } finally {
      if (profileImageUpload === upload) profileImageUpload = undefined;
      if (current()) render();
    }
  }

  function saveProfile(p: ProfileState): void {
    if (p.generation !== feedCacheGeneration() || p.posts.length > 200 || p.people.length > 200) return;
    profileCache.delete(p.cacheKey);
    profileCache.set(p.cacheKey, { account: p.account, posts: p.posts, people: p.people, next: p.next,
      updated: p.updated, generation: p.generation });
    while (profileCache.size > 12) profileCache.delete(profileCache.keys().next().value!);
  }
  function profileRelationships(p: ProfileState, ids: string[]): void {
    const api = state.api;
    if (!api || p.server) return;
    void api.relationships(ids.filter((id) => id !== state.session?.account.id)).then((relations) => {
      if (!currentProfile(p, api)) return;
      const changed = relations.some((r) => JSON.stringify(state.relationships.get(r.id)) !== JSON.stringify(r));
      relations.forEach((r) => state.relationships.set(r.id, r));
      if (changed) render();
    }).catch(() => { /* Relationship metadata must not delay reading. */ });
  }

  export function profilePath(id: string, tab = "posts", server = state.readerServer): string {
    const query = new URLSearchParams();
    if (tab !== "posts") query.set("tab", tab);
    if (server) query.set("server", server);
    return `profile/${encodeURIComponent(id)}${query.toString() ? `?${query}` : ""}`;
  }
  export function postReadLink(id: string): string {
    return `#read/${encodeURIComponent(id)}${state.readerServer ? `?${new URLSearchParams({ server: state.readerServer })}` : ""}`;
  }
  export function profileAvatar(account: Account, small = false, key = account.id): string {
    return `<a class="profile-avatar-link" href="#${escapeHTML(profilePath(account.id))}" aria-label="View ${escapeHTML(account.name)}’s profile">${avatar(account, small, key)}</a>`;
  }
  export function accountRow(account: Account, key = "account"): string {
    const r = state.readerServer ? undefined : state.relationships.get(account.id);
    const direction = r?.following && r.followed_by ? "Mutual follow" : r?.followed_by ? "Follows you" : r?.following ? "You follow" : "";
    return `<div class="recommended">${profileAvatar(account, false, `${key}:${account.id}`)}<div><a class="author-link" href="#${escapeHTML(profilePath(account.id))}">${escapeHTML(account.name)}</a><p>@${escapeHTML(account.acct)}</p>${direction ? `<p class="muted">${direction}</p>` : ""}${account.bio ? `<p class="account-bio">${escapeHTML(account.bio)}</p>` : ""}</div>${followButton(account)}</div>`;
  }
  function currentProfile(profile: ProfileState, api: API | null): boolean {
    return state.profile === profile && state.view === "profile" && state.api === api && !profile.controller?.signal.aborted;
  }
  export async function openProfile(id: string, query: string, force = false): Promise<void> {
    state.profile?.controller?.abort();
    const params = new URLSearchParams(query), api = state.api;
    const source = params.get("server");
    let server = "", sourceError = "";
    try { server = source ? serverURL(source) : ""; }
    catch (error) { sourceError = (error as Error).message; }
    if (server === api?.server) server = "";
    const owner = !server && id === (state.session?.account.id || demoMe.id);
    const tab = params.get("tab") as ProfileTab;
    let cached = !server ? allAccounts().find((a) => a.id === id) || null : null;
    if (!api && !server && cached) cached = { ...cached,
      statuses: demoProfilePosts().filter((post) => post.author.id === id).length,
      ...(owner ? { following: demoState.follows.length, followers: 0 } : {}),
    };
    const p: ProfileState = {
      id, account: cached, owner,
      tab: profileTabs.includes(tab) && (tab !== "likes" || owner) ? tab : "posts",
      api: server ? new API(server) : api, server,
      posts: [], people: [], visited: new Set(), loading: true, error: "",
      updated: 0, generation: feedCacheGeneration(), cacheKey: "", controller: new AbortController(),
    };
    p.cacheKey = JSON.stringify([state.session?.server, state.session?.account.id, p.api?.server, id, p.tab]);
    const saved = profileCache.get(p.cacheKey);
    if (saved?.generation === p.generation) Object.assign(p, saved);
    state.profile = p;
    state.view = "profile";
    state.readerServer = server;
    render();
    if (!sourceError && !force && saved?.generation === p.generation && Date.now() - p.updated < (p.posts.length || p.people.length ? 60000 : 5000)) {
      p.loading = false; render(); return;
    }
    try {
      const imageVersion = profileImageVersion;
      if (sourceError) throw new Error(sourceError);
      const account = p.api ? await p.api.account(id, p.controller?.signal) : cached;
      if (!currentProfile(p, api)) return;
      p.account = owner && imageVersion !== profileImageVersion && state.session ? state.session.account : account;
      if (!p.account) throw new Error("This account could not be found.");
      if (owner && state.session) {
        state.session.account = p.account;
        writeStore("session", state.session, state.session.remember !== true);
      }
      if (!owner) profileRelationships(p, [id]);
    } catch (error) {
      if (!currentProfile(p, api)) return;
      p.error = (error as Error).message;
      if (error instanceof APIError && [401, 403].includes(error.status)) {
        clearFeedCache(); profileCache.clear(); p.posts = []; p.people = []; p.next = undefined;
      }
      p.loading = false;
      render();
      return;
    }
    p.loading = false;
    await loadProfilePage();
  }
  function demoProfilePosts(): Post[] {
    return [...new Map([...demoState.posts, ...Object.values(demoState.comments).flat()]
      .filter((p) => p.visibility !== "direct").map((p) => [p.id, p])).values()]
      .sort((a, b) => b.created.localeCompare(a.created));
  }
  async function fetchProfilePage(p: ProfileState, append: boolean): Promise<void> {
    let posts = append ? p.posts : [], people = append ? p.people : [];
    let next = append ? p.next : undefined;
    // Bound scanning for sparse boosts/replies, retaining a usable cursor.
    for (let page = 0; page < 4; page++) {
      if (p.controller?.signal.aborted) return;
      const cursor = next;
      if (cursor) p.visited.add(cursor);
      const result = p.tab === "followers" || p.tab === "following"
        ? await p.api!.accountConnections(p.id, p.tab, cursor, p.controller?.signal)
        : p.tab === "likes"
          ? await p.api!.favourites(cursor, p.controller?.signal)
          : await p.api!.accountPosts(p.id, p.tab, cursor, p.controller?.signal);
      next = result.next && !p.visited.has(result.next) ? result.next : undefined;
      if (page === 0 && !append) p.updated = Date.now();
      if ("accounts" in result) {
        people = [...new Map([...people, ...result.accounts].map((a) => [a.id, a])).values()];
      } else {
        const visible = p.server ? result.posts.filter((post) => canRepost(post)) : result.posts;
        posts = [...new Map([...posts, ...visible].map((post) => [post.id, post])).values()];
        if (p.owner && p.tab === "boosts") posts.forEach((post) => { post.reposted = true; });
      }
      const count = "accounts" in result ? result.accounts.length : result.posts.length;
      if (count || !next) break;
    }
    p.posts = posts; p.people = people; p.next = next;
  }

  export async function refreshProfile(): Promise<void> {
    const p = state.profile, api = state.api;
    if (!p?.api || p.loading || profileImageUpdating()) return;
    p.controller?.abort();
    const controller = p.controller = new AbortController();
    const imageVersion = profileImageVersion;
    const current = () => currentProfile(p, api) && p.controller === controller && imageVersion === profileImageVersion;
    const visible = () => JSON.stringify([p.account, p.posts, p.people, p.next, p.error]);
    const before = visible();
    // Keep the visible profile intact until both account and activity arrive.
    const fresh = { ...p, visited: new Set<string>(), error: "" };
    try {
      fresh.account = await p.api.account(p.id, controller.signal);
      if (!current()) return;
      await fetchProfilePage(fresh, false);
      if (!current()) return;
      Object.assign(p, fresh);
      if (p.owner && state.session && p.account) {
        state.session.account = p.account;
        if (before !== visible()) writeStore("session", state.session, state.session.remember !== true);
      }
      saveProfile(p);
      profileRelationships(p, [...p.people.map((a) => a.id), ...p.posts.map((post) => post.author.id), ...(!p.owner ? [p.id] : [])]);
    } catch (error) {
      if (!current()) return;
      p.error = (error as Error).message;
      if (error instanceof APIError && [401, 403].includes(error.status)) {
        clearFeedCache(); profileCache.clear(); p.posts = []; p.people = []; p.next = undefined;
      }
    }
    if (current() && before !== visible()) render();
  }

  export async function loadProfilePage(append = false): Promise<void> {
    const p = state.profile, api = state.api;
    if (!p || p.loading || !p.account || (append && !p.next)) return;
    p.controller?.abort();
    p.controller = new AbortController();
    p.loading = true;
    p.error = "";
    if (!append) {
      p.visited.clear();
    }
    render();
    try {
      if (!p.api) {
        const posts = demoProfilePosts();
        p.posts = posts.filter((post) => p.tab === "likes" ? post.liked :
          p.tab === "boosts" ? p.owner && post.reposted :
          ["posts", "replies"].includes(p.tab) && post.author.id === p.id && (p.tab !== "replies" || !!post.replyTo || !!post.isReply));
        p.people = p.tab === "following" && p.owner
          ? demoAuthors.filter((a) => demoState.follows.includes(a.id))
          : p.tab === "followers" && !p.owner && demoState.follows.includes(p.id) ? [demoMe] : [];
        demoAuthors.forEach((a) => state.relationships.set(a.id, {
          id: a.id, following: demoState.follows.includes(a.id), requested: false,
        }));
        if (p.owner) p.account = { ...demoMe, statuses: posts.filter((post) => post.author.id === p.id).length, following: demoState.follows.length, followers: 0 };
      } else {
        const fresh = { ...p, visited: new Set(p.visited) };
        await fetchProfilePage(fresh, append);
        if (!currentProfile(p, api) || p.controller !== fresh.controller) return;
        Object.assign(p, { posts: fresh.posts, people: fresh.people, next: fresh.next,
          updated: fresh.updated, visited: fresh.visited });
        saveProfile(p);
        render();
        profileRelationships(p, [...p.people.map((a) => a.id), ...p.posts.map((post) => post.author.id)]);
      }
    } catch (error) {
      if (currentProfile(p, api)) {
        p.error = (error as Error).message;
        if (error instanceof APIError && [401, 403].includes(error.status)) {
          clearFeedCache(); profileCache.clear(); p.posts = []; p.people = []; p.next = undefined;
        }
      }
    } finally {
      if (currentProfile(p, api)) { p.loading = false; render(); }
    }
  }
  export function profileView(): string {
    const p = state.profile, a = p?.account;
    if (!p || !a) return `<header class="page-top"><a href="#home" class="text-button">${icon("back")} Home</a></header>${emptyState(p?.loading ? "Opening profile…" : "Profile unavailable", p?.error || "", p && !p.loading ? action("profile-refresh", "Try again", "", "button subtle") : "")}`;
    const tabs = profileTabs.filter((tab) => tab !== "followers" && tab !== "following" && (tab !== "likes" || p.owner));
    const editable = p.owner && !!state.api && !!state.session;
    const imageError = editable && profileImageError?.api === state.api ? profileImageError.message : "";
    const uploading = editable && profileImageUpload?.api === state.api ? profileImageUpload.kind : undefined;
    const imageButton = (kind: ProfileImage) => {
      const label = kind === "avatar" ? "Change profile picture" : "Change background image";
      return editable ? `<button type="button" class="profile-image-button" data-action="profile-image" data-id="${kind}" aria-label="${label}" title="${label}"${uploading ? " disabled" : ""}><span aria-hidden="true">${icon("image")}${kind === "header" ? "Change background" : ""}</span></button>` : "";
    };
    const link = (tab: ProfileTab) => `#${escapeHTML(profilePath(p.id, tab, p.server))}`;
    const stats = ([['posts', a.statuses], ['followers', a.followers], ['following', a.following]] as const)
      .map(([tab, count]) => `<a href="${link(tab)}"${p.tab === tab ? ' aria-current="page"' : ""}><strong>${count === undefined ? "—" : count.toLocaleString()}</strong><span>${tab === "posts" ? "posts & replies" : tab}</span></a>`).join("");
    const joined = a.joined && Number.isFinite(Date.parse(a.joined))
      ? `Joined ${new Date(a.joined).toLocaleDateString(undefined, { month: "long", year: "numeric" })}` : "";
    const people = p.tab === "followers" || p.tab === "following";
    const empty = p.next ? "No matching activity on these pages. Load more to keep looking." : people
      ? a.hideCollections && !p.owner ? "This account keeps its followers and following lists private."
        : "No accounts to show. Some servers keep these lists private or only know part of a remote account’s network."
      : p.tab === "likes" ? "Posts you like will appear here. Only you can see this tab."
        : p.tab === "boosts" ? "Posts shared by this account will appear here."
          : "There are no posts to show here yet.";
    return `<header class="page-top"><a href="#home" class="text-button">${icon("back")} Home</a><div>${action("profile-refresh", icon("refresh"), "", "icon-button")}${p.owner ? '<a href="#settings" class="button subtle small-button">' + icon("settings") + ' Settings</a>' : ""}</div></header>
      <section class="profile-header"><div class="profile-cover">${a.header ? `<img src="${escapeHTML(safeURL(a.header, true))}" data-image-key="header:${escapeHTML(a.id)}" alt="${escapeHTML(a.name)}’s profile header" referrerpolicy="no-referrer">` : ""}${imageButton("header")}</div>
      <div class="profile-details"><div class="profile-identity"><div class="profile-avatar">${avatar(a, false, `profile:${a.id}`)}${imageButton("avatar")}</div><div class="profile-buttons">${p.owner ? '<a href="#drafts" class="button subtle">' + icon("edit") + ' Your writing</a><a href="#bookmarks" class="button subtle">' + icon("bookmark") + ' Saved</a>' : p.server ? "" : `${followButton(a, false)}${action("message-account", `${icon("mail")} Message`, a.id, "button subtle")}`}</div></div>
      ${uploading ? `<p class="profile-image-status" role="status">Updating ${uploading === "avatar" ? "profile picture" : "background image"}…</p>` : ""}
      ${imageError ? `<p class="error-panel" role="alert">${escapeHTML(imageError)}</p>` : ""}
      <h1>${escapeHTML(a.name)}</h1><p class="profile-handle">@${escapeHTML(a.acct)} ${a.locked ? `<span title="Approves follow requests">${icon("lock")}</span>` : ""}</p>
      ${state.relationships.get(a.id)?.followed_by && !p.server && !p.owner ? '<span class="profile-badge">Follows you</span>' : ""}
      ${a.bio ? `<p class="profile-bio">${escapeHTML(a.bio)}</p>` : ""}
      ${a.fields?.length ? `<dl class="profile-fields">${a.fields.map((f) => `<div><dt>${escapeHTML(f.name)}</dt><dd>${escapeHTML(f.value)}</dd></div>`).join("")}</dl>` : ""}
      <div class="profile-meta">${joined ? `<span>${joined}</span>` : ""}${a.url ? `<a href="${escapeHTML(safeURL(a.url))}" target="_blank" rel="noopener noreferrer">Original profile ${icon("external")}</a>` : ""}${!state.session && !p.server ? '<span>Fictional offline demo</span>' : ""}</div>
      <div class="profile-counts">${stats}</div></div></section>
      ${p.owner && p.tab === "posts" && p.posts.length ? `<section class="profile-insights" aria-label="Your post activity"><p>On these ${p.posts.length} loaded posts</p><div>${[["heart", "Likes received", "likes"], ["repost", "Boosts received", "reposts"], ["comment", "Replies received", "replies"]].map(([symbol, label, key]) => `<span>${icon(symbol)}<strong>${p.posts.reduce((n, post) => n + (post[key as "likes" | "reposts" | "replies"] || 0), 0).toLocaleString()}</strong> ${label}</span>`).join("")}</div></section>` : ""}
      <nav class="timeline-tabs profile-tabs" aria-label="Profile activity">${tabs.map((tab) => `<a href="${link(tab)}"${p.tab === tab ? ' class="active" aria-current="page"' : ""}>${tab === "posts" ? "Posts & replies" : tab[0].toUpperCase() + tab.slice(1)}${tab === "likes" ? ` ${icon("lock")}` : ""}</a>`).join("")}</nav>
      ${people ? `<p class="profile-notice">${p.tab === "followers" ? (p.owner ? "People who follow you" : "People who follow this account") : (p.owner ? "People you follow" : "People this account follows")}</p>` : ""}
      ${p.tab === "likes" ? '<p class="profile-notice">Your likes · Only visible to you</p>' : ""}
      <div class="${people ? "profile-people" : "feed"}">${people ? p.people.map((a) => accountRow(a, "profile-person")).join("") : p.posts.map((post) => postCard(post)).join("")}</div>
      ${p.error ? `<div class="error-panel" role="alert">${escapeHTML(p.error)}${action(p.next ? "profile-more" : "profile-refresh", "Try again", "", "button subtle")}</div>` : ""}
      ${p.loading ? '<div class="loading" role="status">Loading profile activity…</div>' : !p.error && !(people ? p.people.length : p.posts.length) ? emptyState(`No ${p.tab} to show`, empty) : ""}
      ${!p.loading && p.next ? `<div class="load-more">${action("profile-more", people ? "Load more people" : "Load older activity", "", "button subtle")}</div>` : ""}`;
  }

  export function suggestedAccounts(): Account[] {
    if (state.readerServer) return [];
    const candidates = state.session ? [...state.suggestions, ...state.posts.map((p) => p.author)] : demoAuthors;
    return [...new Map(candidates.map((a) => [a.id, a])).values()].filter((a) => {
      const r = state.relationships.get(a.id);
      return a.id !== (state.session?.account.id || demoMe.id) &&
        (state.session ? !!r && !r.following && !r.requested && !r.blocking && !r.blocked_by && !r.muting : !demoState.follows.includes(a.id));
    }).slice(0, 3);
  }
  export function suggestionsView(inline = false): string {
    const accounts = suggestedAccounts();
    if (!accounts.length) return "";
    return `<section class="${inline ? "feed-suggestions" : "rail-section"}" aria-label="People to follow"><div class="section-heading"><h3>People to follow</h3>${icon("users")}</div>${inline ? '<p class="muted">A few more voices for your reading room.</p>' : ""}${accounts.map((a) => accountRow(a, inline ? "feed-suggested" : "rail-suggested")).join("")}</section>`;
  }
  let suggestionRequest: { api: API; promise: Promise<void> } | undefined;
  let suggestionRetry: { api: API; at: number } | undefined;
  export function loadSuggestions(): Promise<void> {
    const api = state.api;
    if (!api) return Promise.resolve();
    if (suggestionRequest?.api === api) return suggestionRequest.promise;
    if (suggestionRetry?.api === api && suggestionRetry.at > Date.now()) return Promise.resolve();
    const promise = (async () => {
      try {
        const accounts = await api.suggestions();
        if (state.api !== api) return;
        const relationships = await api.relationships(accounts.map((a) => a.id));
        if (state.api !== api) return;
        relationships.forEach((r) => state.relationships.set(r.id, r));
        state.suggestions = accounts;
        state.suggestionsLoaded = true;
        suggestionRetry = { api, at: Date.now() + 300000 };
        if (["home", "discover"].includes(state.view)) render();
      } catch (error) {
        if (state.api === api) {
          state.suggestionsLoaded = false;
          suggestionRetry = { api, at: Math.max(Date.now() + 60000, error instanceof APIError ? error.retryAt || 0 : 0) };
        }
      }
    })();
    const request = suggestionRequest = { api, promise };
    void promise.finally(() => { if (suggestionRequest === request) suggestionRequest = undefined; });
    return promise;
  }
}
