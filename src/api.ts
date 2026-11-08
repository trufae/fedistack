namespace Fedi {
  export class APIError extends Error {
    constructor(
      message: string,
      public status: number,
      public retryAt?: number,
    ) {
      super(message);
    }
  }

  export function rateLimitTime(
    headers: Headers,
    path: string,
    now = Date.now(),
  ): number {
    const after = headers.get("Retry-After");
    const reset = headers.get("X-RateLimit-Reset");
    const fromAfter = after
      ? /^\d+$/.test(after)
        ? now + Number(after) * 1000
        : Date.parse(after)
      : NaN;
    const fromReset = reset
      ? /^\d+$/.test(reset)
        ? Number(reset) * 1000
        : Date.parse(reset)
      : NaN;
    return (
      [fromAfter, fromReset].find(
        (time) => Number.isFinite(time) && time > now,
      ) || now + (path === "/api/v1/apps" ? 600000 : 60000)
    );
  }
  function cooldownMessage(time: number): string {
    return `The server has temporarily limited requests. Try again after ${new Date(time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}. Repeated clicks will not retry before then.`;
  }

  export function responseError(text: string, fallback: string): string {
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      const describe = (value: unknown): string => {
        if (typeof value === "string") return value;
        if (Array.isArray(value))
          return value.map(describe).filter(Boolean).join("; ");
        if (value && typeof value === "object") {
          const item = value as Record<string, unknown>;
          if (typeof item.message === "string") return item.message;
          if (typeof item.description === "string") return item.description;
          return Object.entries(item)
            .map(([key, detail]) => `${key}: ${describe(detail)}`)
            .join("; ");
        }
        return "";
      };
      return (
        [
          describe(body.error_description || body.error || body.message),
          describe(body.errors || body.details),
        ]
          .filter(Boolean)
          .join(" — ")
          .slice(0, 700) || fallback
      );
    } catch {
      return text && !/<[a-z!]/i.test(text) ? text.slice(0, 500) : fallback;
    }
  }

  export function serverURL(input: string): string {
    const url = new URL(
      input.includes("://") ? input.trim() : `https://${input.trim()}`,
    );
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error("Enter an HTTPS server domain, such as mastodon.social.");
    }
    return url.origin;
  }

  export class API {
    readonly server: string;
    constructor(
      server: string,
      private token = "",
    ) {
      this.server = serverURL(server);
    }

    async request<T>(
      path: string,
      method = "GET",
      body?: unknown,
      key?: string,
    ): Promise<{ data: T; next?: string }> {
      const url = new URL(path, this.server);
      // Never send an access token to a pagination URL on another origin.
      if (url.origin !== this.server || url.username || url.password)
        throw new Error("The server returned an unsafe API URL.");
      const cooldownKey = `cooldown:${method}:${url.origin}${url.pathname}`;
      const cooldown = readStore<number>(cooldownKey, 0);
      if (cooldown > Date.now())
        throw new APIError(cooldownMessage(cooldown), 429, cooldown);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (this.token) headers.Authorization = `Bearer ${this.token}`;
        const form = body instanceof URLSearchParams;
        if (body !== undefined)
          headers["Content-Type"] = form
            ? "application/x-www-form-urlencoded;charset=UTF-8"
            : "application/json";
        if (key) headers["Idempotency-Key"] = key;
        const response = await fetch(url.href, {
          method,
          headers,
          body:
            body === undefined
              ? undefined
              : form
                ? body.toString()
                : JSON.stringify(body),
          signal: controller.signal,
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          // Instance capabilities can change while an account stays signed in.
          cache: /^\/api\/v[12]\/instance$/.test(url.pathname) ? "no-store" : "default",
        });
        if (!response.ok) {
          const detail = responseError(
            await response.text(),
            response.statusText || "Request rejected",
          );
          if (response.status === 429) {
            const retryAt = rateLimitTime(response.headers, url.pathname);
            writeStore(cooldownKey, retryAt);
            throw new APIError(
              `${method} ${url.pathname} (429): ${cooldownMessage(retryAt)}`,
              429,
              retryAt,
            );
          }
          if (
            response.status === 422 &&
            typeof location !== "undefined" &&
            location.protocol === "file:" &&
            /^Unprocessable (Content|Entity)$/i.test(detail)
          ) {
            throw new APIError(
              "This server rejected the file:// browser origin. Run make serve, then open http://127.0.0.1:8080 to connect and publish. Local files still work for offline reading and drafts.",
              422,
            );
          }
          throw new APIError(
            `${method} ${url.pathname} (${response.status}): ${detail}`,
            response.status,
          );
        }
        if (method !== "GET" && /^\/api\/v[12]\/(?:statuses(?:\/|$)|bookmarks(?:\/|$)|filters(?:\/|$)|lists(?:\/|$)|accounts\/[^/]+\/(?:follow|unfollow|block|unblock|mute|unmute)$)/.test(url.pathname))
          clearFeedCache();
        const data =
          response.status === 204
            ? (undefined as T)
            : ((await response.json()) as T);
        const next = /<([^>]+)>;\s*rel="next"/.exec(
          response.headers.get("Link") || "",
        )?.[1];
        return { data, next };
      } catch (error) {
        if (error instanceof APIError) throw error;
        throw new Error(
          controller.signal.aborted
            ? "The server took too long. Check your connection and try again."
            : "Could not reach this server. Check its address, your connection, and whether it allows cross-origin access.",
        );
      } finally {
        clearTimeout(timer);
      }
    }

    async get<T>(path: string): Promise<T> {
      return (await this.request<T>(path)).data;
    }
    async post<T>(path: string, data: unknown = {}, key?: string): Promise<T> {
      return (await this.request<T>(path, "POST", data, key)).data;
    }
    async verify(): Promise<Session> {
      const account = await this.get<MastodonAccount>(
        "/api/v1/accounts/verify_credentials",
      );
      return {
        server: this.server,
        token: this.token,
        account: mapAccount(account),
        ...(await this.capabilities()),
      };
    }
    async capabilities(): Promise<Capabilities> {
      // v1 carries rich-text formats on Akkoma/Pleroma, even when v2 is supported.
      const results = await Promise.allSettled([
        this.get<InstanceInfo>("/api/v2/instance"),
        this.get<InstanceInfo>("/api/v1/instance"),
      ]);
      const info = results.map((r) =>
        r.status === "fulfilled" ? r.value : undefined,
      );
      if (!info.some(Boolean))
        throw new Error(
          "Could not read this server’s publishing capabilities. Please try again.",
        );
      return detectCapabilities(info[0], info[1]);
    }

    async timeline(
      timeline: Timeline,
      next?: string,
    ): Promise<{ posts: Post[]; next?: string }> {
      const paths: Record<string, string> = {
        home: "/api/v1/timelines/home",
        local: "/api/v1/timelines/public?local=true",
        federated: "/api/v1/timelines/public",
        bookmarks: "/api/v1/bookmarks",
      };
      const path = timeline.startsWith("list:")
        ? `/api/v1/timelines/list/${encodeURIComponent(timeline.slice(5))}`
        : timeline.startsWith("tag:")
          ? `/api/v1/timelines/tag/${encodeURIComponent(timeline.slice(4))}`
          : paths[timeline];
      const url = new URL(next || path, this.server);
      url.searchParams.set("limit", "40");
      const result = await this.request<MastodonStatus[]>(url.href);
      return {
        posts: result.data
          .filter(
            (s) =>
              s.visibility !== "direct" &&
              !s.filtered?.some((f) => f.filter.filter_action === "hide"),
          )
          .map(mapStatus),
        next: result.next,
      };
    }
    async context(id: string): Promise<Post[]> {
      const context = await this.get<{
        ancestors: MastodonStatus[];
        descendants: MastodonStatus[];
      }>(`/api/v1/statuses/${encodeURIComponent(id)}/context`);
      return [...context.ancestors, ...context.descendants]
        .filter(
          (s) => !s.filtered?.some((f) => f.filter.filter_action === "hide"),
        )
        .map(mapStatus);
    }
    async status(id: string): Promise<Post> {
      return mapStatus(
        await this.get<MastodonStatus>(
          `/api/v1/statuses/${encodeURIComponent(id)}`,
        ),
      );
    }
    async source(id: string): Promise<{
      text: string;
      spoiler_text: string;
      content_type?: PostFormat;
    }> {
      return this.get(`/api/v1/statuses/${encodeURIComponent(id)}/source`);
    }
    async editStatus(
      id: string,
      text: string,
      warning: string,
      format: PostFormat,
    ): Promise<Post> {
      const result = await this.request<MastodonStatus>(
        `/api/v1/statuses/${encodeURIComponent(id)}`,
        "PUT",
        {
          status: text,
          spoiler_text: warning,
          ...(format !== "text/plain" ? { content_type: format } : {}),
        },
      );
      return mapStatus(result.data);
    }
    async deleteStatus(id: string): Promise<void> {
      await this.request(
        `/api/v1/statuses/${encodeURIComponent(id)}`,
        "DELETE",
      );
    }
    async scheduledStatuses(): Promise<ScheduledStatus[]> {
      const statuses: ScheduledStatus[] = [];
      let next: string | undefined = "/api/v1/scheduled_statuses?limit=40";
      const visited = new Set<string>();
      while (next && !visited.has(next)) {
        visited.add(next);
        const page: { data: ScheduledStatus[]; next?: string } =
          await this.request<ScheduledStatus[]>(next);
        statuses.push(...page.data);
        next = page.next;
      }
      return statuses;
    }
    async scheduledStatus(id: string): Promise<ScheduledStatus> {
      return this.get(`/api/v1/scheduled_statuses/${encodeURIComponent(id)}`);
    }
    async deleteScheduledStatus(id: string): Promise<void> {
      try {
        await this.request(`/api/v1/scheduled_statuses/${encodeURIComponent(id)}`, "DELETE");
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 404) throw error;
      }
    }
    async createScheduledStatus(
      text: string, visibility: Visibility, warning: string,
      format: PostFormat, scheduledAt: string, key: string,
    ): Promise<ScheduledStatus> {
      // Never allow a missing/invalid date to fall through to immediate publishing.
      validateScheduleTime(scheduledAt);
      const result = await this.post<ScheduledStatus>("/api/v1/statuses", {
        status: text, visibility, spoiler_text: warning,
        content_type: format, scheduled_at: scheduledAt,
      }, key);
      if (!result.id || !result.params ||
          Date.parse(result.scheduled_at || "") !== Date.parse(scheduledAt))
        throw new Error("The server did not confirm the requested schedule. Check your server before retrying.");
      return result;
    }
    async rescheduleStatus(id: string, scheduledAt: string): Promise<void> {
      validateScheduleTime(scheduledAt);
      const { data } = await this.request<ScheduledStatus>(
        `/api/v1/scheduled_statuses/${encodeURIComponent(id)}`, "PUT", { scheduled_at: scheduledAt });
      if (Date.parse(data.scheduled_at || "") !== Date.parse(scheduledAt))
        throw new Error("The server did not confirm the new publication time.");
    }
    async createStatus(
      text: string,
      visibility: Visibility,
      replyTo?: string,
      warning = "",
      key = uid(),
      format: PostFormat = "text/plain",
    ): Promise<Post> {
      return mapStatus(
        await this.post<MastodonStatus>(
          "/api/v1/statuses",
          {
            status: text,
            visibility,
            ...(replyTo ? { in_reply_to_id: replyTo } : {}),
            spoiler_text: warning,
            ...(format !== "text/plain" ? { content_type: format } : {}),
          },
          key,
        ),
      );
    }
    async toggle(post: Post, action: "like" | "save" | "repost"): Promise<Post> {
      const method =
        action === "like"
          ? post.liked
            ? "unfavourite"
            : "favourite"
          : action === "repost"
            ? post.reposted
              ? "unreblog"
              : "reblog"
            : post.saved
              ? "unbookmark"
              : "bookmark";
      return mapStatus(
        await this.post<MastodonStatus>(
          `/api/v1/statuses/${encodeURIComponent(post.id)}/${method}`,
        ),
      );
    }
    async relationships(ids: string[]): Promise<Relationship[]> {
      if (!ids.length) return [];
      const query = new URLSearchParams();
      [...new Set(ids)].forEach((id) => query.append("id[]", id));
      return this.get<Relationship[]>(
        `/api/v1/accounts/relationships?${query}`,
      );
    }
    async account(id: string): Promise<Account> {
      return mapAccount(await this.get<MastodonAccount>(`/api/v1/accounts/${encodeURIComponent(id)}`));
    }
    async accountPosts(
      id: string, tab: "posts" | "replies" | "boosts" | "writing", next?: string,
    ): Promise<{ posts: Post[]; next?: string }> {
      // Mastodon has no portable boosts-only endpoint. Filter each page of
      // account activity and keep its cursor, including pages with no matches.
      const result = await this.request<MastodonStatus[]>(next ||
        `/api/v1/accounts/${encodeURIComponent(id)}/statuses?exclude_replies=false&exclude_reblogs=${tab !== "boosts"}&limit=40`);
      return {
        posts: result.data.filter((s) => visibleStatus(s) &&
          (tab === "boosts" ? !!s.reblog : !s.reblog) &&
          (tab !== "replies" || !!s.in_reply_to_id || !!s.is_reply)).map(mapStatus),
        next: result.next,
      };
    }
    async favourites(next?: string): Promise<{ posts: Post[]; next?: string }> {
      const result = await this.request<MastodonStatus[]>(next || "/api/v1/favourites?limit=40");
      return { posts: result.data.filter(visibleStatus).map((s) => ({ ...mapStatus(s), liked: true })), next: result.next };
    }
    async accountConnections(id: string, kind: "followers" | "following", next?: string): Promise<{ accounts: Account[]; next?: string }> {
      const result = await this.request<MastodonAccount[]>(next || `/api/v1/accounts/${encodeURIComponent(id)}/${kind}?limit=40`);
      return { accounts: result.data.map(mapAccount), next: result.next };
    }
    async suggestions(): Promise<Account[]> {
      try {
        const result = await this.get<{ account: MastodonAccount }[]>("/api/v2/suggestions?limit=12");
        return result.map((s) => mapAccount(s.account));
      } catch (error) {
        if (!(error instanceof APIError) || ![404, 405, 501].includes(error.status)) throw error;
        return (await this.get<MastodonAccount[]>("/api/v1/suggestions?limit=12")).map(mapAccount);
      }
    }
    async follow(id: string, unfollow: boolean): Promise<Relationship> {
      return this.post<Relationship>(
        `/api/v1/accounts/${encodeURIComponent(id)}/${unfollow ? "unfollow" : "follow"}`,
      );
    }
    async followedTags(next?: string): Promise<{ tags: FollowedTag[]; next?: string }> {
      const result = await this.request<FollowedTag[]>(next || "/api/v1/followed_tags?limit=100");
      return { tags: result.data, next: result.next };
    }
    async followTag(name: string, unfollow = false): Promise<FollowedTag> {
      return this.post<FollowedTag>(`/api/v1/tags/${encodeURIComponent(name)}/${unfollow ? "unfollow" : "follow"}`);
    }
    async saveList(title: string, list?: UserList): Promise<UserList> {
      return (await this.request<UserList>(
        list ? `/api/v1/lists/${encodeURIComponent(list.id)}` : "/api/v1/lists",
        list ? "PUT" : "POST",
        { title, ...(list?.replies_policy ? { replies_policy: list.replies_policy } : {}),
          ...(list?.exclusive !== undefined ? { exclusive: list.exclusive } : {}) },
      )).data;
    }
    async deleteList(id: string): Promise<void> {
      await this.request(`/api/v1/lists/${encodeURIComponent(id)}`, "DELETE");
    }
    async listMembers(id: string, next?: string): Promise<{ accounts: Account[]; next?: string }> {
      const result = await this.request<MastodonAccount[]>(next || `/api/v1/lists/${encodeURIComponent(id)}/accounts?limit=80`);
      return { accounts: result.data.map(mapAccount), next: result.next };
    }
    async setListMember(listId: string, accountId: string, remove = false): Promise<void> {
      await this.request(`/api/v1/lists/${encodeURIComponent(listId)}/accounts`,
        remove ? "DELETE" : "POST", { account_ids: [accountId] });
    }
    async searchFollowing(query: string): Promise<Account[]> {
      const result = await this.get<MastodonAccount[]>(`/api/v1/accounts/search?${new URLSearchParams({
        q: query, following: "true", limit: "20",
      })}`);
      return result.map(mapAccount);
    }
    async search(
      query: string,
    ): Promise<{ accounts: Account[]; posts: Post[] }> {
      const result = await this.get<{
        accounts: MastodonAccount[];
        statuses: MastodonStatus[];
      }>(
        `/api/v2/search?${new URLSearchParams({ q: query, resolve: "true", limit: "20" })}`,
      );
      return {
        accounts: result.accounts.map(mapAccount),
        posts: result.statuses
          .filter(
            (s) =>
              s.visibility !== "direct" &&
              !s.filtered?.some((f) => f.filter.filter_action === "hide"),
          )
          .map(mapStatus),
      };
    }
    async conversations(
      next?: string,
    ): Promise<{ conversations: Conversation[]; next?: string }> {
      const result = await this.request<MastodonConversation[]>(
        next || "/api/v1/conversations?limit=40",
      );
      return {
        conversations: result.data.map((c) => ({
          id: c.id,
          accounts: c.accounts.map(mapAccount),
          unread: c.unread,
          messages: c.last_status ? [mapStatus(c.last_status)] : [],
        })),
        next: result.next,
      };
    }
  }

  export interface InstanceInfo {
    version?: string;
    max_toot_chars?: number;
    configuration?: {
      statuses?: { max_characters?: number; supported_mime_types?: string[] };
    };
    pleroma?: { metadata?: { post_formats?: string[] } };
  }
  export function detectCapabilities(
    v2?: InstanceInfo,
    v1?: InstanceInfo,
  ): Capabilities {
    const maxChars =
      v2?.configuration?.statuses?.max_characters ||
      v1?.configuration?.statuses?.max_characters ||
      v1?.max_toot_chars ||
      500;
    const formats = [
      ...(v1?.pleroma?.metadata?.post_formats || []),
      ...(v2?.pleroma?.metadata?.post_formats || []),
      ...(v2?.configuration?.statuses?.supported_mime_types || []),
      ...(v1?.configuration?.statuses?.supported_mime_types || []),
    ];
    return {
      maxChars,
      format: formats.includes("text/markdown")
        ? "text/markdown"
        : formats.includes("text/html")
          ? "text/html"
          : "text/plain",
      software: v2?.version || v1?.version || "Mastodon-compatible",
    };
  }
  export function supportsArticles(capabilities: Capabilities): boolean {
    return !articleSupportProblem(capabilities);
  }
  export function articleSupportProblem(capabilities: Capabilities): string {
    if (capabilities.maxChars < 5000)
      return `This server allows ${capabilities.maxChars.toLocaleString()} characters per post. Fedistack’s article editor requires a server limit of at least 5,000 characters.`;
    if (capabilities.format === "text/plain")
      return `This server allows ${capabilities.maxChars.toLocaleString()} characters per post, but does not advertise Markdown or HTML publishing. Fedistack’s article editor requires one of these formats. You can still publish plain-text notes.`;
    return "";
  }

  export function mapAccount(account: MastodonAccount): Account {
    return {
      id: account.id,
      name: account.display_name || account.username,
      acct: account.acct,
      avatar: safeURL(account.avatar, true),
      bio: plainText(htmlToMarkdown(account.note)),
      url: safeURL(account.url),
      followers: account.followers_count,
      following: account.following_count,
      statuses: account.statuses_count,
      header: safeURL(account.header || "", true),
      joined: account.created_at,
      locked: account.locked,
      hideCollections: account.hide_collections,
      fields: account.fields?.map((f) => ({ name: f.name, value: plainText(htmlToMarkdown(f.value)) })),
    };
  }

  function visibleStatus(status: MastodonStatus): boolean {
    const original = status.reblog || status;
    return status.visibility !== "direct" && original.visibility !== "direct" &&
      ![status, original].some((s) => s.filtered?.some((f) => f.filter.filter_action === "hide"));
  }

  export function mapStatus(input: MastodonStatus): Post {
    const s = input.reblog || input;
    const content = htmlToMarkdown(s.content),
      tags = (s.tags || []).map((t) => t.name);
    const card = s.card?.type === "link" && s.card.title ? s.card : undefined;
    const heading = /^#\s+(.+)$/m.exec(content)?.[1];
    const title = s.title || heading || card?.title || "";
    // A link preview describes the linked page, not the length or kind of this post.
    const article =
      s.object_type === "Article" ||
      !!heading ||
      tags.some((t) => t.toLowerCase() === "article") ||
      plainText(content).length > 900;
    const media = s.media_attachments?.find((m) => m.type === "image");
    const warning =
      s.spoiler_text ||
      s.filtered?.map((f) => f.filter.title).join(", ") ||
      (s.sensitive ? "Sensitive content" : "");
    return {
      id: s.id,
      author: mapAccount(s.account),
      title: article
        ? title || plainText(content).split("\n")[0].slice(0, 120)
        : "",
      subtitle: card?.description || "",
      markdown: content,
      kind: article ? "article" : "post",
      created: s.created_at,
      likes: s.favourites_count,
      replies: s.replies_count,
      reposts: s.reblogs_count || 0,
      liked: !!s.favourited,
      reposted: !!s.reblogged,
      saved: !!s.bookmarked,
      visibility: s.visibility,
      warning,
      image: safeURL(media?.preview_url || card?.image || "", true),
      imageAlt: media?.description || "",
      url: safeURL(s.url),
      source: card ? safeURL(card.url) : undefined,
      replyTo: s.in_reply_to_id,
      isReply: !!s.in_reply_to_id || !!s.is_reply,
      boostedBy: input.reblog
        ? input.account.display_name || input.account.username
        : undefined,
      tags,
      language: s.language || null,
      audience: [
        ...new Set([s.account.id, ...(s.mentions || []).map((a) => a.id)]),
      ],
    };
  }

  interface PendingOAuth {
    server: string;
    client_id: string;
    client_secret: string;
    redirect: string;
    state: string;
    verifier: string;
    created: number;
    remember?: boolean;
  }
  export async function startOAuth(
    server: string,
    manual = false,
    remember = false,
  ): Promise<void> {
    const api = new API(server);
    if (location.protocol === "file:") {
      const capabilities = await api.capabilities();
      if (
        !/pleroma|akkoma|gotosocial/i.test(capabilities.software) &&
        (/mastodon|glitch/i.test(capabilities.software) ||
          /^\d+\.\d+\.\d+/.test(capabilities.software))
      ) {
        throw new Error(
          "This Mastodon server requires an HTTP or HTTPS origin for login. Run make serve, then open http://127.0.0.1:8080. Directly opening index.html still supports offline reading and drafts.",
        );
      }
    }
    if (!crypto.subtle)
      throw new Error(
        "Secure sign-in needs HTTPS or localhost. You can connect with an access token instead.",
      );
    const oob = "urn:ietf:wg:oauth:2.0:oob";
    const redirect =
      location.protocol === "file:" || manual
        ? oob
        : `${location.origin}${location.pathname}`;
    const register = () =>
      api.post<{ client_id: string; client_secret: string }>(
        "/api/v1/apps",
        new URLSearchParams({
          client_name: "Fedistack",
          redirect_uris: redirect,
          scopes: "read write",
        }),
      );
    const appKey = `oauth-app:${api.server}:${redirect}`;
    const app =
      readStore<{ client_id: string; client_secret: string } | null>(
        appKey,
        null,
        true,
      ) || (await register());
    if (!app.client_id || !app.client_secret)
      throw new Error(
        "The server did not return valid application credentials. Try connecting with an access token.",
      );
    writeStore(
      appKey,
      { client_id: app.client_id, client_secret: app.client_secret },
      true,
    );
    const verifier = uid() + uid();
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const pending: PendingOAuth = {
      server: api.server,
      ...app,
      redirect,
      state: uid(),
      verifier,
      created: Date.now(),
      remember,
    };
    if (!writeStore("oauth", pending, true))
      throw new Error(
        "Session storage is unavailable. Connect with an access token instead.",
      );
    const url = `${api.server}/oauth/authorize?${new URLSearchParams({ client_id: app.client_id, response_type: "code", redirect_uri: redirect, scope: "read write", state: pending.state, code_challenge: challenge, code_challenge_method: "S256" })}`;
    if (redirect === oob) {
      showModal(
        "Authorize Fedistack",
        `<p>Open your server, authorize Fedistack, then paste the authorization code below.</p><a class="button primary" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Open your server ${icon("external")}</a><form id="oauth-form"><label>Authorization code<input name="code" required autocomplete="off"></label><button class="button primary" type="submit">Finish connecting</button></form>`,
      );
    } else location.assign(url);
  }

  export async function finishOAuth(
    code: string,
    returnedState?: string,
  ): Promise<Session> {
    const pending = readStore<PendingOAuth | null>("oauth", null, true);
    if (
      !pending ||
      Date.now() - pending.created > 15 * 60 * 1000 ||
      (pending.redirect !== "urn:ietf:wg:oauth:2.0:oob" &&
        returnedState !== pending.state)
    ) {
      writeStore("oauth", null, true);
      throw new Error(
        "This sign-in expired or could not be verified. Please connect again.",
      );
    }
    const token = await new API(pending.server).post<{ access_token: string }>(
      "/oauth/token",
      new URLSearchParams({
        client_id: pending.client_id,
        client_secret: pending.client_secret,
        redirect_uri: pending.redirect,
        grant_type: "authorization_code",
        code,
        code_verifier: pending.verifier,
      }),
    );
    if (!token.access_token)
      throw new Error(
        "The server did not return an access token. Please connect again.",
      );
    writeStore("oauth", null, true);
    return {
      ...(await new API(pending.server, token.access_token).verify()),
      remember: pending.remember === true,
    };
  }
}
