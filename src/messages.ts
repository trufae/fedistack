namespace Fedi {
  let messageVersion = 0;
  const recentUnread = new Set<string>();
  let viewportWidth = 0, unobscuredHeight = 0;
  const messageDrafts = new Map<string, string>();
  export function clearMessageDrafts(): void {
    messageDrafts.clear();
    recentUnread.clear();
    messageVersion++;
  }
  export function hasUnreadMessages(): boolean {
    return recentUnread.size > 0 || state.conversations.some((c) => c.unread);
  }
  export async function refreshMessageBadge(api: API): Promise<void> {
    if (state.view === "messages" && state.loading) return;
    const version = messageVersion;
    const flags = await api.conversationUnread();
    if (version !== messageVersion || state.api !== api) return;
    recentUnread.clear();
    for (const [id, unread] of flags)
      if (unread) recentUnread.add(id);
    for (const conversation of state.conversations) {
      const unread = flags.get(conversation.id);
      if (unread !== undefined) conversation.unread = unread;
    }
    updateNavBadges();
  }
  export function updateConversationViewport(): void {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const thread = document.getElementById("message-thread");
    const atBottom =
      thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight < 2;
    const { innerWidth, innerHeight } = window;
    const composing = document.activeElement?.id === "message-body";
    // Some browsers shrink the layout viewport as well as the visual viewport.
    unobscuredHeight = composing && innerWidth === viewportWidth
      ? Math.max(unobscuredHeight, innerHeight)
      : innerHeight;
    viewportWidth = innerWidth;
    document.body.classList.toggle(
      "conversation-keyboard-open",
      composing && viewport.scale === 1 && unobscuredHeight - viewport.height > 120,
    );
    // iOS resizes/pans the visual viewport when the keyboard opens.
    document.documentElement.style.setProperty(
      "--conversation-height", `${viewport.height}px`,
    );
    document.documentElement.style.setProperty(
      "--conversation-top", `${viewport.offsetTop}px`,
    );
    if (atBottom) scrollMessages();
  }
  export function sameAudience(
    post: Post,
    accounts: Account[],
    me: string,
  ): boolean {
    const expected = new Set([...accounts.map((a) => a.id), me]);
    const actual = new Set(post.audience || []);
    return (
      post.visibility === "direct" &&
      actual.size === expected.size &&
      [...actual].every((id) => expected.has(id))
    );
  }
  function messageText(post: Post, accounts: Account[]): string {
    const handles = new Set<string>(), profiles = new Set<string>();
    for (const account of [...accounts, post.author, state.session?.account || demoMe]) {
      const handle = (account.acct || "").toLowerCase();
      if (!handle) continue;
      handles.add(handle);
      const profile = safeURL(account.url || "");
      if (profile) profiles.add(profile.replace(/\/$/, ""));
      const origin = profile || safeURL(state.session?.server || "");
      if (!handle.includes("@") && origin)
        handles.add(`${handle}@${new URL(origin).hostname}`);
    }
    // Hide routing mentions only in the chat presentation. Protect code, URLs,
    // images, and unrelated links from being rewritten as ordinary mention text.
    const tokens = /```[\s\S]*?(?:```|$)|`[^`\n]*`|(!?)\[((?:\\.|[^\]\\\n])*)\]\(([^\s)]+)\)|https?:\/\/[^\s<>]+|(^|[^\p{L}\p{M}\p{N}_/@\\])@([a-z\d_.-]+(?:@[a-z\d.-]+)?)/giu;
    const hidden: [number, number][] = [];
    for (const match of post.markdown.matchAll(tokens)) {
      const [, image, label, url, prefix, rawHandle] = match;
      if (label !== undefined) {
        if (!image && /^@[a-z\d_.-]+(?:@[a-z\d.-]+)?$/i.test(label) &&
            profiles.has(safeURL(url).replace(/\/$/, "")))
          hidden.push([match.index!, match.index! + match[0].length]);
      } else if (rawHandle) {
        const handle = rawHandle.replace(/\.+$/, "");
        if (handles.has(handle.toLowerCase())) {
          const start = match.index! + prefix.length;
          hidden.push([start, start + handle.length + 1]);
        }
      }
    }
    let text = post.markdown;
    for (const [start, end] of hidden.reverse()) {
      let before = text.slice(0, start), after = text.slice(end);
      if (/^[.,!?;:)]/.test(after)) before = before.replace(/[ \t]+$/, "");
      else if (!before || /\s$/.test(before)) after = after.replace(/^[ \t]+/, "");
      text = before + after;
    }
    return hidden.length ? text.trim() : text;
  }
  export function messagesView(): string {
    const current = state.conversations.find(
      (c) => c.id === state.conversation,
    );
    const feedback = `${state.error ? `<p class="error-panel" role="alert">${escapeHTML(state.error)} ${action("refresh-messages", "Try again", "", "text-button")}</p>` : ""}${state.loading ? '<div class="loading" role="status">Loading conversations…</div>' : ""}`;
    return `${current ? "" : `<header class="page-top"><a href="#profile" class="text-button">${icon("back")} Your profile</a>${action("new-message", `${icon("plus")} New message`, "", "button subtle small-button")}</header><div class="page-intro"><h1>Conversations<span class="accent">.</span></h1><p>A little more personal.</p></div>`}
      <div class="messages-layout ${current ? "has-conversation" : ""}"><div class="conversation-list">${
        state.conversations
          .map((c) => {
            const a = c.accounts[0],
              last = c.messages[c.messages.length - 1];
            return `<a href="#messages/${encodeURIComponent(c.id)}" class="conversation-item ${current?.id === c.id ? "selected" : ""}">${a ? avatar(a, false, `conversation:${c.id}`) : icon("mail")}<div><strong>${escapeHTML(c.accounts.map((a) => a.name).join(", ") || "Conversation")}</strong><p>${escapeHTML(last ? plainText(messageText(last, c.accounts)).slice(0, 65) : "Start a conversation")}</p><small>${last ? relativeDate(last.created) : "New"}</small></div>${c.unread ? '<span class="unread-dot"></span>' : ""}</a>`;
          })
          .join("") ||
        '<p class="muted conversation-empty">Your conversations will appear here.</p>'
      }${state.conversationNext ? action("more-conversations", "Load older conversations", "", "button subtle full-width") : ""}</div>
      <section class="conversation-detail">${current ? `<div class="conversation-header"><a href="#messages" class="icon-button conversation-back" aria-label="All conversations">${icon("back")}</a>${current.accounts[0] ? avatar(current.accounts[0], true) : ""}<div><strong>${escapeHTML(current.accounts.map((a) => a.name).join(", "))}</strong><small>${escapeHTML(current.accounts.map((a) => "@" + a.acct).join(", "))}</small></div></div><div class="message-thread" id="message-thread">${current.messages.map((m) => `<div class="message ${m.author.id === (state.session?.account.id || "you") ? "outgoing" : ""}"><div class="message-bubble prose">${m.warning ? `<details><summary>${escapeHTML(m.warning)}</summary>${markdown(messageText(m, current.accounts))}</details>` : markdown(messageText(m, current.accounts))}</div><small>${escapeHTML(m.author.name)} · ${new Date(m.created).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</small></div>`).join("")}${feedback}</div><div class="message-composer"><form id="message-form" data-id="${escapeHTML(current.id)}"><label class="sr-only" for="message-body">Message</label><textarea id="message-body" name="body" rows="1" required placeholder="Write a message…">${escapeHTML(messageDrafts.get(current.id) || "")}</textarea><button type="submit" class="button primary" aria-label="Send message">${icon("send")}</button></form><p class="dm-note">${icon("lock")} Private mentions, not end-to-end encrypted.</p></div>` : emptyState("A conversation starts with hello", "Choose a conversation or reach out to someone new.", action("new-message", "Write a message", "", "button subtle"))}</section></div>
      ${current ? "" : feedback}`;
  }
  export async function loadConversations(append = false, quiet = false): Promise<void> {
    const version = ++messageVersion,
      api = state.api;
    let selected = state.conversation;
    state.loading = true;
    state.error = "";
    if (!quiet) render();
    try {
      if (!api) state.conversations = demoState.conversations;
      else {
        const result = await api.conversations(
          append ? state.conversationNext : undefined,
        );
        if (
          version !== messageVersion ||
          state.api !== api ||
          state.view !== "messages"
        )
          return;
        const existing = state.conversations;
        const incoming = result.conversations.map((c) => {
          const cached = existing.find(
            (x) =>
              x.id === c.id ||
              (x.id.startsWith("new-") &&
                x.messages.some((m) => c.messages.some((n) => n.id === m.id))),
          );
          if (cached?.id === selected && cached.id !== c.id) {
            selected = c.id;
            state.conversation = c.id;
            history.replaceState(
              null,
              "",
              `#messages/${encodeURIComponent(c.id)}`,
            );
          }
          return cached
            ? { ...c, messages: mergeMessages(cached.messages, c.messages) }
            : c;
        });
        state.conversations = [
          ...new Map(
            [
              ...existing.filter(
                (c) =>
                  append ||
                  (c.id === selected && !incoming.some((i) => i.id === c.id)),
              ),
              ...incoming,
            ].map((c) => [c.id, c]),
          ).values(),
        ];
        state.conversationNext = result.next;
        if (!append) recentUnread.clear();
        else for (const { id } of incoming) recentUnread.delete(id);
      }
      const current = state.conversations.find((c) => c.id === selected);
      if (current) {
        const last = current.messages[current.messages.length - 1];
        if (api && last) {
          const context = await api.context(last.id);
          if (
            version !== messageVersion ||
            state.api !== api ||
            state.view !== "messages" ||
            state.conversation !== selected
          )
            return;
          // Contexts may include non-private replies. Never put those in the DM view.
          current.messages = mergeMessages(
            current.messages,
            context.filter((p) =>
              sameAudience(p, current.accounts, state.session!.account.id),
            ),
          );
        }
        if (api && current.unread && !current.id.startsWith("new-")) {
          await api.post(`/api/v1/conversations/${encodeURIComponent(current.id)}/read`);
          if (version !== messageVersion || state.api !== api) return;
        }
        recentUnread.delete(current.id);
        current.unread = false;
        if (!api) saveDemo();
      }
    } catch (error) {
      if (version === messageVersion && state.view === "messages")
        state.error = (error as Error).message;
    } finally {
      if (
        version === messageVersion &&
        state.view === "messages" &&
        state.api === api
      ) {
        state.loading = false;
        render();
        scrollMessages();
      }
    }
  }
  function mergeMessages(a: Post[], b: Post[]): Post[] {
    return [...new Map([...a, ...b].map((p) => [p.id, p])).values()].sort(
      (x, y) => Date.parse(x.created) - Date.parse(y.created),
    );
  }
  function scrollMessages(): void {
    const thread = document.getElementById("message-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }
  export function rememberMessage(): void {
    const el = document.getElementById(
      "message-body",
    ) as HTMLTextAreaElement | null;
    if (el) messageDrafts.set(state.conversation, el.value);
  }
  export async function sendMessage(id: string, body: string): Promise<void> {
    const current = state.conversations.find((c) => c.id === id);
    if (!current || !body.trim()) return;
    const api = state.api;
    const participants = current.accounts.filter(
      (a) => a.id !== state.session?.account.id,
    );
    if (!participants.length) throw new Error("Choose a recipient first.");
    // Mentions determine DM recipients. Require an explicit new conversation to add people.
    const allowed = new Set(participants.map((a) => a.acct.toLowerCase()));
    const mentions = Array.from(
      body.matchAll(/(?:^|[^a-z0-9_])@([a-z0-9_.-]+(?:@[a-z0-9.-]+)?)/gi),
      (m) => m[1].toLowerCase().replace(/\.+$/, ""),
    );
    if (mentions.some((m) => !allowed.has(m)))
      throw new Error(
        "This message mentions someone outside this conversation. Start a new conversation to add a recipient.",
      );
    const text = `${participants.map((a) => "@" + a.acct).join(" ")} ${body.trim()}`;
    if (state.session && Array.from(text).length > state.session.maxChars)
      throw new Error(
        `Your server allows ${state.session.maxChars.toLocaleString()} characters, including recipient mentions.`,
      );
    const last = current.messages[current.messages.length - 1];
    const sent = api
      ? await api.createStatus(text, "direct", last?.id)
      : {
          id: uid(),
          author: demoMe,
          title: "",
          subtitle: "",
          markdown: body.trim(),
          kind: "post" as const,
          created: new Date().toISOString(),
          likes: 0,
          replies: 0,
          reposts: 0,
          liked: false,
          reposted: false,
          saved: false,
          visibility: "direct" as const,
          warning: "",
          tags: [],
        };
    if (state.api !== api) return;
    current.messages.push(sent);
    recentUnread.delete(current.id);
    current.unread = false;
    messageDrafts.delete(id);
    if (!api) saveDemo();
    if (state.view === "messages") {
      render();
      scrollMessages();
    }
  }
  export function newMessageDialog(): void {
    showModal(
      "Say hello.",
      `<p>Find a writer by their full Fediverse address.</p><form id="recipient-form"><label>Recipient<input name="recipient" required placeholder="@writer@their.instance" autocomplete="off"></label><button class="button primary" type="submit">Find recipient ${icon("arrow")}</button></form>`,
    );
  }
  export async function findRecipient(query: string): Promise<void> {
    const api = state.api;
    const accounts = api
      ? (await api.search(query)).accounts
      : demoAuthors.filter((a) =>
          `${a.name} ${a.acct}`
            .toLowerCase()
            .includes(query.replace(/^@/, "").toLowerCase()),
        );
    if (state.api !== api) return;
    state.accounts = accounts;
    showModal(
      "Choose your recipient",
      accounts.length
        ? accounts
            .map(
              (a) =>
                `<div class="recommended">${avatar(a)}<div><strong>${escapeHTML(a.name)}</strong><p>${escapeHTML(a.acct)}</p></div>${action("message-account", "Message", a.id, "button subtle")}</div>`,
            )
            .join("")
        : "<p>No matching accounts. Try the full address, such as writer@their.instance.</p>",
    );
  }
  export function startConversation(id: string): void {
    const account = allAccounts().find((a) => a.id === id);
    if (!account) return;
    let conversation = state.conversations.find(
      (c) => c.accounts.length === 1 && c.accounts[0].id === id,
    );
    if (!conversation) {
      conversation = {
        id: `new-${uid()}`,
        accounts: [account],
        unread: false,
        messages: [],
      };
      state.conversations.unshift(conversation);
      if (!state.api) saveDemo();
    }
    closeModal();
    navigate(`messages/${encodeURIComponent(conversation.id)}`);
  }
}
