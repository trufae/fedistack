namespace Fedi {
  const mutations = new Set<string>();
  async function togglePost(id: string, kind: "like" | "save" | "repost"): Promise<void> {
    const post = findPost(id);
    if (!post) return;
    if (state.readerServer) return;
    if (kind === "repost" && !canRepost(post)) return;
    const api = state.api;
    if (api) {
      const updated = await api.toggle(post, kind);
      if (state.api !== api) return;
      [
        ...state.posts,
        ...state.ownPosts,
        ...(state.readerServer ? [] : state.comments),
        ...(state.reading && !state.readerServer ? [state.reading] : []),
      ]
        .filter((p) => p.id === id)
        .forEach((p) => Object.assign(p, updated, { boostedBy: p.boostedBy }));
    } else {
      if (kind === "like") {
        post.liked = !post.liked;
        post.likes += post.liked ? 1 : -1;
      } else if (kind === "repost") {
        post.reposted = !post.reposted;
        post.reposts = Math.max(0, (post.reposts || 0) + (post.reposted ? 1 : -1));
      } else post.saved = !post.saved;
      saveDemo();
    }
    render();
  }
  async function toggleFollow(id: string): Promise<void> {
    const current = state.relationships.get(id),
      api = state.api;
    const unfollow = !!(current?.following || current?.requested);
    const relationship = api
      ? await api.follow(id, unfollow)
      : { id, following: !unfollow, requested: false };
    if (state.api !== api) return;
    state.relationships.set(id, relationship);
    if (!api) {
      demoState.follows = relationship.following
        ? [...new Set([...demoState.follows, id])]
        : demoState.follows.filter((x) => x !== id);
      saveDemo();
    }
    toast(
      relationship.requested
        ? "Follow request sent."
        : relationship.following
          ? "A new voice in your reading room."
          : "No longer following.",
    );
    if ((document.getElementById("modal") as HTMLDialogElement).open)
      closeModal();
    if (state.view === "home" && state.timeline === "home") await loadFeed();
    else render();
  }
  async function sharePost(id: string): Promise<void> {
    const post = findPost(id);
    if (!post) return;
    const link = publicationLink(post);
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(link);
        toast("Fedistack reading link copied. Ready to share.");
        return;
      } catch {
        /* File URLs and denied clipboard permissions use the selectable link. */
      }
    }
    showModal(
      "Share this publication",
      `<p>${post.url ? "Share this Fedistack link so readers see the formatted publication here." : "This is a local demo link. Connect an account and publish to get a public, shareable link."}</p><label>Fedistack reading link<input id="share-link" readonly value="${escapeHTML(link)}"></label>${action("copy-link", "Copy link", "", "button primary")}${post.url ? `<a class="button subtle" href="${escapeHTML(post.url)}" target="_blank" rel="noopener noreferrer">Open original ${icon("external")}</a>` : ""}`,
    );
  }
  function profile(id: string): void {
    const a = allAccounts().find((a) => a.id === id);
    if (!a) return;
    showModal(
      a.name,
      `<div class="profile-card">${avatar(a)}<p class="muted">@${escapeHTML(a.acct)}</p><p>${escapeHTML(a.bio)}</p>${followButton(a, false)} ${action("message-account", `${icon("mail")} Message`, a.id, "button subtle")}${a.url ? `<a href="${escapeHTML(a.url)}" class="button subtle" target="_blank" rel="noopener noreferrer">View profile ${icon("external")}</a>` : ""}</div>`,
    );
  }
  async function checkServer(button: HTMLButtonElement): Promise<void> {
    const input = document.getElementById(
      "fediverse-server",
    ) as HTMLInputElement | null;
    if (!input?.value) {
      input?.focus();
      throw new Error("Enter your server’s domain first.");
    }
    button.disabled = true;
    try {
      const cap = await new API(input.value).capabilities();
      const target = document.getElementById("server-capabilities");
      if (target)
        target.innerHTML = `<div class="capability-card ${supportsArticles(cap) ? "compatible" : ""}"><strong>${supportsArticles(cap) ? "Ready for long-form writing" : "Reading and notes supported"}</strong><p>${cap.maxChars.toLocaleString()} characters · ${cap.format === "text/markdown" ? "Native Markdown" : cap.format === "text/html" ? "Rich HTML" : "Plain text"}</p>${supportsArticles(cap) ? "" : `<small>${escapeHTML(articleSupportProblem(cap))}</small>`}</div>`;
    } finally {
      button.disabled = false;
    }
  }

  async function handleAction(
    name: string,
    id: string,
    button: HTMLButtonElement,
  ): Promise<void> {
    switch (name) {
      case "close-modal":
        closeModal();
        break;
      case "connect":
        connectDialog();
        break;
      case "connect-token":
        connectTokenDialog();
        break;
      case "account":
        navigate("settings");
        break;
      case "manage-hashtags":
        await showInterests("tags");
        break;
      case "manage-lists":
        await showInterests("lists");
        break;
      case "manage-list-members":
        await showInterests("members", id);
        break;
      case "reload-interests":
      case "more-interests":
      case "read-tag":
      case "read-list":
      case "unfollow-tag":
      case "add-list-member":
      case "remove-list-member":
      case "delete-list":
      case "delete-list-cancel":
      case "delete-list-confirm":
        await interestAction(name, id);
        break;
      case "check-server":
        await checkServer(button);
        break;
      case "disconnect":
        if (!flushDraft())
          throw new Error(
            "Export your current draft before logging out; browser storage is unavailable.",
          );
        clearSession();
        state.session = null;
        state.api = null;
        state.posts = [];
        state.ownPosts = [];
        state.ownNext = undefined;
        state.scheduledPosts = [];
        state.serverDraftError = "";
        state.comments = [];
        state.reading = null;
        state.accounts = [];
        state.lists = [];
        state.conversations = [];
        state.conversation = "";
        state.conversationNext = undefined;
        state.draft = null;
        state.relationships.clear();
        state.replyDrafts.clear();
        state.revealed.clear();
        clearMessageDrafts();
        state.query = "";
        state.timeline = "home";
        closeModal();
        navigate("home");
        break;
      case "theme":
        state.theme =
          document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        applyTheme();
        writeStore("theme", state.theme);
        render();
        break;
      case "set-theme":
        state.theme = id;
        applyTheme();
        writeStore("theme", id);
        render();
        break;
      case "timeline":
        state.timeline = id as Timeline;
        if (id === "federated") state.filter = "all";
        state.query = "";
        if (state.view === "bookmarks") navigate("home");
        else await loadFeed();
        break;
      case "filter":
        state.filter = id as typeof state.filter;
        updateFeedFilters();
        break;
      case "refresh":
        await loadFeed();
        break;
      case "load-more":
        await loadFeed(true);
        break;
      case "discover":
        state.query = "";
        state.timeline = "federated";
        state.filter = "all";
        navigate("discover");
        break;
      case "topic":
        state.query = state.session ? "#" + id : id;
        state.timeline = "federated";
        state.filter = "all";
        navigate("discover");
        break;
      case "clear-search":
        state.query = "";
        await loadFeed();
        break;
      case "remove-language":
        setDiscoveryLanguages(state.discoveryLanguages.filter((language) => language !== id));
        break;
      case "clear-languages":
        setDiscoveryLanguages([]);
        break;
      case "follow":
        await toggleFollow(id);
        break;
      case "profile":
        profile(id);
        break;
      case "like":
        await togglePost(id, "like");
        break;
      case "save":
        await togglePost(id, "save");
        break;
      case "repost":
        await togglePost(id, "repost");
        break;
      case "share":
        await sharePost(id);
        break;
      case "edit-publication":
        await editPublication(id);
        break;
      case "delete-publication":
        confirmDeletePublication(id);
        break;
      case "unpublish-publication":
        confirmUnpublishPublication(id);
        break;
      case "confirm-unpublish-publication":
        await unpublishPublication(id);
        break;
      case "confirm-delete-publication":
        await deletePublication(id);
        break;
      case "copy-link": {
        const input = document.getElementById("share-link") as HTMLInputElement;
        try {
          await navigator.clipboard.writeText(input.value);
          toast("Link copied.");
        } catch {
          input.focus();
          input.select();
          toast("Press Cmd/Ctrl+C to copy the selected link.");
        }
        break;
      }
      case "reveal":
        state.revealed.add(id);
        render();
        break;
      case "library-tab":
        state.libraryTab = id;
        render();
        if (id === "published" || id === "replies") await loadOwnPosts();
        break;
      case "own-more":
        await loadOwnPosts(true);
        break;
      case "preview":
        captureDraft();
        flushDraft();
        state.preview = !state.preview;
        render();
        break;
      case "focus":
        toggleFocus();
        break;
      case "format":
        formatSelection(id);
        break;
      case "publish":
        await reviewPublication();
        break;
      case "publish-note":
        captureDraft();
        await publishDraft();
        break;
      case "confirm-publish":
        await publishDraft();
        break;
      case "export-current":
        if (state.draft) {
          captureDraft();
          flushDraft();
          exportDraft(state.draft);
        }
        break;
      case "export-draft": {
        const d = getDrafts().find((d) => d.id === id);
        if (d) exportDraft(d);
        break;
      }
      case "delete-draft":
        showModal(
          "Delete this draft?",
          `<p>This removes the draft from this device and its saved server copies. Export a Markdown copy first if you want to keep it.</p>${action("confirm-delete-draft", "Delete draft", id, "button danger")} ${action("close-modal", "Keep writing", "", "button subtle")}`,
        );
        break;
      case "confirm-delete-draft":
        await deleteSyncedDraft(id);
        closeModal();
        render();
        break;
      case "schedule":
        await scheduleDialog();
        break;
      case "reschedule":
        await scheduleDialog(id);
        break;
      case "refresh-server-drafts":
        await loadServerDrafts();
        render();
        break;
      case "cancel-schedule":
        showModal("Cancel scheduled publication?", `<p>This removes the scheduled post and its content from the server. It will no longer publish automatically.</p>${action("confirm-cancel-schedule", "Cancel publication", id, "button danger")} ${action("close-modal", "Keep scheduled", "", "button subtle")}`);
        break;
      case "confirm-cancel-schedule": {
        const api = state.api;
        if (!api) break;
        await api.deleteScheduledStatus(id);
        if (state.api !== api) break;
        closeModal();
        await loadServerDrafts();
        render();
        break;
      }
      case "new-message":
        newMessageDialog();
        break;
      case "message-account":
        startConversation(id);
        break;
      case "more-conversations":
        await loadConversations(true);
        break;
      case "refresh-messages":
        await loadConversations();
        break;
    }
  }

  async function submit(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form),
      value = (key: string) => String(data.get(key) || "").trim();
    if (form.id === "schedule-form") {
      await submitSchedule(value("time"), form.dataset.id || "");
      return;
    }
    if (["follow-tag-form", "save-list-form", "list-member-search"].includes(form.id)) {
      await submitInterestForm(form.id, value(form.id === "follow-tag-form" ? "tag" : form.id === "save-list-form" ? "title" : "query"));
      return;
    }
    if (form.id === "search-form" || form.id === "discover-search") {
      state.query = value("query");
      state.timeline = "federated";
      state.filter = "all";
      navigate("discover");
      return;
    }
    if (form.id === "connect-form")
      await startOAuth(
        value("fediverse-server"),
        data.has("manual"),
        data.has("remember"),
      );
    if (form.id === "token-connect-form")
      await setSession({
        ...(await new API(form.dataset.server!, value("token")).verify()),
        remember: data.has("remember"),
      });
    if (form.id === "oauth-form")
      await setSession(await finishOAuth(value("code")));
    if (form.id === "recipient-form") await findRecipient(value("recipient"));
    if (form.id === "message-form")
      await sendMessage(form.dataset.id!, value("body"));
    if (form.id === "reply-form") {
      const post = state.reading,
        api = state.api,
        body = value("body");
      if (!post || !body || state.readerServer) return;
      const source = `${post.author.id !== (state.session?.account.id || "you") ? "@" + post.author.acct + " " : ""}${body}`;
      const format = state.session?.format || "text/markdown";
      const text =
        format === "text/html"
          ? markdown(source)
          : format === "text/markdown"
            ? source
            : plainText(source);
      if (
        state.session &&
        Array.from(text + post.warning).length > state.session.maxChars
      )
        throw new Error(
          `Your server allows ${state.session.maxChars.toLocaleString()} characters per reply.`,
        );
      const reply = api
        ? await api.createStatus(
            text,
            post.visibility,
            post.id,
            post.warning,
            uid(),
            format,
          )
        : {
            id: uid(),
            author: demoMe,
            title: "",
            subtitle: "",
            markdown: body,
            kind: "post" as const,
            created: new Date().toISOString(),
            likes: 0,
            replies: 0,
            reposts: 0,
            liked: false,
            reposted: false,
            saved: false,
            visibility: post.visibility,
            warning: post.warning,
            tags: [],
            replyTo: post.id,
          };
      if (state.api !== api) return;
      post.replies++;
      if (!api) {
        (demoState.comments[post.id] ||= []).push(reply);
        saveDemo();
      }
      state.replyDrafts.delete(post.id);
      if (!state.readerServer && state.reading?.id === post.id && state.view === "reader") {
        state.comments.push(reply);
        render();
      }
      toast("Your reply has joined the conversation.");
    }
  }

  export async function boot(): Promise<void> {
    applyTheme();
    updateConversationViewport();
    window.visualViewport?.addEventListener("resize", updateConversationViewport);
    window.visualViewport?.addEventListener("scroll", updateConversationViewport);
    if (state.session?.server && state.session.token)
      state.api = new API(state.session.server, state.session.token);
    else state.session = null;
    document.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "button[data-action]",
      );
      if (!button || button.disabled) return;
      const name = button.dataset.action!,
        id = button.dataset.id || "";
      const key = `${name}:${id}`;
      if (mutations.has(key)) return;
      mutations.add(key);
      button.disabled = true;
      void handleAction(name, id, button)
        .catch(formError)
        .finally(() => {
          mutations.delete(key);
          button.disabled = false;
        });
    });
    document.addEventListener("submit", (event) => {
      const form = event.target as HTMLFormElement;
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>(
        '[type="submit"], button:not([type])',
      );
      if (form.dataset.busy) return;
      form.dataset.busy = "true";
      if (button) button.disabled = true;
      void submit(form)
        .catch(formError)
        .finally(() => {
          delete form.dataset.busy;
          if (button) button.disabled = false;
        });
    });
    document.addEventListener("input", (event) => {
      const el = event.target as HTMLInputElement;
      if (el.id.startsWith("draft-")) captureDraft();
      if (el.id === "message-body") rememberMessage();
      if (el.id === "reply-body" && state.reading)
        state.replyDrafts.set(state.reading.id, el.value);
    });
    document.addEventListener("change", (event) => {
      const el = event.target as HTMLInputElement;
      if (el.id === "following-only") {
        state.followingOnly = el.checked;
        updateFeedFilters();
      }
      if (el.id === "list-select" && el.value) {
        if (el.value === "manage") {
          el.value = state.timeline.startsWith("list:") ? state.timeline : "";
          void showInterests("lists").catch(formError);
        } else {
          state.timeline = el.value as Timeline;
          state.query = "";
          if (state.view === "bookmarks") navigate("home");
          else void loadFeed();
        }
      }
      if (el.id === "draft-visibility") captureDraft();
      if (el.id === "settings-language" && el.value)
        setDiscoveryLanguages([...state.discoveryLanguages, el.value]);
    });
    document.addEventListener("keydown", editorKeydown);
    document.getElementById("modal")!.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeModal();
    });
    window.addEventListener("hashchange", () => {
      void route();
      window.scrollTo(0, 0);
    });
    window.addEventListener("pagehide", flushDraft);
    window.addEventListener("online", () => {
      for (const draft of getDrafts()) queueDraftSync(draft);
    });
    window.addEventListener("beforeunload", (event) => {
      if (!flushDraft()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flushDraft();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener(
      "change",
      () => {
        if (state.theme === "system") applyTheme();
      },
    );
    const params = new URLSearchParams(location.search);
    if (params.has("code") || params.has("error")) {
      const code = params.get("code"),
        oauthState = params.get("state");
      history.replaceState(null, "", location.pathname + location.hash);
      try {
        if (params.has("error"))
          throw new Error(
            "Authorization was cancelled. You can connect again when you’re ready.",
          );
        await setSession(await finishOAuth(code!, oauthState || undefined));
      } catch (error) {
        await route();
        connectDialog();
        formError(error);
      }
    } else {
      // Saved sessions retain credentials, but server support is not permanent.
      void refreshSessionCapabilities().catch(() => {
        // Allow offline reading and writing; publishing checks again before sending.
      });
      void loadServerDrafts().then(() => {
        if (state.view === "drafts") render();
      });
      await route();
    }
    if (state.api) {
      const api = state.api;
      try {
        const lists =
          await api.get<UserList[]>("/api/v1/lists");
        if (state.api === api) {
          state.lists = lists;
          if (["home", "discover", "bookmarks"].includes(state.view)) render();
        }
      } catch {
        /* Optional capability. */
      }
    }
    document
      .querySelector(".refresh-button")
      ?.setAttribute("aria-label", "Refresh timeline");
  }
  if (typeof document !== "undefined") void boot().catch(formError);
}
