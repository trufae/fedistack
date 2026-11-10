namespace Fedi {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let publishing = false;
  export function editorPublishing(): boolean { return publishing; }
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
    if (mediaBusy(draft)) return "Wait for your images to finish uploading before publishing.";
    if (draft.media?.some((m) => !m.url)) return "An image is still processing. Use Check image or remove it before publishing.";
    if ((draft.media?.length || 0) > (capabilities.maxMedia ?? 4))
      return `Your server allows ${capabilities.maxMedia ?? 4} attachments per publication.`;
    if (draft.media?.some((m) => Array.from(m.description).length > (capabilities.mediaDescriptionLimit || 1500)))
      return "An image description exceeds your server’s alt text limit.";
    if (!draft.body.trim() && !(draft.kind === "post" && draft.media?.length))
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
  function draftSaveControls(d: Draft): string {
    const stored = getDrafts().find((saved) => saved.id === d.id);
    const saved = stored && JSON.stringify(stored) === JSON.stringify(d);
    const status = saved
      ? "saved"
      : d.title || d.body || d.subtitle || d.media?.length
        ? "pending"
        : "empty";
    return `<div class="draft-save-controls"><button type="button" class="button subtle small-button" data-action="save-draft" aria-describedby="save-status" title="Save draft (⌘/Ctrl+S)">Save draft</button><span id="save-status" role="status" aria-live="polite" data-state="${status}">${saved ? "Saved" : status === "empty" ? "" : "Unsaved"}</span></div>`;
  }
  function publicationSettings(d: Draft): string {
    return `<details class="publishing-options"><summary>${d.kind === "post" ? "Audience & content warning" : "Publication settings"} ${icon("down")}</summary><div><label>Who can read this?${d.editingId ? " (unchanged when editing)" : ""}<select id="draft-visibility" ${d.editingId ? "disabled" : ""}><option value="public" ${d.visibility === "public" ? "selected" : ""}>Everyone · public</option><option value="unlisted" ${d.visibility === "unlisted" ? "selected" : ""}>Unlisted · visible by link</option><option value="private" ${d.visibility === "private" ? "selected" : ""}>Followers only</option></select></label><label>Content warning (optional)<input id="draft-warning" value="${escapeHTML(d.warning)}" placeholder="Let readers choose before opening"></label></div>${d.kind === "post" ? action("export-current", "Export draft .md", "", "text-button") : ""}</details>`;
  }
  function scheduleButton(d: Draft): string {
    return state.session && !d.editingId ? action("schedule", "Schedule", "", "button subtle") : "";
  }
  function publicationManagement(d: Draft): string {
    return d.editingId
      ? action("unpublish-publication", "Unpublish", d.editingId, "button subtle") +
        action("delete-publication", "Delete", d.editingId, "button subtle delete-link")
      : "";
  }
  function editorOptions(d: Draft): string {
    return `<details class="editor-more"><summary class="icon-button" aria-label="More editor options" title="More editor options">···</summary><div class="editor-menu">${scheduleButton(d)}<button class="button subtle zen-toggle" data-action="focus" aria-pressed="${state.focus}" title="Zen mode (⌘/Ctrl+Shift+F)"><span data-zen-label>${state.focus ? "Exit Zen" : "Zen mode"}</span></button><label class="editor-typing-option"><input id="editor-smart-punctuation" type="checkbox" ${editorSmartPunctuation ? "checked" : ""}> Smart punctuation</label><p>Keyboard quotes and corrections. Always off in code.</p><label class="editor-typing-option"><input id="editor-vim" type="checkbox" ${editorVimEnabled ? "checked" : ""}> Vim mode</label><p>Article body only. hjkl move · i insert · v select · Esc normal.</p>${publicationManagement(d)}</div></details>`;
  }
  function noteComposerView(d: Draft): string {
    const me = state.session?.account || demoMe;
    return `<section class="note-composer" aria-label="${d.editingId ? "Edit note" : "New note"}">
      <header class="note-header">${avatar(me)}<div><strong>${escapeHTML(me.name)}</strong><span>${d.editingId ? "Editing your note" : state.session ? "A quick note" : "Note · offline demo"}</span></div><a href="#drafts" class="text-button">Drafts</a></header>
      <label class="sr-only" for="draft-body">Note text</label><textarea id="draft-body" class="note-input" placeholder="What's on your mind?" spellcheck="true">${escapeHTML(d.body)}</textarea>
      ${draftMediaView(d)}
      ${publicationSettings(d)}
      <div class="note-save-row"><span id="character-count"></span></div>
      <footer class="note-footer">${draftSaveControls(d)}${scheduleButton(d)}<button id="note-publish" class="button primary" data-action="publish-note" ${(!d.body.trim() && !d.media?.length) || mediaBusy(d) ? "disabled" : ""}>${d.editingId ? "Update note" : "Note"}</button>${publicationManagement(d)}</footer>
    </section>`;
  }
  export function editorView(): string {
    const d = state.draft!;
    if (d.kind === "post") return noteComposerView(d);
    const content = articleContent({ title: d.title, subtitle: d.subtitle, markdown: d.body });
    const tools = [
      ["bold", "<b>B</b>", "Bold (⌘/Ctrl+B)"],
      ["italic", "<i>I</i>", "Italic (⌘/Ctrl+I)"],
      ["strike", "<s>S</s>", "Strikethrough"],
      ["heading", "H₂", "Section heading"],
      ["subheading", "H₃", "Subheading"],
      ["quote", "“", "Blockquote"],
      ["list", "☷", "Bulleted list"],
      ["ordered", "1.", "Numbered list"],
      ["task", "☑", "Checklist"],
      ["link", icon("link"), "Link (⌘/Ctrl+K)"],
      ["image", icon("image"), "Image URL"],
      ["code", "&lt;/&gt;", "Code block"],
      ["inline-code", "`", "Inline code"],
      ["divider", "―", "Divider"],
    ];
    const toolbar = `<div class="editor-tools"><button type="button" class="editor-done text-button" data-action="finish-editing">Done</button><div class="editor-toolbar" role="toolbar" aria-label="Markdown formatting">${tools.map(([name, label, title]) => `<button type="button" data-action="format" data-id="${name}" title="${title}" aria-label="${title}">${label}</button>`).join("")}<button type="button" data-action="upload-media" title="Upload images" aria-label="Upload images">${icon("image")}+</button><button type="button" data-action="markdown-help" title="Markdown help" aria-label="Markdown help">?</button></div><span id="editor-vim-status" class="editor-vim-status" role="status" aria-live="polite" title="hjkl move · i insert · v select · Esc normal" ${editorVimEnabled ? "" : "hidden"}>Vim · normal</span></div>`;
    return `<header class="page-top editor-top"><a class="text-button editor-back" href="#drafts" aria-label="Your writing">${icon("back")}<span>Your writing</span></a>${draftSaveControls(d)}<div class="editor-actions"><button class="button subtle editor-preview" data-action="preview" aria-label="${state.preview ? "Edit article" : "Preview article"}" title="${state.preview ? "Edit" : "Preview"}">${icon(state.preview ? "edit" : "eye")}<span>${state.preview ? "Edit" : "Preview"}</span></button><button class="button primary" data-action="publish">${d.editingId ? "Update" : "Publish"}</button>${editorOptions(d)}</div></header>
      <div class="editor-paper">${
        state.preview
          ? `<div class="article-preview-heading"><span class="eyebrow">READING PREVIEW</span><h1>${escapeHTML(d.title || "Untitled article")}</h1>${content.subtitle ? `<p class="reader-subtitle">${escapeHTML(content.subtitle)}</p>` : ""}<div class="post-byline">${avatar(state.session?.account || demoMe)}<div><strong>${escapeHTML(state.session?.account.name || "You")}</strong><div class="byline-sub">${readingTime(d.body)} min read</div></div></div></div><div class="prose reading-prose">${markdown(content.body) || '<p class="muted">Your story will take shape here.</p>'}</div>`
          : `<div class="article-heading"><label class="sr-only" for="draft-title">Article title</label><input id="draft-title" class="title-input" placeholder="Give your story a title…" value="${escapeHTML(d.title)}" maxlength="250"><label class="sr-only" for="draft-subtitle">Subtitle</label><input id="draft-subtitle" class="subtitle-input" placeholder="Add a subtitle, if you like." value="${escapeHTML(d.subtitle)}" maxlength="500"></div>${toolbar}<label class="sr-only" for="draft-body">Article body in Markdown</label><textarea id="draft-body" class="writing-area" placeholder="It starts with a thought.\n\nTell your story…" spellcheck="${editorSmartPunctuation}" autocorrect="${editorSmartPunctuation ? "on" : "off"}" autocapitalize="${editorSmartPunctuation ? "sentences" : "off"}" writingsuggestions="${editorSmartPunctuation}">${escapeHTML(d.body)}</textarea>`
      }${state.preview ? attachmentGallery(d.media, d.body) : ""}</div>
      ${draftMediaView(d)}
      <div class="editor-bottom"><span id="word-count"></span><span id="character-count"></span>${action("export-current", `${icon("download")} Export .md`, "", "text-button")}</div>
      ${publicationSettings(d)}
      <p class="editor-note">${state.session ? `${state.session.maxChars.toLocaleString()} characters per publication · ${state.session.format === "text/markdown" ? "Native Markdown" : state.session.format === "text/html" ? "Rich text" : "Plain text only"}` : "Sign in to publish to the fediverse."}</p>`;
  }

  function saveIndicator(
    value: string,
    status: "saved" | "pending" | "empty" | "error",
  ): void {
    const element = document.getElementById("save-status");
    if (!element) return;
    if (status === "error" && element.dataset.state !== "error") toast(value);
    element.textContent = value;
    element.dataset.state = status;
    const button = document.querySelector<HTMLButtonElement>('[data-action="save-draft"]');
    if (button) button.textContent = status === "error" ? "Retry save" : "Save draft";
  }

  export function updateEditorMeta(): void {
    const d = state.draft;
    if (!d) return;
    updateEditorTyping();
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
        (!d.body.trim() && !d.media?.length) || mediaBusy(d) || !!d.media?.some((m) => !m.url) || (!!state.session && count > state.session.maxChars);
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
    if (
      before !==
      JSON.stringify([d.title, d.subtitle, d.body, d.warning, d.visibility])
    ) {
      d.publishKey = undefined;
      d.scheduleKey = undefined;
      d.scheduleTime = undefined;
    }
    draftChanged(false);
  }
  export function draftChanged(resetKeys = true): void {
    const d = state.draft;
    if (!d || publishing) return;
    d.updated = new Date().toISOString();
    if (resetKeys) d.publishKey = d.scheduleKey = d.scheduleTime = undefined;
    saveIndicator("Saving…", "pending");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushDraft, 300);
    updateEditorMeta();
  }
  export function flushDraft(): boolean {
    clearTimeout(saveTimer);
    if (publishing) return true;
    const d = state.draft;
    if (!d) return true;
    const empty = !d.title.trim() && !d.body.trim() && !d.subtitle.trim() && !d.media?.length && !mediaBusy(d);
    const success = empty && !d.serverId && !d.serverSaveKey ? removeDraft(d.id) : saveDraft(d);
    saveIndicator(
      success
        ? empty
          ? ""
          : "Saved"
        : "Save failed · export a copy",
      success ? (empty ? "empty" : "saved") : "error",
    );
    return success;
  }
  export function saveCurrentDraft(): void {
    const d = state.draft;
    if (!d || publishing) return;
    captureDraft();
    if (!flushDraft()) {
      toast("Could not save your draft. Export a copy to keep your writing.");
      return;
    }
    toast(d.title.trim() || d.subtitle.trim() || d.body.trim() || d.media?.length
      ? "Draft saved." : "Nothing to save yet.");
  }
  export function insertEditorText(text: string, start?: number, end?: number): void {
    if (publishing) return;
    const textarea = document.getElementById("draft-body") as HTMLTextAreaElement | null;
    if (!textarea) return;
    start ??= textarea.selectionStart;
    end ??= textarea.selectionEnd;
    textarea.focus();
    textarea.setSelectionRange(start, end);
    // Use the browser's editing operation to retain native Undo/Redo history.
    if (!document.execCommand?.("insertText", false, text))
      textarea.setRangeText(text, start, end, "end");
    captureDraft();
  }
  let linkSelection: { draft: Draft; start: number; end: number; image: boolean } | undefined;
  export interface EditorSelection { textarea: HTMLTextAreaElement; start: number; end: number }
  let toolbarSelection: EditorSelection | undefined;
  export function rememberEditorSelection(event: PointerEvent): void {
    toolbarSelection = undefined;
    if (!(event.target as Element).closest('[data-action="format"], [data-action="upload-media"], [data-action="insert-media"]')) return;
    const textarea = document.getElementById("draft-body") as HTMLTextAreaElement | null;
    if (textarea) toolbarSelection = { textarea, start: textarea.selectionStart, end: textarea.selectionEnd };
  }
  export function takeEditorSelection(): EditorSelection | undefined {
    const textarea = document.getElementById("draft-body") as HTMLTextAreaElement | null;
    const selection = textarea ? toolbarSelection?.textarea === textarea ? toolbarSelection
      : { textarea, start: textarea.selectionStart, end: textarea.selectionEnd } : undefined;
    toolbarSelection = undefined;
    return selection;
  }
  export function insertEditorLink(url: string, label: string): void {
    const selection = linkSelection;
    if (!selection || state.draft !== selection.draft) return;
    const safe = safeURL(url, selection.image);
    if (!safe || (selection.image && !safe.startsWith("https://")))
      throw new Error(selection.image ? "Enter an HTTPS image URL." : "Enter an HTTP or HTTPS link.");
    closeModal();
    insertEditorText(`${selection.image ? "!" : ""}[${markdownLabel(label || (selection.image ? "" : safe))}](${markdownURL(safe)})`, selection.start, selection.end);
    linkSelection = undefined;
  }
  export function markdownHelp(): void {
    showModal("Writing with Markdown", `<p>Select text, then use the toolbar or keyboard shortcuts. Paste or drop images to upload them.</p><div class="markdown-help"><code>## Section heading<br>### Subheading<br>**Bold** · *Italic* · ~~Strikethrough~~<br>- Bullet item<br>1. Numbered item<br>- [ ] Task · - [x] Completed task<br>&gt; A quotation<br>&#96;inline code&#96;<br>--- (divider)</code></div><p>Enter continues lists and quotes; Enter on an empty item ends the list. Tab indents selected lines; Shift+Tab removes indentation. Cmd/Ctrl+Z undoes toolbar edits. Use Preview to check the result.</p>${action("close-modal", "Back to writing", "", "button primary")}`);
  }
  export function formatSelection(kind: string): void {
    if (state.draft?.kind !== "article" || publishing) return;
    if (state.preview && kind === "image") { state.preview = false; render(); }
    const textarea = document.getElementById(
      "draft-body",
    ) as HTMLTextAreaElement | null;
    if (!textarea) return;
    const selection = takeEditorSelection();
    if (selection) textarea.setSelectionRange(selection.start, selection.end);
    const start = textarea.selectionStart,
      end = textarea.selectionEnd,
      selected = textarea.value.slice(start, end);
    if (kind === "link" || kind === "image") {
      linkSelection = { draft: state.draft, start, end, image: kind === "image" };
      const text = selected.trim();
      const existing = /^!?\[([^\]\n]*)\]\((https?:\/\/[^\s]+)\)$/.exec(text);
      const url = existing ? safeURL(existing[2]) : /^https?:\/\/\S+$/i.test(text) ? safeURL(text) : "";
      const label = existing && url ? existing[1] : url ? "" : selected;
      showModal(kind === "image" ? "Insert an image from a URL" : "Insert a link", `<form id="editor-link-form"><label>${kind === "image" ? "Image URL (HTTPS)" : "URL"}<input type="url" name="url" required placeholder="https://" value="${escapeHTML(url)}" autocorrect="off" autocapitalize="off" spellcheck="false" ${url ? "" : "autofocus"}></label><label>${kind === "image" ? "Image description (alt text)" : "Link text (optional)"}<input name="label" value="${escapeHTML(label)}" placeholder="${kind === "image" ? "Describe the image" : "Text to display"}" ${url ? "autofocus" : ""}></label><button type="submit" class="button primary">Insert ${kind === "image" ? "image" : "link"}</button></form>`);
      return;
    }
    const linePrefixes: Record<string, string> = { heading: "## ", subheading: "### ", quote: "> ", list: "- ", ordered: "1. ", task: "- [ ] " };
    if (linePrefixes[kind]) {
      const from = textarea.value.slice(0, start).lastIndexOf("\n") + 1;
      const last = end > start && textarea.value[end - 1] === "\n" ? end - 1 : end;
      const to = textarea.value.indexOf("\n", last);
      const stop = to < 0 ? textarea.value.length : to;
      const lines = textarea.value.slice(from, stop).split("\n");
      const prefix = linePrefixes[kind];
      const remove = lines.every((line) => kind === "ordered" ? /^\d+\. /.test(line) : line.startsWith(prefix));
      const result = lines.map((line, i) => remove ? kind === "ordered" ? line.replace(/^\d+\. /, "") : line.slice(prefix.length) :
        (kind === "ordered" ? `${i + 1}. ` : prefix) + line.replace(/^(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, "")).join("\n");
      insertEditorText(result, from, stop);
      textarea.setSelectionRange(from, from + result.length);
      return;
    }
    const formats: Record<string, [string, string, string]> = {
      bold: ["**", "**", "bold text"],
      italic: ["*", "*", "italic text"],
      strike: ["~~", "~~", "text"],
      "inline-code": ["`", "`", "code"],
      code: ["\n```\n", "\n```\n", "code"],
      divider: ["\n\n---\n\n", "", ""],
    };
    const [prefix, suffix, placeholder] = formats[kind] || formats.bold;
    const content = selected || placeholder;
    if (selected && prefix && suffix && selected.startsWith(prefix) && selected.endsWith(suffix)) {
      insertEditorText(selected.slice(prefix.length, -suffix.length), start, end);
      return;
    }
    if (selected && textarea.value.slice(start - prefix.length, start) === prefix && textarea.value.slice(end, end + suffix.length) === suffix) {
      insertEditorText(selected, start - prefix.length, end + suffix.length);
      return;
    }
    insertEditorText(prefix + content + suffix, start, end);
    textarea.setSelectionRange(
      start + prefix.length,
      start + prefix.length + content.length,
    );
  }
  export function toggleFocus(): void {
    if (state.view === "editor" && state.draft?.kind !== "article") return;
    if (state.view === "editor" && mobileEditorLayout()) {
      document.getElementById("draft-body")?.focus({ preventScroll: true });
      updateEditorViewport();
      return;
    }
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
  async function prepareDraftMedia(d: Draft, api: API): Promise<void> {
    if (!d.media?.length) return;
    const content = JSON.stringify(d.media.map((m) => [m.id, m.description]));
    if (d.mediaPrepared === content) return;
    for (const media of d.media) await api.describeMedia(media);
    if (state.api !== api || state.draft !== d) return;
    // A successful publication with a lost response can only be recovered by
    // replaying its idempotency key, not by updating its now-attached media.
    d.mediaPrepared = content;
    if (!saveDraft(d, false)) throw new Error("Could not save image descriptions before publishing. Free up browser storage and try again.");
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
      if (api && !d.editingId) {
        await prepareDraftMedia(d, api);
        if (state.api !== api || state.session !== session) return;
      }
      let post: Post;
      if (api && session)
        post = d.editingId
          ? await api.editStatus(
              d.editingId,
              publicationPayload(d, session.format),
              d.warning,
              session.format,
              d.media,
            )
          : await api.createStatus(
              publicationPayload(d, session.format),
              d.visibility,
              undefined,
              d.warning,
              d.publishKey,
              session.format,
              d.media,
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
          media: d.media,
          image: d.media?.[0]?.previewUrl,
          imageAlt: d.media?.[0]?.description,
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
      await prepareDraftMedia(d, api);
      if (state.api !== api || state.session !== session) return;
      await api.createScheduledStatus(publicationPayload(d, session.format), d.visibility,
        d.warning, session.format, scheduledAt, d.scheduleKey, d.media);
      if (!writeStore(key, readStore<Draft[]>(key, []).filter((x) => x.id !== d.id)))
        throw new Error("Publication is scheduled, but the local draft could not be removed. Check Scheduled before retrying.");
      if (state.api !== api) return;
      state.draft = null;
      toast("Publication scheduled. Your server will publish it automatically.");
    } finally {
      publishing = false;
    }
  }
  async function ownedPublication(id: string): Promise<Post> {
    let post = findPost(id);
    const draft = state.draft, api = state.api;
    if (!post && api && state.view === "editor" && draft?.editingId === id) {
      post = await api.status(id);
      if (state.api !== api || state.draft !== draft)
        throw new Error("The editing session has changed.");
    }
    if (!post || !canManagePublication(post))
      throw new Error("You can only manage your own publications.");
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
      media: post.media?.map((m) => ({ ...m })),
      visibility: post.visibility === "direct" ? "private" : post.visibility,
    };
  }
  export async function editPublication(id: string): Promise<void> {
    const api = state.api,
      post = await ownedPublication(id);
    if (state.api !== api) return;
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
          media: post.media?.map((m) => ({ ...m })),
          kind: post.kind,
          warning: post.warning,
          visibility: post.visibility as Draft["visibility"],
        };
  }
  export async function confirmUnpublishPublication(id: string): Promise<void> {
    const post = await ownedPublication(id);
    showModal(
      "Move this publication to drafts?",
      `<p><strong>${escapeHTML(post.title || plainText(post.markdown).slice(0, 100))}</strong></p><p>First, save ${state.draft?.editingId === id ? "your current edits as a draft" : "a Markdown draft"} in this browser. Then remove the published version${state.api ? " from your server and request removal from the fediverse" : " from the demo"}.</p><p>Publishing it again creates a new post and link. Existing likes and replies do not transfer.</p>${action("confirm-unpublish-publication", "Move to drafts", id, "button primary")} ${action("close-modal", "Keep published", "", "button subtle")}`,
    );
  }
  export async function unpublishPublication(id: string): Promise<void> {
    const api = state.api,
      post = await ownedPublication(id);
    if (state.api !== api) return;
    const editing = state.draft?.editingId === id ? state.draft : null;
    const draftId = editing?.id || `unpublished:${id}`;
    const draft = editing || getDrafts().find((d) => d.id === draftId) ||
      (await publicationDraft(post, api));
    if (state.api !== api) return;
    if (!editing) {
      draft.id = draftId;
      delete draft.editingId;
    }
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
    toast("Unpublished. Your draft is saved.");
    if (editing && state.draft === editing) render();
    else navigate(`write/${encodeURIComponent(draft.id)}`);
  }
  export async function confirmDeletePublication(id: string): Promise<void> {
    const post = await ownedPublication(id),
      kind = post.replyTo ? "comment" : "publication";
    showModal(
      `Delete this ${kind}?`,
      `<p><strong>${escapeHTML(post.title || plainText(post.markdown).slice(0, 100))}</strong></p><p>${state.api ? `This will delete the ${kind} from your server and request its removal from the fediverse. This cannot be undone.` : `This removes the ${kind} from your offline demo.`}</p>${action("confirm-delete-publication", `Delete ${kind}`, id, "button danger")} ${action("close-modal", `Keep ${kind}`, "", "button subtle")}`,
    );
  }
  export async function deletePublication(id: string): Promise<void> {
    const api = state.api,
      post = await ownedPublication(id);
    if (state.api !== api) return;
    if (state.draft?.editingId === id && !flushDraft())
      throw new Error("Could not save your draft. The publication was not deleted.");
    if (api) await api.deleteStatus(id);
    if (state.api !== api) return;
    const wasEditing = state.view === "editor" && state.draft?.editingId === id;
    const wasReading = removePublicationFromState(post);
    closeModal();
    toast(post.replyTo ? "Comment deleted." : "Publication deleted.");
    if (wasEditing || (state.view === "reader" && wasReading)) {
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
    if (state.draft?.editingId === id) delete state.draft.editingId;
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
      [draftMarkdown(draft), ...(draft.media || []).filter((m) => m.type === "image" && m.url && !inlineMedia(draft.body, m)).map(mediaMarkdown)].filter(Boolean).join("\n\n"),
    );
  }
  export function editorKeydown(event: KeyboardEvent): void {
    if ((document.getElementById("modal") as HTMLDialogElement).open) return;
    const textarea = document.activeElement as HTMLTextAreaElement | null;
    if (!publishing && !event.isComposing && state.view === "editor" && state.draft?.kind === "article" && textarea?.id === "draft-body" &&
        !event.metaKey && !event.ctrlKey && !event.altKey) {
      const start = textarea.selectionStart, end = textarea.selectionEnd;
      const lineStart = textarea.value.slice(0, start).lastIndexOf("\n") + 1;
      if (event.key === "Tab") {
        event.preventDefault();
        if (start === end && !event.shiftKey) insertEditorText("  ");
        else {
          const last = end > start && textarea.value[end - 1] === "\n" ? end - 1 : end;
          const next = textarea.value.indexOf("\n", last), stop = next < 0 ? textarea.value.length : next;
          const lines = textarea.value.slice(lineStart, stop).split("\n");
          const text = lines.map((line) => event.shiftKey ? line.replace(/^( {1,2}|\t)/, "") : "  " + line).join("\n");
          insertEditorText(text, lineStart, stop);
          textarea.setSelectionRange(lineStart, lineStart + text.length);
        }
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && start === end) {
        const before = textarea.value.slice(0, start);
        if ((before.match(/^```/gm)?.length || 0) % 2 === 0) {
          const item = /^(\s*)([-*+]|\d+\.|>) (\[[ xX]\] )?(.*)$/.exec(textarea.value.slice(lineStart, start));
          if (item) {
            event.preventDefault();
            if (!item[4].trim()) insertEditorText("", lineStart, start);
            else insertEditorText(`\n${item[1]}${/^\d/.test(item[2]) ? `${parseInt(item[2], 10) + 1}.` : item[2]} ${item[3] ? "[ ] " : ""}`);
            return;
          }
        }
      }
    }
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
      saveCurrentDraft();
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
