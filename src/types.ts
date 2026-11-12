namespace Fedi {
  export type Visibility = "public" | "unlisted" | "private" | "direct";
  export type ProfileImage = "avatar" | "header";
  export type HomeTimeline = "home" | "lists" | `list:${string}`;
  export type Timeline =
    | HomeTimeline
    | "local"
    | "federated"
    | "bookmarks"
    | `tag:${string}`;
  export type View =
    | "home"
    | "discover"
    | "people"
    | "bookmarks"
    | "drafts"
    | "editor"
    | "messages"
    | "notifications"
    | "replies"
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
    emojis?: EmojiImages;
  }
  export interface Mention {
    acct: string;
    url?: string;
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
    media?: MediaAttachment[];
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
    linkPreview?: LinkPreview;
    replyTo?: string;
    isReply?: boolean;
    boostedBy?: string;
    boostedByEmojis?: EmojiImages;
    emojis?: EmojiImages;
    tags: string[];
    mentions?: Mention[];
    local?: boolean;
    audience?: string[];
    language?: string | null;
  }
  export interface AccountNotification {
    id: string;
    type: string;
    created: string;
    account: Account;
    post?: Post;
  }
  export interface Conversation {
    id: string;
    accounts: Account[];
    unread: boolean;
    messages: Post[];
  }
  export interface LinkPreview {
    url: string;
    title: string;
    description: string;
    image: string;
    imageAlt: string;
    siteName: string;
    type: "link" | "video";
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
    media?: MediaAttachment[];
    publishKey?: string;
    mediaPrepared?: string;
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
    maxMedia?: number;
    imageSizeLimit?: number;
    imageTypes?: string[];
    mediaDescriptionLimit?: number;
  }
  export interface MediaAttachment {
    id: string;
    type: string;
    url: string;
    previewUrl: string;
    description: string;
  }
  export interface MastodonMedia {
    id: string;
    type: string;
    url?: string | null;
    preview_url?: string | null;
    description?: string | null;
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
  export type EmojiImages = Readonly<Record<string, string>>;
  export interface MastodonEmoji {
    shortcode: string;
    url?: string;
    static_url?: string;
    visible_in_picker?: boolean;
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
    emojis?: MastodonEmoji[];
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
    mentions?: (Mention & { id: string })[];
    emojis?: MastodonEmoji[];
    tags?: { name: string }[];
    filtered?: { filter: { filter_action: string; title: string } }[];
    media_attachments?: MastodonMedia[];
    card?: {
      type: string;
      title: string;
      description: string;
      image?: string | null;
      url: string;
      provider_name?: string;
      image_description?: string;
    } | null;
  }
  export interface MastodonNotification {
    id: string;
    type: string;
    created_at: string;
    account: MastodonAccount;
    status?: MastodonStatus | null;
  }
  export interface MastodonConversation {
    id: string;
    accounts: MastodonAccount[];
    unread: boolean;
    last_status: MastodonStatus | null;
  }
}
