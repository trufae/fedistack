namespace Fedi {
  export function mapMedia(media: MastodonMedia): MediaAttachment {
    return {
      id: media.id, type: media.type,
      url: safeURL(media.url || "", true),
      previewUrl: safeURL(media.preview_url || media.url || "", true),
      description: media.description || "",
    };
  }
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
    private relationshipCache = new Map<string, { value?: Relationship; updated: number }>();
    private relationshipPending = new Map<string, Promise<Relationship | undefined>>();
    private relationshipVersion = 0;
    private rememberRelationship(id: string, value?: Relationship): void {
      this.relationshipCache.delete(id);
      this.relationshipCache.set(id, { value, updated: Date.now() });
      while (this.relationshipCache.size > 500)
        this.relationshipCache.delete(this.relationshipCache.keys().next().value!);
    }
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
      signal?: AbortSignal,
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
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      const timer = setTimeout(cancel, 25000);
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (this.token) headers.Authorization = `Bearer ${this.token}`;
        const form = body instanceof URLSearchParams;
        const multipart = body instanceof FormData;
        if (body !== undefined && !multipart)
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
              : multipart
                ? body
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
        if (method !== "GET" && /^\/api\/v[12]\/(?:statuses(?:\/|$)|bookmarks(?:\/|$)|filters(?:\/|$)|lists(?:\/|$)|tags(?:\/|$)|accounts\/[^/]+\/(?:follow|unfollow|block|unblock|mute|unmute)$)/.test(url.pathname))
          clearFeedCache();
        const data =
          response.status === 204 || response.status === 206
            ? (undefined as T)
            : ((await response.json().catch((error) => {
              if (error?.name !== "SyntaxError") throw error;
              throw new APIError(`${method} ${url.pathname} (${response.status}): The server returned an invalid JSON response.`, response.status);
            })) as T);
        if (method !== "GET" && /\/accounts\/[^/]+\/(follow|unfollow|block|unblock|mute|unmute)$/.test(url.pathname)) {
          this.relationshipVersion++;
          const id = decodeURIComponent(url.pathname.split("/").slice(-2)[0]);
          const relation = data as unknown as Relationship;
          this.rememberRelationship(id, relation?.id === id ? relation : undefined);
        }
        const next = /<([^>]+)>;\s*rel="next"/.exec(
          response.headers.get("Link") || "",
        )?.[1];
        return { data, next };
      } catch (error) {
        if (signal?.aborted) {
          const cancelled = new Error("Request cancelled.");
          cancelled.name = "AbortError";
          throw cancelled;
        }
        if (error instanceof APIError) throw error;
        throw new Error(
          controller.signal.aborted
            ? "The server took too long. Check your connection and try again."
            : "Could not reach this server. Check its address, your connection, and whether it allows cross-origin access.",
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    }

    async get<T>(path: string, signal?: AbortSignal): Promise<T> {
      return (await this.request<T>(path, "GET", undefined, undefined, signal)).data;
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
    async updateProfileImage(kind: ProfileImage, file: File): Promise<Account> {
      const body = new FormData();
      body.append(kind, file);
      const result = await this.request<MastodonAccount>(
        "/api/v1/accounts/update_credentials", "PATCH", body,
      );
      const data = result.data;
      if (!data || typeof data.id !== "string" || !data.id ||
          typeof data.username !== "string" || typeof data.acct !== "string" ||
          typeof data.note !== "string")
        throw new Error("The server did not return a valid account after the image upload. Refresh your profile to check whether it was saved.");
      if (typeof data[kind] !== "string" || !safeURL(data[kind]!, true).startsWith("https://"))
        throw new Error("The server accepted the upload but did not return a usable HTTPS image URL. Refresh your profile or check your server’s media configuration.");
      return mapAccount(data);
    }
    async uploadMedia(file: File): Promise<MediaAttachment> {
      const body = new FormData();
      body.append("file", file);
      let uploaded: MastodonMedia;
      try {
        uploaded = await this.post<MastodonMedia>("/api/v2/media", body);
      } catch (error) {
        if (!(error instanceof APIError) || ![404, 405, 501].includes(error.status)) throw error;
        uploaded = await this.post<MastodonMedia>("/api/v1/media", body);
      }
      if (!uploaded?.id || uploaded.type !== "image")
        throw new Error("The server could not process this image. Try a different image format.");
      return mapMedia(uploaded);
    }
    async readyMedia(media: MediaAttachment): Promise<MediaAttachment> {
      for (let attempt = 0; attempt < 20; attempt++) {
        if (media.url) return media;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const result = await this.get<MastodonMedia | undefined>(`/api/v1/media/${encodeURIComponent(media.id)}`);
        if (result) media = mapMedia(result);
      }
      if (media.url) return media;
      throw new Error("The server is still processing this image. Use Check image to try again.");
    }
    async describeMedia(media: MediaAttachment): Promise<void> {
      await this.request(`/api/v1/media/${encodeURIComponent(media.id)}`, "PUT", { description: media.description });
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
      timeline: Exclude<Timeline, "lists">,
      next?: string,
      signal?: AbortSignal,
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
      const result = await this.request<MastodonStatus[]>(url.href, "GET", undefined, undefined, signal);
      return {
        posts: result.data
          .filter(
            (s) =>
              s.visibility !== "direct" &&
              !s.filtered?.some((f) => f.filter.filter_action === "hide"),
          )
          .map((status) => {
            const post = mapStatus(status);
            if (timeline === "bookmarks") post.saved = true;
            return post;
          }),
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
      media?: MediaAttachment[],
    ): Promise<Post> {
      const result = await this.request<MastodonStatus>(
        `/api/v1/statuses/${encodeURIComponent(id)}`,
        "PUT",
        {
          status: text,
          spoiler_text: warning,
          ...(media ? { media_ids: media.map((m) => m.id),
            media_attributes: media.map((m) => ({ id: m.id, description: m.description })) } : {}),
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
      media: MediaAttachment[] = [],
    ): Promise<ScheduledStatus> {
      // Never allow a missing/invalid date to fall through to immediate publishing.
      validateScheduleTime(scheduledAt);
      const result = await this.post<ScheduledStatus>("/api/v1/statuses", {
        status: text, visibility, spoiler_text: warning,
        content_type: format, scheduled_at: scheduledAt,
        ...(media.length ? { media_ids: media.map((m) => m.id) } : {}),
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
      media: MediaAttachment[] = [],
    ): Promise<Post> {
      return mapStatus(
        await this.post<MastodonStatus>(
          "/api/v1/statuses",
          {
            status: text,
            visibility,
            ...(replyTo ? { in_reply_to_id: replyTo } : {}),
            spoiler_text: warning,
            ...(media.length ? { media_ids: media.map((m) => m.id) } : {}),
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
      const unique = [...new Set(ids)];
      const missing = unique.filter((id) => !this.relationshipPending.has(id) &&
        Date.now() - (this.relationshipCache.get(id)?.updated || 0) >= 60000);
      for (let offset = 0; offset < missing.length; offset += 80) {
        const batch = missing.slice(offset, offset + 80), version = this.relationshipVersion;
        const query = new URLSearchParams();
        batch.forEach((id) => query.append("id[]", id));
        const request = this.get<Relationship[]>(`/api/v1/accounts/relationships?${query}`);
        for (const id of batch) {
          const pending = request.then((rows) => {
            // A mutation response is authoritative over an older metadata read.
            if (version === this.relationshipVersion)
              this.rememberRelationship(id, rows.find((row) => row.id === id));
            return this.relationshipCache.get(id)?.value;
          }).finally(() => {
            if (this.relationshipPending.get(id) === pending) this.relationshipPending.delete(id);
          });
          this.relationshipPending.set(id, pending);
        }
      }
      const rows = await Promise.all(unique.map((id) =>
        this.relationshipPending.get(id) || this.relationshipCache.get(id)?.value));
      return rows.filter((row): row is Relationship => !!row);
    }
    async account(id: string, signal?: AbortSignal): Promise<Account> {
      return mapAccount(await this.get<MastodonAccount>(`/api/v1/accounts/${encodeURIComponent(id)}`, signal));
    }
    async accountPosts(
      id: string, tab: "posts" | "replies" | "boosts" | "writing", next?: string, signal?: AbortSignal,
    ): Promise<{ posts: Post[]; next?: string }> {
      // Keep cursors for pages with no matches. Servers may still return self-replies.
      const result = await this.request<MastodonStatus[]>(next ||
        `/api/v1/accounts/${encodeURIComponent(id)}/statuses?exclude_replies=${tab === "posts"}&exclude_reblogs=${tab !== "boosts"}&limit=40`, "GET", undefined, undefined, signal);
      return {
        posts: result.data.filter((s) => {
          if (!visibleStatus(s) || !!s.reblog !== (tab === "boosts")) return false;
          const reply = !!(s.in_reply_to_id || s.is_reply);
          return tab === "posts" ? !reply : tab !== "replies" || reply;
        }).map(mapStatus),
        next: result.next,
      };
    }
    async favourites(next?: string, signal?: AbortSignal): Promise<{ posts: Post[]; next?: string }> {
      const result = await this.request<MastodonStatus[]>(next || "/api/v1/favourites?limit=40", "GET", undefined, undefined, signal);
      return { posts: result.data.filter(visibleStatus).map((s) => ({ ...mapStatus(s), liked: true })), next: result.next };
    }
    async accountConnections(id: string, kind: "followers" | "following", next?: string, signal?: AbortSignal): Promise<{ accounts: Account[]; next?: string }> {
      const result = await this.request<MastodonAccount[]>(next || `/api/v1/accounts/${encodeURIComponent(id)}/${kind}?limit=40`, "GET", undefined, undefined, signal);
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
    async followedTags(next?: string, signal?: AbortSignal): Promise<{ tags: FollowedTag[]; next?: string }> {
      const result = await this.request<FollowedTag[]>(next || "/api/v1/followed_tags?limit=100", "GET", undefined, undefined, signal);
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
      signal?: AbortSignal,
      next?: string,
    ): Promise<{ accounts: Account[]; posts: Post[]; hashtags: string[]; next?: string }> {
      type Kind = "accounts" | "statuses" | "hashtags";
      type Results = { accounts: MastodonAccount[]; statuses: MastodonStatus[]; hashtags?: { name: string }[] };
      const kinds: Kind[] = ["accounts", "statuses", "hashtags"];
      const offsets: Partial<Record<Kind, number>> = next ? JSON.parse(next) : {};
      const result: Results = { accounts: [], statuses: [], hashtags: [] };
      const more: Partial<Record<Kind, number>> = {};
      // Mastodon ignores offset unless type is present. Each category advances independently.
      await Promise.all((next ? kinds.filter((kind) => offsets[kind] !== undefined) : [undefined]).map(async (kind) => {
        const params = new URLSearchParams({ q: query, limit: "20" });
        if (this.token) params.set("resolve", next ? "false" : "true");
        if (kind) {
          params.set("type", kind);
          params.set("offset", String(offsets[kind]));
        }
        const page = await this.get<Results>(`/api/v2/search?${params}`, signal);
        for (const category of kind ? [kind] : kinds) {
          const values = page[category] || [];
          if (category === "accounts") result.accounts = page.accounts || [];
          else if (category === "statuses") result.statuses = page.statuses || [];
          else result.hashtags = page.hashtags || [];
          // Count raw results: hidden statuses still occupy positions on the server.
          if (this.token && values.length >= 20) more[category] = (offsets[category] || 0) + values.length;
        }
      }));
      return {
        accounts: result.accounts.map(mapAccount),
        posts: result.statuses
          .filter((s) => s.visibility !== "direct" && !s.filtered?.some((f) => f.filter.filter_action === "hide"))
          .map(mapStatus),
        hashtags: (result.hashtags || []).map((tag) => tag.name),
        next: Object.keys(more).length ? JSON.stringify(more) : undefined,
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
      statuses?: { max_characters?: number; supported_mime_types?: string[]; max_media_attachments?: number };
      media_attachments?: { image_size_limit?: number; supported_mime_types?: string[]; description_limit?: number };
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
    const media = v2?.configuration?.media_attachments || v1?.configuration?.media_attachments;
    const maxMedia = v2?.configuration?.statuses?.max_media_attachments ?? v1?.configuration?.statuses?.max_media_attachments;
    return {
      maxChars,
      ...(maxMedia !== undefined ? { maxMedia } : {}),
      ...(media?.image_size_limit ? { imageSizeLimit: media.image_size_limit } : {}),
      ...(media?.supported_mime_types ? { imageTypes: media.supported_mime_types.filter((t) => t.startsWith("image/")) } : {}),
      ...(media?.description_limit ? { mediaDescriptionLimit: media.description_limit } : {}),
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
    const heading = leadingHeading(content);
    const title = s.title?.trim() || (heading ? plainText(heading[1]) : "");
    // Link preview metadata belongs to the linked page.
    const article =
      s.object_type === "Article" ||
      !!title ||
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
      title,
      subtitle: "",
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
      media: s.media_attachments?.filter((m) => !!m.id).map((m) => mapMedia({ ...m, url: m.url || m.preview_url })),
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
        `<p>Open your server, authorize Fedistack, then paste the authorization code below.</p><a class="button primary" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Open your server ${icon("external")}</a><form id="oauth-form"><label>Authorization code<input name="code" required autocomplete="off"></label><button class="button primary" type="submit">Finish signing in</button></form>`,
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
