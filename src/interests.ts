namespace Fedi {
  export function interestsSettings(): string {
    return `<section><h2>Hashtags & lists</h2><p>Follow hashtags for topics you care about. Create lists to group people you follow into their own timelines.</p>${state.session ? `<div class="interest-buttons">${action("manage-hashtags", "Manage hashtags", "", "button subtle")}${action("manage-lists", "Manage lists", "", "button subtle")}</div><p class="muted">Subscriptions and lists are saved on your server and shared with your other apps.</p>` : `<p class="muted">Sign in to manage hashtag subscriptions and lists on your server.</p>${action("connect", "Sign in", "", "button subtle")}`}</section>`;
  }

  interface InterestManager {
    api: API;
    kind: "tags" | "lists" | "members";
    version: number;
    busy: boolean;
    loaded: boolean;
    error: string;
    tags: FollowedTag[];
    members: Account[];
    results: Account[] | null;
    next?: string;
    list?: UserList;
    title: string;
    tag: string;
    query: string;
    deleting: boolean;
  }
  let manager: InterestManager | null = null;

  function current(m: InterestManager): boolean {
    return manager === m && state.api === m.api && modalVersion === m.version &&
      !!(document.getElementById("modal") as HTMLDialogElement)?.open;
  }

  function memberRow(account: Account, remove: boolean, included = false): string {
    return `<div class="interest-row">${avatar(account, true)}<div class="interest-name"><strong>${escapeHTML(account.name)}</strong><small>@${escapeHTML(account.acct)}</small></div>${included ? '<span class="muted">In list</span>' : `<button type="button" class="button subtle" data-action="${remove ? "remove-list-member" : "add-list-member"}" data-id="${escapeHTML(account.id)}" aria-label="${remove ? "Remove" : "Add"} @${escapeHTML(account.acct)} ${remove ? "from" : "to"} list">${remove ? "Remove" : "Add"}</button>`}</div>`;
  }

  function drawManager(m: InterestManager): void {
    const focus = document.activeElement?.id;
    let body = "";
    if (m.loaded && m.kind === "tags") {
      body = `<p>Follow topics to bring their posts into your Following timeline. These subscriptions are saved on your server.</p>
        <form id="follow-tag-form"><label for="interest-tag">Hashtag<input id="interest-tag" name="tag" value="${escapeHTML(m.tag)}" placeholder="#technology" required autocapitalize="none" spellcheck="false"></label><button type="submit" class="button primary">Follow hashtag</button></form>
        <div class="interest-rows">${m.tags.map((tag) => `<div class="interest-row"><button type="button" class="interest-name interest-link" data-action="read-tag" data-id="${escapeHTML(tag.name)}">#${escapeHTML(tag.name)}</button><button type="button" class="button subtle" data-action="unfollow-tag" data-id="${escapeHTML(tag.name)}" aria-label="Unfollow #${escapeHTML(tag.name)}">Unfollow</button></div>`).join("") || '<p class="muted">No followed hashtags yet.</p>'}</div>`;
    } else if (m.loaded && m.kind === "lists") {
      body = `<p>Lists group people you follow into separate timelines. Use hashtags to subscribe to topics.</p>
        <form id="save-list-form"><label for="interest-title">New list name<input id="interest-title" name="title" value="${escapeHTML(m.title)}" placeholder="People writing about design" required></label><button type="submit" class="button primary">Create list</button></form>
        <div class="interest-rows">${state.lists.map((list) => `<div class="interest-row"><button type="button" class="interest-name interest-link" data-action="read-list" data-id="${escapeHTML(list.id)}">${escapeHTML(list.title)}</button><button type="button" class="button subtle" data-action="manage-list-members" data-id="${escapeHTML(list.id)}" aria-label="Manage ${escapeHTML(list.title)}">Manage</button></div>`).join("") || '<p class="muted">No lists yet. Create one to get started.</p>'}</div>`;
    } else if (m.loaded && m.list) {
      body = `${action("manage-lists", "← All lists", "", "text-button")}
        <form id="save-list-form"><label for="interest-title">List name<input id="interest-title" name="title" value="${escapeHTML(m.title)}" required></label><button type="submit" class="button subtle">Save name</button></form>
        <form id="list-member-search"><label for="interest-query">Find people you follow<input id="interest-query" name="query" value="${escapeHTML(m.query)}" placeholder="Name or @username" required autocapitalize="none" spellcheck="false"></label><button type="submit" class="button subtle">Search</button></form>
        ${m.results ? `<div class="interest-rows"><h3>Search results</h3>${m.results.map((account) => memberRow(account, false, m.members.some((member) => member.id === account.id))).join("") || '<p class="muted">No matching people you follow. Try another name.</p>'}${m.results.length === 20 ? '<p class="muted">Showing 20 matches. Refine your search to find someone else.</p>' : ""}</div>` : ""}
        <div class="interest-rows"><h3>People in this list</h3>${m.members.map((account) => memberRow(account, true)).join("") || '<p class="muted">This list has no members yet.</p>'}</div>`;
    }
    showModal(m.kind === "tags" ? "Hashtag subscriptions" : m.list?.title || "Your lists",
      `<fieldset id="interest-manager" class="interest-manager" ${m.busy ? "disabled" : ""} aria-busy="${m.busy}">${body}
      ${m.next && m.loaded ? action("more-interests", m.kind === "tags" ? "Load more hashtags" : "Load more people", "", "button subtle") : ""}
      ${m.loaded && m.list ? `<div class="interest-delete">${m.deleting ? `<p>Delete “${escapeHTML(m.list.title)}”? This removes the list, but keeps your follows and their posts.</p><div class="interest-buttons">${action("delete-list-confirm", "Delete list", "", "button danger")}${action("delete-list-cancel", "Keep list", "", "button subtle")}</div>` : action("delete-list", "Delete list", "", "text-button delete-link")}</div>` : ""}
      ${m.error ? action("reload-interests", "Reload", "", "button subtle") : ""}
      </fieldset>${m.busy ? '<p role="status">Updating your interests…</p>' : ""}`);
    m.version = modalVersion;
    if (m.error) formError(new Error(m.error));
    if (!m.busy && focus) document.getElementById(focus)?.focus({ preventScroll: true });
  }

  async function runInterestTask(m: InterestManager, task: () => Promise<void>): Promise<void> {
    if (!current(m) || m.busy) return;
    // Keep partially entered text when another control refreshes the dialog.
    for (const key of ["tag", "title", "query"] as const) {
      const input = document.getElementById(`interest-${key}`) as HTMLInputElement | null;
      if (input) m[key] = input.value;
    }
    m.busy = true;
    m.error = "";
    drawManager(m);
    try {
      await task();
    } catch (error) {
      m.error = error instanceof APIError && [404, 405, 501].includes(error.status) && !m.loaded
        ? `Your server does not support ${m.kind === "tags" ? "hashtag subscriptions" : "this list feature"}, or it is no longer available.`
        : error instanceof Error ? error.message : "Could not update your interests. Please try again.";
    } finally {
      m.busy = false;
      if (current(m)) drawManager(m);
    }
  }

  async function loadManager(m: InterestManager, append = false): Promise<void> {
    await runInterestTask(m, async () => {
      const cursor = append ? m.next : undefined;
      if (m.kind === "tags") {
        const result = await m.api.followedTags(cursor);
        if (!current(m)) return;
        m.tags = [...new Map([...(append ? m.tags : []), ...result.tags].map((tag) => [tag.name.toLowerCase(), tag])).values()];
        m.next = result.next === cursor ? undefined : result.next;
      } else if (m.list) {
        const result = await m.api.listMembers(m.list.id, cursor);
        if (!current(m)) return;
        m.members = [...new Map([...(append ? m.members : []), ...result.accounts].map((account) => [account.id, account])).values()];
        m.next = result.next === cursor ? undefined : result.next;
      } else {
        const lists = await m.api.get<UserList[]>("/api/v1/lists");
        if (!current(m)) return;
        state.lists = lists;
        render();
      }
      m.loaded = true;
    });
  }

  export async function showInterests(kind: "tags" | "lists" | "members", listId = ""): Promise<void> {
    if (!state.api) { connectDialog(); return; }
    const list = kind === "members" ? state.lists.find((item) => item.id === listId) : undefined;
    if (kind === "members" && !list) return;
    const m: InterestManager = {
      api: state.api, kind, version: 0, busy: false, loaded: false, error: "",
      tags: [], members: [], results: null, list, title: list?.title || "", tag: "", query: "", deleting: false,
    };
    manager = m;
    drawManager(m);
    await loadManager(m);
  }

  export async function submitInterestForm(formId: string, value: string): Promise<void> {
    const m = manager;
    if (!m || !current(m) || !m.loaded) return;
    await runInterestTask(m, async () => {
      if (formId === "follow-tag-form" && m.kind === "tags") {
        const name = value.trim().replace(/^#/, "");
        if (!name || /[\s#/?]/u.test(name)) throw new Error("Enter one hashtag, such as #technology.");
        if (m.tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
          m.tag = "";
          return;
        }
        const tag = await m.api.followTag(name);
        if (!current(m)) return;
        m.tags = [tag, ...m.tags.filter((item) => item.name.toLowerCase() !== tag.name.toLowerCase())];
        m.tag = "";
      } else if (formId === "save-list-form" && m.kind !== "tags") {
        const title = value.trim();
        if (!title) throw new Error("Give your list a name.");
        const list = await m.api.saveList(title, m.list);
        if (state.api !== m.api) return;
        state.lists = [...state.lists.filter((item) => item.id !== list.id), list];
        if (m.list) m.list = list;
        m.title = m.list ? list.title : "";
        render();
      } else if (formId === "list-member-search" && m.list) {
        if (!value.trim()) throw new Error("Enter a name or username to search.");
        const results = await m.api.searchFollowing(value.trim());
        if (current(m)) m.results = results;
      }
    });
  }

  export async function interestAction(name: string, id: string): Promise<void> {
    const m = manager;
    if (!m || !current(m) || m.busy) return;
    if (name === "reload-interests" || name === "more-interests") {
      if (name === "more-interests" && !m.next) return;
      await loadManager(m, name === "more-interests");
      return;
    }
    if (!m.loaded) return;
    if (name === "read-tag" || name === "read-list") {
      state.query = "";
      state.timeline = name === "read-tag" ? `tag:${id}` : `list:${id}`;
      closeModal();
      navigate("discover");
      return;
    }
    await runInterestTask(m, async () => {
      if (name === "unfollow-tag" && m.kind === "tags") {
        await m.api.followTag(id, true);
        if (current(m)) m.tags = m.tags.filter((tag) => tag.name !== id);
      } else if (m.list && (name === "add-list-member" || name === "remove-list-member")) {
        const remove = name === "remove-list-member";
        const account = (remove ? m.members : m.results || []).find((item) => item.id === id);
        if (!account) return;
        await m.api.setListMember(m.list.id, id, remove);
        if (current(m)) m.members = [...m.members.filter((item) => item.id !== id), ...(remove ? [] : [account])];
      } else if (m.list && (name === "delete-list" || name === "delete-list-cancel")) {
        m.deleting = name === "delete-list";
      } else if (m.list && name === "delete-list-confirm" && m.deleting) {
        await m.api.deleteList(m.list.id);
        if (state.api !== m.api) return;
        state.lists = state.lists.filter((list) => list.id !== m.list!.id);
        if (state.timeline === `list:${m.list.id}`) {
          state.timeline = "home";
          state.posts = [];
          state.next = undefined;
          if (["home", "discover", "bookmarks"].includes(state.view)) void loadFeed();
        }
        m.list = undefined;
        m.kind = "lists";
        m.title = "";
        m.next = undefined;
        m.deleting = false;
        render();
      }
    });
  }
}
