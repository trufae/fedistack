namespace Fedi {
  export type Visibility = "public" | "unlisted" | "private" | "direct";
  export type ProfileImage = "avatar" | "header";
  export type Timeline =
    | "home"
    | "local"
    | "federated"
    | "bookmarks"
    | `list:${string}`
    | `tag:${string}`;
  export type View =
    | "home"
    | "discover"
    | "bookmarks"
    | "drafts"
    | "editor"
    | "messages"
    | "settings"
    | "profile"
    | "reader";
  export interface Account {
    id: string;
    name: string;
    acct: string;
    avatar: string;
    bio: string;
    publication?: string;
    color?: string;
    url?: string;
    followers?: number;
    following?: number;
    statuses?: number;
    header?: string;
    joined?: string;
    locked?: boolean;
    hideCollections?: boolean;
    fields?: { name: string; value: string }[];
  }
  export interface Post {
    id: string;
    author: Account;
    title: string;
    subtitle: string;
    markdown: string;
    kind: "article" | "post";
    created: string;
    image?: string;
    imageAlt?: string;
    likes: number;
    replies: number;
    reposts: number;
    liked: boolean;
    reposted: boolean;
    saved: boolean;
    visibility: Visibility;
    warning: string;
    url?: string;
    source?: string;
    replyTo?: string;
    isReply?: boolean;
    boostedBy?: string;
    tags: string[];
    local?: boolean;
    audience?: string[];
    language?: string | null;
  }
  export interface Conversation {
    id: string;
    accounts: Account[];
    unread: boolean;
    messages: Post[];
  }
  export interface Draft {
    id: string;
    title: string;
    subtitle: string;
    body: string;
    kind: "article" | "post";
    visibility: Exclude<Visibility, "direct">;
    warning: string;
    updated: string;
    publishKey?: string;
    editingId?: string;
    serverId?: string;
    serverDraftId?: string;
    serverContent?: string;
    serverDraftContent?: string;
    serverPreviousIds?: string[];
    serverSaveKey?: string;
    serverSaveText?: string;
    scheduleKey?: string;
    scheduleTime?: string;
  }
  export interface ScheduledStatus {
    id: string;
    scheduled_at: string | null;
    params: {
      text: string;
      spoiler_text?: string | null;
      visibility?: Visibility | null;
      content_type?: PostFormat;
      poll?: unknown;
      in_reply_to_id?: string | null;
    };
    media_attachments: unknown[];
  }
  export type PostFormat = "text/markdown" | "text/html" | "text/plain";
  export interface Capabilities {
    maxChars: number;
    format: PostFormat;
    software: string;
  }
  export interface Session extends Capabilities {
    server: string;
    token: string;
    account: Account;
    remember?: boolean;
  }
  export interface Relationship {
    id: string;
    following: boolean;
    requested: boolean;
    followed_by?: boolean;
    blocking?: boolean;
    blocked_by?: boolean;
    muting?: boolean;
  }
  export interface UserList {
    id: string;
    title: string;
    replies_policy?: "followed" | "list" | "none";
    exclusive?: boolean;
  }
  export interface FollowedTag {
    name: string;
    following?: boolean;
  }
  export interface MastodonAccount {
    id: string;
    display_name: string;
    username: string;
    acct: string;
    avatar: string;
    note: string;
    url: string;
    followers_count?: number;
    following_count?: number;
    statuses_count?: number;
    header?: string;
    created_at?: string;
    locked?: boolean;
    hide_collections?: boolean;
    fields?: { name: string; value: string }[];
  }
  export interface MastodonStatus {
    object_type?: string;
    title?: string | null;
    language?: string | null;
    id: string;
    account: MastodonAccount;
    content: string;
    created_at: string;
    favourites_count: number;
    replies_count: number;
    reblogs_count: number;
    favourited?: boolean;
    reblogged?: boolean;
    bookmarked?: boolean;
    visibility: Visibility;
    spoiler_text: string;
    sensitive?: boolean;
    url: string;
    in_reply_to_id?: string;
    is_reply?: boolean;
    reblog?: MastodonStatus;
    mentions?: { id: string; acct: string }[];
    tags?: { name: string }[];
    filtered?: { filter: { filter_action: string; title: string } }[];
    media_attachments?: {
      type: string;
      preview_url: string;
      description?: string;
    }[];
    card?: {
      type: string;
      title: string;
      description: string;
      image: string;
      url: string;
    };
  }
  export interface MastodonConversation {
    id: string;
    accounts: MastodonAccount[];
    unread: boolean;
    last_status: MastodonStatus | null;
  }
}
