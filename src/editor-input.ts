namespace Fedi {
  export let editorSmartPunctuation = readStore("editor-smart-punctuation", false);
  let editorViewportWidth = 0, editorFullHeight = 0;
  let mobileEditorFocus = false, editorKeyboardOpen = false;
  export function mobileEditorLayout(): boolean {
    return typeof window !== "undefined" && (window.innerWidth <= 700 ||
      window.innerWidth <= 1000 && typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches);
  }

  export function updateEditorViewport(): void {
    if (typeof window === "undefined") return;
    const viewport = window.visualViewport;
    const active = document.activeElement as HTMLElement | null;
    const editing = state.view === "editor";
    const mobile = mobileEditorLayout();
    if (mobile && editing && state.focus) {
      state.focus = false;
      document.body.classList.toggle("focus-mode", false);
      document.body.classList.toggle("zen-mode", false);
      document.querySelector('[data-action="focus"]')?.setAttribute("aria-pressed", "false");
      const label = document.querySelector("[data-zen-label]");
      if (label) label.textContent = "Zen mode";
    }
    const sameWidth = editorViewportWidth === window.innerWidth;
    const input = editing && !!active?.matches?.("input, textarea, [contenteditable=true]");
    editorFullHeight = sameWidth && (input || mobileEditorFocus)
      ? Math.max(editorFullHeight, window.innerHeight) : window.innerHeight;
    editorViewportWidth = window.innerWidth;
    const keyboard = mobile && input && !!viewport && viewport.scale === 1 && editorFullHeight - viewport.height > 120;
    // iOS's keyboard Done button can leave the textarea focused.
    if (editorKeyboardOpen && !keyboard && sameWidth && viewport?.scale === 1 && active?.id === "draft-body") active.blur();
    const focused = document.activeElement as HTMLElement | null;
    mobileEditorFocus = mobile && editing && state.draft?.kind === "article" && !state.preview &&
      (focused?.id === "draft-body" || mobileEditorFocus &&
        (!!focused?.closest?.(".editor-tools") || !!(document.getElementById("modal") as HTMLDialogElement | null)?.open));
    editorKeyboardOpen = keyboard;
    document.body.classList.toggle("editor-keyboard-open", keyboard);
    document.body.classList.toggle("mobile-editor-focus", mobileEditorFocus);
    if (viewport) {
      document.documentElement.style.setProperty("--editor-height", `${viewport.height}px`);
      document.documentElement.style.setProperty("--editor-top", `${viewport.offsetTop}px`);
    }
  }

  export function finishMobileEditing(): void {
    captureDraft();
    flushDraft();
    (document.activeElement as HTMLElement | null)?.blur();
    mobileEditorFocus = false;
    document.body.classList.toggle("mobile-editor-focus", false);
    updateEditorViewport();
  }

  export function editorCodeAt(text: string, position: number): boolean {
    const before = text.slice(0, position);
    let fence = "", size = 0, offset = 0, proseStart = 0;
    for (const line of before.split("\n")) {
      offset += line.length + 1;
      const source = line.replace(/^(?: {0,3}> ?)+/, "");
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(source);
      if (!match) continue;
      if (fence) {
        if (match[1][0] === fence && match[1].length >= size && !match[2].trim()) {
          fence = "";
          proseStart = offset;
        }
      } else if (match[1][0] !== "`" || !match[2].includes("`")) {
        fence = match[1][0];
        size = match[1].length;
      }
    }
    if (fence || /^(?: {4}|\t)/.test(before.slice(before.lastIndexOf("\n") + 1))) return true;
    const paragraph = before.slice(proseStart).split(/\n\s*\n/).pop()!;
    let ticks = 0;
    for (const match of paragraph.matchAll(/`+/g)) {
      const escapes = /\\+$/.exec(paragraph.slice(0, match.index))?.[0].length || 0;
      if (escapes % 2 && !ticks) continue;
      if (!ticks) ticks = match[0].length;
      else if (ticks === match[0].length) ticks = 0;
    }
    return ticks > 0;
  }

  export function updateEditorTyping(): void {
    if (state.view !== "editor" || state.draft?.kind !== "article") return;
    const textarea = document.getElementById("draft-body") as HTMLTextAreaElement | null;
    if (!textarea) return;
    const enabled = editorSmartPunctuation && !editorCodeAt(textarea.value, textarea.selectionStart);
    // WebKit's iOS input traits tie smart quotes and dashes to spellcheck as well.
    const attributes = { spellcheck: String(enabled), autocorrect: enabled ? "on" : "off",
      autocapitalize: enabled ? "sentences" : "off", writingsuggestions: String(enabled) };
    for (const [name, value] of Object.entries(attributes))
      if (textarea.getAttribute(name) !== value) textarea.setAttribute(name, value);
  }

  export function setEditorSmartPunctuation(enabled: boolean): void {
    editorSmartPunctuation = enabled;
    if (!writeStore("editor-smart-punctuation", enabled)) toast("Typing preference is only saved for this tab.");
    updateEditorTyping();
  }

  function straightPunctuation(text: string): string {
    return text.replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').replace(/—/g, "--").replace(/–/g, "-");
  }
  let pendingTyping: { target: HTMLTextAreaElement; before: string } | undefined;
  export function editorBeforeInput(event: InputEvent): void {
    pendingTyping = undefined;
    const target = event.target as HTMLTextAreaElement;
    if (editorPublishing() || state.view !== "editor" || state.draft?.kind !== "article" || target.id !== "draft-body" ||
        event.isComposing || !["insertText", "insertReplacementText"].includes(event.inputType) ||
        editorSmartPunctuation && !editorCodeAt(target.value, target.selectionStart)) return;
    pendingTyping = { target, before: target.value };
    if (event.cancelable && event.inputType === "insertText" && event.data && straightPunctuation(event.data) !== event.data) {
      pendingTyping = undefined;
      event.preventDefault();
      insertEditorText(straightPunctuation(event.data));
    }
  }
  export function editorInput(event: InputEvent): void {
    const pending = pendingTyping;
    pendingTyping = undefined;
    const target = event.target as HTMLTextAreaElement;
    if (pending?.target !== target || event.isComposing || !["insertText", "insertReplacementText"].includes(event.inputType)) return;
    // Only normalize this keyboard edit. Never rewrite pasted text or existing quotes.
    const after = target.value, before = pending.before;
    let start = 0, end = after.length, oldEnd = before.length;
    while (start < end && start < oldEnd && after[start] === before[start]) start++;
    while (end > start && oldEnd > start && after[end - 1] === before[oldEnd - 1]) { end--; oldEnd--; }
    const inserted = after.slice(start, end), plain = straightPunctuation(inserted);
    if (inserted === plain) return;
    const map = (position: number) => position <= start ? position : position >= end
      ? position + plain.length - inserted.length : start + straightPunctuation(after.slice(start, position)).length;
    const selectionStart = map(target.selectionStart), selectionEnd = map(target.selectionEnd);
    target.setSelectionRange(start, end);
    if (!document.execCommand?.("insertText", false, plain)) target.setRangeText(plain, start, end, "preserve");
    target.setSelectionRange(selectionStart, selectionEnd);
  }
}
