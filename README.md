# Fedistack

A Substack-inspired reading and writing client with the fediverse as its backend. Vanilla TypeScript, handwritten CSS, and **zero runtime dependencies**. TypeScript is the only development dependency.

## Build and run

```sh
# Optional if tsc is already installed:
npm ci

make             # same as make dist
make serve       # http://127.0.0.1:8080
make test        # Node's built-in test runner
make check       # strict TypeScript check
```

`make serve PORT=8081` changes the local port. Node 20+ is recommended for development and tests. The browser needs modern DOM, Fetch, Web Crypto, and dialog APIs.

Upload the **contents of `dist/`** to any static HTTP(S) host. Subdirectories work; navigation uses URL hashes and all assets use relative paths. There is no application server, framework, bundler, CDN, external font, or analytics service.

You can also open `dist/index.html` directly. The offline demo, editor, drafts, themes, and local interactions work without a server or network. **Mastodon login and writes require localhost or HTTPS:** browsers send `Origin: null` from `file://`, which Mastodon's CSRF protection rejects with a generic 422. This is an instance restriction a static client cannot override. Use `make serve` for a live Mastodon account. Other compatible servers may allow the manual authorization-code flow from a local file.

## Connect an account

Click **Connect your account**, enter your instance domain, and optionally check compatibility. OAuth registers Fedistack with the instance and redirects to the instance's sign-in page. Your password never enters Fedistack. OAuth uses a state parameter and an S256 PKCE challenge; registration and token exchange use form encoding.

The additional sign-in options support a manual authorization code or an existing application access token with `read` and `write` permissions. Tokens and OAuth credentials are held in this tab's session storage, not embedded in the website or stored in local storage. Disconnect removes the active token from this client; revoke the application in your server's settings to revoke server-side access as well.

**If you see 429 on `/api/v1/apps`, stop retrying.** Mastodon's upstream default is five application registrations per ten-minute window; your instance can differ. Fedistack honors `Retry-After` / `X-RateLimit-Reset` when exposed, otherwise waits ten minutes for registration. Successful app registrations are reused within the session. It never automatically retries a rejected registration.

Moving between `file://`, localhost, and a hosted URL changes browser storage. Export important drafts before switching, then paste their Markdown into the editor at the new location.

## Long-form publishing

The article editor targets servers that advertise **at least 5,000 characters and rich-text input** through the Mastodon-compatible API. Capability detection reads both v1 and v2 instance metadata, including Akkoma/Pleroma `post_formats` and glitch-soc `supported_mime_types`.

For example, infosec.exchange advertised **11,000 characters, Markdown, and HTML** when checked on November 6, 2026. The client checks the actual instance configuration rather than assuming defaults.

- Articles are **one publication**, never truncated or automatically turned into threads.
- Markdown is sent as `content_type=text/markdown` when supported; otherwise the client sends the rendered HTML if the server advertises HTML input.
- Plain-text instances remain usable for reading and short posts. They cannot publish articles from this editor.
- The length check includes title, subtitle, source formatting, and content warning. It is conservative: some servers count rendered text or normalized links differently. The server remains authoritative.
- The reader converts incoming HTML into the supported Markdown subset before rendering. Raw HTML and unsafe URL schemes are not inserted into the page.
- Article detection uses a heading, a link-preview title, the `article` tag, or a body longer than 900 characters. The Mastodon API has no universal article type, so this is a reading filter, not a claim about the underlying ActivityPub object.
- Linked articles show the text provided by the instance plus a link to the original; Fedistack does not scrape paywalled or external article bodies.

## Reading, writing, and conversations

