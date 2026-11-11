# Getting started

[Documentation](README.md) · [Fedistack](../README.md)

Install Node.js, npm, and Make, then run:

```sh
make             # same as make dist
make serve       # http://127.0.0.1:8080
make test        # Node's built-in test runner
make check       # strict TypeScript check
```

Make installs the locked npm dependencies, including TypeScript and Highlight.js, on the first build, when either package manifest changes, or if required build files are missing. No separate npm command is needed. The initial install needs access to the npm registry.

On Alpine Linux, install the build tools and create a deployment archive with:

```sh
apk add nodejs npm make zip
make zip         # creates fedistack.zip
```

`make serve PORT=8081` changes the local port. Node 20+ is recommended for development and tests. The browser needs modern DOM, Fetch, Web Crypto, and dialog APIs.

Upload the **contents of `dist/`** to any static HTTP(S) host. Subdirectories work; navigation uses URL hashes and all assets use relative paths. There is no application server, framework, bundler, CDN, external font, or analytics service.

## Default login server

Edit `public/config.js` before running `make`, or edit `config.js` on your static host without rebuilding:

```js
globalThis.FEDISTACK_CONFIG = {
  defaultServer: "social.example.org",
  allowOtherServers: false,
};
```

`defaultServer` accepts an HTTPS instance domain or origin. With `allowOtherServers: true`, it prefills the editable server field. With `false`, sign-in shows **Continue to social.example.org** with no server field or compatibility step. OAuth, manual codes, and token sign-in all use that instance; saved sessions for other instances are ignored and their drafts are kept. A locked site must specify a valid default server.

When Fedistack is hosted on the instance's own HTTPS origin, you can use `defaultServer: location.origin` to use that host automatically. For example, a copy at `https://social.example.org/fedistack/` will sign in to `https://social.example.org`.

`index.html` loads `config.js` with a plain script tag before `app.js`. The app reads `globalThis.FEDISTACK_CONFIG`; it does not fetch or parse a configuration file. Missing settings use the shipped defaults (`defaultServer: ""`, `allowOtherServers: true`), letting users choose any instance. Server URLs are validated when signing in. The restriction controls this client's login flow; it does not change federation or public reading links and is not a server access-control policy.

Serve `config.js` with `Cache-Control: no-cache` so changes take effect on reload. The included local server and Apache `.htaccess` already do this. Each build copies `public/config.js` over `dist/config.js`, so keep permanent settings in `public/config.js` or reapply hosted settings during deployment.

## Mobile and offline use

On iPhone or iPad, open the hosted site in Safari and choose **Share → Add to Home Screen**. Enable **Open as Web App** if offered. The shortcut uses the Fedistack icon and opens in standalone mode. To pick up updated installation metadata, add a new shortcut from the updated site. Pinch and double-tap zoom are disabled for the touch layout; scrolling remains available.

You can also open `dist/index.html` directly. The offline demo, editor, drafts, themes, and local interactions work without a server or network. **Mastodon login and writes require localhost or HTTPS:** browsers send `Origin: null` from `file://`, which Mastodon's CSRF protection rejects with a generic 422. This is an instance restriction a static client cannot override. Use `make serve` for a live Mastodon account. Other compatible servers may allow the manual authorization-code flow from a local file.

Next: [sign in](accounts.md) or explore the [user guide](user-guide.md).
