# Getting started

[Documentation](README.md) · [Fedistack](../README.md)

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

Next: [connect an account](accounts.md) or explore the [user guide](user-guide.md).
