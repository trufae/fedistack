namespace Fedi {
  const draftMarker = "\n\n<!-- fedistack-draft-v1:";
  const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const syncQueues = new Map<string, Promise<unknown>>();
  const syncErrors = new Map<string, string>();

  export function validateScheduleTime(value: string): void {
    if (!value || !Number.isFinite(Date.parse(value)) || Date.parse(value) < Date.now() + 300000)
      throw new Error("Choose a publication time at least five minutes from now.");
  }

  // Spread drafts over different days to avoid Mastodon's per-day scheduling limit.
  // This is deliberately a finite date, not a promise of a server-side 'never' mode.
  export function serverDraftTime(id: string): string {
    let hash = 0;
    for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    const date = new Date("9999-01-01T12:00:00.000Z");
    date.setUTCDate(1 + hash % 365);
    return date.toISOString();
  }

  export function draftContent(d: Draft): string {
    return JSON.stringify([d.kind, d.title, d.subtitle, d.body, d.warning, d.visibility, d.editingId || ""]);
  }

  export function encodeServerDraft(d: Draft): string {
    const metadata = { id: d.id, kind: d.kind, title: d.title, subtitle: d.subtitle,
      updated: d.updated, editingId: d.editingId };
    return draftMarkdown(d) + draftMarker + encodeURIComponent(JSON.stringify(metadata)) + " -->";
  }

  function scheduledContent(s: ScheduledStatus): string {
    return JSON.stringify([s.params.text, s.params.spoiler_text || "", s.params.visibility || "public", s.scheduled_at]);
  }

  export function decodeServerDraft(s: ScheduledStatus): Draft | null {
    if (!s.scheduled_at?.startsWith("9999-") || s.params.poll ||
        s.params.in_reply_to_id || s.media_attachments?.length) return null;
    const text = s.params.text;
    const index = typeof text === "string" ? text.lastIndexOf(draftMarker) : -1;
    if (index < 0 || !text.endsWith(" -->")) return null;
    try {
      const meta = JSON.parse(decodeURIComponent(text.slice(index + draftMarker.length, -4)));
      if (!meta || typeof meta.id !== "string" || !meta.id ||
          !["article", "post"].includes(meta.kind) || typeof meta.title !== "string" ||
          typeof meta.subtitle !== "string" || !Number.isFinite(Date.parse(meta.updated)) ||
          (meta.editingId !== undefined && typeof meta.editingId !== "string") ||
          !["public", "unlisted", "private"].includes(s.params.visibility || "public")) return null;
      const prefix = meta.kind === "article"
        ? [meta.title ? `# ${meta.title}` : "", meta.subtitle].filter(Boolean).join("\n\n") : "";
      const source = text.slice(0, index);
      // Preserve edits made by another scheduled-post client, including changed headings.
      const unchangedHeading = !prefix || source === prefix || source.startsWith(prefix + "\n\n");
      const heading = /^#\s+([^\n]+)\n*/.exec(source);
      const d: Draft = {
        id: meta.id, kind: meta.kind,
        title: unchangedHeading ? meta.title : heading?.[1] || "",
        subtitle: unchangedHeading ? meta.subtitle : "",
        body: unchangedHeading ? source.slice(prefix ? prefix.length + (source === prefix ? 0 : 2) : 0)
          : heading ? source.slice(heading[0].length) : source,
        updated: meta.updated, editingId: meta.editingId,
        visibility: (s.params.visibility || "public") as Draft["visibility"],
        warning: s.params.spoiler_text || "", serverId: s.id, serverDraftId: meta.id, serverContent: scheduledContent(s),
      };
      d.serverDraftContent = draftContent(d);
      return d;
    } catch {
      return null;
    }
  }

  function accountDrafts(key: string): Draft[] {
    const value = readStore<Draft[]>(key, []);
    return Array.isArray(value) ? value : [];
  }

  function storeDrafts(key: string, drafts: Draft[]): void {
    if (!writeStore(key, drafts)) throw new Error("Could not save draft sync information on this device. Export a copy.");
  }

  function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
    const job = (syncQueues.get(key) || Promise.resolve()).catch(() => {}).then(work);
    syncQueues.set(key, job);
    const clear = () => { if (syncQueues.get(key) === job) syncQueues.delete(key); };
    void job.then(clear, clear);
    return job;
  }

  function updateReference(key: string, id: string, fields: Partial<Draft>): boolean {
    const drafts = accountDrafts(key), d = drafts.find((d) => d.id === id);
    if (!d) return false;
    Object.assign(d, fields);
    storeDrafts(key, drafts);
    if (draftKey() === key && state.draft?.id === id) Object.assign(state.draft, fields);
    return true;
  }

  function clearReference(d: Draft): void {
    delete d.serverId;
    delete d.serverDraftId;
    delete d.serverContent;
    delete d.serverDraftContent;
    delete d.serverPreviousIds;
    delete d.serverSaveKey;
    delete d.serverSaveText;
  }

  export function serverDraftLabel(d: Draft): string {
    if (!state.session) return "";
    const error = syncErrors.get(`${draftKey()}:${d.id}`);
    if (error) return `Server save failed · ${error}`;
    return d.serverId && d.serverDraftContent === draftContent(d)
      ? "Saved on server" : "Server save pending";
  }

  function showSyncState(key: string, id: string): void {
    if (draftKey() !== key || typeof document === "undefined") return;
    if (state.draft?.id === id) {
      const element = document.getElementById("server-save-status");
      if (element) element.textContent = serverDraftLabel(state.draft);
    } else if (state.view === "drafts") render();
  }

  export function queueDraftSync(d: Draft): void {
    const api = state.api, session = state.session, key = draftKey();
    if (!api || !session) return;
    const timerKey = `${key}:${d.id}`;
    if (syncTimers.has(timerKey)) return;
    syncTimers.set(timerKey, setTimeout(() => {
      syncTimers.delete(timerKey);
      void syncServerDraft(d.id, api, session, key).catch(() => {});
    }, 30000));
  }

  export async function syncServerDraft(
    id: string, api = state.api, session = state.session, key = draftKey(),
  ): Promise<void> {
    if (!api || !session) return;
    clearTimeout(syncTimers.get(`${key}:${id}`));
    syncTimers.delete(`${key}:${id}`);
    try {
      await serialized(key, () => saveOnServer(id, api, session, key));
      syncErrors.delete(`${key}:${id}`);
    } catch (error) {
      syncErrors.set(`${key}:${id}`, (error as Error).message);
      throw error;
    } finally {
      showSyncState(key, id);
    }
  }

  async function saveOnServer(id: string, api: API, session: Session, key: string): Promise<void> {
    const d = accountDrafts(key).find((d) => d.id === id);
    if (!d) return;
    for (const old of d.serverPreviousIds || []) await removeServerDraftCopy(api, old);
    if (d.serverPreviousIds?.length) updateReference(key, id, { serverPreviousIds: [] });
    if (!d.title.trim() && !d.subtitle.trim() && !d.body.trim()) {
      if (d.serverId) await removeServerDraftCopy(api, d.serverId);
      storeDrafts(key, accountDrafts(key).filter((x) => x.id !== id));
      if (draftKey() === key && state.draft?.id === id) clearReference(state.draft);
      return;
    }
    let existing: ScheduledStatus | undefined;
    if (d.serverId) {
      existing = await api.scheduledStatus(d.serverId);
    } else {
      // Recover successful writes whose response was lost, before creating anything.
      existing = (await api.scheduledStatuses()).find((s) => decodeServerDraft(s)?.id === id);
    }
    if (existing) {
      const remote = decodeServerDraft(existing);
      if (!remote || remote.id !== (d.serverDraftId || id))
        throw new Error("This draft was changed or scheduled elsewhere. Refresh Your writing before saving again.");
      if (draftContent(d) === draftContent(remote)) {
        updateReference(key, id, { serverId: existing.id, serverDraftId: remote.id, serverContent: scheduledContent(existing), serverDraftContent: draftContent(d) });
        return;
      }
      if (d.serverContent !== scheduledContent(existing))
        throw new Error("Another client changed this draft. Refresh Your writing to keep both versions.");
    }
    const text = encodeServerDraft(d);
    if (Array.from(text + d.warning).length > session.maxChars)
      throw new Error("Draft and sync metadata exceed this server's character limit. A local copy is saved.");
    const saveKey = d.serverSaveText === text && d.serverSaveKey ? d.serverSaveKey : uid();
    updateReference(key, id, { serverSaveKey: saveKey, serverSaveText: text });
    const saved = await api.createScheduledStatus(text, d.visibility, d.warning, "text/plain", serverDraftTime(id), saveKey);
    const fields = { serverId: saved.id, serverDraftId: id, serverContent: scheduledContent(saved), serverDraftContent: draftContent(d),
      serverPreviousIds: existing && existing.id !== saved.id ? [existing.id] : [] };
    if (!updateReference(key, id, fields)) {
      await api.deleteScheduledStatus(saved.id);
      return;
    }
    // Create first: a failed replacement must leave the previous server copy recoverable.
    if (existing && existing.id !== saved.id) {
      await removeServerDraftCopy(api, existing.id);
      updateReference(key, id, { serverPreviousIds: [] });
    }
  }

  async function removeServerDraftCopy(api: API, id: string): Promise<void> {
    try {
      const copy = await api.scheduledStatus(id);
      if (!decodeServerDraft(copy))
        throw new Error("A draft copy was scheduled or changed elsewhere. Check Scheduled before removing it.");
      await api.deleteScheduledStatus(id);
    } catch (error) {
      if (!(error instanceof APIError) || error.status !== 404) throw error;
    }
  }

  export async function loadServerDrafts(): Promise<void> {
    const api = state.api, key = draftKey();
    if (!api || !state.session) return;
    try {
      await serialized(key, async () => {
        const scheduled = await api.scheduledStatuses();
        const local = accountDrafts(key);
        const activeId = state.api === api && state.view === "editor" ? state.draft?.id : undefined;
        const remoteIds = new Set(scheduled.map((s) => s.id));
        const ignored = new Set(local.flatMap((d) => d.serverPreviousIds || []));
        const incoming = scheduled.filter((s) => !ignored.has(s.id)).map(decodeServerDraft).filter((d): d is Draft => !!d);
        for (const remote of incoming) {
          let current = local.find((d) => d.serverId === remote.serverId);
          if (current) remote.id = current.id;
          else {
            current = local.find((d) => d.id === remote.id);
            if (current?.serverId && remoteIds.has(current.serverId) && current.serverId !== remote.serverId) {
              // Two clients may replace the same revision concurrently. Keep both
              // server copies addressable instead of silently selecting one.
              remote.id = `server-copy:${remote.serverId}`;
              current = local.find((d) => d.id === remote.id);
            }
          }
          // A background refresh must not replace text currently being edited.
          // Its next save checks the remote revision before writing.
          if (activeId && current?.id === activeId) continue;
          if (!current) local.unshift(remote);
          else if (draftContent(current) === draftContent(remote) || draftContent(current) === current.serverDraftContent) {
            Object.assign(current, remote);
          } else if (current.serverContent !== remote.serverContent) {
            // Preserve divergent offline edits as a separate draft instead of choosing a winner.
            current.id = uid();
            clearReference(current);
            local.unshift(remote);
          }
        }
        const kept = local.filter((d) => {
          if (d.id === activeId) return true;
          if (!d.serverId || remoteIds.has(d.serverId)) return true;
          if (draftContent(d) === d.serverDraftContent) return false;
          d.id = uid();
          clearReference(d);
          return true;
        });
        storeDrafts(key, kept);
        if (state.api === api) {
          state.scheduledPosts = scheduled.filter((s) => !decodeServerDraft(s) && !ignored.has(s.id));
          state.serverDraftError = "";
          for (const d of kept) {
            syncErrors.delete(`${key}:${d.id}`);
            if (!d.serverId || d.serverDraftContent !== draftContent(d) || d.serverPreviousIds?.length) queueDraftSync(d);
          }
        }
      });
    } catch (error) {
      if (state.api === api) state.serverDraftError = `Could not load server drafts: ${(error as Error).message}`;
    }
  }

  export async function deleteSyncedDraft(id: string, keepLocal = false): Promise<void> {
    const api = state.api, key = draftKey();
    clearTimeout(syncTimers.get(`${key}:${id}`));
    syncTimers.delete(`${key}:${id}`);
    await serialized(key, async () => {
      const d = accountDrafts(key).find((d) => d.id === id);
      if (!d) return;
      if (api && (d.serverId || d.serverSaveKey)) {
        // Include recovered writes and old replacements, so deleting cannot resurrect a draft.
        const copies = (await api.scheduledStatuses()).filter((s) => {
          const remote = decodeServerDraft(s);
          return remote && (s.id === d.serverId || d.serverPreviousIds?.includes(s.id) ||
            (!d.serverId && remote.id === id) || (remote.id === id && s.params.text === d.serverSaveText));
        });
        for (const copy of copies) await api.deleteScheduledStatus(copy.id);
        if (keepLocal && d.serverId && !copies.some((s) => s.id === d.serverId))
          throw new Error("This draft was removed or scheduled in another client. Refresh Your writing first.");
      }
      if (keepLocal) {
        clearReference(d);
        const drafts = accountDrafts(key).map((x) => x.id === id ? d : x);
        storeDrafts(key, drafts);
        if (draftKey() === key && state.draft?.id === id) clearReference(state.draft);
      } else storeDrafts(key, accountDrafts(key).filter((d) => d.id !== id));
    });
  }

  export function scheduledPostsView(): string {
    return state.scheduledPosts.map((s) => `<article class="draft-card"><div><span class="eyebrow">${s.scheduled_at ? `Scheduled · ${escapeHTML(new Date(s.scheduled_at).toLocaleString())}` : "No publication date"}</span><h2>${escapeHTML(plainText(s.params.text).slice(0, 100) || "Scheduled publication")}</h2><p>${escapeHTML(s.params.spoiler_text || "")}</p></div><div class="draft-actions">${action("reschedule", "Change time", s.id, "button subtle")}${action("cancel-schedule", "Cancel publication", s.id, "text-button muted")}</div></article>`).join("") || emptyState("Writing for later", "Choose Schedule in the editor to have your server publish automatically, even when this browser is closed.");
  }

  export async function scheduleDialog(id = ""): Promise<void> {
    if (!state.api || !state.session) throw new Error("Connect an account to schedule a publication.");
    if (!id) {
      captureDraft();
      if (!flushDraft()) throw new Error("Save or export your draft before scheduling.");
      if (!state.draft || state.draft.editingId) throw new Error("Only new publications can be scheduled.");
      const d = state.draft, api = state.api, session = state.session;
      await refreshSessionCapabilities();
      if (state.draft !== d || state.api !== api || state.session !== session) return;
      const problem = publishProblem(state.draft, state.session);
      if (problem) throw new Error(problem);
    }
    const scheduled = state.scheduledPosts.find((s) => s.id === id);
    const date = new Date(scheduled?.scheduled_at || Date.now() + 3600000);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    showModal(id ? "Change publication time" : "Schedule publication", `<form id="schedule-form" data-id="${escapeHTML(id)}"><label>Publication time (${escapeHTML(Intl.DateTimeFormat().resolvedOptions().timeZone)})<input type="datetime-local" name="time" required value="${local}"></label><p>Your server will publish automatically at this time, even when Fedistack is closed. Choose at least five minutes from now.</p><button class="button primary" type="submit">${id ? "Change time" : "Schedule publication"}</button></form>`);
  }

  export async function submitSchedule(time: string, id = ""): Promise<void> {
    const currentAPI = state.api;
    const date = new Date(time);
    if (!Number.isFinite(date.getTime())) throw new Error("Choose a valid publication time.");
    const iso = date.toISOString();
    validateScheduleTime(iso);
    if (date.getUTCFullYear() >= 9999) throw new Error("Choose a publication date before year 9999.");
    if (id) {
      const api = state.api;
      if (!api) return;
      await api.rescheduleStatus(id, iso);
      if (state.api !== api) return;
    } else await scheduleDraft(iso);
    if (state.api !== currentAPI) return;
    closeModal();
    state.libraryTab = "scheduled";
    navigate("drafts");
    await loadServerDrafts();
    if (state.view === "drafts") render();
  }
}
