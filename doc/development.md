# Development

[Documentation](README.md) · [Fedistack](../README.md)

Vanilla TypeScript, handwritten CSS, and zero runtime dependencies. TypeScript is the only development dependency.

## Build and test

```sh
npm ci
make check
make test
```

`make test` builds the distribution before running Node’s built-in test runner. See [getting started](getting-started.md) for the local server and static hosting.

## Versioning

Fedistack starts at **0.1.0**. `package.json` is the source of truth for the application version. Change its `version` for a release, then run `make test`. Both `make` and `make check` run `scripts/version.mjs` to generate `dist/version.ts`; TypeScript embeds that value in the static bundle and Settings displays it. The generated file is not committed and does not require a runtime fetch, so the version also works offline.

## Code layout

| File              | Responsibility                                                |
| ----------------- | ------------------------------------------------------------- |
| `src/types.ts`    | Domain and API response types                                 |
| `src/api.ts`      | Transport, capabilities, OAuth, rate limits, response mapping |
| `src/markdown.ts` | Escaped Markdown rendering and HTML conversion                |
| `src/storage.ts`  | Defensive browser storage and account-scoped drafts           |
| `src/server-drafts.ts` | Server draft synchronization and scheduled-post management |
| `src/app.ts`      | Routes, state, feed, reader, library, settings                |
| `src/profile.ts`  | Shared account profiles, paginated activity, people lists, recommendations |
| `src/editor.ts`   | Draft lifecycle, formatting, preview, single-post publishing  |
| `src/messages.ts` | Conversation loading, participants, private replies           |
| `src/interests.ts` | Hashtag subscriptions, list management, and list membership   |
| `src/ui.ts`       | Shared components, icons, dialogs, notifications              |
| `src/demo.ts`     | Explicitly fictional offline content                          |
| `src/main.ts`     | Event delegation and application startup                      |

TypeScript namespaces compile into one classic script with `tsc --outFile`; ES-module loading is deliberately avoided so opening the distribution from disk remains possible. Styling and local SVG illustrations are original to this project.

Tests cover publishing limits, Markdown escaping, account-scoped drafts, server draft round-trips and conflicts, scheduled publishing and retries, keyboard formatting, API transport, OAuth state/PKCE, file-origin login, rate limiting, DM audiences, view rendering, and static serving. Browser visual QA and authenticated end-to-end actions require a browser session and a real account; the automated tests use mock API responses and do not publish to an account.

## Continuous integration

[CI](../.github/workflows/ci.yml) runs on pushes and pull requests. It installs the locked dependencies on Node 24, checks TypeScript, regenerates the icons, builds the distribution, and runs the tests. The README badge links to this workflow on GitHub.

## Icons

See [icons and exports](icons.md) to edit the SVG and regenerate the PNG and ICO assets. Generated assets are checked in, so ordinary builds need only TypeScript.

## References

The architecture was informed by source review of [Elk's API setup](https://github.com/elk-zone/elk/blob/main/app/composables/masto/masto.ts), [drafts](https://github.com/elk-zone/elk/blob/main/app/composables/masto/statusDrafts.ts), [navigation](https://github.com/elk-zone/elk/blob/main/app/components/nav/NavSide.vue), [Phanpy's authentication](https://github.com/cheeaun/phanpy/blob/main/src/utils/auth.js), and [Pinafore's OAuth flow](https://github.com/nolanlawson/pinafore/blob/master/src/routes/_api/oauth.js). This is an independent implementation, not a fork or a vendor copy of those clients.

API references: [Mastodon OAuth](https://docs.joinmastodon.org/methods/oauth/), [statuses](https://docs.joinmastodon.org/methods/statuses/), [conversations](https://docs.joinmastodon.org/methods/conversations/), [followed hashtags](https://docs.joinmastodon.org/methods/followed_tags/), [hashtag subscriptions](https://docs.joinmastodon.org/methods/tags/), [lists](https://docs.joinmastodon.org/methods/lists/), [Pleroma extensions](https://docs.pleroma.social/backend/development/API/differences_in_mastoapi_responses/), and [Mastodon's registration rate limit](https://github.com/mastodon/mastodon/blob/main/config/initializers/rack_attack.rb).

Reading requests use per-view abort controllers. The API client shares relationship reads per account ID, batches at 80, and caches metadata for one minute; successful follow/mute/block mutations supersede older in-flight reads. Suggestions share a pending request and retry failures after one minute (honoring Retry-After). Visible reading uses a single five-second polling timer with freshness checks and failure backoff, rather than a streaming connection.
