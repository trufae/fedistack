# Reading, writing, and conversations

[Documentation](README.md) · [Fedistack](../README.md)

- Following, local, federated, bookmarks, hashtag, and server-list timelines, with pagination.
- Open **Settings → Hashtags & lists → Manage hashtags** to follow or unfollow topics. Tap a subscribed hashtag to read its timeline. Subscriptions are saved on your server and bring matching posts into Following when supported by the server.
- **Your lists → Manage lists…** or **Settings → Hashtags & lists → Manage lists** lets you create lists, rename them, search people you already follow to add them, and remove members. Lists group accounts; hashtag subscriptions follow topics. Tap a list name to read its timeline. Deleting a list asks for confirmation and keeps your account follows. Unsupported server features show an explanation in the management dialog.
- Articles/notes filters, following-only filtering, search, topic search, follows and follow requests.
- Timeline loads and **Load older posts** automatically scan up to 10 server pages (20 posts requested per page), aiming for 10 new publications that match the content, language, and following filters. Matches appear as pages arrive. Scanning stops at the end of the timeline, on an error, or at the page limit; use **Load older posts** to continue. Changing filters also fills sparse results from older pages. Search uses the server's returned results without this extra scanning.
- Use **Add language** in **Settings → Discovery languages** to choose one or more languages. On phones, open Settings beside your profile avatar. Tap a language chip to remove it, or **Show all languages** to clear the list. Discover shows posts matching any selected language, including regional variants, using your server's language labels. Unlabeled posts are hidden while filters are selected; load older posts for more results. Your choices are saved on this device, and an older single-language preference carries over. Home and Saved keep all languages.
- Likes, comments preserving the parent visibility, content warnings, and canonical publication sharing. Your own comments have a visible **Delete comment** action with confirmation.
- Visible **Edit** and **Delete** controls on your own publications. Editing loads the server's original source, autosaves unpublished changes, and updates the same post with its link and audience preserved. Deletion requires confirmation.
- **Unpublish → Move to drafts** saves the original Markdown locally before deleting the live publication. A failed draft save prevents deletion; a failed deletion leaves the recovery draft available. Republishing creates a new post and link; likes and replies do not transfer.
- Light, dark, and system themes; responsive layout; reading focus mode and full-window **Zen mode** for articles. Zen shows the article body below a slim save/status bar and an always-visible, compact formatting toolbar. Keyboard shortcuts also work. Titles, subtitles, preview/publish controls, and statistics stay out of the writing area; use **Exit Zen** or Escape to return.
- **Note** opens a compact social composer with your avatar, a text box, audience/content-warning settings, autosave status, and a **Note** button. There is no article title, subtitle, toolbar, or preview step. **Write an article** opens the full Markdown editor. Both kinds of draft resume from **Your writing**, and switching between them preserves the current draft.
- Markdown titles, subtitles, headings, emphasis, lists, quotes, links, images by URL, code blocks, dividers, and reading preview. This is a deliberately small Markdown subset, not a full CommonMark implementation.
- Drafts autosave locally after 300 ms, then sync pending changes to the connected server every 30 seconds while writing. Local saves flush when leaving the editor or hiding the page. Drafts are scoped to server and account. Open **Your writing** on another device to retrieve server drafts; **Refresh server drafts** fetches changes from other clients. Continue, delete, and export drafts there. Returning online retries local drafts. A closed browser cannot finish a pending upload: wait for **Saved on server** before switching devices.
- **Your writing → Replies** lists your replies and comments, with links back to their conversations and controls to delete your own comments. Load older replies to browse your history. **Published** lists your articles and notes separately.
- The editor labels drafts as **unpublished** and shows local and server save states separately. Failed server saves retain the local copy and explain the error. Changes made offline are preserved as a separate draft when they conflict with a newer server version.
- **Schedule** in the article or note editor accepts a date and time in your browser’s time zone, at least five minutes ahead. The server publishes automatically even with Fedistack closed. **Your writing → Scheduled** lists scheduled posts from all clients and lets you change their publication time or cancel them. Scheduling applies to new posts, not updates to existing publications.
- Publication counts, followers, following, likes, replies, word counts, and estimated reading times. Engagement totals explicitly cover loaded publications. No fabricated views or impressions.
- Separate DM conversations with private-mention replies. Context messages are checked against the exact participant set. A mention cannot silently add someone to a conversation. DMs are not end-to-end encrypted.

| Editor shortcut  | Action                             |
| ---------------- | ---------------------------------- |
| Cmd/Ctrl+B       | Bold selection                     |
| Cmd/Ctrl+I       | Italic selection                   |
| Cmd/Ctrl+K       | Insert Markdown link               |
| Cmd/Ctrl+S       | Save draft                         |
| Cmd/Ctrl+Shift+F | Toggle Zen editing / reading focus |
| Escape           | Leave Zen / focus mode             |

Server drafts use Mastodon’s scheduled-status API with dates spread across year **9999**. There is no documented indefinite draft mode: omitting `scheduled_at` when creating a status publishes immediately. Year 9999 is a finite workaround, not a guarantee of “never.” A server rejecting that date leaves the draft local and reports a sync error; Fedistack never retries it as an immediate post.

Other clients with scheduled-post support can see these copies, containing readable Markdown and a Fedistack metadata comment for restoring titles, subtitles, and editing state. Use Fedistack’s **Schedule** or **Publish** to remove that metadata and apply the server’s publication format; directly rescheduling a draft in another client may publish the raw text and metadata. Ordinary scheduled posts are kept separate from server drafts. Server character limits include draft metadata, and server scheduling quotas also apply. Export Markdown for an independent backup.

Offline demo drafts remain device-local. Demo data is fictional and kept separately from live account data. Remote messages are kept in memory rather than persisted in local storage. Timelines and conversations refresh on navigation or explicit refresh; there is no background streaming or push service.