- Following, local, federated, bookmarks, and existing server-list timelines, with pagination.
- Articles/notes filters, following-only filtering, search, topic search, follows and follow requests.
- Choose a language in **Settings → Discovery language** or directly in **Discover**. The device-local preference filters loaded Discover posts using server language labels, including regional variants. Unlabeled posts are hidden when a language is selected; load older posts for more results. Home and Saved keep all languages.
- Likes, comments preserving the parent visibility, content warnings, and canonical publication sharing. Your own comments have a visible **Delete comment** action with confirmation.
- Visible **Edit** and **Delete** controls on your own publications. Editing loads the server's original source, autosaves unpublished changes, and updates the same post with its link and audience preserved. Deletion requires confirmation.
- **Unpublish → Move to drafts** saves the original Markdown locally before deleting the live publication. A failed draft save prevents deletion; a failed deletion leaves the recovery draft available. Republishing creates a new post and link; likes and replies do not transfer.
- Light, dark, and system themes; responsive layout; reading focus mode and full-window **Zen mode** for articles. Zen shows the article body below a slim save/status bar and an always-visible, compact formatting toolbar. Keyboard shortcuts also work. Titles, subtitles, preview/publish controls, and statistics stay out of the writing area; use **Exit Zen** or Escape to return.
- **Note** opens a compact social composer with your avatar, a text box, audience/content-warning settings, autosave status, and a **Note** button. There is no article title, subtitle, toolbar, or preview step. **Write an article** opens the full Markdown editor. Both kinds of draft resume from **Your writing**, and switching between them preserves the current draft.
- Markdown titles, subtitles, headings, emphasis, lists, quotes, links, images by URL, code blocks, dividers, and reading preview. This is a deliberately small Markdown subset, not a full CommonMark implementation.
- Drafts autosave after 300 ms, flush when leaving the editor or hiding the page, and report storage failures. Drafts are scoped to server and account. Continue, delete, and export drafts from **Your writing**.
- **Your writing → Replies** lists your replies and comments, with links back to their conversations and controls to delete your own comments. Load older replies to browse your history. **Published** lists your articles and notes separately.
- The editor labels drafts as **unpublished** and distinguishes **unsaved changes**, **saved at [time] on this device**, and **save failed**. Failed saves retain the draft in the editor.
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

Drafts are device-local, not synchronized across browsers. Export Markdown to back them up. Demo data is fictional and kept separately from live account data. Remote messages are kept in memory rather than persisted in local storage. Timelines and conversations refresh on navigation or explicit refresh; there is no background streaming or push service.

## Code layout

| File              | Responsibility                                                |
| ----------------- | ------------------------------------------------------------- |
| `src/types.ts`    | Domain and API response types                                 |
| `src/api.ts`      | Transport, capabilities, OAuth, rate limits, response mapping |
| `src/markdown.ts` | Escaped Markdown rendering and HTML conversion                |
| `src/storage.ts`  | Defensive browser storage and account-scoped drafts           |
| `src/app.ts`      | Routes, state, feed, reader, library, settings                |
| `src/editor.ts`   | Draft lifecycle, formatting, preview, single-post publishing  |
| `src/messages.ts` | Conversation loading, participants, private replies           |
| `src/ui.ts`       | Shared components, icons, dialogs, notifications              |
| `src/demo.ts`     | Explicitly fictional offline content                          |
| `src/main.ts`     | Event delegation and application startup                      |

TypeScript namespaces compile into one classic script with `tsc --outFile`; ES-module loading is deliberately avoided so opening the distribution from disk remains possible. Styling and local SVG illustrations are original to this project.

Tests cover publishing limits, Markdown escaping, account-scoped drafts, keyboard formatting, API transport, OAuth state/PKCE, file-origin login, rate limiting, DM audiences, view rendering, and static serving. Browser visual QA and authenticated end-to-end actions require a browser session and a real account; the automated tests use mock API responses and do not publish to an account.

## References

The architecture was informed by source review of [Elk's API setup](https://github.com/elk-zone/elk/blob/main/app/composables/masto/masto.ts), [drafts](https://github.com/elk-zone/elk/blob/main/app/composables/masto/statusDrafts.ts), [navigation](https://github.com/elk-zone/elk/blob/main/app/components/nav/NavSide.vue), [Phanpy's authentication](https://github.com/cheeaun/phanpy/blob/main/src/utils/auth.js), and [Pinafore's OAuth flow](https://github.com/nolanlawson/pinafore/blob/master/src/routes/_api/oauth.js). This is an independent implementation, not a fork or a vendor copy of those clients.

API references: [Mastodon OAuth](https://docs.joinmastodon.org/methods/oauth/), [statuses](https://docs.joinmastodon.org/methods/statuses/), [conversations](https://docs.joinmastodon.org/methods/conversations/), [Pleroma extensions](https://docs.pleroma.social/backend/development/API/differences_in_mastoapi_responses/), and [Mastodon's registration rate limit](https://github.com/mastodon/mastodon/blob/main/config/initializers/rack_attack.rb).
