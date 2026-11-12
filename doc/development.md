# Development

[Documentation](README.md) · [Fedistack](../README.md)

Vanilla TypeScript and handwritten CSS, with Highlight.js for code-block highlighting. TypeScript (7.x) is the only development dependency.

## Build and test

```sh
make check
make test
```

Make installs the locked npm dependencies on the first build and when either package manifest changes, including development dependencies when `NODE_ENV=production`.

`make test` builds the distribution before running Node’s built-in test runner. See [getting started](getting-started.md) for the local server and static hosting.

## Versioning

Fedistack starts at **0.1.0**. `package.json` is the source of truth for the application version. Change its `version` for a release, then run `make test`. Both `make` and `make check` run `scripts/version.mjs` to generate `dist/version.ts`; TypeScript embeds that value in the static bundle and Settings displays it. The generated file is not committed and does not require a runtime fetch, so the version also works offline.

## Code layout

| File              | Responsibility                                                |
| ----------------- | ------------------------------------------------------------- |
| `src/types.ts`    | Domain and API response types                                 |
| `src/api.ts`      | Transport, capabilities, OAuth, rate limits, response mapping |
| `src/markdown.ts` | Escaped Markdown rendering and HTML conversion                |
| `src/link-preview.ts` | Open Graph metadata, cached client lookups, and framed link previews |
| `src/sharing.ts` | Publication metadata in the document head and shared query links |
| `scripts/share-preview.mjs` | Optional crawler HTML, anonymous status fetching, and public-address validation |
| `src/storage.ts`  | Defensive browser storage and account-scoped drafts           |
| `src/server-drafts.ts` | Server draft synchronization and scheduled-post management |
| `src/app.ts`      | Routes, state, feed, reader, library, settings                |
| `src/profile.ts`  | Shared account profiles, paginated activity, people lists, recommendations |
| `src/editor.ts`   | Draft lifecycle, formatting, preview, single-post publishing  |
| `src/editor-input.ts` | Mobile editor viewport, typing preferences, and article-only Vim integration |
| `src/refresh.ts` | Mobile pull-to-refresh gesture and its independent status indicator |
| `public/editor-vim.js` | Standalone textarea Vim modes, motions, selections, and basic editing |
| `src/media.ts`    | Image uploads, attachment management, inline images, alt text and galleries |
| `src/messages.ts` | Conversation loading, participants, private replies           |
| `src/interests.ts` | Hashtag subscriptions, list management, and list membership   |
| `src/ui.ts`       | Shared components, icons, dialogs, notifications              |
| `src/demo.ts`     | Explicitly fictional offline content                          |
| `src/main.ts`     | Event delegation and application startup                      |

TypeScript namespaces compile into classic scripts that share the global `Fedi` namespace. TypeScript 7 removed `--outFile` and `module: none`, so `tsc` emits one plain script per input file into `dist/js/` and `scripts/bundle.mjs` concatenates them, in `tsconfig.json` `files` order, back into the single `dist/app.js` that `index.html` loads. ES-module loading is deliberately avoided so opening the distribution from disk remains possible. `public/editor-vim.js` and the prebuilt common-language script from `@highlightjs/cdn-assets` are copied alongside the bundle and loaded first as separate classic scripts. Highlight.js and its license ship in `dist/`; highlighting requires no CDN or runtime fetch. Styling and local SVG illustrations are original to this project.

Tests cover publishing limits, Markdown escaping, account-scoped drafts, server draft round-trips and conflicts, scheduled publishing and retries, keyboard formatting, API transport, OAuth state/PKCE, file-origin login, rate limiting, DM audiences, view rendering, and static serving. Browser visual QA and authenticated end-to-end actions require a browser session and a real account; the automated tests use mock API responses and do not publish to an account.

## Continuous integration

[CI](../.github/workflows/ci.yml) runs on pushes and pull requests. It installs the locked dependencies on Node 24, checks TypeScript, regenerates the icons, builds the distribution, and runs the tests. The README badge links to this workflow on GitHub.

## Icons

See [icons and exports](icons.md) to edit the SVG and regenerate the PNG and ICO assets. Generated assets are checked in, so ordinary builds need only the npm dependencies.

## References

The architecture was informed by source review of [Elk's API setup](https://github.com/elk-zone/elk/blob/main/app/composables/masto/masto.ts), [drafts](https://github.com/elk-zone/elk/blob/main/app/composables/masto/statusDrafts.ts), [navigation](https://github.com/elk-zone/elk/blob/main/app/components/nav/NavSide.vue), [Phanpy's authentication](https://github.com/cheeaun/phanpy/blob/main/src/utils/auth.js), and [Pinafore's OAuth flow](https://github.com/nolanlawson/pinafore/blob/master/src/routes/_api/oauth.js). This is an independent implementation, not a fork or a vendor copy of those clients.

API references: [Mastodon OAuth](https://docs.joinmastodon.org/methods/oauth/), [statuses](https://docs.joinmastodon.org/methods/statuses/), [conversations](https://docs.joinmastodon.org/methods/conversations/), [followed hashtags](https://docs.joinmastodon.org/methods/followed_tags/), [hashtag subscriptions](https://docs.joinmastodon.org/methods/tags/), [lists](https://docs.joinmastodon.org/methods/lists/), [Pleroma extensions](https://docs.pleroma.social/backend/development/API/differences_in_mastoapi_responses/), and [Mastodon's registration rate limit](https://github.com/mastodon/mastodon/blob/main/config/initializers/rack_attack.rb).

Reading requests use per-view abort controllers. The API client shares relationship reads per account ID, batches at 80, and caches metadata for one minute; successful follow/mute/block mutations supersede older in-flight reads. Suggestions share a pending request and retry failures after one minute (honoring Retry-After). Visible reading uses a single five-second polling timer with freshness checks and failure backoff, rather than a streaming connection.

Mobile pull-to-refresh and polling share the refresh guard and error backoff. Manual refreshes have a five-second cooldown. Feed refreshes fetch only the head page, preserve overlapping older pages, and skip rendering unchanged responses. Discover refreshes check one page from each public timeline, reuse interests and loaded posts, and preserve their order. The pull indicator sits outside the rendered app so gestures and loading feedback do not rebuild page content.

Search uses the [Mastodon v2 search API](https://docs.joinmastodon.org/methods/search/), including all three result categories. Pagination uses separate `type`/`offset` pairs because combined searches ignore `offset`; raw result counts advance cursors before client filtering. Exact hashtag queries use the [tag timeline API](https://docs.joinmastodon.org/methods/timelines/#tag), independent of full-text indexing. `resolve=true` discovers specific accounts or URLs, not arbitrary remote keywords.

Link previews use the server's [PreviewCard](https://docs.joinmastodon.org/entities/PreviewCard/) metadata, including video cards, separately from publication covers. When metadata is missing, the first eligible link gets a client-side Open Graph lookup as it approaches the viewport. Requests omit credentials and referrers, allow three concurrent fetches, stop after the HTML head or 512 KiB, and time out after six seconds. The latest 128 results (including failures) stay in memory across rerenders. Remote markup is parsed in an inert template and only escaped text and safe image URLs are rendered; embeds are never executed.

Because Fedistack is static, direct lookups depend on the destination allowing browser CORS access. Sites that block it, including many social sites, rely on server-provided metadata. YouTube watch, short, live, embed, and youtu.be links also have a thumbnail fallback. Other unavailable previews remain clickable text cards, and broken thumbnails fall back to the card text. No third-party scraping proxy is used. Content warnings suppress previews until revealed.
