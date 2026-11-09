namespace Fedi {
  const mutations = new Set<string>();
  let homeScroll = 0;
  async function togglePost(id: string, kind: "like" | "save" | "repost"): Promise<void> {
    const post = findPost(id);
    if (!post) return;
    if (state.readerServer) return;
    if (kind === "repost" && !canRepost(post)) return;
    rememberDiscoveryLikes([post]);
    const api = state.api;
    if (api) {
      const updated = await api.toggle(post, kind);
      if (state.api !== api) return;
      [
        ...state.posts,
        ...state.ownPosts,
        ...(state.profile && !state.profile.server ? state.profile.posts : []),
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
    rememberDiscoveryLikes([post]);
    const profile = state.profile;
    if (profile?.owner && ((profile.tab === "likes" && kind === "like") || (profile.tab === "saved" && kind === "save") || (profile.tab === "boosts" && kind === "repost")))
      profile.posts = profile.posts.filter((p) => kind === "like" ? p.liked : kind === "save" ? p.saved : p.reposted);
    render();
  }
  async function toggleFollow(id: string): Promise<void> {
    if (state.readerServer) return;
    const current = state.relationships.get(id),
      api = state.api;
    const unfollow = !!(current?.following || current?.requested);
    const relationship = api
      ? await api.follow(id, unfollow)
      : { id, following: !unfollow, requested: false };
    if (state.api !== api) return;
    state.relationships.set(id, relationship);
    const delta = Number(relationship.following) - Number(!!current?.following);
    const me = state.session?.account || demoMe;
    if (!api) me.following = demoState.follows.length;
    if (me.following !== undefined) me.following = Math.max(0, me.following + delta);
    const profile = state.profile;
    if (profile && !profile.server && profile.account) {
      if (profile.owner) {
        profile.account.following = me.following;
        if (profile.tab === "following" && !relationship.following)
          profile.people = profile.people.filter((a) => a.id !== id);
      } else if (profile.id === id && profile.account.followers !== undefined)
        profile.account.followers = Math.max(0, profile.account.followers + delta);
    }
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
        showModal("Account", `<div class="account-menu">${action("account-profile", "Your profile", "", "button subtle")}${action("account-settings", "Settings", "", "button subtle")}${action("disconnect", "Sign out", "", "button subtle")}</div>`);
        break;
      case "account-profile":
      case "account-settings":
        closeModal();
        navigate(name === "account-profile" ? "profile" : "settings");
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
        state.profile = null;
        state.suggestions = [];
        state.suggestionsLoaded = false;
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
        state.homeTimeline = state.timeline = "home";
        homeScroll = 0;
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
        if (id === "bookmarks") {
          if (state.view !== "bookmarks") navigate("bookmarks");
          break;
        }
        if (id === "home" || id === "lists") {
          if (id === "home" || !state.homeTimeline.startsWith("list:")) state.homeTimeline = id;
          if (state.view !== "home") navigate("home");
          else {
            homeScroll = 0;
            state.timeline = state.homeTimeline;
            await loadFeed(false, undefined, false);
          }
        }
        break;
      case "filter":
        if (id === "all" || id === "article" || id === "post") setFeedFilter(id);
        break;
      case "refresh":
        await loadFeed();
        break;
      case "discovery-timeline":
        if (id === "local" || id === "federated") {
          discovery.timeline = id;
          render();
        }
        break;
      case "load-more":
        await loadFeed(true);
        break;
      case "topic":
        navigate(searchPath(state.session ? `#${id}` : id));
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
      case "dismiss-suggestion":
        dismissSuggestion(id);
        break;
      case "suggestion-previous":
      case "suggestion-next":
        scrollSuggestions(id, name === "suggestion-next" ? 1 : -1);
        break;
      case "profile":
        navigate(profilePath(id));
        break;
      case "profile-refresh":
        await route(true);
        break;
      case "profile-more":
        await loadProfilePage(true);
        break;
      case "profile-image":
        if (id === "avatar" || id === "header") chooseProfileImage(id);
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
      case "save-draft":
        saveCurrentDraft();
        break;
      case "finish-editing":
        finishMobileEditing();
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
      case "markdown-help":
        markdownHelp();
        break;
      case "upload-media":
        chooseDraftImages();
        break;
      case "insert-media":
        insertDraftMedia(id);
        break;
      case "remove-media":
        removeDraftMedia(id);
        break;
      case "retry-media":
        await retryDraftMedia(id);
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
    if (form.id === "editor-link-form") {
      insertEditorLink(value("url"), value("label"));
      return;
    }
    if (form.id === "schedule-form") {
      await submitSchedule(value("time"), form.dataset.id || "");
      return;
    }
    if (["follow-tag-form", "save-list-form", "list-member-search"].includes(form.id)) {
      await submitInterestForm(form.id, value(form.id === "follow-tag-form" ? "tag" : form.id === "save-list-form" ? "title" : "query"));
      return;
    }
    if (form.id === "search-form" || form.id === "discover-search") {
      navigate(searchPath(value("query")));
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
    updateEditorViewport();
    window.visualViewport?.addEventListener("resize", updateEditorViewport);
    window.visualViewport?.addEventListener("scroll", updateEditorViewport);
    window.addEventListener("resize", updateEditorViewport);
    window.addEventListener("resize", updateSuggestionArrows);
    document.addEventListener("focusin", () => { updateEditorTyping(); updateEditorViewport(); });
    document.addEventListener("focusout", () => { setTimeout(updateEditorViewport, 0); });
    document.addEventListener("selectionchange", updateEditorTyping);
    document.addEventListener("beforeinput", editorBeforeInput);
    document.addEventListener("pointerdown", rememberEditorSelection);
    document.addEventListener("mousedown", (event) => {
      if (document.activeElement?.id === "draft-body" &&
          (event.target as Element).closest('.editor-toolbar button')) event.preventDefault();
    });
    if (state.session?.server && state.session.token)
      state.api = new API(state.session.server, state.session.token);
    else state.session = null;
    document.addEventListener("click", (event) => {
      const tab = (event.target as Element).closest<HTMLAnchorElement>(
        '.mobile-nav a[aria-current="page"]',
      );
      if (tab && !event.defaultPrevented && event.button === 0 &&
          !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
          (tab.hash === location.hash || (!location.hash && tab.hash === "#home"))) {
        event.preventDefault();
        window.scrollTo(0, 0);
        return;
      }
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
      document.querySelector(".editor-more[open]")?.removeAttribute("open");
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
      editorInput(event as InputEvent);
      if (el.id.startsWith("draft-")) captureDraft();
      if (el.dataset.mediaAlt) updateMediaDescription(el.dataset.mediaAlt, el.value);
      if (el.id === "message-body") rememberMessage();
      if (el.id === "reply-body" && state.reading)
        state.replyDrafts.set(state.reading.id, el.value);
    });
    document.addEventListener("change", (event) => {
      const el = event.target as HTMLInputElement;
      if (el.id === "editor-smart-punctuation") setEditorSmartPunctuation(el.checked);
      if (el.id === "list-select") {
        state.homeTimeline = state.timeline = el.value.startsWith("list:") ? el.value as HomeTimeline : "lists";
        state.query = "";
        if (state.view !== "home") navigate("home");
        else void loadFeed(false, undefined, false);
      }
      if (el.id === "draft-visibility") captureDraft();
      if (el.id === "settings-language" && el.value)
        setDiscoveryLanguages([...state.discoveryLanguages, el.value]);
    });
    document.addEventListener("error", imageLoadError, true);
    document.addEventListener("keydown", editorKeydown);
    document.addEventListener("paste", editorFileEvent);
    document.addEventListener("drop", editorFileEvent);
    document.addEventListener("dragover", (event) => {
      if (state.view === "editor" && event.dataTransfer?.types.includes("Files") &&
          (event.target as Element).closest("#draft-body, #draft-media, .editor-paper, .note-composer")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    });
    document.getElementById("modal")!.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeModal();
    });
    history.scrollRestoration = "manual";
    window.addEventListener("hashchange", () => {
      if (state.view === "home" && state.timeline === "home") homeScroll = window.scrollY;
      const hash = location.hash;
      const loading = route();
      const restore = state.view === "home" && state.timeline === "home" ? homeScroll : 0;
      window.scrollTo(0, restore);
      const restored = window.scrollY;
      if (restored < restore) {
        void loading.then(() => {
          if (location.hash === hash && window.scrollY === restored) window.scrollTo(0, restore);
        });
      }
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
      else void refreshReading();
    });
    window.addEventListener("online", () => { void refreshReading(); });
    const pollReading = async () => {
      try { await refreshReading(); }
      finally { setTimeout(pollReading, 5000); }
    };
    setTimeout(pollReading, 5000);
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
  }
  if (typeof document !== "undefined") void boot().catch(formError);
}
