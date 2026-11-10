namespace Fedi {
  export function readStore<T>(key: string, fallback: T, session = false): T {
    try {
      return (
        JSON.parse(
          (session ? sessionStorage : localStorage).getItem(
            `fedistack:${key}`,
          ) || "null",
        ) ?? fallback
      );
    } catch {
      return fallback;
    }
  }

  export function writeStore(
    key: string,
    value: unknown,
    session = false,
  ): boolean {
    try {
      const storage = session ? sessionStorage : localStorage;
      if (value === null) storage.removeItem(`fedistack:${key}`);
      else storage.setItem(`fedistack:${key}`, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  export function loadSession(): Session | null {
    for (const temporary of [true, false]) {
      const session = readStore<Session | null>("session", null, temporary);
      if (!session || typeof session.server !== "string" || !session.server.trim()) continue;
      try {
        return { ...session, server: loginServer(session.server) };
      } catch {
        // A deployment can restrict sign-in after an account was saved.
      }
    }
    return null;
  }

  export function clearSession(): void {
    cancelReadingRequests();
    const feedCleared = clearFeedCache();
    const localCleared = writeStore("session", null);
    const tabCleared = writeStore("session", null, true);
    const oauthCleared = writeStore("oauth", null, true);
    if (!localCleared || !tabCleared || !oauthCleared || !feedCleared)
      throw new Error(
        "Could not clear saved sign-in data. Clear this site's browser data to finish logging out.",
      );
  }

  export function saveSession(session: Session): boolean {
    loginServer(session.server);
    clearSession();
    return writeStore("session", session, session.remember !== true);
  }

  export interface FeedCache {
    key: string;
    posts: Post[];
    next?: string;
    relationships: Relationship[];
    updated: number;
  }
  let feedCacheRevision = 0;
  export function feedCacheGeneration(): number { return feedCacheRevision; }
  export function clearFeedCache(): boolean {
    feedCacheRevision++;
    return writeStore("feed-cache", null, true);
  }
  export function feedCacheKey(timeline: Timeline): string | undefined {
    const session = state.session;
    // Older mapped posts used link-preview images as publication covers.
    return session && state.api?.server === session.server
      ? JSON.stringify([3, session.server, session.account.id, timeline]) : undefined;
  }
  function cachedFeeds(): FeedCache[] {
    const value = readStore<unknown>("feed-cache", [], true);
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is FeedCache => {
      if (!entry || typeof entry.key !== "string" || !Number.isFinite(entry.updated) ||
          entry.updated > Date.now() || Date.now() - entry.updated > 86400000 ||
          (entry.next !== undefined && typeof entry.next !== "string") ||
          !Array.isArray(entry.posts) || entry.posts.length > 200 || !Array.isArray(entry.relationships)) return false;
      return entry.posts.every((post: Post) => post && post.visibility !== "direct" &&
        [post.id, post.title, post.subtitle, post.markdown, post.created, post.warning,
          post.author?.id, post.author?.name, post.author?.acct, post.author?.avatar, post.author?.bio]
          .every((field) => typeof field === "string") &&
        (post.kind === "article" || post.kind === "post") && Array.isArray(post.tags) &&
        post.tags.every((tag) => typeof tag === "string")) &&
        entry.relationships.every((r: Relationship) => r && typeof r.id === "string" && typeof r.following === "boolean");
    }).slice(0, 6);
  }
  export function readFeedCache(key: string): FeedCache | undefined {
    return cachedFeeds().find((entry) => entry.key === key);
  }
  export function writeFeedCache(entry: FeedCache): void {
    // Keep complete page boundaries: truncating posts while retaining a later
    // cursor would silently skip posts when the cached feed is resumed.
    if (entry.posts.length > 200) return;
    const entries = [entry, ...cachedFeeds().filter((old) => old.key !== entry.key)].slice(0, 6);
    while (entries.length && JSON.stringify(entries).length > 2000000) entries.pop();
    if (entries.length) writeStore("feed-cache", entries, true);
  }

  export function uid(): string {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
  }

  export function draftKey(): string {
    return state.session
      ? `drafts:${state.session.server}:${state.session.account.id}`
      : "drafts:demo";
  }
  export function getDrafts(): Draft[] {
    const drafts = readStore<unknown>(draftKey(), []);
    return Array.isArray(drafts)
      ? drafts.filter(
          (d) =>
            d &&
            typeof d.id === "string" &&
            typeof d.body === "string" &&
            typeof d.title === "string",
        )
      : [];
  }
  export function saveDraft(draft: Draft, sync = true): boolean {
    const drafts = getDrafts().filter((d) => d.id !== draft.id);
    drafts.unshift(draft);
    const saved = writeStore(draftKey(), drafts);
    if (saved && sync) queueDraftSync(draft);
    return saved;
  }
  export function removeDraft(id: string): boolean {
    return writeStore(
      draftKey(),
      getDrafts().filter((d) => d.id !== id),
    );
  }
}
