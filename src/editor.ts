namespace Fedi {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let publishing = false;
  export function newDraft(kind: Draft["kind"] = "article"): Draft {
    return {
      id: uid(),
      title: "",
      subtitle: "",
      body: "",
      kind,
      visibility: "public",
      warning: "",
      updated: new Date().toISOString(),
    };
  }
  export function draftMarkdown(draft: Draft): string {
    return [
      draft.kind === "article" && draft.title ? `# ${draft.title}` : "",
      draft.kind === "article" ? draft.subtitle : "",
      draft.body,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  export function publicationPayload(draft: Draft, format: PostFormat): string {
    if (draft.kind === "post" && format === "text/plain") return draft.body;
    const source = draftMarkdown(draft);
    return format === "text/html"
      ? markdown(source)
      : format === "text/markdown"
        ? source
        : plainText(source);
  }
  export function publishProblem(
    draft: Draft,
    capabilities: Capabilities,
  ): string {
    if (!draft.body.trim())
      return "Give your publication a little substance before publishing.";
    if (draft.kind === "article" && !draft.title.trim())
      return "Your article needs a title.";
    if (draft.kind === "article") {
      const problem = articleSupportProblem(capabilities);
      if (problem) return `${problem} Your draft stays saved here.`;
    }
    const count = Array.from(
      publicationPayload(draft, capabilities.format) + draft.warning,
    ).length;
    if (count > capabilities.maxChars)
      return `This publication is ${count.toLocaleString()} characters. Your server allows ${capabilities.maxChars.toLocaleString()}. Shorten it or export it for a server with a higher limit.`;
    return "";
  }
  function draftStatus(d: Draft): string {
    const stored = getDrafts().find((saved) => saved.id === d.id);
    const saved = stored && JSON.stringify(stored) === JSON.stringify(d);
    const status = saved
      ? "saved"
      : d.title || d.body || d.subtitle
        ? "pending"
        : "empty";
    return `<div class="draft-save-state"><span class="draft-badge">${d.editingId ? "Editing published writing · unsent changes" : "Draft · unpublished"}</span><span id="save-status" role="status" aria-live="polite" data-state="${status}">${saved ? savedLabel(d.updated) : status === "empty" ? "Not saved yet · start writing" : "Unsaved changes"}</span>${state.session ? `<span id="server-save-status" role="status" aria-live="polite">${escapeHTML(serverDraftLabel(d))}</span>` : ""}</div>`;
  }
  function publicationSettings(d: Draft): string {
    return `<details class="publishing-options"><summary>${d.kind === "post" ? "Audience & content warning" : "Publication settings"} ${icon("down")}</summary><div><label>Who can read this?${d.editingId ? " (unchanged when editing)" : ""}<select id="draft-visibility" ${d.editingId ? "disabled" : ""}><option value="public" ${d.visibility === "public" ? "selected" : ""}>Everyone · public</option><option value="unlisted" ${d.visibility === "unlisted" ? "selected" : ""}>Unlisted · visible by link</option><option value="private" ${d.visibility === "private" ? "selected" : ""}>Followers only</option></select></label><label>Content warning (optional)<input id="draft-warning" value="${escapeHTML(d.warning)}" placeholder="Let readers choose before opening"></label></div>${d.kind === "post" ? action("export-current", "Export draft .md", "", "text-button") : ""}</details>`;
  }
  function scheduleButton(d: Draft): string {
    return state.session && !d.editingId ? action("schedule", "Schedule", "", "button subtle") : "";
  }
  function noteComposerView(d: Draft): string {
    const me = state.session?.account || demoMe;
    return `<section class="note-composer" aria-label="${d.editingId ? "Edit note" : "New note"}">
      <header class="note-header">${avatar(me)}<div><strong>${escapeHTML(me.name)}</strong><span>${d.editingId ? "Editing your note" : state.session ? "A quick note" : "Note · offline demo"}</span></div><a href="#drafts" class="text-button">Drafts</a></header>
      <label class="sr-only" for="draft-body">Note text</label><textarea id="draft-body" class="note-input" placeholder="What's on your mind?" spellcheck="true">${escapeHTML(d.body)}</textarea>
      ${publicationSettings(d)}
      <div class="note-save-row">${draftStatus(d)}<span id="character-count"></span></div>
      <footer class="note-footer"><a class="text-button" href="#drafts">Save & close</a>${scheduleButton(d)}<button id="note-publish" class="button primary" data-action="publish-note" ${!d.body.trim() ? "disabled" : ""}>${d.editingId ? "Update note" : "Note"}</button></footer>
    </section>`;
  }
  export function editorView(): string {
    const d = state.draft!;
    if (d.kind === "post") return noteComposerView(d);
    const tools = [
      ["bold", "<b>B</b>", "Bold (⌘/Ctrl+B)"],
      ["italic", "<i>I</i>", "Italic (⌘/Ctrl+I)"],
      ["heading", "H₂", "Heading"],
      ["quote", "“", "Blockquote"],
      ["list", "☷", "Bulleted list"],
      ["link", icon("link"), "Link (⌘/Ctrl+K)"],
      ["image", icon("image"), "Image URL"],
      ["code", "&lt;/&gt;", "Code block"],
      ["divider", "―", "Divider"],
    ];
    const toolbar = `<div class="editor-toolbar" role="toolbar" aria-label="Markdown formatting">${tools.map(([name, label, title]) => `<button type="button" data-action="format" data-id="${name}" title="${title}" aria-label="${title}">${label}</button>`).join("")}<span>MARKDOWN</span></div>`;
    return `<header class="page-top editor-top"><a class="text-button" href="#drafts">${icon("back")} Your writing</a><div>${draftStatus(d)}${state.preview ? '<button class="zen-preview-edit text-button" data-action="preview">Edit</button>' : ""}<button class="button subtle small-button zen-toggle" data-action="focus" aria-label="${state.focus ? "Exit" : "Enter"} Zen mode" aria-pressed="${state.focus}" title="Zen mode (⌘/Ctrl+Shift+F)">${icon("expand")}<span data-zen-label>${state.focus ? "Exit Zen" : "Zen mode"}</span></button></div></header>
      <div class="editor-controls"><span class="editor-kind">Article</span><div><button class="button subtle" data-action="preview">${icon(state.preview ? "edit" : "eye")} ${state.preview ? "Edit" : "Preview"}</button>${scheduleButton(d)}<button class="button primary" data-action="publish">${d.editingId ? "Update article" : state.session ? "Publish" : "Publish in demo"} ${icon("arrow")}</button></div></div>
      <div class="editor-paper">${
        state.preview
          ? `<div class="article-preview-heading"><span class="eyebrow">READING PREVIEW</span><h1>${escapeHTML(d.title || "Untitled article")}</h1>${d.subtitle ? `<p class="reader-subtitle">${escapeHTML(d.subtitle)}</p>` : ""}<div class="post-byline">${avatar(state.session?.account || demoMe)}<div><strong>${escapeHTML(state.session?.account.name || "You")}</strong><div class="byline-sub">${readingTime(d.body)} min read</div></div></div></div><div class="prose reading-prose">${markdown(d.body) || '<p class="muted">Your story will take shape here.</p>'}</div>`
          : `<div class="article-heading"><label class="sr-only" for="draft-title">Article title</label><input id="draft-title" class="title-input" placeholder="Give your story a title…" value="${escapeHTML(d.title)}" maxlength="250"><label class="sr-only" for="draft-subtitle">Subtitle</label><input id="draft-subtitle" class="subtitle-input" placeholder="Add a subtitle, if you like." value="${escapeHTML(d.subtitle)}" maxlength="500"></div>${toolbar}<label class="sr-only" for="draft-body">Article body in Markdown</label><textarea id="draft-body" class="writing-area" placeholder="It starts with a thought.\n\nTell your story…" spellcheck="true">${escapeHTML(d.body)}</textarea>`
      }</div>
      <div class="editor-bottom"><span id="word-count"></span><span id="character-count"></span>${action("export-current", `${icon("download")} Export .md`, "", "text-button")}</div>
      ${publicationSettings(d)}
      <p class="editor-note">${state.session ? `${state.session.maxChars.toLocaleString()} characters per publication · ${state.session.format === "text/markdown" ? "Native Markdown" : state.session.format === "text/html" ? "Rich text" : "Plain text only"}` : "Not signed in · drafts save on this device · sign in to publish to the fediverse."}</p>`;
  }

  function savedLabel(date: string): string {
    return `Saved at ${new Date(date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · this device`;
  }
  function saveIndicator(
    value: string,
    status: "saved" | "pending" | "empty" | "error",
  ): void {
    const element = document.getElementById("save-status");
    if (!element) return;
    element.textContent = value;
    element.dataset.state = status;
  }

  export function updateEditorMeta(): void {
    const d = state.draft;
    if (!d) return;
    const note = document.querySelector(".editor-note");
    if (note && state.session)
      note.textContent = `${state.session.maxChars.toLocaleString()} characters per publication · ${state.session.format === "text/markdown" ? "Native Markdown" : state.session.format === "text/html" ? "Rich text" : "Plain text only"}`;
    const words = d.body.trim() ? d.body.trim().split(/\s+/).length : 0;
    const count = Array.from(
      publicationPayload(d, state.session?.format || "text/markdown") +
        d.warning,
    ).length;
    const wordElement = document.getElementById("word-count"),
      charElement = document.getElementById("character-count");
    if (wordElement)
      wordElement.textContent = `${words.toLocaleString()} words · ${readingTime(d.body)} min read`;
    if (charElement) {
      charElement.textContent = `${count.toLocaleString()}${state.session ? ` / ${state.session.maxChars.toLocaleString()}` : ""} characters`;
      charElement.classList.toggle(
        "over-limit",
        !!state.session && count > state.session.maxChars,
      );
    }
    const noteButton = document.getElementById(
      "note-publish",
    ) as HTMLButtonElement | null;
    if (noteButton)
      noteButton.disabled =
        !d.body.trim() || (!!state.session && count > state.session.maxChars);
  }
  export function captureDraft(): void {
    const d = state.draft;
    if (!d || publishing) return;
    const before = JSON.stringify([
      d.title,
      d.subtitle,
      d.body,
      d.warning,
      d.visibility,
    ]);
    const value = (id: string) =>
      (document.getElementById(id) as HTMLInputElement | null)?.value;
    d.title = value("draft-title") ?? d.title;
    d.subtitle = value("draft-subtitle") ?? d.subtitle;
    d.body = value("draft-body") ?? d.body;
    d.warning = value("draft-warning") ?? d.warning;
    d.visibility =
      (value("draft-visibility") as Draft["visibility"]) || d.visibility;
    d.updated = new Date().toISOString();
    if (
      before !==
      JSON.stringify([d.title, d.subtitle, d.body, d.warning, d.visibility])
    ) {
      d.publishKey = undefined;
      d.scheduleKey = undefined;
      d.scheduleTime = undefined;
    }
    saveIndicator("Unsaved changes · saving…", "pending");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushDraft, 300);
    updateEditorMeta();
  }
  export function flushDraft(): boolean {
    clearTimeout(saveTimer);
    if (publishing) return true;
    const d = state.draft;
    if (!d) return true;
    const empty = !d.title.trim() && !d.body.trim() && !d.subtitle.trim();
    const success = empty && !d.serverId && !d.serverSaveKey ? removeDraft(d.id) : saveDraft(d);
    saveIndicator(
      success
        ? empty
          ? "Not saved yet · draft is empty"
          : savedLabel(d.updated)
        : "Save failed · export a copy",
      success ? (empty ? "empty" : "saved") : "error",
    );
    const serverStatus = document.getElementById("server-save-status");
    if (serverStatus) serverStatus.textContent = serverDraftLabel(d);
    return success;
  }
  export function formatSelection(kind: string): void {
    if (state.draft?.kind !== "article") return;
    const textarea = document.getElementById(
      "draft-body",
    ) as HTMLTextAreaElement | null;
    if (!textarea) return;
    const start = textarea.selectionStart,
      end = textarea.selectionEnd,
      selected = textarea.value.slice(start, end);
    const formats: Record<string, [string, string, string]> = {
      bold: ["**", "**", "bold text"],
      italic: ["*", "*", "italic text"],
      heading: ["\n## ", "\n", "Heading"],
      quote: ["\n> ", "\n", "A thought worth keeping"],
      list: ["\n- ", "\n", "List item"],
      link: ["[", "](https://example.com)", "link text"],
      image: ["![", "](https://example.com/image.jpg)", "Describe the image"],
      code: ["\n```\n", "\n```\n", "code"],
      divider: ["\n\n---\n\n", "", ""],
    };
    const [prefix, suffix, placeholder] = formats[kind] || formats.bold;
    const content = selected || placeholder;
    textarea.setRangeText(prefix + content + suffix, start, end, "end");
    textarea.focus();
    textarea.setSelectionRange(
      start + prefix.length,
      start + prefix.length + content.length,
    );
    captureDraft();
  }
  export function toggleFocus(): void {
    if (state.view === "editor" && state.draft?.kind !== "article") return;
    state.focus = !state.focus;
    const editing = state.view === "editor";
    document.body.classList.toggle("focus-mode", state.focus);
    document.body.classList.toggle("zen-mode", state.focus && editing);
    const button = document.querySelector<HTMLButtonElement>(
      '[data-action="focus"]',
    );
    if (button) {
      button.setAttribute(
        "aria-label",
        `${state.focus ? "Exit" : "Enter"} ${editing ? "Zen" : "focus"} mode`,
      );
      button.setAttribute("aria-pressed", String(state.focus));
      const label = button.querySelector("[data-zen-label]");
      if (label) label.textContent = state.focus ? "Exit Zen" : "Zen mode";
    }
    if (editing)
      document.getElementById("draft-body")?.focus({ preventScroll: true });
    toast(
      state.focus
        ? `${editing ? "Zen" : "Focus"} mode. Press Escape to come back.`
        : "Welcome back.",
    );
  }
  export async function reviewPublication(): Promise<void> {
    flushDraft();
    const d = state.draft, api = state.api, session = state.session;
    if (!d) return;
    await refreshSessionCapabilities();
    if (state.draft !== d || state.api !== api || state.session !== session) return;
    const capabilities = state.session || {
      maxChars: 100000,
      format: "text/markdown" as const,
      software: "demo",
    };
    const problem = publishProblem(d, capabilities);
    if (problem) {
      toast(problem);
      return;
    }
    showModal(
      d.editingId
        ? "Update this publication?"
        : state.session
          ? "Ready to share your writing?"
          : "Publish to your offline demo?",
      `<div class="publish-preview"><span class="eyebrow">${d.kind} · ${d.visibility === "private" ? "FOLLOWERS ONLY" : d.visibility.toUpperCase()}</span><h3>${escapeHTML(d.title || "A new post")}</h3><p>${escapeHTML(plainText(d.body).slice(0, 240))}…</p><p class="muted">${readingTime(d.body)} min read · ${Array.from(publicationPayload(d, capabilities.format) + d.warning).length.toLocaleString()} characters</p></div><p>${d.editingId ? "Your changes will update the existing publication. Its link, likes, replies, and audience stay the same." : state.session ? `This is one publication on <strong>${escapeHTML(new URL(state.session.server).host)}</strong>. ${d.visibility === "public" ? "Anyone can read and share it." : d.visibility === "private" ? "Only approved followers can read it." : "It stays out of public timelines, but anyone with its link can read it."}` : "This stays in your browser. Sign in to share real publications with the fediverse."}</p>${action("confirm-publish", d.editingId ? "Update publication" : state.session ? "Publish now" : "Publish in demo", "", "button primary full-width")}`,
    );
  }
  export async function publishDraft(): Promise<void> {
    if (publishing || !state.draft) return;
    const d = state.draft,
      api = state.api,
      session = state.session,
      key = draftKey();
    publishing = true;
    try {
      d.publishKey ||= uid();
      if (!saveDraft(d, false))
        throw new Error(
          "Could not save your draft before publishing. Export a copy first and free up browser storage.",
        );
      await refreshSessionCapabilities();
      if (state.draft !== d || state.api !== api || state.session !== session) return;
      const problem = publishProblem(
        d,
        session || {
          maxChars: 100000,
          format: "text/markdown",
          software: "demo",
        },
      );
      if (problem) throw new Error(problem);
      await deleteSyncedDraft(d.id, true);
      if (state.api !== api) return;
      let post: Post;
      if (api && session)
        post = d.editingId
          ? await api.editStatus(
              d.editingId,
              publicationPayload(d, session.format),
              d.warning,
              session.format,
            )
          : await api.createStatus(
              publicationPayload(d, session.format),
              d.visibility,
              undefined,
              d.warning,
              d.publishKey,
              session.format,
            );
      else
        post = {
          ...(d.editingId
            ? findPost(d.editingId)
            : undefined),
          id: d.editingId || uid(),
          author: demoMe,
          title: d.kind === "article" ? d.title : "",
          subtitle: d.kind === "article" ? d.subtitle : "",
          markdown: d.body,
          kind: d.kind,
          created: d.editingId
            ? findPost(d.editingId)?.created || new Date().toISOString()
            : new Date().toISOString(),
          likes: d.editingId ? findPost(d.editingId)?.likes || 0 : 0,
          replies: d.editingId ? findPost(d.editingId)?.replies || 0 : 0,
          reposts: d.editingId ? findPost(d.editingId)?.reposts || 0 : 0,
          liked: d.editingId ? !!findPost(d.editingId)?.liked : false,
          reposted: d.editingId ? !!findPost(d.editingId)?.reposted : false,
          saved: d.editingId ? !!findPost(d.editingId)?.saved : false,
          visibility: d.visibility,
          warning: d.warning,
          tags: ["Writing"],
          local: true,
        };
      if (!api) {
        demoState.posts = [
          post,
          ...demoState.posts.filter((p) => p.id !== post.id),
        ];
        for (const parentId of Object.keys(demoState.comments)) {
          demoState.comments[parentId] = demoState.comments[parentId].map(
            (p) => p.id === post.id ? post : p,
          );
        }
        saveDemo();
      }
      const drafts = readStore<Draft[]>(key, []).filter((x) => x.id !== d.id);
      writeStore(key, drafts);
      if (state.api !== api) return;
      if (!d.editingId && state.session?.account.statuses !== undefined)
        state.session.account.statuses++;
      state.draft = null;
      state.posts = [post, ...state.posts.filter((p) => p.id !== post.id)];
      state.ownPosts = [
        post,
        ...state.ownPosts.filter((p) => p.id !== post.id),
      ];
      state.reading = post;
      closeModal();
      toast(
        d.editingId
          ? "Your publication has been updated."
          : api
            ? "Your publication is out in the world."
            : "Published in your offline demo.",
      );
      navigate(`read/${encodeURIComponent(post.id)}`);
    } finally {
      publishing = false;
    }
  }
  export async function scheduleDraft(scheduledAt: string): Promise<void> {
    validateScheduleTime(scheduledAt);
    const d = state.draft, api = state.api, session = state.session, key = draftKey();
    if (publishing || !d || !api || !session) throw new Error("Open a draft and connect an account before scheduling.");
    if (d.editingId) throw new Error("Updates to published posts cannot be scheduled.");
    publishing = true;
    try {
      if (d.scheduleTime !== scheduledAt) d.scheduleKey = undefined;
      d.scheduleKey ||= uid();
      d.scheduleTime = scheduledAt;
      if (!saveDraft(d, false)) throw new Error("Could not save your draft before scheduling. Export a copy first.");
      await refreshSessionCapabilities();
      if (state.draft !== d || state.api !== api || state.session !== session) return;
      const problem = publishProblem(d, session);
      if (problem) throw new Error(problem);
      await deleteSyncedDraft(d.id, true);
      if (state.api !== api) return;
      await api.createScheduledStatus(publicationPayload(d, session.format), d.visibility,
        d.warning, session.format, scheduledAt, d.scheduleKey);
      if (!writeStore(key, readStore<Draft[]>(key, []).filter((x) => x.id !== d.id)))
        throw new Error("Publication is scheduled, but the local draft could not be removed. Check Scheduled before retrying.");
      if (state.api !== api) return;
      state.draft = null;
      toast("Publication scheduled. Your server will publish it automatically.");
    } finally {
      publishing = false;
    }
  }
  function ownedPublication(id: string): Post {
    const post = findPost(id);
    if (
      !post ||
      state.readerServer ||
      post.author.id !== (state.session?.account.id || "you") ||
      post.visibility === "direct"
    ) {
      throw new Error("You can only manage your own publications.");
    }
    return post;
  }
  export function draftFromSource(
    post: Post,
    source: { text: string; spoiler_text: string; content_type?: PostFormat },
  ): Draft {
    const text =
      source.content_type === "text/html"
        ? htmlToMarkdown(source.text)
        : source.text;
    const heading = /^#\s+([^\n]+)\n*/.exec(text);
    return {
      ...newDraft(),
      editingId: post.id,
      title: heading?.[1] || "",
      subtitle: "",
      body: heading ? text.slice(heading[0].length) : text,
      kind: heading ? "article" : "post",
      warning: source.spoiler_text || "",
      visibility: post.visibility === "direct" ? "private" : post.visibility,
    };
  }
  export async function editPublication(id: string): Promise<void> {
    const post = ownedPublication(id),
      api = state.api;
    const existing = getDrafts().find((d) => d.editingId === id);
    if (existing) {
      navigate(`write/${encodeURIComponent(existing.id)}`);
      return;
    }
    const draft = await publicationDraft(post, api);
    if (state.api !== api) return;
    if (!saveDraft(draft))
      throw new Error(
        "Could not create an editing draft. Free up browser storage before editing.",
      );
    navigate(`write/${encodeURIComponent(draft.id)}`);
  }
  async function publicationDraft(post: Post, api: API | null): Promise<Draft> {
    return api
      ? draftFromSource(post, await api.source(post.id))
      : {
          ...newDraft(),
          editingId: post.id,
          title: post.title,
          subtitle: post.subtitle,
          body: post.markdown,
          kind: post.kind,
          warning: post.warning,
          visibility: post.visibility as Draft["visibility"],
        };
  }
  export function confirmUnpublishPublication(id: string): void {
    const post = ownedPublication(id);
    showModal(
      "Move this publication to drafts?",
      `<p><strong>${escapeHTML(post.title || plainText(post.markdown).slice(0, 100))}</strong></p><p>First, save a Markdown draft in this browser. Then remove the published version${state.api ? " from your server and request removal from the fediverse" : " from the demo"}.</p><p>Publishing it again creates a new post and link. Existing likes and replies do not transfer.</p>${action("confirm-unpublish-publication", "Move to drafts", id, "button primary")} ${action("close-modal", "Keep published", "", "button subtle")}`,
    );
  }
  export async function unpublishPublication(id: string): Promise<void> {
    const post = ownedPublication(id),
      api = state.api;
    // A stable local ID reuses the recovery copy if a removal must be retried.
    const draftId = `unpublished:${id}`;
    const draft =
      getDrafts().find((d) => d.id === draftId) ||
      (await publicationDraft(post, api));
    if (state.api !== api) return;
    draft.id = draftId;
    delete draft.editingId;
    if (!saveDraft(draft))
      throw new Error(
        "Could not save the draft. The published version was not removed. Free up browser storage and try again.",
      );
    try {
      if (api) await api.deleteStatus(id);
    } catch (error) {
      throw new Error(
        `A draft copy is saved, but the server did not confirm unpublishing. The original may still be live. ${(error as Error).message}`,
      );
    }
    if (state.api !== api) return;
    removePublicationFromState(post);
    closeModal();
    toast("Unpublished. Your article is saved in drafts.");
    navigate(`write/${encodeURIComponent(draft.id)}`);
  }
  export function confirmDeletePublication(id: string): void {
    const post = ownedPublication(id),
      kind = post.replyTo ? "comment" : "publication";
    showModal(
      `Delete this ${kind}?`,
      `<p><strong>${escapeHTML(post.title || plainText(post.markdown).slice(0, 100))}</strong></p><p>${state.api ? `This will delete the ${kind} from your server and request its removal from the fediverse. This cannot be undone.` : `This removes the ${kind} from your offline demo.`}</p>${action("confirm-delete-publication", `Delete ${kind}`, id, "button danger")} ${action("close-modal", `Keep ${kind}`, "", "button subtle")}`,
    );
  }
  export async function deletePublication(id: string): Promise<void> {
    const post = ownedPublication(id),
      api = state.api;
    if (api) await api.deleteStatus(id);
    if (state.api !== api) return;
    const wasReading = removePublicationFromState(post);
    closeModal();
    toast(post.replyTo ? "Comment deleted." : "Publication deleted.");
    if (state.view === "reader" && wasReading) {
      state.libraryTab = post.replyTo ? "replies" : "published";
      navigate("drafts");
    } else render();
  }
  function removePublicationFromState(post: Post): boolean {
    const id = post.id;
    if (post.replyTo) {
      // A post can occur in multiple views, sometimes as the same object.
      const cachedPosts = new Set([
        ...state.posts,
        ...state.ownPosts,
        ...(state.profile && !state.profile.server ? state.profile.posts : []),
        ...(state.readerServer ? [] : state.comments),
        ...(state.reading && !state.readerServer ? [state.reading] : []),
        ...(!state.api
          ? [...demoState.posts, ...Object.values(demoState.comments).flat()]
          : []),
      ]);
      for (const parent of cachedPosts) {
        if (parent.id === post.replyTo)
          parent.replies = Math.max(0, parent.replies - 1);
      }
    }
    if (!state.api) {
      demoState.posts = demoState.posts.filter((p) => p.id !== id);
      for (const parentId of Object.keys(demoState.comments)) {
        demoState.comments[parentId] = demoState.comments[parentId].filter(
          (p) => p.id !== id,
        );
      }
      delete demoState.comments[id];
      saveDemo();
    }
    state.posts = state.posts.filter((p) => p.id !== id);
    state.ownPosts = state.ownPosts.filter((p) => p.id !== id);
    if (state.profile && !state.profile.server)
      state.profile.posts = state.profile.posts.filter((p) => p.id !== id);
    if (!state.readerServer)
      state.comments = state.comments.filter((p) => p.id !== id);
    if (state.session?.account.statuses !== undefined)
      state.session.account.statuses = Math.max(
        0,
        state.session.account.statuses - 1,
      );
    // Preserve any local editing draft as an unpublished draft after deletion.
    getDrafts()
      .filter((d) => d.editingId === id)
      .forEach((d) => {
        delete d.editingId;
        saveDraft(d);
      });
    const wasReading = !state.readerServer && state.reading?.id === id;
    if (wasReading) state.reading = null;
    return wasReading;
  }
  export function exportDraft(draft: Draft): void {
    download(
      `${
        (draft.title || "untitled-draft")
          .replace(/[^a-z0-9 -]/gi, "")
          .trim()
          .replace(/\s+/g, "-")
          .slice(0, 80) || "draft"
      }.md`,
      draftMarkdown(draft),
    );
  }
  export function editorKeydown(event: KeyboardEvent): void {
    if ((document.getElementById("modal") as HTMLDialogElement).open) return;
    if (event.key === "Escape" && state.focus) {
      toggleFocus();
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    if (
      ((state.view === "editor" && state.draft?.kind === "article") ||
        state.view === "reader") &&
      event.shiftKey &&
      event.key.toLowerCase() === "f"
    ) {
      event.preventDefault();
      toggleFocus();
      return;
    }
    if (state.view !== "editor") return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      flushDraft();
      return;
    }
    if (
      state.draft?.kind !== "article" ||
      document.activeElement?.id !== "draft-body"
    )
      return;
    const format = { b: "bold", i: "italic", k: "link" }[key];
    if (format) {
      event.preventDefault();
      formatSelection(format);
    }
  }
}
