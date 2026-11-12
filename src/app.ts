namespace Fedi {
  type FeedFilter = "all" | "article" | "post";
  const storedFilter = readStore<unknown>("home-filter", "all");
  let homeFilter: FeedFilter = storedFilter === "article" || storedFilter === "post" ? storedFilter : "all";
  const readerFontMin = 12, readerFontMax = 32;
  const storedReaderFontSize = readStore<unknown>("reader-font-size", 16);
  export const state = {
    session: loadSession(),
    api: null as API | null,
    view: "home" as View,
    timeline: "home" as Timeline,
    homeTimeline: "home" as HomeTimeline,
    filter: homeFilter,
    exploring: false,
    query: "",
    posts: [] as Post[],
    accounts: [] as Account[],
    searchTags: [] as string[],
    profile: null as ProfileState | null,
    suggestions: [] as Account[],
    suggestionsLoaded: false,
    next: undefined as string | undefined,
    loading: false,
    error: "",
    relationships: new Map<string, Relationship>(),
    revealed: new Set<string>(),
    lists: [] as UserList[],
    reading: null as Post | null,
    readerBack: "home",
    readerServer: "",
    comments: [] as Post[],
    replyDrafts: new Map<string, string>(),
    conversations: [] as Conversation[],
    conversation: "",
    conversationNext: undefined as string | undefined,
    draft: null as Draft | null,
    preview: false,
    focus: false,
    readerFontSize: typeof storedReaderFontSize === "number" && Number.isFinite(storedReaderFontSize)
      ? Math.max(readerFontMin, Math.min(readerFontMax, storedReaderFontSize)) : 16,
    discoveryLanguages: normalizeDiscoveryLanguages(
      readStore<unknown>("discovery-languages", readStore<unknown>("discovery-language", [])),
    ),
    libraryTab: "drafts",
    scheduledPosts: [] as ScheduledStatus[],
    serverDraftError: "",
    ownPosts: [] as Post[],
    ownNext: undefined as string | undefined,
    theme: readStore<string>("theme", "system"),
    linkPreviews: readStore<unknown>("link-previews", true) !== false,
  };
  let loadVersion = 0;
  const feedTarget = 10;
  const feedPageLimit = 3;
  let feedSource: string | undefined;
  let feedController: AbortController | undefined;
  let threadController: AbortController | undefined;
  export function cancelReadingRequests(): void {
    feedController?.abort();
    threadController?.abort();
    state.profile?.controller?.abort();
  }
  let feedInFlight: { key: string; api: API | null; promise: Promise<void> } | undefined;
  export const demoState = readStore<{
    posts: Post[];
    follows: string[];
    comments: Record<string, Post[]>;
    conversations: Conversation[];
  }>("demo", {
    posts: demoPosts,
    follows: ["mara", "ines"],
    comments: {},
    conversations: initialConversations(),
  });
  export function saveDemo(): void {
    if (!writeStore("demo", demoState))
      toast("Browser storage is full. Your changes are only kept in this tab.");
  }
  export function allAccounts(): Account[] {
    return [
      state.session?.account || demoMe,
      ...(state.profile?.account && !state.profile.server ? [state.profile.account] : []),
      ...(state.profile && !state.profile.server ? state.profile.people : []),
      ...(state.profile && !state.profile.server ? state.profile.posts.map((p) => p.author) : []),
      ...state.suggestions,
      ...state.accounts,
      ...state.posts.map((p) => p.author),
      ...state.comments.map((p) => p.author),
      ...(state.reading ? [state.reading.author] : []),
      ...state.conversations.flatMap((c) => c.accounts),
      ...(!state.session ? demoAuthors : []),
    ];
  }
  export function findPost(id: string): Post | undefined {
    if (state.view === "reader") {
      const post = state.reading?.id === id ? state.reading : state.comments.find((p) => p.id === id);
      if (post) return post;
    }
    if (state.view === "profile") {
      const post = state.profile?.posts.find((p) => p.id === id);
      if (post) return post;
    }
    if (state.readerServer) {
      const post = [state.reading, ...(state.profile?.server ? state.profile.posts : []), ...state.comments].find((p) => p?.id === id);
      if (post) return post;
    }
    return [
      ...state.posts,
      ...state.ownPosts,
      ...(state.profile && !state.profile.server ? state.profile.posts : []),
      ...state.comments,
      ...(state.reading ? [state.reading] : []),
      ...(!state.session
        ? [...demoState.posts, ...Object.values(demoState.comments).flat()]
        : []),
    ].find((p) => p.id === id);
  }
  const compactPublicationID = /^[A-Za-z0-9_-]{0,21}[AQgw]$/;
  function publicationID(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      const encoded = encodeURIComponent(id).replace(/^~/, "%7E");
      // Escape opaque IDs that could otherwise be mistaken for compact UUIDs.
      return compactPublicationID.test(encoded)
        ? `%${encoded.charCodeAt(0).toString(16).toUpperCase()}${encoded.slice(1)}`
        : encoded;
    }
    const bytes = id.replace(/-/g, "").match(/../g)!;
    // Leading zero groups are restored when reading; no UUID bits are lost.
    return btoa(String.fromCharCode(...bytes.map((byte) => parseInt(byte, 16))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").replace(/^A+(?=.)/, "");
  }
  function expandPublicationID(id: string, compact = false): string {
    const marked = id.startsWith("~");
    if (!marked && (!compact || !compactPublicationID.test(id))) return decodeURIComponent(id);
    const encoded = marked ? id.slice(1) : id.padStart(22, "A");
    if (!/^[A-Za-z0-9_-]{21}[AQgw]$/.test(encoded))
      throw new Error("This publication link is invalid.");
    const hex = Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + "=="),
      (byte) => byte.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  export function publicationLink(post: Post): string {
    const url = new URL(location.href);
    const server = state.readerServer || state.api?.server || state.session?.server;
    const username = post.author.acct.split("@")[0];
    url.search = "";
    url.hash = server
      ? `@${encodeURIComponent(username)}/${publicationID(post.id)}${server !== url.origin ? `?${new URLSearchParams({ server })}` : ""}`
      : `read/${encodeURIComponent(post.id)}`;
    return url.href;
  }
  export function navigate(path: string): void {
    if (state.view === "editor" && state.draft && path === `write/${encodeURIComponent(state.draft.id)}`) return;
    if (requestEditorLeave(() => navigate(path))) return;
    if (location.hash === `#${path}`) void route();
    else location.hash = path;
  }
  export function searchPath(query: string): string {
    return query ? `discover?${new URLSearchParams({ q: query })}` : "discover";
  }

  export function applyTheme(): void {
    const dark =
      state.theme === "dark" ||
      (state.theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  function navItems(): string[][] {
    return [
      ["home", "home", "Home"],
      ["discover", "compass", "Discover"],
      ["drafts", "edit", "Your writing"],
      ...(state.session ? [["notifications", "bell", "Notifications"]] : []),
      ["messages", "mail", "Messages"],
      ["settings", "settings", "Settings"],
    ];
  }
  function navView(): View {
    const { view } = state;
    return view === "editor" ? "drafts" : view === "bookmarks" || view === "replies" ? "home"
      : view === "people" ? "discover" : view;
  }
  const badgeLabels = {
    notifications: ["Notifications", "Notifications, new activity"],
    messages: ["Messages", "Messages, unread conversations"],
  };
  function navUnread(view: keyof typeof badgeLabels): boolean {
    return view === "notifications" ? hasNewNotifications() : hasUnreadMessages();
  }
  function navBadge(view: string): string {
    if (view !== "notifications" && view !== "messages") return "";
    const unread = navUnread(view);
    return `<span class="unread-dot" aria-hidden="true"${unread ? "" : " hidden"}></span>`;
  }
  function navBadgeAttributes(view: string): string {
    if (view !== "notifications" && view !== "messages") return "";
    return ` data-nav-badge="${view}" aria-label="${badgeLabels[view][Number(navUnread(view))]}"`;
  }
  export function updateNavBadges(): void {
    for (const view of ["notifications", "messages"] as const) {
      const unread = navUnread(view);
      for (const link of document.querySelectorAll<HTMLElement>(`[data-nav-badge="${view}"]`)) {
        const dot = link.querySelector<HTMLElement>(".unread-dot");
        if (dot) dot.hidden = !unread;
        link.setAttribute("aria-label", badgeLabels[view][Number(unread)]);
      }
    }
  }

  function sidebar(): string {
    const current = navView();
    const me = state.session?.account || demoMe;
    const items = navItems();
    return `<aside class="sidebar"><div class="brand-block"><a class="brand" href="#home"><img src="assets/favicon.svg" alt="">fedistack</a><p class="brand-date">${new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}</p></div>
      ${state.session ? "" : action("connect", "Sign in", "", "button primary account-action mobile-account-action")}
      <nav aria-label="Main navigation">${items.map(([view, symbol, name]) => `<a href="#${view}" class="nav-item ${current === view ? "active" : ""}" ${current === view ? 'aria-current="page"' : ""}${navBadgeAttributes(view)}>${icon(symbol)}<span>${name}</span>${view === "drafts" && getDrafts().length ? `<span class="nav-count">${getDrafts().length}</span>` : ""}${navBadge(view)}</a>`).join("")}</nav>
      <a href="#write" class="button primary write-button">${icon("edit")}<span>Write an article</span></a><a href="#note" class="button subtle note-button">${icon("comment")}<span>Note</span></a>
      <div class="sidebar-bottom"><div class="sidebar-tools"><button class="icon-button" data-action="theme" aria-label="Toggle light and dark theme">${icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon")}</button></div>
      ${state.session ? `<button class="profile-switch" data-action="account" aria-haspopup="dialog">${avatar(me, false, "sidebar")}<span><strong>${emojiText(me.name, me.emojis)}</strong><small>${escapeHTML(new URL(state.session.server).host)}</small></span>${icon("chevron")}</button>` : ""}</div></aside>`;
  }

  function rightRail(): string {
    return `<aside class="right-rail">${state.view === "discover" ? "" : `<form class="search-box" id="search-form">${icon("search")}<input name="query" aria-label="Search publications and people" placeholder="Search your corner of the world" value="${escapeHTML(state.query)}"><button type="submit" class="sr-only">Search</button></form>`}
      ${state.view === "people" ? "" : suggestionsView()}
      ${state.view === "discover" ? "" : `<section class="rail-section"><h3>Follow your curiosity</h3><div class="topics">${["Technology", "Culture", "Design", "Nature", "Life", "Writing"].map((t) => action("topic", t, t, "topic")).join("")}</div></section>`}
      <section class="little-note">${icon("globe")}<p>Your words. Your community.<br><strong>Your corner of the fediverse.</strong></p></section>
      <footer>Fedistack <span>·</span> Made for the open web<br><a href="#settings">About & settings</a>${!state.session && !state.readerServer ? "<p>Demo stories and people are fictional.</p>" : ""}</footer></aside>`;
  }

  function mobileNav(): string {
    const current = navView();
    const me = state.session?.account || demoMe;
    const items = navItems().filter(([view]) => view !== "settings");
    return `<nav class="mobile-nav" aria-label="Mobile navigation" style="--nav-items: ${items.length + 1}">${items.map(([view, symbol, name]) => `<a href="#${view}"${view === "drafts" ? ' class="mobile-write"' : ""}${navBadgeAttributes(view) || ` aria-label="${name}"`}${current === view ? ' aria-current="page"' : ""}>${icon(symbol)}${navBadge(view)}</a>`).join("")}${state.session ? `<a href="#profile" aria-label="Your profile"${current === "profile" && state.profile?.owner ? ' aria-current="page"' : ""}>${avatar(me, false, "mobile-account")}</a>` : '<button type="button" data-action="connect" class="mobile-sign-in" aria-label="Sign in" title="Sign in" aria-haspopup="dialog"></button>'}</nav>`;
  }

  export function render(): void {
    updatePullRefresh();
    const app = document.getElementById("app")!;
    const suggestionScrolls = new Map(Array.from(app.querySelectorAll<HTMLElement>(".suggestion-track"), (track) => [track.id, track.scrollLeft]));
    const search = document.activeElement as HTMLInputElement | null;
    const discovery = state.view === "discover" && search?.id === "discover-query" &&
      search.defaultValue === state.query ? document.getElementById("discover-content") : null;
    if (discovery) {
      renderHTML(discovery, discoverContent());
      setupLinkPreviews(app);
      setupSuggestionCarousels(suggestionScrolls);
      setupDiscoveryScroll();
      return;
    }
    const languagePicker = document.activeElement?.closest(".language-picker");
    const languageFocus = languagePicker ? document.activeElement?.id : "";
    const languageSelect = languagePicker?.querySelector("select")?.id;
    document.body.classList.toggle("focus-mode", state.focus);
    document.body.classList.toggle(
      "zen-mode",
      state.focus && state.view === "editor" && state.draft?.kind === "article",
    );
    document.body.classList.toggle("writing-view", state.view === "editor");
    document.body.classList.toggle("messages-view", state.view === "messages");
    document.body.classList.toggle(
      "conversation-open",
      state.view === "messages" &&
        state.conversations.some((c) => c.id === state.conversation),
    );
    const content =
      state.view === "editor"
        ? editorView()
        : state.view === "messages"
          ? messagesView()
          : state.view === "reader"
            ? readerView()
            : state.view === "drafts"
              ? libraryView()
              : state.view === "settings"
                ? settingsView()
                : state.view === "profile"
                  ? profileView()
                  : state.view === "people"
                    ? peopleView()
                    : state.view === "discover" ? discoverView()
                      : state.view === "notifications" ? notificationsView() : homeView();
    renderHTML(
      document.getElementById("app")!,
      `<div class="layout">${sidebar()}${!state.session ? action("connect", "Sign in", "", "button primary desktop-sign-in") : ""}<main id="main" tabindex="-1">${content}</main>${rightRail()}</div>${mobileNav()}`,
    );
    setupSuggestionCarousels(suggestionScrolls);
    setupDiscoveryScroll();
    setupLinkPreviews(app);
    if (languageFocus) {
      const target = document.getElementById(languageFocus) ||
        document.getElementById(languageSelect || "");
      if (target?.hasAttribute("disabled"))
        document.getElementById(`${languageSelect}-clear`)?.focus({ preventScroll: true });
      else target?.focus({ preventScroll: true });
    }
    updateEditorVim();
    if (state.view === "editor") updateEditorMeta();
    updateEditorViewport();
    document.title = `${state.view === "reader" && state.reading ? state.reading.title || (state.reading.kind === "article" ? "Article" : "Note") : state.view === "editor" ? (state.draft?.kind === "post" ? "New note" : state.draft?.title) || "New draft" : state.view === "profile" ? state.profile?.account?.name || "Profile" : state.view === "people" ? "People to follow" : state.view === "discover" ? "Discover" : state.view === "notifications" ? "Notifications" : state.view === "replies" ? "Replies" : "Your reading room"} — Fedistack`;
  }

  function normalizeDiscoveryLanguages(value: unknown): string[] {
    const languages = Array.isArray(value) ? value : [value];
    return [...new Set(languages.filter((language): language is string =>
      discoveryLanguages.some(([code]) => code === language),
    ))];
  }
  export function filterByLanguages(posts: Post[], languages: string[]): Post[] {
    if (!languages.length) return posts;
    const selected = languages.map((language) => language.toLowerCase().replace(/_/g, "-"));
    return posts.filter((post) => {
      const code = post.language?.toLowerCase().replace(/_/g, "-");
      return selected.some((language) => code === language || !!code?.startsWith(`${language}-`));
    });
  }
  export function setDiscoveryLanguages(languages: string[]): void {
    state.discoveryLanguages = normalizeDiscoveryLanguages(languages);
    if (!writeStore("discovery-languages", state.discoveryLanguages))
      toast("Language preferences are only saved for this tab.");
    if (state.view === "discover") updateFeedFilters();
    else render();
  }
  function visibleFeedPosts(source = state.posts): Post[] {
    let posts = source.filter(
      (p) => state.filter === "all" || p.kind === state.filter,
    );
    if (state.view === "discover") posts = filterByLanguages(undiscoveredPosts(posts), state.discoveryLanguages);
    if (state.query && !state.session)
      posts = posts.filter((p) =>
        `${p.title} ${p.markdown} ${p.author.name} ${p.tags.join(" ")}`
          .toLowerCase()
          .includes(state.query.toLowerCase().replace(/^#/, "")),
      );
    return posts;
  }
  export function updateFeedFilters(): void {
    render();
    const missing = feedTarget - visibleFeedPosts().length;
    if (state.api && !state.query && state.next && !state.loading && missing > 0)
      void loadFeed(true, missing);
  }
  function feedLists(): string {
    const selected = state.timeline.startsWith("list:");
    return `<section class="feed-lists" aria-label="List timeline"><div class="list-picker-row">${state.lists.length || selected ? `<label for="list-select">List<select id="list-select"><option value="">Choose a list…</option>${selected && !state.lists.some((list) => `list:${list.id}` === state.timeline) ? `<option value="${escapeHTML(state.timeline)}" selected>Current list</option>` : ""}${state.lists.map((list) => `<option value="list:${escapeHTML(list.id)}" ${state.timeline === `list:${list.id}` ? "selected" : ""}>${escapeHTML(list.title)}</option>`).join("")}</select></label>` : '<p>No lists yet. Create one to group people you follow.</p>'}${action("manage-lists", "Manage lists", "", "button subtle")}</div>${!selected && state.lists.length ? '<p class="muted">Choose a list to read its posts.</p>' : ""}</section>`;
  }
  export function setFeedFilter(filter: FeedFilter): void {
    state.filter = filter;
    if (state.view === "home") {
      homeFilter = filter;
      writeStore("home-filter", filter);
    }
    updateFeedFilters();
  }

  function feedFilters(): string {
    const filters = [["all", "All"], ["article", "Articles"], ["post", "Notes"]];
    return `<div class="feed-controls"><div class="filter-pills" aria-label="Content type">${filters.map(([type, label]) => `<button data-action="filter" data-id="${type}" class="${state.filter === type ? "selected" : ""}" aria-pressed="${state.filter === type}">${label}</button>`).join("")}</div></div>`;
  }

  function homeView(): string {
    const saved = state.view === "bookmarks", replies = state.view === "replies";
    const lists = !!state.session && !saved && !replies && state.timeline !== "home";
    const tabs = [["home", "Following"], ...(state.session ? [["lists", "Lists"], ["replies", "Replies"]] : []), ["bookmarks", "Saved"]];
    const heading = `<header class="page-intro feed-intro home-intro"><h1>Home</h1>${replies ? notificationRefreshButton() : saved || (lists && state.timeline === "lists") ? "" : feedFilters()}</header>
      <div class="timeline-tabs" aria-label="Personal timelines">${tabs.map(([type, label]) => {
        const active = type === (saved ? "bookmarks" : replies ? "replies" : lists ? "lists" : "home");
        return `<button data-action="timeline" data-id="${type}" class="${active ? "active" : ""}" aria-pressed="${active}">${label}</button>`;
      }).join("")}</div>${lists ? feedLists() : ""}`;
    if (replies) return heading + notificationList(true);
    if (lists && state.timeline === "lists") return heading;
    return heading + feedView();
  }

  function discoverView(): string {
    return `<header class="page-intro feed-intro"><h1>Discover</h1></header>
      <form id="discover-search" role="search" class="search-box discover-search">${icon("search")}<input id="discover-query" type="search" name="query" aria-label="Search people, posts, and hashtags" placeholder="People, posts, #tags" value="${escapeHTML(state.query)}"><button class="button subtle" aria-label="Search">${icon("arrow")}</button></form>
      <div id="discover-content">${discoverContent()}</div>`;
  }

  function discoverContent(): string {
    if (!state.exploring || state.query) {
      const title = state.query ? `Results for “${escapeHTML(state.query)}”`
        : state.timeline === "local" ? "Local timeline" : "Federated timeline";
      return `<div class="discover-section discover-results"><a class="text-button" href="#discover">${icon("back")} Discover</a><h2>${title}</h2>
        ${state.query ? '<p class="muted">Search covers content known to your server. Try #topic, a full @user@server address, or a post URL.</p>' : ""}</div>
        ${feedFilters()}${feedView()}`;
    }

    const posts = visibleFeedPosts();
    const topics = new Map<string, string>();
    for (const post of posts) {
      for (const tag of post.tags) {
        const key = tag.toLowerCase();
        if (hashtagName(`#${tag}`) && !topics.has(key)) topics.set(key, tag);
        if (topics.size === 6) break;
      }
      if (topics.size === 6) break;
    }
    const articles = discoveryArticles(posts);
    rememberDiscoveryArticles(articles);
    return `${topics.size ? `<section class="discover-section"><h2>Topics</h2><div class="discover-links">${Array.from(topics.values(), (tag) => hashtagLink(tag, "topic")).join("")}</div></section>` : ""}
      ${discoveryTimelineView()}`;
  }

  function feedError(): string {
    return state.error ? `<div class="error-panel" role="alert">${escapeHTML(state.error)}${action("refresh", "Try again", "", "button subtle")}</div>` : "";
  }

  function feedView(): string {
    const posts = visibleFeedPosts();
    const hasLanguages = state.view === "discover" && state.discoveryLanguages.length > 0;
    const searching = !!state.query;
    const empty = hasLanguages ? "No posts in the selected languages match the loaded results. Load older posts or change your languages in Settings."
      : state.filter !== "all" ? "No matching writing in the loaded posts. Try another filter or load older posts."
      : searching ? "No matching posts are available here. Your server may not have received them yet, or may limit full-text search. Try a hashtag or a specific post URL."
      : state.view === "bookmarks" ? "Bookmark a post to come back to it later."
      : "Follow a writer, explore a public timeline, or start a conversation.";
    const emptyLink = hasLanguages ? '<a href="#settings" class="button subtle">Change language settings</a>'
      : state.view === "home" && state.filter === "all" ? '<a href="#discover" class="button subtle">Explore the fediverse</a>' : "";
    return `${searching && state.searchTags.length ? `<div class="filter-pills search-tags" aria-label="Matching hashtags">${state.searchTags.map((tag) => hashtagLink(tag, "button subtle")).join("")}</div>` : ""}
      ${searching && state.accounts.length ? `<div class="account-results">${state.accounts.map((a) => accountRow(a, "search")).join("")}</div>` : ""}
      ${feedError()}
      <div class="feed">${posts.map((post) => postCard(post)).join("")}${!posts.length && !state.loading && !state.error && !state.accounts.length && !state.searchTags.length ? emptyState("A little quiet here", empty, emptyLink) : ""}</div>
      ${state.loading ? `<div class="loading" role="status">${posts.length ? "Updating your reading…" : "Gathering your reading…"}</div>` : state.next ? `<div class="load-more">${action("load-more", searching ? "Load more results" : "Load older posts", "", "button subtle")}</div>` : posts.length ? `<div class="end-note">${searching ? "End of available search results." : "You’re all caught up. Go make a little something."}</div>` : ""}`;
  }

  export function loadFeed(
    append = false,
    target = feedTarget,
    force = true,
    quiet = false,
  ): Promise<void> {
    const api = state.api;
    const key = JSON.stringify([state.view, state.timeline, state.query, state.filter,
      state.exploring, state.discoveryLanguages, append, target]);
    if (state.loading && feedInFlight?.api === api && feedInFlight.key === key)
      return feedInFlight.promise;
    const promise = runLoadFeed(append, target, force, quiet);
    const request = { api, key, promise };
    feedInFlight = request;
    const done = () => { if (feedInFlight === request) feedInFlight = undefined; };
    void promise.then(done, done);
    return promise;
  }

  async function runLoadFeed(
    append: boolean,
    target: number,
    force: boolean,
    quiet: boolean,
  ): Promise<void> {
    if (append && !state.next) return;
    const version = ++loadVersion,
      api = state.api;
    feedController?.abort();
    const controller = feedController = new AbortController();
    const current = () => version === loadVersion && state.api === api && !controller.signal.aborted;
    if (state.view === "discover" && state.exploring && !state.query) {
      feedSource = undefined;
      await loadDiscovery(api, controller.signal, current, append, quiet);
      return;
    }
    const previous = state.posts, previousNext = state.next;
    const visible = () => JSON.stringify([state.posts, state.accounts, state.searchTags,
      state.next, state.error, [...state.relationships.values()]]);
    let shown = quiet ? visible() : "";
    const update = () => {
      if (quiet && state.loading) return;
      const next = quiet ? visible() : "";
      if (!quiet || shown !== next) { render(); shown = next; }
    };
    const existing = new Set(append ? state.posts.map((p) => p.id) : []);
    const visited = new Set<string>();
    const tagQuery = hashtagName(state.query.trim());
    const searching = !!state.query && !tagQuery;
    const timeline = tagQuery ? `tag:${tagQuery}` as Timeline : state.view === "bookmarks" ? "bookmarks" : state.timeline;
    if (timeline === "lists") {
      state.posts = [];
      state.accounts = [];
      state.next = undefined;
      state.loading = false;
      state.error = "";
      feedSource = undefined;
      render();
      return;
    }
    const key = !state.query ? feedCacheKey(timeline) : undefined;
    const generation = feedCacheGeneration();
    const cached = key ? readFeedCache(key) : undefined;
    let updated = cached?.updated || 0;
    let loaded: Post[] = append ? state.posts : [];
    const save = () => {
      if (key && current() && state.posts === loaded && generation === feedCacheGeneration()) {
        const authors = new Set(state.posts.map((post) => post.author.id));
        writeFeedCache({ key, posts: state.posts, next: state.next, updated,
          relationships: [...state.relationships.values()].filter((r) => authors.has(r.id)) });
      }
    };
    let cursor = append ? state.next : undefined;
    const requestedRelationships = new Set<string>();
    let reuseCache = false;
    state.loading = true;
    state.error = "";
    if (!append && !quiet) {
      if (cached) {
        state.posts = cached.posts;
        state.next = cached.next;
        cached.relationships.forEach((r) => state.relationships.set(r.id, r));
      } else if (!key || key !== feedSource) {
        state.posts = [];
        state.next = undefined;
      }
      state.accounts = [];
      state.searchTags = [];
      feedSource = key;
      if (cached && !force && Date.now() - cached.updated < (cached.posts.length ? 60000 : 5000)) {
        state.loading = false;
        reuseCache = true;
      }
    }
    update();
    if (!append && !quiet && state.view !== "bookmarks") void loadSuggestions();
    if (reuseCache) return;
    try {
      let posts: Post[];
      if (!api) {
        // Older demo saves predate language labels; all bundled stories are English.
        demoState.posts.forEach((p) => {
          if (demoAuthors.some((a) => a.id === p.author.id)) p.language = "en";
        });
        posts = demoState.posts.filter((p) => p.visibility !== "direct");
        if (state.view === "bookmarks") posts = posts.filter((p) => p.saved);
        else if (timeline === "home")
          posts = posts.filter(
            (p) =>
              demoState.follows.includes(p.author.id) || p.author.id === "you",
          );
        else if (timeline === "local")
          posts = posts.filter((p) => p.local || p.author.id === "you");
        if (timeline === "home") posts.sort((a, b) => b.created.localeCompare(a.created));
        if (state.view === "discover" && state.query)
          state.accounts = demoAuthors.filter((a) =>
            `${a.name} ${a.acct}`
              .toLowerCase()
              .includes(state.query.toLowerCase()),
          );
        state.relationships = new Map(
          demoAuthors.map((a) => [
            a.id,
            {
              id: a.id,
              following: demoState.follows.includes(a.id),
              requested: false,
            },
          ]),
        );
      } else posts = [];
      const paginated = !!api;
      for (let page = 0; page < feedPageLimit; page++) {
        if (api && paginated) {
          if (cursor) visited.add(cursor);
          let result: { posts: Post[]; next?: string };
          if (searching) {
            const found = await api.search(state.query, controller.signal, cursor);
            if (!current()) return;
            state.accounts = [...new Map([...(quiet && !append ? [] : state.accounts), ...found.accounts].map((account) => [account.id, account])).values()];
            state.searchTags = [...new Set([...(quiet && !append ? [] : state.searchTags), ...(found.hashtags || [])])];
            result = found;
          } else result = await api.timeline(timeline, cursor, controller.signal);
          if (!current()) return;
          posts = result.posts;
          if (page === 0 && !append) updated = Date.now();
          state.next =
            result.next && !visited.has(result.next) ? result.next : undefined;
          cursor = state.next;
        }
        if (!current()) return;
        rememberDiscoveryLikes(posts);
        loaded = [...new Map([...loaded, ...posts].map((p) => [p.id, p])).values()];
        // A refresh only reads the head. Keep already loaded older pages when
        // it overlaps, otherwise retain the new cursor so no unseen gap is lost.
        if (quiet && !append && !state.query && state.next && posts.length) {
          const overlap = previous.findIndex((post) => post.id === posts[posts.length - 1].id);
          if (overlap >= 0) {
            const ids = new Set(loaded.map((post) => post.id));
            loaded.push(...previous.slice(overlap + 1).filter((post) => !ids.has(post.id)));
            state.next = previousNext;
          }
        }
        // Keep readable cached articles while scanning note-only fresh pages.
        if (append || visibleFeedPosts(loaded).length || !visibleFeedPosts().length)
          state.posts = loaded;
        if (!paginated) state.next = undefined;
        save();
        update();
        if (api) {
          const ids = [...new Set([
              ...posts.map((p) => p.author.id),
              ...state.accounts.map((a) => a.id),
            ])].filter((id) => !requestedRelationships.has(id));
          ids.forEach((id) => requestedRelationships.add(id));
          if (ids.length) {
            void api.relationships(ids).then((relations) => {
              if (!current()) return;
              relations.forEach((r) => state.relationships.set(r.id, r));
              save();
              update();
            }).catch(() => { /* Relationship metadata is optional for reading. */ });
          }
        }
        if (!current()) return;
        if (
          quiet || !paginated || searching ||
          !state.next ||
          visibleFeedPosts(loaded).filter((p) => !existing.has(p.id)).length >= target
        )
          break;
        update();
      }
      state.posts = loaded;
      save();
    } catch (error) {
      if (current()) {
        state.error = (error as Error).message;
        if (cached && state.posts !== loaded) state.next = cached.next;
        if (error instanceof APIError && (error.status === 401 || error.status === 403)) {
          clearFeedCache();
          state.posts = [];
          state.next = undefined;
        }
      }
    } finally {
      if (current()) {
        state.loading = false;
        update();
      }
    }
  }

  export function canRefreshReading(): boolean {
    return state.view === "profile" ? !!state.profile?.api :
      ["home", "discover", "bookmarks"].includes(state.view) &&
      (state.view !== "home" || state.timeline !== "lists");
  }
  let readingRefresh: { api: API | null; key: string; at: number; manualAt: number; failures: number } | undefined;
  let refreshingReading = false;
  export async function refreshReading(now = Date.now(), manual = false): Promise<void> {
    const p = state.view === "profile" ? state.profile : null, api = p?.api || state.api;
    if (!canRefreshReading() || refreshingReading || state.loading || p?.loading || profileImageUpdating() ||
        (!manual && (!api || state.query || state.view === "bookmarks" ||
        (state.view === "discover" && state.exploring && state.posts.length > 0) ||
        (typeof window !== "undefined" && window.scrollY > 200))) ||
        (typeof document !== "undefined" && (document.hidden || document.activeElement?.matches("input,textarea,[contenteditable=true]"))) ||
        (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    const key = JSON.stringify([state.view, state.timeline, state.query, p?.id, p?.tab, p?.server]);
    const empty = p ? !p.posts.length && !p.people.length : !state.posts.length;
    const interval = empty ? 5000 : 30000;
    if (readingRefresh?.api !== api || readingRefresh.key !== key)
      readingRefresh = { api, key, at: 0, manualAt: 0, failures: 0 };
    const refresh = readingRefresh;
    const updated = p ? p.updated : !state.query && !(state.view === "discover" && state.exploring)
      ? readFeedCache(feedCacheKey(state.view === "bookmarks" ? "bookmarks" : state.timeline) || "")?.updated || 0 : 0;
    const due = manual ? Math.max(refresh.manualAt, refresh.failures ? refresh.at : 0, updated + 5000)
      : Math.max(refresh.at, updated + interval);
    if (now < due) return;
    refreshingReading = true;
    try {
      if (p) await refreshProfile();
      else await loadFeed(false, feedTarget, true, true);
      const failed = p ? !!p.error : !!state.error || (state.view === "discover" && state.exploring &&
        !!(discovery.errors.local || discovery.errors.federated));
      refresh.failures = failed ? refresh.failures + 1 : 0;
      refresh.at = now + (failed ? Math.min(120000, interval * 2 ** refresh.failures) : interval);
      refresh.manualAt = Math.max(now, Date.now()) + 5000;
    } finally { refreshingReading = false; }
  }

  function readerPostProblem(post: Post, publicReading: boolean): string {
    if (post.visibility === "direct") return "This is a private message. Open it from Conversations.";
    if (publicReading && post.visibility !== "public" && post.visibility !== "unlisted")
      return "This publication requires access through its server. Connect an authorized account to read it.";
    return "";
  }

  export async function refreshReader(): Promise<void> {
    const { reading, api, readerServer } = state;
    if (state.view !== "reader" || state.loading || !reading) return;
    const readerAPI = readerServer ? new API(readerServer) : api;
    if (!readerAPI) return;
    threadController?.abort();
    const controller = threadController = new AbortController();
    const hash = location.hash;
    const current = () => !controller.signal.aborted && location.hash === hash && state.view === "reader" &&
      state.api === api && state.readerServer === readerServer && state.reading === reading;
    const content = () => JSON.stringify([state.reading, state.comments]);
    const before = content();
    let checkingAccess = true, post: Post, comments: Post[];
    try {
      post = await readerAPI.status(reading.id, controller.signal);
      if (!current()) return;
      const problem = readerPostProblem(post, !!readerServer);
      if (problem) throw new APIError(problem, 403);
      checkingAccess = false;
      comments = await loadThread(readerAPI, post, !!readerServer, controller.signal);
    } catch (error) {
      if (!current()) return;
      if (!checkingAccess || !(error instanceof APIError) || ![401, 403, 404, 410].includes(error.status)) throw error;
      state.reading = null;
      state.comments = [];
      state.error = error.message;
      render();
      return;
    }
    // A reply or reaction can finish while the refresh is in flight.
    if (!current() || content() !== before || (!state.error && JSON.stringify([post, comments]) === before)) return;
    state.reading = post;
    state.comments = comments;
    state.error = "";
    render();
  }

  async function loadThread(api: API, post: Post, publicReading: boolean, signal: AbortSignal): Promise<Post[]> {
    const visible = (p: Post) => p.id !== post.id && p.visibility !== "direct" &&
      (!publicReading || p.visibility === "public" || p.visibility === "unlisted");
    const { ancestors, descendants } = await api.statusContext(post.id, signal);
    const ancestorIds = new Set(ancestors.map((p) => p.id));
    const replies = new Map(descendants.filter((p) => visible(p) && !ancestorIds.has(p.id)).map((p) => [p.id, p]));
    const checked = new Set<string>();

    // Some servers truncate the root context. Query only branches with missing children.
    for (let remaining = 6; remaining > 0 && !signal.aborted;) {
      const counts = new Map<string, number>();
      for (const { replyTo } of replies.values())
        if (replyTo) counts.set(replyTo, (counts.get(replyTo) || 0) + 1);
      const branches = [...replies.values()]
        .filter((p) => !checked.has(p.id) && p.replies > (counts.get(p.id) || 0))
        .slice(0, Math.min(3, remaining));
      if (!branches.length) break;
      remaining -= branches.length;
      const results = await Promise.allSettled(branches.map(({ id }) => {
        checked.add(id);
        return api.statusContext(id, signal);
      }));
      for (const result of results)
        if (result.status === "fulfilled")
          for (const p of result.value.descendants)
            if (visible(p) && !replies.has(p.id) && !ancestorIds.has(p.id))
              replies.set(p.id, p);
    }
    return [...ancestors.filter(visible), ...replies.values()];
  }

  function demoThread(post: Post): Post[] {
    const comments = [...Object.values(demoState.comments).flat(), ...demoState.posts.flatMap(demoComments)];
    const byId = new Map([...demoState.posts, ...comments].map((p) => [p.id, p]));
    const children = new Map<string, Post[]>();
    for (const comment of comments) {
      if (!comment.replyTo || comment.visibility === "direct") continue;
      if (!children.has(comment.replyTo)) children.set(comment.replyTo, []);
      children.get(comment.replyTo)!.push(comment);
    }
    const seen = new Set([post.id]), thread: Post[] = [];
    for (let parent = byId.get(post.replyTo || ""); parent && !seen.has(parent.id); parent = byId.get(parent.replyTo || "")) {
      if (parent.visibility === "direct") break;
      seen.add(parent.id);
      thread.unshift(parent);
    }
    const pending = [...(children.get(post.id) || [])];
    for (const comment of pending) {
      if (seen.has(comment.id)) continue;
      seen.add(comment.id);
      thread.push(comment);
      for (const reply of children.get(comment.id) || []) pending.push(reply);
    }
    return thread;
  }

  export async function route(force = false): Promise<void> {
    const fromReader = state.view === "reader";
    if (state.view === "editor" && state.draft) {
      const destination = location.hash.slice(1), editorPath = `write/${encodeURIComponent(state.draft.id)}`;
      if (destination === editorPath) return;
      if (requestEditorLeave(() => navigate(destination))) {
        // Hash changes also cover the browser's Back and Forward buttons.
        history.replaceState(null, "", `#${editorPath}`);
        return;
      }
      state.draft = null;
    }
    const [path, query = ""] = location.hash.slice(1).split("?");
    const params = new URLSearchParams(query);
    let [page, rawId] = path.split("/");
    if (page === "home" && params.get("tab") === "replies") page = "replies";
    const sharedPublication = page === "p" || page.startsWith("@");
    let id = "";
    try {
      id = decodeURIComponent(rawId || "");
    } catch {
      /* Ignore malformed hashes. */
    }
    loadVersion++;
    cancelReadingRequests();
    state.error = "";
    state.loading = false;
    state.focus = false;
    // Public reader IDs belong to their source server, not the current account.
    if (state.readerServer) {
      state.reading = null;
      state.comments = [];
    }
    state.readerServer = "";
    state.profile = null;
    // Demo reader URLs can survive sign-in or be restored with a saved session.
    // Only bare, uncached demo links should leave the reader; shared IDs are real.
    if (state.session && page === "read" && !new URLSearchParams(query).get("server") &&
        !findPost(id) && [...demoPosts, ...demoState.posts, ...Object.values(demoState.comments).flat()]
          .some((post) => post.id === id)) {
      page = "home";
      history.replaceState(null, "", "#home");
    }
    if (page === "profile") {
      await openProfile(id || state.session?.account.id || demoMe.id, query, force);
      return;
    }
    if (page === "write" || page === "note") {
      if (id && state.api && !getDrafts().some((d) => d.id === id)) {
        const version = loadVersion;
        await loadServerDrafts();
        if (version !== loadVersion) return;
      }
      state.view = "editor";
      state.draft =
        getDrafts().find((d) => d.id === id) ||
        newDraft(page === "note" ? "post" : "article");
      history.replaceState(
        null,
        "",
        `#write/${encodeURIComponent(state.draft.id)}`,
      );
      state.preview = false;
      writeStore(`${draftKey()}:resume`, state.draft.id);
      render();
      return;
    }
    if (page === "read" || sharedPublication) {
      // Shared links default to this origin, even when signed in elsewhere.
      // Legacy internal #read links continue to use the connected account.
      // The username is descriptive; the server and ID locate the publication.
      const source = new URLSearchParams(query).get("server") ||
        (sharedPublication ? location.origin : "");
      if (!fromReader) state.readerBack = state.view === "discover"
        ? state.query ? searchPath(state.query) : state.exploring ? "discover" : `discover?timeline=${state.timeline}`
        : state.view === "replies" ? "home?tab=replies" : state.view === "notifications" ? "notifications" : "home";
      state.view = "reader";
      state.reading = source ? null : findPost(id) ||
        (!state.api ? demoState.posts.flatMap(demoComments).find((p) => p.id === id) : null) || null;
      if (source) state.revealed.delete(id);
      state.comments = [];
      state.loading = true;
      render();
      const version = loadVersion, api = state.api;
      const controller = threadController = new AbortController();
      try {
        if (sharedPublication) {
          id = expandPublicationID(rawId || "", page.startsWith("@"));
          if (!id) throw new Error("This publication link is invalid.");
          state.revealed.delete(id);
        }
        const server = source ? serverURL(source) : "";
        let readerAPI = server && server !== api?.server ? new API(server) : api;
        let post = state.reading || (readerAPI ? await readerAPI.status(id, controller.signal) : null);
        if (version !== loadVersion || state.api !== api) return;
        if (!post) throw new Error("This publication is not available.");
        const problem = readerPostProblem(post, !!readerAPI && readerAPI !== api);
        if (problem) {
          state.reading = null;
          throw new Error(problem);
        }
        if (api && readerAPI !== api && post.url) {
          try {
            const originalURL = post.url;
            const resolved = (await api.search(originalURL)).posts.find((p) => p.url === originalURL);
            if (resolved) {
              post = resolved;
              readerAPI = api;
            }
          } catch {
            // Keep the public article readable if the reader's server cannot resolve it.
          }
          if (version !== loadVersion || state.api !== api) return;
        }
        state.readerServer = readerAPI && readerAPI !== api ? readerAPI.server : "";
        state.reading = post;
        render();
        const comments = readerAPI
          ? await loadThread(readerAPI, post, !!state.readerServer, controller.signal)
          : demoThread(post);
        if (version !== loadVersion || state.api !== api) return;
        state.comments = [...new Map([...comments, ...state.comments].map((p) => [p.id, p])).values()];
      } catch (error) {
        if (version === loadVersion) state.error = (error as Error).message;
      } finally {
        if (version === loadVersion) {
          state.loading = false;
          render();
        }
      }
      return;
    }
    state.view = (
      [
        "home",
        "discover",
        "people",
        "bookmarks",
        "drafts",
        "messages",
        "notifications",
        "replies",
        "settings",
      ].includes(page)
        ? page
        : "home"
    ) as View;
    if (state.view === "people") {
      const api = state.api;
      state.loading = !!api && !state.suggestionsLoaded;
      render();
      await loadSuggestions();
      if (state.view === "people" && state.api === api) {
        state.loading = false;
        render();
      }
      return;
    }
    if (state.view === "notifications" || state.view === "replies") {
      state.query = "";
      await loadNotifications();
      return;
    }
    if (state.view === "messages") {
      state.conversation = id;
      await loadConversations();
      return;
    }
    if (state.view === "drafts") {
      render();
      await loadWriting();
      return;
    }
    if (state.view === "settings") {
      render();
      return;
    }
    state.query = state.view === "discover" ? params.get("q")?.trim() || "" : "";
    if (state.view === "discover") {
      const timeline = params.get("timeline");
      state.exploring = !state.query && timeline !== "local" && timeline !== "federated";
      state.timeline = !state.query && timeline === "local" ? "local" : "federated";
    } else {
      state.exploring = false;
      state.timeline = state.homeTimeline;
    }
    state.filter = state.view === "home" ? homeFilter : "all";
    if (!force && fromReader && state.view === "discover" && state.exploring && restoreDiscovery()) return;
    await loadFeed(false, feedTarget, false);
  }

  export function changeReaderFontSize(step: -2 | 2): void {
    if (state.view !== "reader") return;
    state.readerFontSize = Math.max(readerFontMin, Math.min(readerFontMax, state.readerFontSize + step));
    document.querySelector<HTMLElement>(".reader .reading-prose")?.style.setProperty("--reader-font-size", `${state.readerFontSize}px`);
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action="reader-font-size"]')) {
      button.setAttribute("aria-disabled", String(button.dataset.id === "decrease"
        ? state.readerFontSize <= readerFontMin : state.readerFontSize >= readerFontMax));
    }
    writeStore("reader-font-size", state.readerFontSize);
  }

  function threadComments(post: Post): string {
    const byId = new Map([...state.comments, post].map((p) => [p.id, p]));
    const children = new Map<string, Post[]>();
    const roots: Post[] = [];
    for (const p of byId.values()) {
      if (p.replyTo && byId.has(p.replyTo)) {
        if (!children.has(p.replyTo)) children.set(p.replyTo, []);
        children.get(p.replyTo)!.push(p);
      } else roots.push(p);
    }
    const seen = new Set<string>(), html: string[] = [];
    for (const root of [...roots, ...byId.values()]) {
      const pending = [{ p: root, depth: 0 }];
      while (pending.length) {
        const { p, depth } = pending.pop()!;
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        if (p.id !== post.id) html.push(commentCard(p, byId.get(p.replyTo || ""), depth));
        const replies = children.get(p.id) || [];
        for (let i = replies.length - 1; i >= 0; i--)
          pending.push({ p: replies[i], depth: p.id === post.id ? 0 : depth + 1 });
      }
    }
    return html.join("");
  }

  function readerView(): string {
    const p = state.reading;
    if (!p)
      return `<div class="page-intro">${emptyState(state.loading ? "Opening your next read…" : "Publication unavailable", state.error, '<a class="button subtle" href="#home">Back home</a>')}</div>`;
    const hidden = p.warning && !state.revealed.has(p.id);
    const publicReading = !!state.readerServer;
    const article = p.kind === "article";
    const title = article ? p.title : "";
    const content = article ? articleContent(p) : { subtitle: "", body: "" };
    const mentions = postMentionContext(p);
    const author = `<a class="author-link" href="#${escapeHTML(profilePath(p.author.id))}">${emojiText(p.author.name, p.author.emojis)}</a>`;
    const replyForm = publicReading
      ? `<p class="muted">${state.session ? "Open the original post to join the conversation." : `Sign in to join the conversation. ${action("connect", "Sign in", "", "text-button")}`}</p>`
      : `<form id="reply-form"><label class="sr-only" for="reply-body">Write a comment</label><textarea id="reply-body" name="body" rows="3" required placeholder="Add a little perspective…">${escapeHTML(state.replyDrafts.get(p.id) || "")}</textarea><div class="reply-footer"><span>${p.visibility === "private" ? "Followers only" : p.visibility === "unlisted" ? "Unlisted reply" : "Public reply"}${!state.session || state.session.format !== "text/plain" ? " · Markdown supported" : ""}</span>${emojiPickerButton("reply-body")}<button class="button primary" type="submit">Reply ${icon("arrow")}</button></div></form>`;
    return `<header class="page-top"><a class="text-button reader-back" href="#${escapeHTML(state.readerBack)}" aria-label="Back to reading">${icon("back")}<span>Back to reading</span></a><div class="reader-controls"><button class="icon-button reader-font-button" data-action="reader-font-size" data-id="decrease" aria-label="Decrease font size" title="Decrease font size" aria-disabled="${state.readerFontSize <= readerFontMin}">A−</button><button class="icon-button reader-font-button" data-action="reader-font-size" data-id="increase" aria-label="Increase font size" title="Increase font size" aria-disabled="${state.readerFontSize >= readerFontMax}">A+</button><button class="icon-button" data-action="focus" aria-label="${state.focus ? "Leave" : "Enter"} focus mode" title="Focus mode">${icon("book")}</button>${editPublicationButton(p)}</div></header><article class="reader${article ? "" : " note-reader"}">
      ${hidden ? `<div class="content-warning"><h2>${emojiText(p.warning, p.emojis)}</h2>${action("reveal", "Show publication", p.id, "button subtle")}</div>` : `${title ? `<span class="eyebrow">${escapeHTML(p.author.publication || "INDEPENDENT WRITING")}</span>` : ""}${!publicReading && p.author.id === (state.session?.account.id || "you") ? `<span class="published-badge">${state.session ? "Published" : "Published in demo"}</span>` : ""}${title ? `<h1>${emojiText(title, p.emojis)}</h1>` : ""}${content.subtitle ? `<p class="reader-subtitle">${mentionText(content.subtitle, mentions, p.emojis)}</p>` : ""}`}
      <div class="post-byline">${profileAvatar(p.author, false, `post:${p.id}`)}<div>${author}<div class="byline-sub">${new Date(p.created).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}${article ? ` · ${readingTime(p.markdown)} min read` : ""}</div></div>${publicReading ? "" : followButton(p.author)}</div>
      ${article ? postActions(p) : ""}${hidden ? "" : article ? `${!p.media?.length && p.image ? `<img class="reader-cover" data-image-key="cover:${escapeHTML(p.id)}" src="${escapeHTML(p.image)}" alt="${escapeHTML(p.imageAlt || "")}">` : ""}<div class="prose reading-prose" style="--reader-font-size: ${state.readerFontSize}px">${markdown(content.body, mentions, p.emojis)}</div>${attachmentGallery(p.media, p.markdown)}${postLinkPreview(p)}<div class="reader-end">${icon("leaf")}<span>Thanks for reading. Keep the conversation going.</span></div>` : noteContent(p, true)}${article ? "" : postActions(p)}</article>
      <section class="comments"><div class="section-heading"><h2>Conversation <span>${p.replies}</span></h2>${action("share", "Share publication", p.id, "text-button")}</div>${replyForm}
      ${state.error ? `<p class="form-error" role="alert">${escapeHTML(state.error)}</p>` : ""}${state.loading ? '<p class="loading">Loading the conversation…</p>' : threadComments(p) || '<p class="muted">Be the first to start the conversation.</p>'}</section>`;
  }

  function libraryView(): string {
    const drafts = getDrafts(),
      writing = state.session
        ? state.ownPosts
        : [...new Map(
            [...demoState.posts, ...Object.values(demoState.comments).flat()]
              .filter((p) => p.author.id === "you" && p.visibility !== "direct")
              .map((p) => [p.id, p]),
          ).values()].sort((a, b) => b.created.localeCompare(a.created)),
      posts = writing.filter((p) => !p.replyTo),
      replies = writing.filter((p) => !!p.replyTo),
      showingReplies = state.libraryTab === "replies";
    const resume = drafts.find((d) => d.id === readStore<string>(`${draftKey()}:resume`, "")) || drafts[0];
    const continueEditing = resume ? `<section class="continue-editing" aria-labelledby="continue-editing-title"><div><span class="eyebrow">WORK IN PROGRESS${resume.editingId ? " · UNPUBLISHED CHANGES" : ""}</span><h2 id="continue-editing-title">${escapeHTML(resume.kind === "post" ? resume.body.trim().slice(0, 60) || "Untitled note" : resume.title || "Untitled article")}</h2><p>Saved on this device · ${relativeDate(resume.updated)}${resume.editingId ? ". Your published version is unchanged." : ". Your draft is unpublished."}</p></div><a href="#write/${encodeURIComponent(resume.id)}" class="button primary">Continue editing ${icon("arrow")}</a></section>` : "";
    return `<header class="page-top"><span>A SPACE FOR YOUR IDEAS</span><div><a href="#note" class="button subtle small-button">Note</a><a href="#write" class="button primary small-button">${icon("plus")} Article</a></div></header><div class="page-intro"><h1>Your writing<span class="accent">.</span></h1><p>A passing thought today. Someone’s favorite read tomorrow.</p></div>
      ${state.session ? `<p class="account-stats">${(state.session.account.followers ?? 0).toLocaleString()} followers <span>·</span> ${(state.session.account.following ?? 0).toLocaleString()} following <span>·</span> ${(state.session.account.statuses ?? 0).toLocaleString()} total posts</p>` : ""}<div class="stats-grid"><div><strong>${drafts.length}</strong><span>Saved drafts</span></div><div><strong>${posts.length}${state.ownNext ? "+" : ""}</strong><span>Publications loaded</span></div><div><strong>${posts.reduce((n, p) => n + p.likes, 0)}</strong><span>Likes on these posts</span></div><div><strong>${posts.reduce((n, p) => n + p.replies, 0)}</strong><span>Replies on these posts</span></div></div>
      ${continueEditing}<div class="timeline-tabs">${(state.session ? ["drafts", "scheduled", "published", "replies"] : ["drafts", "published", "replies"]).map((t) => `<button data-action="library-tab" data-id="${t}" class="${state.libraryTab === t ? "active" : ""}">${t === "drafts" ? `Drafts (${drafts.length})` : t === "replies" ? "Replies" : t === "scheduled" ? `Scheduled (${state.scheduledPosts.length})` : "Published"}</button>`).join("")}</div>
      <div class="draft-list">${state.libraryTab === "drafts" ? drafts.map((d) => `<article class="draft-card"><div><span class="eyebrow">${d.editingId ? "Unpublished changes" : d.kind === "post" ? "Note · work in progress" : "Article · work in progress"} · ${relativeDate(d.updated)}</span><a href="#write/${encodeURIComponent(d.id)}"><h2>${escapeHTML(d.kind === "post" ? d.body.trim().slice(0, 60) || "Untitled note" : d.title || "Untitled article")}</h2></a><p>${escapeHTML(plainText(d.body).slice(0, 120) || "A blank page, full of possibility.")}</p><small>${d.body.trim() ? d.body.trim().split(/\s+/).length : 0} words · Saved on this device${state.session ? ` · ${escapeHTML(serverDraftLabel(d))}` : ""}</small></div><div class="draft-actions"><a class="button subtle" href="#write/${encodeURIComponent(d.id)}">Continue editing ${icon("arrow")}</a>${action("export-draft", "Export .md", d.id, "text-button")}${action("delete-draft", "Delete", d.id, "text-button muted")}</div></article>`).join("") || emptyState("Every good story starts here", "Your drafts autosave as you write. Start something new.", '<a href="#write" class="button primary">Start writing</a>') : state.libraryTab === "scheduled" ? scheduledPostsView() : (showingReplies ? replies : posts).map((p) => postCard(p)).join("") || (state.loading ? "" : emptyState(showingReplies ? "Your replies and comments" : "Your words will find a home", state.ownNext ? `No ${showingReplies ? "replies" : "publications"} in the loaded posts. Load older ${showingReplies ? "replies" : "publications"} to keep looking.` : showingReplies ? "Your replies and comments on posts will appear here." : "Published articles and notes will appear here."))}</div>
      ${state.error ? `<p class="error-panel">${escapeHTML(state.error)}</p>` : ""}${state.loading ? `<p class="loading">Loading your ${showingReplies ? "replies" : "publications"}…</p>` : ["published", "replies"].includes(state.libraryTab) && state.ownNext ? `<div class="load-more">${action("own-more", showingReplies ? "Load older replies" : "Load older publications", "", "button subtle")}</div>` : ""}${state.serverDraftError ? `<p class="error-panel">${escapeHTML(state.serverDraftError)}</p>` : ""}<p class="library-note">${state.session ? "Drafts save locally, then on your server as posts scheduled for year 9999. Other clients can find them in scheduled posts." : "Offline drafts stay in this browser."} Export Markdown to keep a backup.</p>`;
  }

  export async function loadWriting(quiet = false): Promise<void> {
    const api = state.api;
    await Promise.all([loadOwnPosts(false, quiet), loadServerDrafts()]);
    if (state.view === "drafts" && state.api === api) render();
  }

  export async function loadOwnPosts(append = false, quiet = false): Promise<void> {
    if (!state.api || !state.session) {
      if (!quiet) render();
      return;
    }
    const version = ++loadVersion,
      api = state.api;
    state.loading = true;
    state.error = "";
    if (!quiet) render();
    try {
      const result = await api.accountPosts(state.session.account.id, "writing", append ? state.ownNext : undefined);
      if (version !== loadVersion) return;
      state.ownPosts = [
        ...new Map([...(append ? state.ownPosts : []), ...result.posts].map((p) => [p.id, p])).values(),
      ];
      state.ownNext = result.next;
    } catch (error) {
      if (version === loadVersion) state.error = (error as Error).message;
    } finally {
      if (version === loadVersion) {
        state.loading = false;
        if (!quiet) render();
      }
    }
  }

  function settingsView(): string {
    const session = state.session;
    return `<header class="page-top"><span>MAKE YOURSELF AT HOME</span><a href="#profile" class="text-button">Your profile ${icon("arrow")}</a></header><div class="page-intro"><h1>The little details<span class="accent">.</span></h1><p>Your reading room, your way.</p></div><div class="settings-content"><section><h2>Appearance</h2><div class="theme-options">${["light", "dark", "system"].map((t) => `<button class="button ${state.theme === t ? "primary" : "subtle"}" data-action="set-theme" data-id="${t}" aria-pressed="${state.theme === t}">${icon(t === "dark" ? "moon" : t === "light" ? "sun" : "settings")} ${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div></section>
      <section><h2>Link previews</h2><p id="link-previews-description">Show a picture and details for linked pages and videos. Turning this off stops loading previews. Saved on this device.</p><button id="link-previews-toggle" class="button subtle" role="switch" aria-checked="${state.linkPreviews}" aria-describedby="link-previews-description" data-action="toggle-link-previews">Link previews: ${state.linkPreviews ? "On" : "Off"}</button></section>
      <section><h2>Discovery languages</h2><p>Show publications in any of your chosen languages when exploring Discover. Add languages below and tap a language to remove it. Home and Saved keep all languages.</p>${languageSelector("settings-language")}<p class="muted">This uses language labels supplied by your server. Posts without a label are excluded while language filters are selected. An empty list shows all languages. Your preferences are saved on this device.</p></section>
      ${interestsSettings()}
      <section><h2>Your account</h2>${session ? `<p>Signed in as <strong>${escapeHTML(session.account.acct)}</strong></p><div class="capability-card"><strong>${session.maxChars.toLocaleString()} characters per publication</strong><p>${session.format === "text/markdown" ? "Native Markdown publishing" : session.format === "text/html" ? "Rich HTML publishing from Markdown" : "Plain-text publishing only"}</p><span>${supportsArticles(session) ? "Ready for long-form writing" : escapeHTML(articleSupportProblem(session))}</span></div>${action("disconnect", "Sign out", "", "button subtle")}` : `<p>Choose an Akkoma, Pleroma, or compatible instance with long posts and rich text. Fedistack checks the server’s capabilities before you write.</p>${action("connect", "Sign in", "", "button primary")}`}</section>
      <section><h2>Fedistack <span class="version-badge">${escapeHTML(version)}</span></h2><p>Fedistack is a quiet place to read and publish independent writing. Your instance hosts your posts and handles your followers. This website is just your reading room.</p><p>No analytics. No external fonts. No runtime dependencies.</p><p class="muted">Choose “Keep me signed in” when signing in to save your sign-in on this device. Sign out to remove it. Drafts save locally, then sync to your server using far-future scheduled posts when supported. Direct messages are private mentions handled by your server, and are not end-to-end encrypted.</p></section><section><h2>Keyboard shortcuts</h2><div class="shortcut-list"><span>Bold / italic</span><kbd>⌘ / Ctrl B · I</kbd><span>Insert a link</span><kbd>⌘ / Ctrl K</kbd><span>Save draft</span><kbd>⌘ / Ctrl S</kbd><span>Zen editing / reading focus</span><kbd>⌘ / Ctrl Shift F</kbd><span>Leave Zen / focus mode</span><kbd>Esc</kbd></div></section></div>`;
  }

  function rememberSessionOption(checked = false): string {
    return `<label class="manual-option"><input id="remember-session" type="checkbox" name="remember" ${checked ? "checked" : ""}> Keep me signed in on this device</label>`;
  }

  export function connectDialog(): void {
    const host = loginConfig.defaultServer;
    const serverField = loginConfig.allowOtherServers
      ? `<label for="fediverse-server">Your server<input id="fediverse-server" name="fediverse-server" type="text" inputmode="url" value="${escapeHTML(host)}" placeholder="infosec.exchange" required autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"></label>`
      : "";
    const introduction = loginConfig.allowOtherServers
      ? "Sign in with your existing Fediverse account. Enter your server below to continue to its sign-in page."
      : `Sign in with your <strong>${escapeHTML(host)}</strong> account. Continue to your server to authorize Fedistack.`;
    showModal(
      "Sign in to Fedistack",
      `<p>${introduction}</p>${location.protocol === "file:" ? '<div class="local-file-notice"><strong>Opened as a local file</strong><p>Mastodon servers require localhost or HTTPS for sign-in. Run <code>make serve</code>, then open <a href="http://127.0.0.1:8080" target="_blank" rel="noopener noreferrer">http://127.0.0.1:8080</a>. Offline reading and drafts work here.</p></div>' : ""}<form id="connect-form" autocomplete="off">${serverField}<div id="server-capabilities"></div>${rememberSessionOption()}<div class="form-buttons">${loginConfig.allowOtherServers ? '<button type="button" class="button subtle" data-action="check-server">Check compatibility</button>' : ""}<button class="button primary" type="submit">${!loginConfig.allowOtherServers ? `Continue to ${escapeHTML(host)}` : "Sign in"} ${icon("arrow")}</button></div><details class="token-details"><summary>Other sign-in options</summary><label class="manual-option"><input type="checkbox" name="manual"> Use a manual authorization code</label><button type="button" class="button subtle" data-action="connect-token">Sign in with token</button></details></form>`,
    );
  }

  export function connectTokenDialog(): void {
    const input = document.getElementById("fediverse-server") as HTMLInputElement | null;
    if (input && !input.reportValidity()) return;
    const server = loginServer(input?.value || "");
    const remember = (
      document.getElementById("remember-session") as HTMLInputElement | null
    )?.checked;
    showModal(
      "Sign in with an access token",
      `<p>Create an application on <strong>${escapeHTML(server)}</strong> with read, write, and follow permissions.</p><form id="token-connect-form" data-server="${escapeHTML(server)}" autocomplete="off"><label>Access token<input type="password" name="token" required autocomplete="off" placeholder="Paste your access token"></label>${rememberSessionOption(remember)}<button type="submit" class="button primary">Sign in ${icon("arrow")}</button></form>`,
    );
  }

  export async function refreshSessionCapabilities(): Promise<void> {
    const api = state.api, session = state.session;
    if (!api || !session) return;
    const capabilities = await api.capabilities();
    if (state.api !== api || state.session !== session) return;
    Object.assign(session, capabilities);
    // Keep the existing account, drafts, and choice of sign-in storage.
    writeStore("session", session, session.remember !== true);
    if (state.view === "settings") render();
    if (state.view === "editor") updateEditorMeta();
  }

  export async function setSession(session: Session): Promise<void> {
    if (!flushDraft())
      throw new Error(
        "Export your current draft before switching accounts; browser storage is unavailable.",
      );
    const saved = saveSession(session);
    state.draft = null;
    state.session = session;
    state.api = new API(session.server, session.token);
    if (!saved)
      toast(
        "Your sign-in could not be saved. You will need to reconnect after reloading.",
      );
    state.posts = [];
    state.accounts = [];
    state.profile = null;
    state.suggestions = [];
    state.suggestionsLoaded = false;
    state.ownPosts = [];
    state.ownNext = undefined;
    state.scheduledPosts = [];
    state.serverDraftError = "";
    state.reading = null;
    state.comments = [];
    state.conversations = [];
    state.conversation = "";
    state.conversationNext = undefined;
    state.lists = [];
    state.replyDrafts.clear();
    state.revealed.clear();
    clearMessageDrafts();
    resetNotifications();
    state.relationships.clear();
    state.query = "";
    state.homeTimeline = state.timeline = "home";
    closeModal();
    if (/^#(?:read|p|@[^/]*)\//.test(location.hash)) await route();
    else navigate("home");
    await loadServerDrafts();
    try {
      const api = state.api;
      const lists =
        await api.get<UserList[]>("/api/v1/lists");
      if (state.api === api) {
        state.lists = lists;
        if (["home", "discover", "bookmarks"].includes(state.view)) render();
      }
    } catch {
      /* Lists are optional. */
    }
  }
}
