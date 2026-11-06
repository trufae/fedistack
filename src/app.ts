namespace Fedi {
  export const state = {
    session: loadSession(),
    api: null as API | null,
    view: "home" as View,
    timeline: "home" as Timeline,
    filter: "article" as "all" | "article" | "post",
    followingOnly: false,
    query: "",
    posts: [] as Post[],
    accounts: [] as Account[],
    next: undefined as string | undefined,
    loading: false,
    error: "",
    relationships: new Map<string, Relationship>(),
    revealed: new Set<string>(),
    lists: [] as UserList[],
    reading: null as Post | null,
    readerServer: "",
    comments: [] as Post[],
    replyDrafts: new Map<string, string>(),
    conversations: [] as Conversation[],
    conversation: "",
    conversationNext: undefined as string | undefined,
    draft: null as Draft | null,
    preview: false,
    focus: false,
    discoveryLanguages: normalizeDiscoveryLanguages(
      readStore<unknown>("discovery-languages", readStore<unknown>("discovery-language", [])),
    ),
    libraryTab: "drafts",
    scheduledPosts: [] as ScheduledStatus[],
    serverDraftError: "",
    ownPosts: [] as Post[],
    ownNext: undefined as string | undefined,
    theme: readStore<string>("theme", "system"),
  };
  let loadVersion = 0;
  const feedTarget = 10;
  const feedPageLimit = 10;
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
      ...state.accounts,
      ...state.posts.map((p) => p.author),
      ...state.comments.map((p) => p.author),
      ...(state.reading ? [state.reading.author] : []),
      ...state.conversations.flatMap((c) => c.accounts),
      ...(!state.session ? demoAuthors : []),
    ];
  }
  export function findPost(id: string): Post | undefined {
    if (state.readerServer) {
      const post = [state.reading, ...state.comments].find((p) => p?.id === id);
      if (post) return post;
    }
    return [
      ...state.posts,
      ...state.ownPosts,
      ...state.comments,
      ...(state.reading ? [state.reading] : []),
      ...(!state.session
        ? [...demoState.posts, ...Object.values(demoState.comments).flat()]
        : []),
    ].find((p) => p.id === id);
  }
  export function publicationLink(post: Post): string {
    const url = new URL(location.href);
    const server = state.readerServer && post === state.reading
      ? state.readerServer
      : state.api?.server || state.session?.server;
    url.search = "";
    url.hash = `read/${encodeURIComponent(post.id)}${server ? `?${new URLSearchParams({ server })}` : ""}`;
    return url.href;
  }
  export function navigate(path: string): void {
    if (location.hash === `#${path}`) void route();
    else location.hash = path;
  }

  export function applyTheme(): void {
    const dark =
      state.theme === "dark" ||
      (state.theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  function sidebar(): string {
    const me = state.session?.account || demoMe;
    const items = [
      ["home", "home", "Home"],
      ["discover", "compass", "Discover"],
      ["bookmarks", "bookmark", "Saved"],
      ["drafts", "edit", "Your writing"],
      ["messages", "mail", "Messages"],
    ];
    return `<aside class="sidebar"><a class="brand" href="#home"><img src="assets/favicon.svg" alt="">fedistack<span>•</span></a><div class="brand-caption">Independent voices, connected.</div>
      <nav aria-label="Main navigation">${items.map(([view, symbol, name]) => `<a href="#${view}" class="nav-item ${state.view === view || (view === "drafts" && state.view === "editor") ? "active" : ""}" ${state.view === view ? 'aria-current="page"' : ""}>${icon(symbol)}<span>${name}</span>${view === "drafts" && getDrafts().length ? `<span class="nav-count">${getDrafts().length}</span>` : ""}${view === "messages" && state.conversations.some((c) => c.unread) ? '<span class="unread-dot"></span>' : ""}</a>`).join("")}</nav>
      <a href="#write" class="button primary write-button">${icon("edit")}<span>Write an article</span></a><a href="#note" class="button subtle note-button">${icon("comment")}<span>Note</span></a>
      <div class="sidebar-bottom"><div class="sidebar-tools"><button class="icon-button" data-action="theme" aria-label="Toggle light and dark theme">${icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon")}</button><span>${state.session ? "Open & connected" : state.readerServer ? "Public reading" : "Offline demo"}</span></div>
      <button class="profile-switch" data-action="${state.session ? "account" : "connect"}">${avatar(me, false, "sidebar")}<span><strong>${escapeHTML(state.session ? me.name : "Make yourself at home")}</strong><small>${escapeHTML(state.session ? new URL(state.session.server).host : "Connect your account")}</small></span>${icon("chevron")}</button></div></aside>`;
  }

  function rightRail(): string {
    const authors = state.session
      ? [
          ...new Map(
            state.posts
              .filter((p) => p.author.id !== state.session!.account.id)
              .map((p) => [p.author.id, p.author]),
          ).values(),
        ].slice(0, 3)
      : state.readerServer ? [] : demoAuthors.slice(0, 3);
    return `<aside class="right-rail"><form class="search-box" id="search-form">${icon("search")}<input name="query" aria-label="Search publications and people" placeholder="Search your corner of the world" value="${escapeHTML(state.query)}"><button type="submit" class="sr-only">Search</button></form>
      ${authors.length ? `<section class="rail-section"><div class="section-heading"><h3>Voices to explore</h3>${icon("users")}</div>${authors.map((a) => `<div class="recommended">${avatar(a, false, `suggested:${a.id}`)}<div><button class="author-link" data-action="profile" data-id="${escapeHTML(a.id)}">${escapeHTML(a.name)}</button><p>${escapeHTML(a.publication || a.bio.slice(0, 55) || a.acct)}</p></div>${followButton(a)}</div>`).join("")}</section>` : ""}
      <section class="rail-section"><h3>Follow your curiosity</h3><div class="topics">${["Technology", "Culture", "Design", "Nature", "Life", "Writing"].map((t) => action("topic", t, t, "topic")).join("")}</div></section>
      <section class="little-note">${icon("globe")}<p>Your words. Your community.<br><strong>Your corner of the fediverse.</strong></p></section>
      <footer>Fedistack <span>·</span> Made for the open web<br><a href="#settings">About & settings</a>${!state.session && !state.readerServer ? "<p>Demo stories and people are fictional.</p>" : ""}</footer></aside>`;
  }

  function mobileNav(): string {
    const current = state.view === "editor" ? "drafts" : state.view;
    const me = state.session?.account || demoMe;
    const items = [
      ["home", "home", "Home"],
      ["discover", "compass", "Discover"],
      ["drafts", "edit", "Your writing"],
      ["messages", "mail", "Messages"],
    ];
    return `<nav class="mobile-nav" aria-label="Mobile navigation">${items.map(([view, symbol, name]) => `<a href="#${view}"${view === "drafts" ? ' class="mobile-write"' : ""} aria-label="${name}"${current === view ? ' aria-current="page"' : ""}>${icon(symbol)}</a>`).join("")}<a href="#settings" aria-label="Account and settings"${current === "settings" ? ' aria-current="page"' : ""}>${avatar(me, false, "mobile-account")}</a></nav>`;
  }

  export function render(): void {
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
                : feedView();
    renderHTML(
      document.getElementById("app")!,
      `<div class="layout">${sidebar()}<main id="main" tabindex="-1">${content}</main>${rightRail()}</div>${mobileNav()}`,
    );
    if (languageFocus) {
      const target = document.getElementById(languageFocus) ||
        document.getElementById(languageSelect || "");
      if (target?.hasAttribute("disabled"))
        document.getElementById(`${languageSelect}-clear`)?.focus({ preventScroll: true });
      else target?.focus({ preventScroll: true });
    }
    if (state.view === "editor") updateEditorMeta();
    document.title = `${state.view === "reader" && state.reading ? state.reading.title || "Note" : state.view === "editor" ? (state.draft?.kind === "post" ? "New note" : state.draft?.title) || "New draft" : "Your reading room"} — Fedistack`;
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
  function visibleFeedPosts(): Post[] {
    let posts = state.posts.filter(
      (p) => state.filter === "all" || p.kind === state.filter,
    );
    if (state.view === "discover") posts = filterByLanguages(posts, state.discoveryLanguages);
    if (state.followingOnly)
      posts = posts.filter(
        (p) => state.relationships.get(p.author.id)?.following,
      );
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
  function feedView(): string {
    const title =
      state.view === "bookmarks"
        ? "Your reading list"
        : state.view === "discover"
          ? "A world of good writing"
          : "Your reading room";
    const posts = visibleFeedPosts();
    const hasLanguages = state.view === "discover" && state.discoveryLanguages.length > 0;
    return `<header class="page-top"><span>${state.view === "bookmarks" ? "SAVED FOR A QUIET MOMENT" : new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</span><div>${!state.session ? '<span class="demo-badge">DEMO</span>' : '<span class="connected-dot">Connected</span>'}${action("refresh", icon("refresh"), "", "icon-button refresh-button")}</div></header>
      <div class="page-intro"><h1>${title}<span class="accent">.</span></h1><p>${state.view === "bookmarks" ? "Good things are worth coming back to." : "Independent voices. A little more perspective."}</p></div>
      <div class="timeline-tabs" aria-label="Timelines">${(["home", "local", "federated"] as Timeline[]).map((t, i) => `<button data-action="timeline" data-id="${t}" class="${state.timeline === t ? "active" : ""}" aria-pressed="${state.timeline === t}">${["Following", "Local", "Federated"][i]}</button>`).join("")}${state.session ? `<select id="list-select" aria-label="Your lists"><option value="">Your lists</option>${state.lists.map((l) => `<option value="list:${escapeHTML(l.id)}" ${state.timeline === `list:${l.id}` ? "selected" : ""}>${escapeHTML(l.title)}</option>`).join("")}<option value="manage">Manage lists…</option></select>` : ""}</div>
      <div class="feed-controls"><div class="filter-pills" aria-label="Content type">${(["all", "article", "post"] as const).map((f, i) => `<button data-action="filter" data-id="${f}" class="${state.filter === f ? "selected" : ""}" aria-pressed="${state.filter === f}">${["All", "Articles", "Notes"][i]}</button>`).join("")}</div><label class="following-toggle"><input type="checkbox" id="following-only" ${state.followingOnly ? "checked" : ""}> Following only</label></div>
      ${state.view === "discover" ? `<form id="discover-search" class="search-box discover-search">${icon("search")}<input name="query" aria-label="Search people and writing" placeholder="Search people, writing, or #topics" value="${escapeHTML(state.query)}"><button class="button subtle">Search</button></form>` : ""}
      ${state.query ? `<div class="search-summary">Results for “${escapeHTML(state.query)}” ${action("clear-search", "Clear", "", "text-button")}</div>` : ""}
      ${state.timeline.startsWith("tag:") && !state.query && state.view !== "bookmarks" ? `<div class="search-summary">Posts tagged #${escapeHTML(state.timeline.slice(4))}</div>` : ""}
      ${state.accounts.length ? `<div class="account-results">${state.accounts.map((a) => `<div class="recommended">${avatar(a)}<div><button class="author-link" data-action="profile" data-id="${escapeHTML(a.id)}">${escapeHTML(a.name)}</button><p>${escapeHTML(a.acct)}</p></div>${followButton(a)}</div>`).join("")}</div>` : ""}
      ${state.error ? `<div class="error-panel" role="alert">${escapeHTML(state.error)}${action("refresh", "Try again", "", "button subtle")}</div>` : ""}
      <div class="feed">${posts.map((p, i) => postCard(p, i === 0 && p.kind === "article")).join("")}${!posts.length && !state.loading && !state.error ? emptyState("A little quiet here", hasLanguages ? "No posts in the selected languages match the loaded results. Load older posts or change your languages in Settings." : state.filter !== "all" ? "No matching writing in the loaded posts. Try another filter or load older posts." : "Follow a writer, explore another timeline, or start a conversation.", hasLanguages ? '<a href="#settings" class="button subtle">Change language settings</a>' : action("discover", "Explore the fediverse", "", "button subtle")) : ""}</div>
      ${state.loading ? '<div class="loading" role="status">Gathering your reading…</div>' : state.next ? `<div class="load-more">${action("load-more", "Load older posts", "", "button subtle")}</div>` : posts.length ? '<div class="end-note">You’re all caught up. Go make a little something.</div>' : ""}`;
  }

  export async function loadFeed(
    append = false,
    target = feedTarget,
  ): Promise<void> {
    if (append && !state.next) return;
    const version = ++loadVersion,
      api = state.api;
    const existing = new Set(append ? state.posts.map((p) => p.id) : []);
    const visited = new Set<string>();
    const timeline = state.view === "bookmarks" ? "bookmarks" : state.timeline;
    state.loading = true;
    state.error = "";
    if (!append) {
      state.posts = [];
      state.accounts = [];
      state.next = undefined;
    }
    render();
    try {
      let posts: Post[];
      if (!api) {
        // Older demo saves predate language labels; all bundled stories are English.
        demoState.posts.forEach((p) => {
          if (demoAuthors.some((a) => a.id === p.author.id)) p.language = "en";
        });
        posts = demoState.posts.filter((p) => p.visibility !== "direct");
        if (state.view === "bookmarks") posts = posts.filter((p) => p.saved);
        else if (state.timeline === "home")
          posts = posts.filter(
            (p) =>
              demoState.follows.includes(p.author.id) || p.author.id === "you",
          );
        else if (state.timeline === "local")
          posts = posts.filter((p) => p.local || p.author.id === "you");
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
      } else if (state.query) {
        const result = await api.search(state.query);
        if (version !== loadVersion) return;
        posts = result.posts;
        state.accounts = result.accounts;
      } else posts = [];
      const paginated = !!api && !state.query;
      for (let page = 0; page < feedPageLimit; page++) {
        if (api && paginated) {
          const cursor = state.next;
          if (cursor) visited.add(cursor);
          const result = await api.timeline(timeline, cursor);
          if (version !== loadVersion) return;
          posts = result.posts;
          state.next =
            result.next && !visited.has(result.next) ? result.next : undefined;
        }
        if (version !== loadVersion) return;
        state.posts = [
          ...new Map([...state.posts, ...posts].map((p) => [p.id, p])).values(),
        ];
        if (api) {
          try {
            const relations = await api.relationships([
              ...posts.map((p) => p.author.id),
              ...state.accounts.map((a) => a.id),
            ]);
            if (version !== loadVersion) return;
            relations.forEach((r) => state.relationships.set(r.id, r));
          } catch {
            /* Reading does not depend on the relationships endpoint. */
          }
        }
        if (version !== loadVersion) return;
        if (
          !paginated ||
          !state.next ||
          visibleFeedPosts().filter((p) => !existing.has(p.id)).length >= target
        )
          break;
        render();
      }
    } catch (error) {
      if (version === loadVersion) state.error = (error as Error).message;
    } finally {
      if (version === loadVersion) {
        state.loading = false;
        render();
      }
    }
  }

  export async function route(): Promise<void> {
    if (state.view === "editor") {
      if (!flushDraft()) {
        history.replaceState(
          null,
          "",
          `#write/${encodeURIComponent(state.draft!.id)}`,
        );
        toast(
          "This draft could not be saved. Export a copy before leaving the editor.",
        );
        return;
      }
      state.draft = null;
    }
    const [path, query = ""] = location.hash.slice(1).split("?");
    const [page, rawId] = path.split("/");
    let id = "";
    try {
      id = decodeURIComponent(rawId || "");
    } catch {
      /* Ignore malformed hashes. */
    }
    loadVersion++;
    state.error = "";
    state.loading = false;
    state.focus = false;
    // Public reader IDs belong to their source server, not the current account.
    if (state.readerServer) {
      state.reading = null;
      state.comments = [];
    }
    state.readerServer = "";
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
      render();
      return;
    }
    if (page === "read") {
      const source = new URLSearchParams(query).get("server");
      state.view = "reader";
      state.reading = source ? null : findPost(id) || null;
      if (source) state.revealed.delete(id);
      state.comments = [];
      state.loading = true;
      render();
      const version = loadVersion,
        api = state.api;
      try {
        const server = source ? serverURL(source) : "";
        let readerAPI = server && server !== api?.server ? new API(server) : api;
        let post = state.reading || (readerAPI ? await readerAPI.status(id) : null);
        if (version !== loadVersion || state.api !== api) return;
        if (!post) throw new Error("This publication is not available.");
        if (post.visibility === "direct") {
          state.reading = null;
          throw new Error(
            "This is a private message. Open it from Conversations.",
          );
        }
        if (readerAPI && readerAPI !== api && post.visibility !== "public" && post.visibility !== "unlisted")
          throw new Error("This publication requires access through its server. Connect an authorized account to read it.");
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
        const comments = readerAPI
          ? await readerAPI.context(post.id)
          : [...demoComments(post), ...(demoState.comments[id] || [])];
        if (version !== loadVersion || state.api !== api) return;
        const readingId = post.id;
        state.comments = comments.filter(
          (p) => p.visibility !== "direct" && (!state.readerServer || p.visibility !== "private") && p.id !== readingId && !!p.replyTo,
        );
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
        "bookmarks",
        "drafts",
        "messages",
        "settings",
      ].includes(page)
        ? page
        : "home"
    ) as View;
    if (state.view === "messages") {
      state.conversation = id;
      await loadConversations();
      return;
    }
    if (state.view === "drafts") {
      render();
      await Promise.all([loadOwnPosts(), loadServerDrafts()]);
      if (state.view === "drafts") render();
      return;
    }
    if (state.view === "settings") {
      render();
      return;
    }
    if (state.view === "discover" && state.timeline === "home")
      state.timeline = "federated";
    if (state.view !== "discover") state.query = "";
    await loadFeed();
  }

  function readerView(): string {
    const p = state.reading;
    if (!p)
      return `<div class="page-intro">${emptyState(state.loading ? "Opening your next read…" : "Publication unavailable", state.error, '<a class="button subtle" href="#home">Back home</a>')}</div>`;
    const hidden = p.warning && !state.revealed.has(p.id);
    const publicReading = !!state.readerServer;
    const author = publicReading
      ? `<strong>${escapeHTML(p.author.name)}</strong>`
      : `<button class="author-link" data-action="profile" data-id="${escapeHTML(p.author.id)}">${escapeHTML(p.author.name)}</button>`;
    const replyForm = publicReading
      ? `<p class="muted">${state.session ? "Open the original post to join the conversation." : `Connect your account to join the conversation. ${action("connect", "Connect", "", "text-button")}`}</p>`
      : `<form id="reply-form"><label class="sr-only" for="reply-body">Write a comment</label><textarea id="reply-body" name="body" rows="3" required placeholder="Add a little perspective…">${escapeHTML(state.replyDrafts.get(p.id) || "")}</textarea><div class="reply-footer"><span>${p.visibility === "private" ? "Followers only" : p.visibility === "unlisted" ? "Unlisted reply" : "Public reply"}${!state.session || state.session.format !== "text/plain" ? " · Markdown supported" : ""}</span><button class="button primary" type="submit">Reply ${icon("arrow")}</button></div></form>`;
    return `<header class="page-top"><a class="text-button" href="#home">${icon("back")} Back to reading</a><button class="icon-button" data-action="focus" aria-label="${state.focus ? "Leave" : "Enter"} focus mode" title="Focus mode">${icon("book")}</button></header><article class="reader">
      ${hidden ? `<div class="content-warning"><h2>${escapeHTML(p.warning)}</h2>${action("reveal", "Show publication", p.id, "button subtle")}</div>` : `<span class="eyebrow">${escapeHTML(p.author.publication || "INDEPENDENT WRITING")}</span>${!publicReading && p.author.id === (state.session?.account.id || "you") ? `<span class="published-badge">${state.session ? "Published" : "Published in demo"}</span>` : ""}<h1>${escapeHTML(p.title || "A note from " + p.author.name)}</h1>${p.subtitle ? `<p class="reader-subtitle">${escapeHTML(p.subtitle)}</p>` : ""}`}
      <div class="post-byline">${avatar(p.author, false, `post:${p.id}`)}<div>${author}<div class="byline-sub">${new Date(p.created).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} · ${readingTime(p.markdown)} min read</div></div>${publicReading ? "" : followButton(p.author)}</div>
      ${postActions(p)}${hidden ? "" : `${p.image ? `<img class="reader-cover" data-image-key="cover:${escapeHTML(p.id)}" src="${escapeHTML(p.image)}" alt="${escapeHTML(p.imageAlt || "")}">` : ""}<div class="prose reading-prose">${markdown(p.markdown.replace(/^#\s+[^\n]+\n+/, ""))}</div>${p.source ? `<a class="button subtle" href="${escapeHTML(p.source)}" target="_blank" rel="noopener noreferrer">Read the linked article ${icon("external")}</a>` : ""}<div class="reader-end">${icon("leaf")}<span>Thanks for reading. Keep the conversation going.</span></div>${postActions(p)}`}</article>
      <section class="comments"><div class="section-heading"><h2>Conversation <span>${p.replies}</span></h2>${action("share", "Share publication", p.id, "text-button")}</div>${replyForm}
      ${state.error ? `<p class="form-error" role="alert">${escapeHTML(state.error)}</p>` : ""}${state.loading ? '<p class="loading">Loading the conversation…</p>' : state.comments.map(commentCard).join("") || '<p class="muted">Be the first to start the conversation.</p>'}</section>`;
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
    return `<header class="page-top"><span>A SPACE FOR YOUR IDEAS</span><div><a href="#note" class="button subtle small-button">Note</a><a href="#write" class="button primary small-button">${icon("plus")} Article</a></div></header><div class="page-intro"><h1>Your writing<span class="accent">.</span></h1><p>A passing thought today. Someone’s favorite read tomorrow.</p></div>
      ${state.session ? `<p class="account-stats">${(state.session.account.followers ?? 0).toLocaleString()} followers <span>·</span> ${(state.session.account.following ?? 0).toLocaleString()} following <span>·</span> ${(state.session.account.statuses ?? 0).toLocaleString()} total posts</p>` : ""}<div class="stats-grid"><div><strong>${drafts.length}</strong><span>Saved drafts</span></div><div><strong>${posts.length}${state.ownNext ? "+" : ""}</strong><span>Publications loaded</span></div><div><strong>${posts.reduce((n, p) => n + p.likes, 0)}</strong><span>Likes on these posts</span></div><div><strong>${posts.reduce((n, p) => n + p.replies, 0)}</strong><span>Replies on these posts</span></div></div>
      <div class="timeline-tabs">${(state.session ? ["drafts", "scheduled", "published", "replies"] : ["drafts", "published", "replies"]).map((t) => `<button data-action="library-tab" data-id="${t}" class="${state.libraryTab === t ? "active" : ""}">${t === "drafts" ? `Drafts (${drafts.length})` : t === "replies" ? "Replies" : t === "scheduled" ? `Scheduled (${state.scheduledPosts.length})` : "Published"}</button>`).join("")}</div>
      <div class="draft-list">${state.libraryTab === "drafts" ? drafts.map((d) => `<article class="draft-card"><div><span class="eyebrow">${d.editingId ? "Unpublished changes" : d.kind === "post" ? "Note" : "Article"} · ${relativeDate(d.updated)}</span><a href="#write/${encodeURIComponent(d.id)}"><h2>${escapeHTML(d.kind === "post" ? d.body.trim().slice(0, 60) || "Untitled note" : d.title || "Untitled article")}</h2></a><p>${escapeHTML(plainText(d.body).slice(0, 120) || "A blank page, full of possibility.")}</p><small>${d.body.trim() ? d.body.trim().split(/\s+/).length : 0} words · Saved on this device${state.session ? ` · ${escapeHTML(serverDraftLabel(d))}` : ""}</small></div><div class="draft-actions"><a class="button subtle" href="#write/${encodeURIComponent(d.id)}">Continue writing ${icon("arrow")}</a>${action("export-draft", "Export .md", d.id, "text-button")}${action("delete-draft", "Delete", d.id, "text-button muted")}</div></article>`).join("") || emptyState("Every good story starts here", "Your drafts autosave as you write. Start something new.", '<a href="#write" class="button primary">Start writing</a>') : state.libraryTab === "scheduled" ? scheduledPostsView() : (showingReplies ? replies : posts).map((p) => postCard(p)).join("") || (state.loading ? "" : emptyState(showingReplies ? "Your replies and comments" : "Your words will find a home", state.ownNext ? `No ${showingReplies ? "replies" : "publications"} in the loaded posts. Load older ${showingReplies ? "replies" : "publications"} to keep looking.` : showingReplies ? "Your replies and comments on posts will appear here." : "Published articles and notes will appear here."))}</div>
      ${state.error ? `<p class="error-panel">${escapeHTML(state.error)}</p>` : ""}${state.loading ? `<p class="loading">Loading your ${showingReplies ? "replies" : "publications"}…</p>` : ["published", "replies"].includes(state.libraryTab) && state.ownNext ? `<div class="load-more">${action("own-more", showingReplies ? "Load older replies" : "Load older publications", "", "button subtle")}</div>` : ""}${state.serverDraftError ? `<p class="error-panel">${escapeHTML(state.serverDraftError)}</p>` : ""}<p class="library-note">${state.session ? `Drafts save locally, then on your server as posts scheduled for year 9999. Other clients can find them in scheduled posts. ${action("refresh-server-drafts", "Refresh server drafts", "", "text-button")}` : "Offline drafts stay in this browser."} Export Markdown to keep a backup.</p>`;
  }

  export async function loadOwnPosts(append = false): Promise<void> {
    if (!state.api || !state.session) {
      render();
      return;
    }
    const version = ++loadVersion,
      api = state.api;
    state.loading = true;
    state.error = "";
    render();
    try {
      const result = await api.request<MastodonStatus[]>(
        append && state.ownNext
          ? state.ownNext
          : `/api/v1/accounts/${encodeURIComponent(state.session.account.id)}/statuses?exclude_replies=false&exclude_reblogs=true&limit=40`,
      );
      if (version !== loadVersion) return;
      state.ownPosts = [
        ...new Map(
          [
            ...(append ? state.ownPosts : []),
            ...result.data
              .filter((p) => p.visibility !== "direct" && !p.reblog)
              .map(mapStatus),
          ].map((p) => [p.id, p]),
        ).values(),
      ];
      state.ownNext = result.next;
    } catch (error) {
      if (version === loadVersion) state.error = (error as Error).message;
    } finally {
      if (version === loadVersion) {
        state.loading = false;
        render();
      }
    }
  }

  function settingsView(): string {
    const session = state.session;
    return `<header class="page-top"><span>MAKE YOURSELF AT HOME</span></header><div class="page-intro"><h1>The little details<span class="accent">.</span></h1><p>Your reading room, your way.</p></div><div class="settings-content"><section><h2>Appearance</h2><div class="theme-options">${["light", "dark", "system"].map((t) => `<button class="button ${state.theme === t ? "primary" : "subtle"}" data-action="set-theme" data-id="${t}" aria-pressed="${state.theme === t}">${icon(t === "dark" ? "moon" : t === "light" ? "sun" : "settings")} ${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div></section>
      <section><h2>Discovery languages</h2><p>Show publications in any of your chosen languages when exploring Discover. Add languages below and tap a language to remove it. Home and Saved keep all languages.</p>${languageSelector("settings-language")}<p class="muted">This uses language labels supplied by your server. Posts without a label are excluded while language filters are selected. An empty list shows all languages. Your preferences are saved on this device.</p></section>
      ${interestsSettings()}
      <section><h2>Your connection</h2>${session ? `<p>Connected as <strong>${escapeHTML(session.account.acct)}</strong></p><div class="capability-card"><strong>${session.maxChars.toLocaleString()} characters per publication</strong><p>${session.format === "text/markdown" ? "Native Markdown publishing" : session.format === "text/html" ? "Rich HTML publishing from Markdown" : "Plain-text publishing only"}</p><span>${supportsArticles(session) ? "Ready for long-form writing" : "Reading and notes available. Articles need a rich-text server with a 5,000+ character limit."}</span></div>${action("disconnect", "Log out", "", "button subtle")}` : `<p>Choose an Akkoma, Pleroma, or compatible instance with long posts and rich text. Fedistack checks the server’s capabilities before you write.</p>${action("connect", "Connect your account", "", "button primary")}`}</section>
      <section><h2>Made for the open web</h2><p>Fedistack is a quiet place to read and publish independent writing. Your instance hosts your posts and handles your followers. This website is just your reading room.</p><p>No analytics. No external fonts. No runtime dependencies.</p><p class="muted">Choose “Keep me signed in” when connecting to save your sign-in on this device. Log out to remove it. Drafts save locally, then sync to your server using far-future scheduled posts when supported. Direct messages are private mentions handled by your server, and are not end-to-end encrypted.</p></section><section><h2>Keyboard shortcuts</h2><div class="shortcut-list"><span>Bold / italic</span><kbd>⌘ / Ctrl B · I</kbd><span>Insert a link</span><kbd>⌘ / Ctrl K</kbd><span>Save draft</span><kbd>⌘ / Ctrl S</kbd><span>Zen editing / reading focus</span><kbd>⌘ / Ctrl Shift F</kbd><span>Leave Zen / focus mode</span><kbd>Esc</kbd></div></section></div>`;
  }

  function rememberSessionOption(checked = false): string {
    return `<label class="manual-option"><input id="remember-session" type="checkbox" name="remember" ${checked ? "checked" : ""}> Keep me signed in on this device</label>`;
  }

  export function connectDialog(): void {
    showModal(
      "Your writing, your server.",
      `<p>Connect an existing Fediverse account. For articles, choose a server with <strong>5,000+ characters and Markdown or HTML support</strong>, such as infosec.exchange, or a suitably configured Akkoma or Pleroma instance.</p>${location.protocol === "file:" ? '<div class="local-file-notice"><strong>Opened as a local file</strong><p>Mastodon servers require localhost or HTTPS for sign-in. Run <code>make serve</code>, then open <a href="http://127.0.0.1:8080" target="_blank" rel="noopener noreferrer">http://127.0.0.1:8080</a>. Offline reading and drafts work here.</p></div>' : ""}<form id="connect-form" autocomplete="off"><label for="fediverse-server">Your server<input id="fediverse-server" name="fediverse-server" type="text" inputmode="url" placeholder="infosec.exchange" required autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"></label><div id="server-capabilities"></div>${rememberSessionOption()}<div class="form-buttons"><button type="button" class="button subtle" data-action="check-server">Check compatibility</button><button class="button primary" type="submit">Connect ${icon("arrow")}</button></div><details class="token-details"><summary>Other sign-in options</summary><label class="manual-option"><input type="checkbox" name="manual"> Use a manual authorization code</label><button type="button" class="button subtle" data-action="connect-token">Connect with token</button></details></form><p class="fine-print">Mastodon sign-in and publishing need localhost or HTTPS. Some other servers support the manual code flow from a local file. No application backend is required.</p>`,
    );
  }

  export function connectTokenDialog(): void {
    const input = document.getElementById("fediverse-server") as HTMLInputElement;
    if (!input.reportValidity()) return;
    const server = serverURL(input.value);
    const remember = (
      document.getElementById("remember-session") as HTMLInputElement | null
    )?.checked;
    showModal(
      "Connect with an access token",
      `<p>Create an application on <strong>${escapeHTML(server)}</strong> with read, write, and follow permissions.</p><form id="token-connect-form" data-server="${escapeHTML(server)}" autocomplete="off"><label>Access token<input type="password" name="token" required autocomplete="off" placeholder="Paste your access token"></label>${rememberSessionOption(remember)}<button type="submit" class="button primary">Connect ${icon("arrow")}</button></form>`,
    );
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
    state.relationships.clear();
    state.query = "";
    state.timeline = "home";
    closeModal();
    if (location.hash.startsWith("#read/")) await route();
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
