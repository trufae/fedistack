<p align="center">
  <img src="public/assets/favicon.svg" width="96" height="96" alt="Fedistack icon">
</p>

# Fedistack

**Independent voices, connected.**

[![CI](https://github.com/trufae/fedistack/actions/workflows/ci.yml/badge.svg)](https://github.com/trufae/fedistack/actions/workflows/ci.yml)

A quiet place to read and write on the fediverse. Follow independent voices, publish your next essay, share a quick note, and keep the conversation going — all with your existing fediverse account.

## Make room for good writing

- **Find your next read.** Browse your following, local, and federated feeds. Discover topics and languages, and save favorites for later.
- **Give your ideas space.** Write articles in Markdown, preview before publishing, and settle into Zen mode when you need to focus.
- **Stay in the conversation.** Post notes, reply to readers, follow authors, and browse your direct messages.
- **Keep working at your own pace.** Autosave drafts on your device, pick them up from Your writing, and export them as Markdown.
- **Read comfortably anywhere.** A responsive layout, light and dark themes, and a reading focus mode for phones and desktops.
- **Host it yourself.** A static site with zero runtime dependencies, no analytics, and no application server to maintain.

Fedistack connects to servers with a Mastodon-compatible API. Article publishing needs a server with long-post and rich-text support; other servers can be used for reading and short notes. [Check compatibility →](doc/publishing.md)

## Try it locally

With Node.js and Make installed:

```sh
git clone https://github.com/trufae/fedistack.git
cd fedistack
npm ci
make serve
```

Open **http://127.0.0.1:8080** to explore the built-in demo, or connect your account. Ready to host your own copy? Run `make` and upload the contents of `dist/` to a static host.

## Explore further

- [Getting started and hosting](doc/getting-started.md)
- [Connecting your account](doc/accounts.md)
- [Reading, writing, and conversations](doc/user-guide.md)
- [Publishing and server compatibility](doc/publishing.md)
- [Development and testing](doc/development.md)
- [SVG icon and PNG / ICO exports](doc/icons.md)
