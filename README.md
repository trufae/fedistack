
  <img align=left src="public/assets/favicon.svg" width="96" height="96" alt="Fedistack icon">

**Fedistack** // *Independent voices, connected.*

[![CI](https://github.com/trufae/fedistack/actions/workflows/ci.yml/badge.svg)](https://github.com/trufae/fedistack/actions/workflows/ci.yml)

<h2></h2>
A quiet place to read and write on the fediverse. Follow independent voices, publish your next essay, share a quick note, and keep the conversation going — all with your existing fediverse account.

If you have a [Mastodon](https://mastodon.social/) account all your data will remain there, your credentials in the browser so can try it online at https://radare.org/fedistack

## Make room for good writing

- **Find your next read.** Browse your following, local, and federated feeds. Discover topics and languages, and save favorites for later.
- **Give your ideas space.** Write articles in Markdown, preview before publishing, and settle into Zen mode when you need to focus.
- **Stay in the conversation.** Post notes, reply to readers, follow authors, and browse your direct messages.
- **Keep working at your own pace.** Autosave drafts on your device and sync them to your server, resume on another device, and export Markdown backups. Schedule publications for automatic release.
- **Read comfortably anywhere.** A responsive layout, light and dark themes, and a reading focus mode for phones and desktops.
- **Host it yourself.** A static site with zero runtime dependencies, no analytics, and no application server to maintain.

Fedistack connects to servers with a Mastodon-compatible API. Article publishing needs a server with long-post and rich-text support; other servers can be used for reading and short notes. [Check compatibility →](doc/publishing.md)

## Try it locally

With Node.js and Make installed:

```sh
git clone https://github.com/trufae/fedistack.git
cd fedistack
make && make serve
```

Open **http://127.0.0.1:8080** and choose **Sign in** to use your existing Fediverse account. A clearly labeled preview with fictional stories is available before signing in. Ready to host your own copy? Run `make` and upload the contents of `dist/` to a static host.

## Explore further

- [Getting started and hosting](doc/getting-started.md)
- [Signing in](doc/accounts.md)
- [Reading, writing, and conversations](doc/user-guide.md)
- [Publishing and server compatibility](doc/publishing.md)
- [Development and testing](doc/development.md)
- [SVG icon and PNG / ICO exports](doc/icons.md)
