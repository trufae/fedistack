namespace Fedi {
  const mediaJobs = new Set<string>();
  const mediaMessages = new Map<string, string>();
  const imagePattern = /!\[(?:\\.|[^\]\\\n])*\]\(([^\s)]+)\)/g;
  const mediaJobKey = (draft: Draft) => `${draftKey()}:${draft.id}`;
  export function mediaBusy(draft: Draft): boolean { return mediaJobs.size > 0 && mediaJobs.has(mediaJobKey(draft)); }
  export function markdownLabel(text: string): string {
    return text.replace(/\r?\n/g, " ").replace(/[\\\[\]]/g, "\\$&");
  }
  export function markdownURL(url: string): string {
    return url.replace(/\(/g, "%28").replace(/\)/g, "%29");
  }
  export function mediaMarkdown(media: MediaAttachment): string {
    return `![${markdownLabel(media.description)}](${markdownURL(media.url)})`;
  }
  export function inlineMedia(body: string, media: MediaAttachment): boolean {
    return Array.from(body.matchAll(imagePattern)).some((m) => m[1] === markdownURL(media.url));
  }
  export function attachmentGallery(media: MediaAttachment[] = [], body = ""): string {
    const attachments = media.filter((m) => m.url && !inlineMedia(body, m));
    if (!attachments.length) return "";
    return `<div class="attachment-gallery">${attachments.map((m) => {
      const url = safeURL(m.url, true);
      if (!url) return "";
      return `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${m.type === "image"
        ? `<img src="${escapeHTML(url)}" alt="${escapeHTML(m.description)}" loading="lazy" referrerpolicy="no-referrer">`
        : escapeHTML(m.description || `Open ${m.type} attachment`)}</a>`;
    }).join("")}</div>`;
  }
  export function draftMediaView(d: Draft): string {
    const busy = mediaBusy(d), media = d.media || [], session = state.session;
    return `<section id="draft-media" class="draft-media" aria-label="Attached images">
      <div class="media-heading"><strong>Images${media.length ? ` · ${media.length} / ${session?.maxMedia ?? 4}` : ""}</strong>
      <button type="button" class="text-button" data-action="upload-media" ${busy || media.length >= (session?.maxMedia ?? 4) ? "disabled" : ""}>${icon("image")} Add images</button>
      ${d.kind === "article" ? '<button type="button" class="text-button" data-action="format" data-id="image">From URL</button>' : ""}</div>
      <p class="media-hint">${session ? `Choose, paste, or drop images here.${d.kind === "article" ? " Images are inserted at your cursor." : ""}` : "Sign in to upload images to your server."}</p>
      <p class="media-status" role="status" aria-live="polite">${escapeHTML(mediaMessages.size ? mediaMessages.get(mediaJobKey(d)) || "" : "")}</p>
      <div class="media-list">${media.map((m, index) => `<div class="media-item">
        ${m.previewUrl || m.url ? `<img src="${escapeHTML(safeURL(m.previewUrl || m.url, true))}" alt="${escapeHTML(m.description)}">` : '<span class="muted">Processing…</span>'}
        <div><label for="media-alt-${index}">Image description (alt text)<textarea id="media-alt-${index}" data-media-alt="${escapeHTML(m.id)}" rows="2" maxlength="${session?.mediaDescriptionLimit || 1500}" placeholder="Describe what matters in this image">${escapeHTML(m.description)}</textarea></label>
        <div class="media-actions">${!m.url ? action("retry-media", "Check image", m.id, "text-button") : d.kind === "article" && m.type === "image" ? action("insert-media", inlineMedia(d.body, m) ? "Insert again" : "Insert into article", m.id, "text-button") : ""}${action("remove-media", "Remove", m.id, "text-button muted")}</div></div></div>`).join("")}</div></section>`;
  }
  function refreshMedia(): void {
    const d = state.draft, region = document.getElementById("draft-media");
    if (d && region) region.outerHTML = draftMediaView(d);
    updateEditorMeta();
  }
  export function imageUploadProblem(file: File, cap: Capabilities, count: number): string {
    const types = cap.imageTypes || ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"];
    if (!file.type.startsWith("image/") || !types.includes(file.type))
      return `${file.name}: this image format is not supported by your server.`;
    if (!file.size) return `${file.name}: this file is empty.`;
    if (file.size > (cap.imageSizeLimit || 16 * 1024 * 1024))
      return `${file.name}: images must be under ${Math.round((cap.imageSizeLimit || 16 * 1024 * 1024) / 1024 / 1024)} MB.`;
    if (count >= (cap.maxMedia ?? 4)) return `Your server allows ${cap.maxMedia ?? 4} attachments per publication.`;
    return "";
  }
  export function chooseDraftImages(): void {
    if (!state.session) { toast("Sign in to upload images to your server."); return; }
    const draft = state.draft, api = state.api, selection = takeEditorSelection();
    const input = document.createElement("input");
    input.type = "file";
    input.accept = (state.session.imageTypes || ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]).join(",");
    input.multiple = true;
    input.addEventListener("change", () => {
      if (state.draft === draft && state.api === api)
        void uploadDraftImages(Array.from(input.files || []), selection).catch((error) => toast(error.message));
    });
    input.click();
  }
  export async function uploadDraftImages(files: File[], selection = takeEditorSelection()): Promise<void> {
    const d = state.draft, api = state.api, session = state.session, key = draftKey();
    if (!d || !files.length || editorPublishing() || mediaBusy(d)) return;
    if (!api || !session) { toast("Sign in to upload images to your server."); return; }
    captureDraft();
    let insertion = d.kind === "article" && selection
      ? { body: d.body, start: selection.start, end: selection.end } : undefined;
    const job = mediaJobKey(d);
    mediaJobs.add(job);
    if (!flushDraft()) { mediaJobs.delete(job); return; }
    const persist = (media: MediaAttachment) => {
      // Uploads can finish after navigation. Update only the original account's
      // still-existing draft; never resurrect a deleted draft or switch accounts.
      const drafts = readStore<Draft[]>(key, []), stored = drafts.find((x) => x.id === d.id);
      if (!stored) return;
      const active = draftKey() === key && state.draft?.id === d.id ? state.draft : stored;
      if (active === state.draft && state.view === "editor") captureDraft();
      const previous = active.media?.find((m) => m.id === media.id);
      if (previous) Object.assign(previous, { ...media, description: previous.description });
      else (active.media ||= []).push(media);
      if (media.url && insertion) {
        // Rebase the saved selection around typing that happened during upload.
        // If its text was replaced, keep the attachment without overwriting edits.
        const before = insertion.body, after = active.body;
        if (before !== after) {
          let start = 0, oldEnd = before.length, end = after.length;
          while (start < oldEnd && start < end && before[start] === after[start]) start++;
          while (oldEnd > start && end > start && before[oldEnd - 1] === after[end - 1]) { oldEnd--; end--; }
          if (oldEnd <= insertion.start) {
            insertion.start += end - oldEnd;
            insertion.end += end - oldEnd;
          } else if (start < insertion.end) insertion = undefined;
        }
        if (insertion) {
          const text = `\n\n${mediaMarkdown(previous || media)}\n\n`;
          if (active === state.draft && state.view === "editor" && document.getElementById("draft-body"))
            insertEditorText(text, insertion.start, insertion.end);
          else active.body = after.slice(0, insertion.start) + text + after.slice(insertion.end);
          insertion.start += text.length;
          insertion.end = insertion.start;
          insertion.body = active.body;
        }
      }
      active.updated = new Date().toISOString();
      active.publishKey = active.scheduleKey = active.scheduleTime = undefined;
      Object.assign(stored, active);
      if (!writeStore(key, drafts)) throw new Error("Image uploaded, but the draft could not be saved. Free up browser storage and save again.");
      if (active === state.draft) { queueDraftSync(active); refreshMedia(); }
    };
    try {
      await refreshSessionCapabilities();
      if (state.api !== api || state.session !== session) return;
      for (let index = 0; index < files.length; index++) {
        const current = readStore<Draft[]>(key, []).find((x) => x.id === d.id);
        if (!current || state.api !== api) break;
        const problem = imageUploadProblem(files[index], session, current.media?.length || 0);
        if (problem) throw new Error(problem);
        mediaMessages.set(job, `Uploading image ${index + 1} of ${files.length}…`);
        refreshMedia();
        let media = await api.uploadMedia(files[index]);
        persist(media);
        if (!media.url) {
          mediaMessages.set(job, "Processing image…");
          refreshMedia();
          media = await api.readyMedia(media);
          persist(media);
        }
      }
      mediaMessages.set(job, "Images uploaded. Add descriptions so everyone can enjoy them.");
    } catch (error) {
      mediaMessages.set(job, (error as Error).message);
    } finally {
      mediaJobs.delete(job);
      if (draftKey() === key && state.draft?.id === d.id) { refreshMedia(); flushDraft(); }
    }
  }
  export async function retryDraftMedia(id: string): Promise<void> {
    const d = state.draft, api = state.api, media = d?.media?.find((m) => m.id === id);
    if (!d || !api || !media || mediaBusy(d)) return;
    const job = mediaJobKey(d);
    mediaJobs.add(job);
    mediaMessages.set(job, "Checking image…");
    refreshMedia();
    try {
      const ready = await api.readyMedia(media);
      if (state.draft !== d || state.api !== api || !d.media?.includes(media)) return;
      Object.assign(media, { ...ready, description: media.description });
      draftChanged();
      mediaMessages.delete(job);
    } catch (error) { mediaMessages.set(job, (error as Error).message); }
    finally { mediaJobs.delete(job); refreshMedia(); }
  }
  export function updateMediaDescription(id: string, description: string): void {
    const d = state.draft, media = d?.media?.find((m) => m.id === id);
    if (!d || !media || editorPublishing()) return;
    const body = document.getElementById("draft-body") as HTMLTextAreaElement | null;
    media.description = description;
    d.body = (body?.value ?? d.body).replace(imagePattern, (source, url) =>
      url === markdownURL(media.url) ? mediaMarkdown(media) : source);
    if (body && body.value !== d.body) body.value = d.body;
    draftChanged();
  }
  export function removeDraftMedia(id: string): void {
    const d = state.draft, media = d?.media?.find((m) => m.id === id);
    if (!d || !media || editorPublishing() || mediaBusy(d)) return;
    captureDraft();
    d.media = d.media!.filter((m) => m.id !== id);
    d.body = d.body.replace(imagePattern, (source, url) => url === markdownURL(media.url) ? "" : source);
    const body = document.getElementById("draft-body") as HTMLTextAreaElement | null;
    if (body) body.value = d.body;
    draftChanged();
    refreshMedia();
  }
  export function insertDraftMedia(id: string): void {
    const media = state.draft?.media?.find((m) => m.id === id);
    if (!media?.url) return;
    if (state.preview) { state.preview = false; render(); }
    const selection = takeEditorSelection();
    insertEditorText(`\n\n${mediaMarkdown(media)}\n\n`, selection?.start, selection?.end);
  }
  export function editorFileEvent(event: ClipboardEvent | DragEvent): void {
    if (state.view !== "editor" || !(event.target instanceof Element) ||
        !event.target.closest("#draft-body, #draft-media, .editor-paper, .note-composer")) return;
    const transfer = "clipboardData" in event ? event.clipboardData : event.dataTransfer;
    const files = Array.from(transfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    void uploadDraftImages(files).catch((error) => toast(error.message));
  }
}
