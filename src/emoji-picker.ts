namespace Fedi {
  type EmojiField = HTMLTextAreaElement | HTMLInputElement;
  let draftField: EmojiField | undefined;
  let picker: {
    fieldId: string; publicationId?: string; value: string; api: API; version: number;
    start: number; end: number; emojis?: EmojiImages;
  } | undefined;

  export function rememberEmojiField(event: FocusEvent): void {
    const field = event.target as EmojiField;
    if (["draft-title", "draft-subtitle", "draft-body"].includes(field?.id)) draftField = field;
  }

  export function emojiPickerButton(id: string): string {
    return state.api
      ? `<button type="button" class="icon-button" data-action="pick-emoji" data-id="${id}" aria-label="Custom emoji" title="Custom emoji" aria-haspopup="dialog">${icon("smile")}</button>`
      : "";
  }

  export async function openEmojiPicker(id: string): Promise<void> {
    const api = state.api;
    const field = id === "draft-body" && draftField?.isConnected ? draftField
      : document.getElementById(id) as EmojiField | null;
    if (!api || !field || editorPublishing()) return;
    const start = field.selectionStart ?? 0, end = field.selectionEnd ?? start;
    const host = new URL(api.server).host;
    showModal("Custom emoji", `<label>Search ${escapeHTML(host)} emoji<input id="emoji-search" type="search" autocomplete="off"></label><div id="emoji-results"><p role="status">Loading emoji…</p></div>`);
    const pending: NonNullable<typeof picker> = picker = {
      fieldId: field.id, publicationId: field.id === "reply-body" ? state.reading?.id : state.draft?.id,
      value: field.value, api, version: modalVersion, start, end,
    };
    const search = document.getElementById("emoji-search") as HTMLInputElement;
    const results = document.getElementById("emoji-results")!;
    let emojis: EmojiImages;
    try {
      emojis = await api.customEmojis();
    } catch {
      if (picker === pending && pickerCurrent()) results.innerHTML = '<p role="status">Could not load custom emoji from your instance.</p>';
      return;
    }
    if (picker !== pending || !pickerCurrent()) return;
    pending.emojis = emojis;
    const tokens = Object.keys(emojis).sort((a, b) => a.localeCompare(b));
    const update = () => {
      const query = search.value.trim().replace(/^:|:$/g, "").toLowerCase();
      const matches = tokens.filter((token) => token.toLowerCase().includes(query));
      const limit = 120;
      results.innerHTML = matches.length
        ? `<div class="emoji-grid">${matches.slice(0, limit).map((token) => `<button type="button" data-action="insert-emoji" data-id="${escapeHTML(token)}" aria-label="Insert ${escapeHTML(token)}">${emojiText(token, emojis)}</button>`).join("")}</div>${matches.length > limit ? '<p class="muted">Search to see more emoji.</p>' : ""}`
        : `<p role="status">${tokens.length ? "No matching emoji." : "Your instance has no custom emoji available to pick."}</p>`;
    };
    search.addEventListener("input", update);
    update();
  }

  function pickerCurrent(): boolean {
    return !!picker && picker.api === state.api && picker.version === modalVersion &&
      !!(document.getElementById("modal") as HTMLDialogElement | null)?.open;
  }

  export function insertPickedEmoji(token: string): void {
    if (!picker || !pickerCurrent() || !picker.emojis?.[token] || editorPublishing()) return;
    const { fieldId, publicationId, value, start, end } = picker;
    const reply = fieldId === "reply-body";
    const field = document.getElementById(fieldId) as EmojiField | null;
    const currentId = reply ? state.reading?.id : state.draft?.id;
    if (!field || currentId !== publicationId || field.value !== value) {
      closeModal();
      toast("The composer changed. Open the emoji picker again.");
      return;
    }
    const before = /[\p{L}\p{M}\p{N}_:]$/u.test(field.value.slice(0, start)) ? " " : "";
    const after = end === field.value.length || /^[\p{L}\p{M}\p{N}_:]/u.test(field.value.slice(end)) ? " " : "";
    const text = before + token + after;
    if (field.maxLength >= 0 && field.value.length - (end - start) + text.length > field.maxLength)
      throw new Error("This emoji exceeds the field’s character limit.");
    picker = undefined;
    closeModal();
    replaceInputText(field, text, start, end);
    if (reply && state.reading) state.replyDrafts.set(state.reading.id, field.value);
    else captureDraft();
  }
}
