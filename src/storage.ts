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
  export function saveDraft(draft: Draft): boolean {
    const drafts = getDrafts().filter((d) => d.id !== draft.id);
    drafts.unshift(draft);
    return writeStore(draftKey(), drafts);
  }
  export function removeDraft(id: string): boolean {
    return writeStore(
      draftKey(),
      getDrafts().filter((d) => d.id !== id),
    );
  }
}
