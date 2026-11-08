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
  }
  const profileTabs: ProfileTab[] = ["posts", "replies", "likes", "boosts", "followers", "following"];

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
    return `<div class="recommended">${profileAvatar(account, false, `${key}:${account.id}`)}<div><a class="author-link" href="#${escapeHTML(profilePath(account.id))}">${escapeHTML(account.name)}</a><p>@${escapeHTML(account.acct)}</p>${account.bio ? `<p class="account-bio">${escapeHTML(account.bio)}</p>` : ""}</div>${followButton(account)}</div>`;
  }
  function currentProfile(profile: ProfileState, api: API | null): boolean {
    return state.profile === profile && state.view === "profile" && state.api === api;
  }
  export async function openProfile(id: string, query: string): Promise<void> {
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
    };
    state.profile = p;
    state.view = "profile";
    state.readerServer = server;
    render();
    try {
      if (sourceError) throw new Error(sourceError);
      p.account = p.api ? await p.api.account(id) : cached;
      if (!currentProfile(p, api)) return;
      if (!p.account) throw new Error("This account could not be found.");
      if (owner && state.session) {
        state.session.account = p.account;
        writeStore("session", state.session, state.session.remember !== true);
      }
      if (!server && api && !owner) {
        try {
          const relationships = await api.relationships([id]);
          if (!currentProfile(p, api)) return;
          relationships.forEach((r) => state.relationships.set(r.id, r));
        } catch { /* A profile remains readable without relationship metadata. */ }
      }
    } catch (error) {
      if (!currentProfile(p, api)) return;
      p.error = (error as Error).message;
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
  export async function loadProfilePage(append = false): Promise<void> {
    const p = state.profile, api = state.api;
    if (!p || p.loading || !p.account || (append && !p.next)) return;
    p.loading = true;
    p.error = "";
    if (!append) {
      p.posts = [];
      p.people = [];
      p.next = undefined;
      p.visited.clear();
    }
    render();
    try {
      if (!p.api) {
        const posts = demoProfilePosts();
        p.posts = posts.filter((post) => p.tab === "likes" ? post.liked :
          p.tab === "boosts" ? p.owner && post.reposted :
          ["posts", "replies"].includes(p.tab) && post.author.id === p.id && !!post.replyTo === (p.tab === "replies"));
        p.people = p.tab === "following" && p.owner
          ? demoAuthors.filter((a) => demoState.follows.includes(a.id))
          : p.tab === "followers" && !p.owner && demoState.follows.includes(p.id) ? [demoMe] : [];
        demoAuthors.forEach((a) => state.relationships.set(a.id, {
          id: a.id, following: demoState.follows.includes(a.id), requested: false,
        }));
        if (p.owner) p.account = { ...demoMe, statuses: posts.filter((post) => post.author.id === p.id).length, following: demoState.follows.length, followers: 0 };
      } else {
        // Bound scanning for sparse boosts/replies. The next cursor stays usable
        // even if none of the scanned pages contained matching activity.
        for (let page = 0; page < 4; page++) {
          const cursor = p.next;
          if (cursor) p.visited.add(cursor);
          const result = p.tab === "followers" || p.tab === "following"
            ? await p.api.accountConnections(p.id, p.tab, cursor)
            : p.tab === "likes"
              ? await p.api.favourites(cursor)
              : await p.api.accountPosts(p.id, p.tab, cursor);
          if (!currentProfile(p, api)) return;
          p.next = result.next && !p.visited.has(result.next) ? result.next : undefined;
          if ("accounts" in result) {
            p.people = [...new Map([...p.people, ...result.accounts].map((a) => [a.id, a])).values()];
          } else {
            const posts = p.server ? result.posts.filter((post) => canRepost(post)) : result.posts;
            p.posts = [...new Map([...p.posts, ...posts].map((post) => [post.id, post])).values()];
            if (p.owner && p.tab === "boosts") p.posts.forEach((post) => { post.reposted = true; });
          }
          const count = "accounts" in result ? result.accounts.length : result.posts.length;
          if (count || !p.next) break;
        }
        if (api && !p.server) {
          try {
            const relationships = await api.relationships([...p.people.map((a) => a.id), ...p.posts.map((post) => post.author.id)]);
            if (!currentProfile(p, api)) return;
            relationships.forEach((r) => state.relationships.set(r.id, r));
          } catch { /* Reading does not require relationships. */ }
        }
      }
    } catch (error) {
      if (currentProfile(p, api)) p.error = (error as Error).message;
    } finally {
      if (currentProfile(p, api)) { p.loading = false; render(); }
    }
  }
  export function profileView(): string {
    const p = state.profile, a = p?.account;
    if (!p || !a) return `<header class="page-top"><a href="#home" class="text-button">${icon("back")} Home</a></header>${emptyState(p?.loading ? "Opening profile…" : "Profile unavailable", p?.error || "", p && !p.loading ? action("profile-refresh", "Try again", "", "button subtle") : "")}`;
    const tabs = profileTabs.filter((tab) => tab !== "likes" || p.owner);
    const link = (tab: ProfileTab) => `#${escapeHTML(profilePath(p.id, tab, p.server))}`;
    const stats = ([['posts', a.statuses], ['followers', a.followers], ['following', a.following]] as const)
      .map(([tab, count]) => `<a href="${link(tab)}"><strong>${count === undefined ? "—" : count.toLocaleString()}</strong><span>${tab}</span></a>`).join("");
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
      <section class="profile-header"><div class="profile-cover">${a.header ? `<img src="${escapeHTML(safeURL(a.header, true))}" data-image-key="header:${escapeHTML(a.id)}" alt="${escapeHTML(a.name)}’s profile header" referrerpolicy="no-referrer">` : ""}</div>
      <div class="profile-details"><div class="profile-identity">${avatar(a, false, `profile:${a.id}`)}<div class="profile-buttons">${p.owner ? '<a href="#drafts" class="button subtle">' + icon("edit") + ' Your writing</a><a href="#bookmarks" class="button subtle">' + icon("bookmark") + ' Saved</a>' : p.server ? "" : `${followButton(a, false)}${action("message-account", `${icon("mail")} Message`, a.id, "button subtle")}`}</div></div>
      <h1>${escapeHTML(a.name)}</h1><p class="profile-handle">@${escapeHTML(a.acct)} ${a.locked ? `<span title="Approves follow requests">${icon("lock")}</span>` : ""}</p>
      ${state.relationships.get(a.id)?.followed_by && !p.server && !p.owner ? '<span class="profile-badge">Follows you</span>' : ""}
      ${a.bio ? `<p class="profile-bio">${escapeHTML(a.bio)}</p>` : ""}
      ${a.fields?.length ? `<dl class="profile-fields">${a.fields.map((f) => `<div><dt>${escapeHTML(f.name)}</dt><dd>${escapeHTML(f.value)}</dd></div>`).join("")}</dl>` : ""}
      <div class="profile-meta">${joined ? `<span>${joined}</span>` : ""}${a.url ? `<a href="${escapeHTML(safeURL(a.url))}" target="_blank" rel="noopener noreferrer">Original profile ${icon("external")}</a>` : ""}${!state.session && !p.server ? '<span>Fictional offline demo</span>' : ""}</div>
      <div class="profile-counts">${stats}</div></div></section>
      ${p.owner && p.tab === "posts" && p.posts.length ? `<section class="profile-insights" aria-label="Your post activity"><p>On these ${p.posts.length} loaded posts</p><div>${[["heart", "Likes received", "likes"], ["repost", "Boosts received", "reposts"], ["comment", "Replies received", "replies"]].map(([symbol, label, key]) => `<span>${icon(symbol)}<strong>${p.posts.reduce((n, post) => n + (post[key as "likes" | "reposts" | "replies"] || 0), 0).toLocaleString()}</strong> ${label}</span>`).join("")}</div></section>` : ""}
      <nav class="timeline-tabs profile-tabs" aria-label="Profile activity">${tabs.map((tab) => `<a href="${link(tab)}"${p.tab === tab ? ' class="active" aria-current="page"' : ""}>${tab[0].toUpperCase() + tab.slice(1)}${tab === "likes" ? ` ${icon("lock")}` : ""}</a>`).join("")}</nav>
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
  export async function loadSuggestions(): Promise<void> {
    const api = state.api;
    if (!api || state.suggestionsLoaded) return;
    state.suggestionsLoaded = true;
    try {
      const accounts = await api.suggestions();
      if (state.api !== api) return;
      const relationships = await api.relationships(accounts.map((a) => a.id));
      if (state.api !== api) return;
      // A follow may have completed while suggestions were loading.
      relationships.forEach((r) => { if (!state.relationships.has(r.id)) state.relationships.set(r.id, r); });
      state.suggestions = accounts;
      if (["home", "discover"].includes(state.view)) render();
    } catch { /* Suggestions are optional; known timeline authors are the fallback. */ }
  }
}
