namespace Fedi {
  type NotificationMarker = Pick<AccountNotification, "id" | "created">;
  let items: AccountNotification[] = [];
  let next: string | undefined;
  let activeView: View | undefined;
  let version = 0;
  let newestSeen: NotificationMarker | undefined;
  let unread = false;
  let poll: { api: API; nextAt: number } | undefined;

  export function resetNotifications(): void {
    version++;
    items = [];
    next = undefined;
    activeView = undefined;
    newestSeen = undefined;
    poll = undefined;
    unread = false;
  }

  export function hasNewNotifications(): boolean {
    return unread;
  }

  function notificationStorageKey(session: Session): string {
    return `notifications-seen:${session.server}:${session.account.id}`;
  }

  function isNewer(a: NotificationMarker, b?: NotificationMarker): boolean {
    if (!b) return true;
    if (a.id === b.id) return false;
    if (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)) return BigInt(a.id) > BigInt(b.id);
    return Date.parse(a.created) >= Date.parse(b.created);
  }

  export async function refreshActivityBadges(now = Date.now()): Promise<void> {
    const { api, session } = state;
    if (!api || !session || document.hidden || navigator.onLine === false ||
        (poll?.api === api && now < poll.nextAt)) return;
    const request = poll = { api, nextAt: now + 60000 };
    const started = version;
    try {
      const { items: latest } = await api.notifications(false);
      if (poll !== request || state.api !== api || started !== version) return;
      const saved = readStore<NotificationMarker | undefined>(notificationStorageKey(session), undefined, session.remember !== true);
      const seen = saved && isNewer(saved, newestSeen) ? saved : newestSeen;
      unread = !!latest[0] && isNewer(latest[0], seen);
      updateNavBadges();
    } catch {
      // An unavailable notifications endpoint should not affect navigation.
    }
  }

  export async function loadNotifications(append = false, quiet = false): Promise<void> {
    const { api, session, view } = state;
    if (activeView !== view) {
      items = [];
      next = undefined;
      activeView = view;
    }
    if (!api || !session) { render(); return; }
    const request = ++version;
    const current = () => request === version && state.api === api && state.view === view;
    state.error = "";
    state.loading = true;
    if (!quiet) render();
    try {
      const result = await api.notifications(view === "replies", append ? next : undefined);
      if (!current()) return;
      const readNewest = view === "notifications" && (!append || !items.length);
      items = [...new Map([...(append ? items : []), ...result.items].map((item) => [item.id, item])).values()];
      next = result.next;
      if (readNewest && items[0]) {
        const { id, created } = items[0];
        const marker = { id, created };
        const key = notificationStorageKey(session), temporary = session.remember !== true;
        const saved = readStore<NotificationMarker | undefined>(key, undefined, temporary);
        if (isNewer(marker, saved) && isNewer(marker, newestSeen)) {
          newestSeen = marker;
          writeStore(key, marker, temporary);
        }
      }
      if (readNewest) unread = false;
    } catch (error) {
      if (current()) state.error = (error as Error).message;
    } finally {
      if (current()) {
        state.loading = false;
        render();
      }
    }
  }

  const notificationLabels: Readonly<Record<string, string>> = {
    follow: "followed you",
    follow_request: "requested to follow you",
    favourite: "liked your post",
    reblog: "boosted your post",
    mention: "mentioned you",
    poll: "has a poll that ended",
    status: "published a post",
    update: "edited a post",
    quote: "quoted your post",
    quoted_update: "edited a post you quoted",
  };

  function notificationRow({ id, account, post, type, created }: AccountNotification): string {
    const isReply = type === "mention" && (post?.replyTo || post?.isReply);
    const label = isReply ? "replied in a conversation" : Object.prototype.hasOwnProperty.call(notificationLabels, type)
      ? notificationLabels[type] : "sent a notification";
    const preview = post && (post.warning || post.title || plainText(post.markdown).trim().slice(0, 180));
    return `<article class="notification-row">${profileAvatar(account, false, `notification:${id}`)}<div>
      <a class="author-link" href="#${escapeHTML(profilePath(account.id))}">${emojiText(account.name, account.emojis)}</a> ${label}
      <small class="byline-sub"> · ${relativeDate(created)}</small>
      ${post ? `<a class="notification-post" href="${escapeHTML(postReadLink(post.id))}">${emojiText(preview || (isReply ? "Open reply" : "Open post"), post.emojis)}</a>` : ""}
      </div></article>`;
  }

  export function notificationRefreshButton(): string {
    return state.session ? action("refresh-notifications", "Refresh", "", "button subtle small-button") : "";
  }

  export function notificationList(replies: boolean): string {
    if (!state.session)
      return emptyState("Sign in to see activity", "Connect your Fediverse account to see replies and notifications.",
        action("connect", "Sign in", "", "button primary"));
    return `<div class="notification-list">
      ${state.error ? `<div class="error-panel" role="alert">${escapeHTML(state.error)} ${action("refresh-notifications", "Try again", "", "text-button")}</div>` : ""}
      ${items.map(notificationRow).join("")}
      ${state.loading ? '<p class="loading" role="status">Loading activity…</p>' : next
        ? `<div class="load-more">${action("more-notifications", replies ? "Load older replies" : "Load older notifications", "", "button subtle")}</div>`
        : !items.length && !state.error ? emptyState(replies ? "No replies yet" : "No notifications yet",
          replies ? "Replies that mention you will appear here." : "Mentions, follows, likes, and other activity will appear here.") : ""}
      </div>`;
  }

  export function notificationsView(): string {
    return `<header class="page-intro feed-intro home-intro"><h1>Notifications</h1>${notificationRefreshButton()}</header>${notificationList(false)}`;
  }
}
