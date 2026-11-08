import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

const bundle = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
    data,
  };
}
function setup(
  fetch = async () => {
    throw new Error("Unexpected network request");
  },
  stores = {},
) {
  const context = vm.createContext({
    URL,
    URLSearchParams,
    Headers,
    Response,
    TextEncoder,
    AbortController,
    crypto: webcrypto,
    btoa,
    atob,
    fetch,
    localStorage: stores.localStorage || storage(),
    sessionStorage: stores.sessionStorage || storage(),
    setTimeout: (...args) => {
      const timer = setTimeout(...args);
      timer.unref();
      return timer;
    },
    clearTimeout,
    location: {
      protocol: "https:",
      origin: "https://reader.example",
      pathname: "/fedistack/",
      hash: "",
      href: "https://reader.example/fedistack/",
      assign(url) {
        this.assigned = url;
      },
    },
    history: { replaceState() {} },
  });
  vm.runInContext(bundle, context);
  return { app: context.Fedi, context };
}
function elements(context) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        innerHTML: "",
        textContent: "",
        dataset: {},
        focus() {},
        querySelectorAll: () => [],
        classList: { toggle() {}, add() {}, remove() {} },
      });
    return nodes.get(id);
  };
  context.document = {
    getElementById: (id) => nodes.get(id) || null,
    querySelector: () => null,
    body: { classList: { toggle() {} } },
    documentElement: { dataset: { theme: "light" } },
    title: "",
  };
  get("app");
  get("toast");
  return { get, nodes };
}
const longServer = {
  maxChars: 11000,
  format: "text/markdown",
  software: "5.0.0+glitch",
};
const article = {
  id: "draft-one",
  title: "An independent publication",
  subtitle: "A place for ideas",
  body: "**Hello**, open web.",
  kind: "article",
  visibility: "public",
  warning: "",
  updated: new Date().toISOString(),
};

function staleCapabilityClient({ formats = ["text/plain", "text/html", "text/markdown"], remember = false, metadata } = {}) {
  const requests = [], localStorage = storage(), sessionStorage = storage();
  const session = {
    server: "https://nyap.example", token: "test-token", account: { id: "me" },
    maxChars: 32768, format: "text/plain", software: "4.2.0+nyap.0.1.0", remember,
  };
  (remember ? localStorage : sessionStorage).setItem("fedistack:session", JSON.stringify(session));
  const info = { version: session.software, configuration: { statuses: {
    max_characters: 32768, supported_mime_types: formats,
  } } };
  const client = setup(async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({ path, ...options });
    if (/^\/api\/v[12]\/instance$/.test(path))
      return metadata ? metadata(path, info) : Response.json(info);
    if (["/api/v1/lists", "/api/v1/scheduled_statuses"].includes(path)) return Response.json([]);
    if (options.method === "POST" && path === "/api/v1/statuses" ||
        options.method === "PUT" && path === "/api/v1/statuses/existing") {
      const body = JSON.parse(options.body);
      if (body.scheduled_at) return Response.json({
        id: "scheduled", scheduled_at: body.scheduled_at, media_attachments: [],
        params: { text: body.status, content_type: body.content_type, visibility: body.visibility },
      });
      return Response.json({
        id: "published", content: body.status, created_at: new Date().toISOString(),
        account: { id: "me", username: "writer", acct: "writer", note: "", avatar: "", url: "https://nyap.example/@writer" },
        visibility: body.visibility || "public", favourites_count: 0, replies_count: 0,
      });
    }
    throw new Error(`Unexpected request: ${options.method} ${path}`);
  }, { localStorage, sessionStorage });
  const { app, context } = client, { get } = elements(context);
  const modal = get("modal");
  modal.querySelector = () => null;
  modal.showModal = () => { modal.open = true; };
  modal.close = () => { modal.open = false; };
  app.htmlToMarkdown = (text) => text;
  app.state.api = new app.API(session.server, session.token);
  app.state.draft = { ...article };
  return { ...client, get, requests };
}

for (const remember of [false, true]) test(`restoring a ${remember ? "remembered" : "tab"} session refreshes stale publishing capabilities`, async () => {
  const { app, context, get, requests } = staleCapabilityClient({ remember });
  const draft = app.state.draft;
  context.document.addEventListener = () => {};
  context.window = { addEventListener() {} };
  context.matchMedia = () => ({ matches: false, addEventListener() {} });
  get("modal").addEventListener = () => {};
  app.route = async () => {};
  await app.boot();
  await new Promise(setImmediate);
  assert.equal(app.state.session.format, "text/markdown");
  assert.equal(app.state.session.maxChars, 32768);
  assert.equal(app.state.session.token, "test-token");
  assert.equal(app.state.draft, draft);
  assert.equal(app.loadSession().format, "text/markdown");
  assert.equal((remember ? context.sessionStorage : context.localStorage).getItem("fedistack:session"), null);
  const metadata = requests.filter((r) => r.path.endsWith("/instance"));
  assert.deepEqual(metadata.map((r) => r.path).sort(), ["/api/v1/instance", "/api/v2/instance"]);
  assert.ok(metadata.every((r) => r.cache === "no-store"));
});

for (const format of ["text/html", "text/markdown"]) test(`a stale plain-text session can review and publish an article as ${format}`, async () => {
  const { app, context, get, requests } = staleCapabilityClient({ formats: ["text/plain", format] });
  app.state.view = "editor";
  const note = { textContent: "Plain text only" };
  context.document.querySelector = (selector) => selector === ".editor-note" ? note : null;
  await app.reviewPublication();
  assert.match(get("modal").innerHTML, /Ready to share your writing/);
  assert.doesNotMatch(get("toast").textContent, /does not advertise/);
  assert.match(note.textContent, format === "text/html" ? /Rich text/ : /Native Markdown/);
  assert.equal(app.getDrafts()[0].body, article.body);
  // Confirmation must also refresh, even if the saved session is stale again.
  app.state.session.format = "text/plain";
  await app.publishDraft();
  const writes = requests.filter((r) => r.method === "POST");
  assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].body);
  assert.equal(body.content_type, format);
  assert.match(body.status, format === "text/html" ? /<h1>An independent publication<\/h1>/ : /^# An independent publication\n/);
  assert.match(body.status, format === "text/html" ? /<strong>Hello<\/strong>/ : /\*\*Hello\*\*/);
  assert.equal(app.state.draft, null);
});

test("publishing an edit refreshes its format before sending the update", async () => {
  const { app, requests } = staleCapabilityClient();
  app.state.draft.editingId = "existing";
  await app.publishDraft();
  const updates = requests.filter((r) => r.method === "PUT");
  assert.equal(updates.length, 1);
  assert.equal(JSON.parse(updates[0].body).content_type, "text/markdown");
  assert.equal(requests.some((r) => r.method === "POST"), false);
});

test("scheduling refreshes stale capabilities both before the dialog and before sending", async () => {
  const { app, get, requests } = staleCapabilityClient();
  await app.scheduleDialog();
  assert.match(get("modal").innerHTML, /Schedule publication/);
  app.state.session.format = "text/plain";
  const time = new Date(Date.now() + 3600000).toISOString();
  await app.scheduleDraft(time);
  const writes = requests.filter((r) => r.method === "POST");
  assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].body);
  assert.equal(body.content_type, "text/markdown");
  assert.equal(body.scheduled_at, time);
  assert.match(body.status, /^# An independent publication\n/);
  assert.equal(app.state.draft, null);
});

test("a server that still advertises only plain text retains the article and sends no publication", async () => {
  const { app, get, requests } = staleCapabilityClient({ formats: ["text/plain"] });
  await app.reviewPublication();
  assert.match(get("toast").textContent, /does not advertise Markdown or HTML/);
  await assert.rejects(app.publishDraft(), /does not advertise Markdown or HTML/);
  assert.equal(requests.some((r) => r.method !== "GET"), false);
  assert.equal(app.getDrafts()[0].body, article.body);
});

test("failed capability refresh preserves cached support and saves the draft before publishing", async () => {
  const { app, requests } = staleCapabilityClient({ metadata: () => new Response(null, { status: 503 }) });
  app.state.session.format = "text/html";
  await assert.rejects(app.publishDraft(), /Could not read this server’s publishing capabilities/);
  assert.equal(app.state.session.format, "text/html");
  assert.equal(app.state.draft.body, article.body);
  assert.equal(app.getDrafts()[0].body, article.body);
  assert.equal(requests.some((r) => r.method !== "GET"), false);
});

test("a capability response after logout cannot restore the session or publish its draft", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const { app, context, requests } = staleCapabilityClient({ metadata: async (_, info) => {
    await waiting;
    return Response.json(info);
  } });
  const publishing = app.publishDraft();
  app.clearSession();
  app.state.api = null;
  app.state.session = null;
  app.state.draft = null;
  release();
  await publishing;
  assert.equal(app.state.session, null);
  assert.equal(app.loadSession(), null);
  assert.equal(context.localStorage.getItem("fedistack:session"), null);
  assert.equal(requests.some((r) => r.method !== "GET"), false);
});

test("repeated publish clicks during capability refresh create one publication", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const { app, requests } = staleCapabilityClient({ metadata: async (_, info) => {
    await waiting;
    return Response.json(info);
  } });
  const first = app.publishDraft();
  await app.publishDraft();
  release();
  await first;
  assert.equal(requests.filter((r) => r.method === "POST").length, 1);
});

test("the distribution uses local classic scripts and assets, with no module/file fetch requirement", () => {
  const html = readFileSync(
    new URL("../dist/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /<script src="app.js" defer>/);
  assert.doesNotMatch(html, /type="module"|https?:\/\//);
  assert.doesNotThrow(() => new vm.Script(bundle));
  assert.doesNotMatch(bundle, /\bimport\s*\(/);
});

test("Markdown renders headings, emphasis, lists, quotes, links, and code blocks", () => {
  const { app } = setup();
  const rendered = app.markdown(
    "# Title\n\n**Bold** and *italic*.\n\n- First\n- Second\n\n> A quote\n\n```\n<script>**code**</script>\n```\n\n[Read](https://example.org)",
  );
  assert.match(rendered, /<h1>Title<\/h1>/);
  assert.match(rendered, /<strong>Bold<\/strong> and <em>italic<\/em>/);
  assert.match(rendered, /<ul><li>First<\/li><li>Second<\/li><\/ul>/);
  assert.match(rendered, /<blockquote>A quote<\/blockquote>/);
  assert.match(
    rendered,
    /<pre><code>&lt;script&gt;\*\*code\*\*&lt;\/script&gt;<\/code><\/pre>/,
  );
  assert.match(rendered, /rel="noopener noreferrer"/);
});

test("Markdown cannot inject executable HTML or unsafe links", () => {
  const { app } = setup();
  for (const source of [
    "<img src=x onerror=alert(1)>",
    "[x](javascript:alert)",
    "![x](data:image/svg+xml,attack)",
    "[x](java&#115;cript:alert)",
    "[x](file:///etc/passwd)",
  ]) {
    const rendered = app.markdown(source);
    assert.doesNotMatch(
      rendered,
      /<img|<script|href="(?:javascript|data|file):/,
    );
  }
  assert.match(app.markdown('[quote](https://example.org/"onclick="x)'), /%22/);
  assert.equal(app.safeURL("https://user:secret@example.org"), "");
  assert.equal(app.safeURL("assets/slow-web.svg", true), "assets/slow-web.svg");
  assert.equal(app.safeURL("../secret.svg", true), "");
});

test("server addresses only allow HTTPS origins without credentials or paths", () => {
  const { app } = setup();
  assert.equal(app.serverURL(" INFOSEC.exchange "), "https://infosec.exchange");
  for (const url of [
    "http://example.org",
    "https://name:secret@example.org",
    "https://example.org/path",
    "https://example.org?token=secret",
  ])
    assert.throws(() => app.serverURL(url));
});

test("the server picker contains no password field and validates the host before token entry", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const modal = get("modal");
  modal.querySelector = () => null;
  modal.showModal = () => { modal.open = true; };
  app.connectDialog();
  const picker = modal.innerHTML;
  assert.doesNotMatch(picker, /type="password"/);
  assert.match(picker, /name="fediverse-server"/);
  assert.doesNotMatch(picker, /name="remember"[^>]*checked/);
  const server = get("fediverse-server");
  server.reportValidity = () => false;
  app.connectTokenDialog();
  assert.equal(modal.innerHTML, picker);
  server.reportValidity = () => true;
  server.value = "https://example.org/unexpected-path";
  assert.throws(() => app.connectTokenDialog());
  assert.equal(modal.innerHTML, picker);
  server.value = " EXAMPLE.org ";
  get("remember-session").checked = true;
  app.connectTokenDialog();
  assert.match(modal.innerHTML, /id="token-connect-form" data-server="https:\/\/example.org"/);
  assert.match(modal.innerHTML, /type="password" name="token" required/);
  assert.doesNotMatch(modal.innerHTML, /name="fediverse-server"/);
  assert.match(modal.innerHTML, /name="remember" checked/);
});

test("server submission starts OAuth while token submission verifies the chosen server", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const listeners = new Map();
  context.document.addEventListener = (name, listener) => listeners.set(name, listener);
  context.window = { addEventListener() {} };
  context.matchMedia = () => ({ matches: false, addEventListener() {} });
  context.FormData = class {
    constructor(form) { return new Map(form.fields); }
  };
  get("modal").addEventListener = () => {};
  app.route = async () => {};
  await app.boot();
  const oauth = [], sessions = [], errors = [];
  app.startOAuth = async (...args) => { oauth.push(args); };
  app.setSession = async (session) => { sessions.push(session); };
  app.formError = (error) => { errors.push(error); };
  app.API.prototype.verify = async function () {
    return { server: this.server, token: this.token };
  };
  const submit = async (id, fields, dataset = {}) => {
    const form = { id, fields, dataset, querySelector: () => null };
    listeners.get("submit")({ target: form, preventDefault() {} });
    await new Promise(setImmediate);
    assert.equal(form.dataset.busy, undefined);
  };
  await submit("connect-form", [
    ["fediverse-server", " EXAMPLE.org "],
    ["manual", "on"],
    ["remember", "on"],
    ["token", "unrelated-autofill"],
  ]);
  assert.deepEqual(oauth, [["EXAMPLE.org", true, true]]);
  assert.equal(sessions.length, 0);
  await submit("token-connect-form", [["token", " application-token "]], {
    server: "https://example.org",
  });
  await submit("token-connect-form", [["token", "remembered-token"], ["remember", "on"]], {
    server: "https://example.org",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(sessions)), [
    { server: "https://example.org", token: "application-token", remember: false },
    { server: "https://example.org", token: "remembered-token", remember: true },
  ]);
  assert.equal(oauth.length, 1);
  assert.deepEqual(errors, []);
});

test("only an opted-in session survives reopening, and switching to temporary sign-in removes it", () => {
  const { app, context } = setup();
  const session = { server: "https://example.org", token: "access", account: { id: "me" } };
  assert.equal(app.saveSession(session), true);
  assert.equal(context.localStorage.getItem("fedistack:session"), null);
  assert.equal(setup(undefined, context).app.state.session.token, "access");
  assert.equal(setup(undefined, { localStorage: context.localStorage }).app.state.session, null);
  assert.equal(app.saveSession({ ...session, remember: true }), true);
  assert.equal(context.sessionStorage.getItem("fedistack:session"), null);
  assert.equal(setup(undefined, { localStorage: context.localStorage }).app.state.session.token, "access");
  assert.equal(app.saveSession({ ...session, token: "temporary", remember: false }), true);
  assert.equal(app.loadSession().token, "temporary");
  assert.equal(setup(undefined, { localStorage: context.localStorage }).app.state.session, null);
});

test("clearing sign-in removes persistent, legacy tab, and pending OAuth data without deleting drafts", () => {
  const { app, context } = setup();
  app.writeStore("session", { token: "persistent" });
  app.writeStore("session", { token: "temporary" }, true);
  app.writeStore("oauth", { verifier: "pending" }, true);
  app.writeStore("drafts:https://example.org:me", [article]);
  app.clearSession();
  assert.equal(app.loadSession(), null);
  assert.equal(context.localStorage.getItem("fedistack:session"), null);
  assert.equal(context.sessionStorage.getItem("fedistack:session"), null);
  assert.equal(context.sessionStorage.getItem("fedistack:oauth"), null);
  assert.equal(app.readStore("drafts:https://example.org:me", [])[0].id, article.id);
});

test("failed sign-in storage does not restore an older account or claim a successful logout", () => {
  const { app, context } = setup();
  app.writeStore("session", { token: "old-account", remember: true });
  context.localStorage.setItem = () => { throw new Error("Storage full"); };
  assert.equal(app.saveSession({ token: "new-account", remember: true }), false);
  assert.equal(app.loadSession(), null);
  context.localStorage.removeItem = () => { throw new Error("Storage unavailable"); };
  app.writeStore("session", { token: "temporary" }, true);
  assert.throws(() => app.clearSession(), /Could not clear saved sign-in/);
  assert.equal(context.sessionStorage.getItem("fedistack:session"), null);
});

test("infosec.exchange and Akkoma capabilities enable single long Markdown publications", () => {
  const { app } = setup();
  const glitch = app.detectCapabilities(undefined, {
    version: "5.0.0-alpha.2+glitch",
    max_toot_chars: 11000,
    configuration: {
      statuses: {
        max_characters: 11000,
        supported_mime_types: ["text/plain", "text/markdown", "text/html"],
      },
    },
  });
  assert.equal(glitch.maxChars, 11000);
  assert.equal(glitch.format, "text/markdown");
  assert.equal(app.supportsArticles(glitch), true);
  const akkoma = app.detectCapabilities(
    { configuration: { statuses: { max_characters: 10000 } } },
    {
      pleroma: { metadata: { post_formats: ["text/plain", "text/markdown"] } },
    },
  );
  assert.equal(app.supportsArticles(akkoma), true);
  assert.equal(
    app.supportsArticles(
      app.detectCapabilities({
        configuration: { statuses: { max_characters: 500 } },
      }),
    ),
    false,
  );
});

test("publication validation never splits or truncates an oversized article", () => {
  const { app } = setup();
  assert.equal(app.publishProblem(article, longServer), "");
  assert.match(
    app.publishProblem({ ...article, body: "x".repeat(11001) }, longServer),
    /Shorten it or export/,
  );
  assert.match(
    app.publishProblem(article, { maxChars: 500, format: "text/plain" }),
    /5,000/,
  );
  const payload = app.publicationPayload(article, "text/markdown");
  assert.equal(
    payload,
    "# An independent publication\n\nA place for ideas\n\n**Hello**, open web.",
  );
  assert.equal(
    app.publicationPayload(article, "text/html"),
    app.markdown(payload),
  );
});

test("publication limits count Unicode code points and content warnings", () => {
  const { app } = setup();
  const post = {
    ...article,
    kind: "post",
    body: "🌱".repeat(500),
    warning: "",
  };
  assert.equal(
    app.publishProblem(post, { maxChars: 500, format: "text/plain" }),
    "",
  );
  assert.match(
    app.publishProblem(
      { ...post, warning: "CW" },
      { maxChars: 500, format: "text/plain" },
    ),
    /502/,
  );
});

test("a 32K server without rich text reports a format requirement, not a length limit", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const capabilities = app.detectCapabilities({
    configuration: { statuses: { max_characters: 32768 } },
  });
  app.state.session = capabilities;
  app.state.draft = { ...article, title: "Title", subtitle: "", body: "x".repeat(907) };
  get("character-count");
  app.updateEditorMeta();
  assert.equal(get("character-count").textContent, "914 / 32,768 characters");
  const problem = app.publishProblem(app.state.draft, capabilities);
  assert.match(problem, /32,768/);
  assert.match(problem, /does not advertise Markdown or HTML publishing/);
  assert.doesNotMatch(problem, /5,000|Shorten/);
  assert.equal(app.supportsArticles(capabilities), false);
  assert.equal(app.publishProblem({ ...app.state.draft, kind: "post" }, capabilities), "");
  for (const format of ["text/markdown", "text/html"]) {
    assert.equal(app.supportsArticles({ ...capabilities, format }), true);
    assert.equal(app.publishProblem(app.state.draft, { ...capabilities, format }), "");
  }
});

test("drafts survive reload and are isolated by server and account", () => {
  const { app, context } = setup();
  assert.equal(app.saveDraft(article), true);
  assert.equal(app.getDrafts()[0].body, article.body);
  app.state.session = { server: "https://one.example", account: { id: "1" } };
  assert.equal(app.getDrafts().length, 0);
  app.saveDraft({ ...article, body: "Account one" });
  app.state.session = { server: "https://two.example", account: { id: "1" } };
  assert.equal(app.getDrafts().length, 0);
  app.state.session = null;
  assert.equal(app.getDrafts()[0].body, article.body);
  app.removeDraft(article.id);
  assert.equal(app.getDrafts().length, 0);
  context.localStorage.setItem("fedistack:drafts:demo", "{broken");
  assert.equal(app.getDrafts().length, 0);
});

test("storage failures are reported instead of claiming a draft was saved", () => {
  const { app, context } = setup();
  context.localStorage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  assert.equal(app.saveDraft(article), false);
  assert.equal(app.writeStore("test", { value: 1 }), false);
});

test("requests never send credentials to foreign pagination origins", async () => {
  let calls = 0;
  const { app } = setup(async () => {
    calls++;
    return Response.json([]);
  });
  const api = new app.API("https://good.example", "private-token");
  await assert.rejects(
    api.get("https://evil.example/api/v1/statuses"),
    /unsafe API URL/,
  );
  await assert.rejects(
    api.get("https://name:pass@good.example/api/v1/statuses"),
    /unsafe API URL/,
  );
  assert.equal(calls, 0);
});

test("API calls omit cookies, disallow redirects, and preserve pagination links", async () => {
  let options;
  const { app } = setup(async (_url, init) => {
    options = init;
    return Response.json([], {
      headers: {
        Link: '<https://good.example/api/v1/timelines/home?max_id=10>; rel="next"',
      },
    });
  });
  const result = await new app.API("good.example", "private-token").request(
    "/api/v1/timelines/home",
  );
  assert.equal(options.headers.Authorization, "Bearer private-token");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.match(result.next, /max_id=10/);
});

test("422 errors retain endpoint and structured validation details", async () => {
  const { app } = setup(async () =>
    Response.json(
      {
        error: "Validation failed",
        details: {
          redirect_uris: [
            { error: "invalid", description: "Callback URL is not allowed" },
          ],
        },
      },
      { status: 422 },
    ),
  );
  await assert.rejects(
    new app.API("example.org").post("/api/v1/apps", {}),
    (error) => {
      assert.equal(error.status, 422);
      assert.match(error.message, /POST \/api\/v1\/apps \(422\)/);
      assert.match(error.message, /Callback URL is not allowed/);
      return true;
    },
  );
});

test("rate limiting honors server reset headers and blocks repeated clicks", async () => {
  let calls = 0;
  const reset = Date.now() + 120000;
  const { app } = setup(async () => {
    calls++;
    return Response.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "X-RateLimit-Reset": new Date(reset).toISOString() },
      },
    );
  });
  const api = new app.API("infosec.exchange");
  await assert.rejects(
    api.post("/api/v1/apps", {}),
    (error) => error.retryAt === reset,
  );
  await assert.rejects(api.post("/api/v1/apps", {}), /Try again after/);
  assert.equal(calls, 1);
  assert.equal(
    app.rateLimitTime(
      new Headers({ "Retry-After": "30" }),
      "/api/v1/apps",
      1000,
    ),
    31000,
  );
  assert.equal(app.rateLimitTime(new Headers(), "/api/v1/apps", 1000), 601000);
});

test("file-origin Mastodon login is stopped before it consumes an app registration", async () => {
  const requests = [];
  const { app, context } = setup(async (url, options) => {
    requests.push([url, options.method]);
    return Response.json({
      version: "5.0.0-alpha.2+glitch",
      configuration: {
        statuses: {
          max_characters: 11000,
          supported_mime_types: ["text/markdown"],
        },
      },
    });
  });
  context.location.protocol = "file:";
  await assert.rejects(app.startOAuth("infosec.exchange"), /make serve/);
  assert.ok(requests.every(([, method]) => method === "GET"));
});

test("OAuth registration is form encoded, cached, and bound to PKCE and state", async () => {
  const requests = [];
  const { app, context } = setup(async (url, options) => {
    requests.push({ url, options });
    return Response.json({
      client_id: "client-test",
      client_secret: "secret-test",
    });
  });
  await app.startOAuth("infosec.exchange");
  assert.equal(requests.length, 1);
  assert.match(
    requests[0].options.headers["Content-Type"],
    /application\/x-www-form-urlencoded/,
  );
  const body = new URLSearchParams(requests[0].options.body);
  assert.equal(body.get("client_name"), "Fedistack");
  assert.equal(body.get("redirect_uris"), "https://reader.example/fedistack/");
  assert.equal(body.get("scopes"), "read write");
  const authorization = new URL(context.location.assigned);
  const pending = app.readStore("oauth", null, true);
  assert.equal(pending.remember, false);
  assert.equal(authorization.searchParams.get("state"), pending.state);
  const digest = await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(pending.verifier),
  );
  assert.equal(
    authorization.searchParams.get("code_challenge"),
    Buffer.from(digest).toString("base64url"),
  );
  assert.equal(context.localStorage.getItem("fedistack:oauth"), null);
  await app.startOAuth("infosec.exchange", false, true);
  assert.equal(app.readStore("oauth", null, true).remember, true);
  assert.equal(
    requests.length,
    1,
    "Repeated sign-in reuses the registered app",
  );
});

test("OAuth does not automatically retry rejected app registrations", async () => {
  let calls = 0;
  const { app } = setup(async () => {
    calls++;
    return Response.json({ error: "Unprocessable Content" }, { status: 422 });
  });
  await assert.rejects(app.startOAuth("example.org"), /422/);
  assert.equal(calls, 1);
});

test("OAuth rejects mismatched state without making a token request", async () => {
  let calls = 0;
  const { app } = setup(async () => {
    calls++;
    return Response.json({});
  });
  app.writeStore(
    "oauth",
    {
      server: "https://example.org",
      state: "expected",
      redirect: "https://reader.example/",
      created: Date.now(),
    },
    true,
  );
  await assert.rejects(
    app.finishOAuth("authorization-code", "different"),
    /could not be verified/,
  );
  assert.equal(calls, 0);
  assert.equal(app.readStore("oauth", null, true), null);
});

test("OAuth token exchange keeps the exact callback and code verifier", async () => {
  let request;
  const { app } = setup(async (url, options) => {
    request = { url, options };
    return Response.json({ access_token: "test-access" });
  });
  app.writeStore(
    "oauth",
    {
      server: "https://example.org",
      state: "expected",
      redirect: "https://reader.example/fedistack/",
      verifier: "test-verifier",
      client_id: "client",
      client_secret: "secret",
      created: Date.now(),
      remember: true,
    },
    true,
  );
  app.API.prototype.verify = async () => ({ account: { id: "me" } });
  const session = await app.finishOAuth("authorization-code", "expected");
  assert.equal(session.remember, true);
  const body = new URLSearchParams(request.options.body);
  assert.equal(body.get("redirect_uri"), "https://reader.example/fedistack/");
  assert.equal(body.get("code_verifier"), "test-verifier");
  assert.equal(body.get("code"), "authorization-code");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(app.readStore("oauth", null, true), null);
});

test("manual OAuth keeps the remember choice through authorization without persisting the pending credentials", async () => {
  for (const remember of [false, true]) {
    const { app, context } = setup(async (url) =>
      Response.json(url.endsWith("/api/v1/apps")
        ? { client_id: "client", client_secret: "secret" }
        : { access_token: "access" }),
    );
    app.showModal = () => {};
    app.API.prototype.verify = async () => ({ account: { id: "me" } });
    await app.startOAuth("example.org", true, remember);
    assert.equal(context.localStorage.getItem("fedistack:oauth"), null);
    const session = await app.finishOAuth("manual-code");
    assert.equal(session.remember, remember);
    assert.equal(context.sessionStorage.getItem("fedistack:oauth"), null);
  }
});

test("DM contexts only accept direct messages with the exact participant set", () => {
  const { app } = setup();
  const accounts = [{ id: "alice" }];
  assert.equal(
    app.sameAudience(
      { visibility: "direct", audience: ["alice", "me"] },
      accounts,
      "me",
    ),
    true,
  );
  assert.equal(
    app.sameAudience(
      { visibility: "public", audience: ["alice", "me"] },
      accounts,
      "me",
    ),
    false,
  );
  assert.equal(
    app.sameAudience(
      { visibility: "direct", audience: ["alice", "me", "other"] },
      accounts,
      "me",
    ),
    false,
  );
  assert.equal(
    app.sameAudience({ visibility: "direct" }, accounts, "me"),
    false,
  );
});

test("DM sending cannot add a recipient through an unexpected mention", async () => {
  let calls = 0;
  const { app } = setup();
  app.state.api = {
    createStatus: async () => {
      calls++;
    },
  };
  app.state.session = { account: { id: "me" }, maxChars: 11000 };
  app.state.conversations = [
    {
      id: "conversation",
      accounts: [{ id: "alice", acct: "alice@example.org" }],
      messages: [],
    },
  ];
  await assert.rejects(
    app.sendMessage("conversation", "Hello @outsider@another.example"),
    /outside this conversation/,
  );
  assert.equal(calls, 0);
});

test("all major views render using only bundled data", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.state.posts = app.demoPosts;
  app.state.conversations = app.initialConversations();
  app.state.reading = app.demoPosts[0];
  app.state.draft = { ...article };
  for (const view of [
    "home",
    "discover",
    "bookmarks",
    "drafts",
    "editor",
    "messages",
    "settings",
    "reader",
  ]) {
    app.state.view = view;
    app.render();
    assert.match(get("app").innerHTML, /<main id="main"/);
    assert.doesNotMatch(get("app").innerHTML, /\bundefined\b/);
  }
});

function imageRenderFixture() {
  const { app, context } = setup();
  const image = (src, key = "author", extra = {}) => {
    const attributes = { src, ...extra };
    if (key !== null) attributes["data-avatar-key"] = key;
    return {
      mutations: [],
      get src() { return this.getAttribute("src"); },
      get key() { return this.getAttribute("data-avatar-key"); },
      get attributes() {
        return Object.entries(attributes).map(([name, value]) => ({ name, value }));
      },
      getAttribute(name) { return attributes[name] ?? null; },
      hasAttribute(name) { return name in attributes; },
      setAttribute(name, value) {
        this.mutations.push(name);
        attributes[name] = value;
      },
      removeAttribute(name) {
        this.mutations.push(name);
        delete attributes[name];
      },
      replaceWith(previous) {
        // Replacement must happen in the live document, not the inert template.
        assert.equal(root.images.includes(this), true);
        root.images[root.images.indexOf(this)] = previous;
      },
    };
  };
  const select = (images, selector) => {
    assert.equal(selector, "img");
    return images;
  };
  const root = {
    images: [],
    querySelectorAll(selector) { return select(this.images, selector); },
    replaceChildren(content) { this.images = [...content.images]; },
  };
  const content = {
    images: [],
    querySelectorAll(selector) { return select(this.images, selector); },
  };
  context.document = {
    createElement(tag) {
      assert.equal(tag, "template");
      return { content };
    },
  };
  return { app, root, content, image };
}

test("rerenders retain each avatar image without resetting its source or loading state", () => {
  const { app, root, content, image } = imageRenderFixture();
  const first = image("https://example.org/avatar.png");
  const duplicate = image(first.src);
  const other = image("https://example.org/other.png");
  first.complete = true;
  duplicate.complete = false;
  root.images = [first, duplicate, other];
  const placeholders = [image(other.src), image(first.src), image(first.src)];
  content.images = placeholders;

  app.renderHTML(root, "updated posts and follow buttons");
  assert.deepEqual(root.images, [other, first, duplicate]);
  assert.equal(first.src, "https://example.org/avatar.png");
  assert.equal(duplicate.src, first.src);
  assert.equal(first.complete, true);
  assert.equal(duplicate.complete, false);
  assert.ok(placeholders.every((placeholder) => placeholder.src === null));

  content.images = root.images.map((old) => image(old.src));
  app.renderHTML(root, "late list response");
  assert.deepEqual(root.images, [other, first, duplicate]);
});

test("new and changed avatar URLs load normally and removed images are not cached", () => {
  const { app, root, content, image } = imageRenderFixture();
  const previous = image("https://example.org/old.png");
  const changed = image("https://example.org/new.png");
  const additional = image(changed.src);
  root.images = [previous];
  content.images = [changed, additional];
  app.renderHTML(root, "changed avatar plus another appearance");
  assert.deepEqual(root.images, [changed, additional]);
  assert.equal(changed.src, "https://example.org/new.png");
  assert.equal(additional.src, changed.src);

  const returning = image(previous.src);
  content.images = [image(changed.src), returning];
  app.renderHTML(root, "a previously removed avatar returns");
  assert.deepEqual(root.images, [changed, returning]);
  assert.notEqual(root.images[1], previous);
});

test("appending another post by the same author keeps the suggestion avatar in its own slot", () => {
  const { app, root, content, image } = imageRenderFixture();
  const src = "https://example.org/avatar.png";
  const firstPost = image(src, "post:first");
  const suggestion = image(src, "suggested:author");
  const newPost = image(src, "post:second");
  root.images = [firstPost, suggestion];
  content.images = [image(src, firstPost.key), newPost, image(src, suggestion.key)];
  app.renderHTML(root, "another post before the suggestions panel");
  assert.deepEqual(root.images, [firstPost, newPost, suggestion]);
  assert.equal(newPost.src, src);
});

test("rerenders retain logos, covers, thumbnails, and duplicate inline images", () => {
  const { app, root, content, image } = imageRenderFixture();
  const logo = image("assets/favicon.svg", null);
  const cover = image("https://example.org/cover.png", null, { class: "feature-cover" });
  const thumbnail = image("https://example.org/thumbnail.png", null, { class: "thumbnail", loading: "lazy" });
  const inline = image(cover.src, null, { loading: "lazy", referrerpolicy: "no-referrer" });
  const duplicate = image(inline.src, null, { loading: "lazy", referrerpolicy: "no-referrer" });
  const avatar = image(cover.src);
  cover.complete = true;
  thumbnail.complete = false;
  root.images = [logo, cover, thumbnail, inline, duplicate, avatar];
  const reordered = [logo, thumbnail, inline, duplicate, avatar, cover];
  const placeholders = reordered.map((old) => image(old.src, old.key,
    Object.fromEntries(old.attributes.map(({ name, value }) => [name, value]))));
  content.images = placeholders;

  app.renderHTML(root, "updated feed with inline images");
  assert.deepEqual(root.images, reordered);
  assert.equal(cover.complete, true);
  assert.equal(thumbnail.complete, false);
  assert.ok(reordered.every((old) => old.mutations.length === 0));
  assert.ok(placeholders.every((placeholder) => placeholder.src === null));
});

test("retained covers update presentation and alt text without rewriting their source", () => {
  const { app, root, content, image } = imageRenderFixture();
  const src = "https://example.org/cover.png";
  const cover = image(src, null, {
    "data-image-key": "cover:first", class: "thumbnail", alt: "Old description", loading: "lazy",
  });
  const other = image(src, null, { "data-image-key": "cover:second", class: "thumbnail" });
  const reader = image(src, null, { "data-image-key": "cover:first", class: "reader-cover", alt: "New description", width: "800" });
  const newCover = image(src, null, { "data-image-key": "cover:third", class: "thumbnail" });
  root.images = [cover, other];
  content.images = [newCover, image(src, null, { "data-image-key": "cover:second", class: "thumbnail" }), reader];

  app.renderHTML(root, "another cover followed by the reader");
  assert.deepEqual(root.images, [newCover, other, cover]);
  assert.equal(cover.getAttribute("class"), "reader-cover");
  assert.equal(cover.getAttribute("alt"), "New description");
  assert.equal(cover.getAttribute("width"), "800");
  assert.equal(cover.hasAttribute("loading"), false);
  assert.equal(cover.src, src);
  assert.equal(cover.mutations.includes("src"), false);
  assert.deepEqual(other.mutations, []);
  assert.equal(newCover.src, src);
});

test("changed image sources and request attributes use new images", () => {
  for (const [name, value] of Object.entries({
    src: "https://example.org/new.png", srcset: "https://example.org/large.png 2x",
    sizes: "100vw", crossorigin: "anonymous", referrerpolicy: "no-referrer",
  })) {
    const { app, root, content, image } = imageRenderFixture();
    const old = image("https://example.org/old.png", null);
    const changed = image(old.src, null, { [name]: value });
    root.images = [old];
    content.images = [changed];
    app.renderHTML(root, "updated image request");
    assert.equal(root.images[0], changed, name);
    assert.equal(changed.getAttribute(name), value);

    const returning = image(old.src, null);
    content.images = [returning];
    app.renderHTML(root, "previously removed image returns");
    assert.equal(root.images[0], returning);
  }
});

test("retaining responsive images leaves their sources untouched and disables placeholder requests", () => {
  const { app, root, content, image } = imageRenderFixture();
  const src = "https://example.org/small.png";
  const extra = { srcset: "https://example.org/large.png 2x", sizes: "100vw" };
  const old = image(src, null, extra);
  const placeholder = image(src, null, extra);
  root.images = [old];
  content.images = [placeholder];
  app.renderHTML(root, "updated text around a responsive image");
  assert.equal(root.images[0], old);
  assert.deepEqual(old.mutations, []);
  assert.equal(placeholder.src, null);
  assert.equal(placeholder.hasAttribute("srcset"), false);
});

test("opening and leaving a chat switches the viewport layout and keeps its draft", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const classes = new Map();
  context.document.body.classList.toggle = (name, enabled) => classes.set(name, enabled);
  app.state.view = "messages";
  app.state.conversations = app.initialConversations();
  app.render();
  assert.equal(classes.get("conversation-open"), false);
  assert.match(get("app").innerHTML, /data-action="new-message"/);

  app.state.conversation = app.state.conversations[0].id;
  get("message-body").value = "A draft to finish later";
  app.rememberMessage();
  app.state.error = "Could not refresh messages";
  app.render();
  const chat = get("app").innerHTML;
  assert.equal(classes.get("conversation-open"), true);
  assert.doesNotMatch(chat, /data-action="new-message"|KEEP THE CONVERSATION GOING|A little more personal/);
  assert.match(chat, /href="#messages"[^>]*aria-label="All conversations"/);
  assert.match(chat, /id="message-body"[^>]*>A draft to finish later<\/textarea>/);
  assert.ok(chat.indexOf('role="alert"') > chat.indexOf('id="message-thread"'));
  assert.ok(chat.indexOf('role="alert"') < chat.indexOf('id="message-form"'));

  app.state.conversation = "";
  app.render();
  assert.equal(classes.get("conversation-open"), false);
  assert.match(get("app").innerHTML, /data-action="new-message"/);
  app.state.conversation = app.state.conversations[0].id;
  app.state.view = "home";
  app.render();
  assert.equal(classes.get("conversation-open"), false);
});

test("keyboard viewport changes keep the latest message visible without interrupting history reading", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  context.window = {};
  assert.doesNotThrow(() => app.updateConversationViewport());

  const thread = get("message-thread");
  thread.scrollHeight = 1800;
  thread.clientHeight = 600;
  let scrollTop = 1200;
  Object.defineProperty(thread, "scrollTop", {
    get: () => scrollTop,
    set: (value) => { scrollTop = Math.min(value, thread.scrollHeight - thread.clientHeight); },
  });
  const styles = new Map();
  context.document.documentElement.style = {
    setProperty(name, value) {
      styles.set(name, value);
      if (name === "--conversation-height") thread.clientHeight = parseFloat(value) - 200;
    },
  };
  context.window.visualViewport = { height: 500, offsetTop: 40 };
  app.updateConversationViewport();
  assert.equal(styles.get("--conversation-height"), "500px");
  assert.equal(styles.get("--conversation-top"), "40px");
  assert.equal(thread.scrollTop, 1500);

  // Reading an earlier message must not jump to the newest one on a resize.
  thread.scrollTop = 100;
  context.window.visualViewport = { height: 450, offsetTop: 60 };
  app.updateConversationViewport();
  assert.equal(thread.scrollTop, 100);

  thread.scrollTop = thread.scrollHeight;
  context.window.visualViewport = { height: 800, offsetTop: 0 };
  app.updateConversationViewport();
  assert.equal(styles.get("--conversation-top"), "0px");
  assert.equal(thread.scrollTop, 1200);
});

test("content warnings keep publication body and imagery out of the initial card", () => {
  const { app } = setup();
  const post = {
    ...app.demoPosts[0],
    warning: "Sensitive topic",
    title: "PRIVATE TITLE",
    markdown: "PRIVATE BODY",
    image: "https://example.org/private.jpg",
  };
  const output = app.postCard(post, true);
  assert.match(output, /Sensitive topic/);
  assert.doesNotMatch(output, /PRIVATE TITLE|PRIVATE BODY|private.jpg/);
  app.state.revealed.add(post.id);
  assert.match(app.postCard(post, true), /PRIVATE TITLE/);
});

test("editor keyboard formatting changes the selection and retains the draft", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.state.draft = { ...article, body: "hello world" };
  app.state.view = "editor";
  const textarea = get("draft-body");
  Object.assign(textarea, {
    id: "draft-body",
    value: "hello world",
    selectionStart: 6,
    selectionEnd: 11,
    focus() {},
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
    },
  });
  get("modal").open = false;
  context.document.activeElement = textarea;
  let prevented = false;
  app.editorKeydown({
    key: "b",
    ctrlKey: true,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(textarea.value, "hello **world**");
  assert.equal(app.state.draft.body, "hello **world**");
  assert.equal(app.flushDraft(), true);
  assert.equal(app.getDrafts()[0].body, "hello **world**");
});

test("leaving and deleting a draft does not resurrect it on the next save", async () => {
  const { app, context } = setup();
  elements(context);
  app.state.view = "editor";
  app.state.draft = { ...article };
  context.location.hash = "#settings";
  await app.route();
  assert.equal(app.state.draft, null);
  app.removeDraft(article.id);
  app.flushDraft();
  assert.equal(app.getDrafts().length, 0);
});

test("an unsaved draft stays in the editor if storage fails during navigation", async () => {
  const { app, context } = setup();
  elements(context);
  app.state.view = "editor";
  app.state.draft = { ...article };
  context.localStorage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  context.location.hash = "#settings";
  await app.route();
  assert.equal(app.state.view, "editor");
  assert.equal(app.state.draft.body, article.body);
});

test("erasing an entire saved draft removes the stale stored text", () => {
  const { app, context } = setup();
  elements(context);
  app.saveDraft(article);
  app.state.draft = { ...article, title: "", subtitle: "", body: "" };
  assert.equal(app.flushDraft(), true);
  assert.equal(app.getDrafts().length, 0);
});

test("DM recipient checks also catch mentions adjacent to punctuation", async () => {
  const { app } = setup();
  app.state.api = {
    createStatus: async () => {
      throw new Error("Must not send");
    },
  };
  app.state.session = { account: { id: "me" }, maxChars: 11000 };
  app.state.conversations = [
    {
      id: "one",
      accounts: [{ id: "alice", acct: "alice@example.org" }],
      messages: [],
    },
  ];
  for (const text of [
    "hello (@outsider@elsewhere.org)",
    "hi >@outsider",
    "**@outsider@elsewhere.org**",
  ]) {
    await assert.rejects(
      app.sendMessage("one", text),
      /outside this conversation/,
    );
  }
});

test("the editor distinguishes an unpublished draft, a saved draft, and a failed save", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.state.draft = { ...article };
  assert.match(app.editorView(), /Draft · unpublished/);
  assert.match(app.editorView(), /Unsaved changes/);
  get("save-status");
  assert.equal(app.flushDraft(), true);
  assert.equal(get("save-status").dataset.state, "saved");
  assert.match(get("save-status").textContent, /Saved at .*this device/);
  assert.match(app.editorView(), /data-state="saved"/);
  context.localStorage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  app.state.draft.body = "Changed text";
  assert.equal(app.flushDraft(), false);
  assert.equal(get("save-status").dataset.state, "error");
  assert.match(get("save-status").textContent, /Save failed/);
});

test("publication management controls are visible only on the current user's publications", () => {
  const { app } = setup();
  const own = { ...app.demoPosts[0], author: app.demoMe };
  assert.match(app.postActions(own), /data-action="edit-publication"/);
  assert.match(app.postActions(own), /data-action="delete-publication"/);
  assert.match(app.postActions(own), /data-action="unpublish-publication"/);
  assert.doesNotMatch(
    app.postActions(app.demoPosts[0]),
    /data-action="(?:edit|delete|unpublish)-publication"/,
  );
});

test("editing an article reconstructs its original Markdown without losing its subtitle", () => {
  const { app } = setup();
  const source = "# Title\n\nA subtitle\n\n## Section\n\n**Full article**.";
  const draft = app.draftFromSource(
    { ...app.demoPosts[0], id: "original", visibility: "private" },
    { text: source, spoiler_text: "A warning", content_type: "text/markdown" },
  );
  assert.equal(draft.editingId, "original");
  assert.equal(draft.visibility, "private");
  assert.equal(draft.warning, "A warning");
  assert.equal(app.draftMarkdown(draft), source);
});

test("edits use PUT and deletes use DELETE for the original status", async () => {
  const requests = [];
  const account = {
    id: "me",
    username: "writer",
    display_name: "Writer",
    acct: "writer",
    avatar: "",
    note: "",
    url: "https://example.org/@writer",
  };
  const { app } = setup(async (url, options) => {
    requests.push({ url, options });
    return Response.json({
      id: "original",
      account,
      content: "Edited body",
      created_at: new Date().toISOString(),
      favourites_count: 5,
      replies_count: 2,
      visibility: "private",
      spoiler_text: "",
      url: "https://example.org/@writer/original",
    });
  });
  // DOM conversion is tested at the renderer boundary; this test checks the wire protocol.
  app.htmlToMarkdown = (text) => text;
  const api = new app.API("example.org", "test-token");
  const post = await api.editStatus(
    "original",
    "# New title\n\nBody",
    "Warning",
    "text/markdown",
  );
  assert.equal(post.id, "original");
  assert.equal(post.likes, 5);
  assert.equal(post.visibility, "private");
  assert.equal(requests[0].options.method, "PUT");
  assert.equal(requests[0].url, "https://example.org/api/v1/statuses/original");
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.content_type, "text/markdown");
  assert.equal(payload.spoiler_text, "Warning");
  assert.equal(Object.hasOwn(payload, "visibility"), false);
  await api.deleteStatus("original");
  assert.equal(requests[1].options.method, "DELETE");
  assert.equal(requests[1].url, requests[0].url);
});

async function postActionFixture(fetch) {
  const { app, context } = setup(fetch);
  const { get } = elements(context);
  const listeners = new Map();
  context.document.addEventListener = (name, listener) => listeners.set(name, listener);
  context.window = { addEventListener() {} };
  context.matchMedia = () => ({ matches: false, addEventListener() {} });
  get("modal").addEventListener = () => {};
  const route = app.route;
  app.route = async () => {};
  await app.boot();
  app.route = route;
  app.htmlToMarkdown = (text) => text;
  const click = (id, action = "repost") => {
    const button = { dataset: { action, id }, disabled: false };
    listeners.get("click")({ target: { closest: () => button } });
    return button;
  };
  return { app, context, get, click };
}

test("Share copies the current Fedistack reader link and keeps the original separately accessible", async () => {
  const { app, context, get, click } = await postActionFixture();
  const post = { ...app.demoPosts[0], author: { ...app.demoAuthors[0], acct: "writer@author.example" }, id: "remote/id", url: "https://author.example/@writer/original" };
  app.state.posts = [post];
  app.state.api = new app.API("https://social.example", "private-token");
  context.location.href = "https://reader.example/custom/path/?code=secret&state=secret#home";
  let copied, dialog;
  context.navigator = { clipboard: { writeText: async (text) => { copied = text; } } };
  click(post.id, "share");
  await new Promise(setImmediate);
  const link = new URL(copied);
  assert.equal(link.origin, "https://reader.example");
  assert.equal(link.pathname, "/custom/path/");
  assert.equal(link.search, "");
  assert.equal(link.hash, "#@writer/remote%2Fid?server=https%3A%2F%2Fsocial.example");
  assert.doesNotMatch(copied, /secret|private-token|author\.example/);
  assert.match(get("toast").textContent, /Fedistack reading link copied/);
  assert.match(app.postActions(post), /href="https:\/\/author.example\/@writer\/original"[^>]*aria-label="Open original post"/);

  context.navigator.clipboard.writeText = async () => { throw new Error("Clipboard denied"); };
  app.showModal = (title, body) => { dialog = { title, body }; };
  click(post.id, "share");
  await new Promise(setImmediate);
  assert.match(dialog.body, /Fedistack reading link/);
  assert.ok(dialog.body.includes(app.escapeHTML(copied)));
  assert.ok(dialog.body.includes(post.url));
  assert.match(dialog.body, /Open original/);
});

function sharedStatus(overrides = {}) {
  return {
    id: "slow-web",
    account: { id: "you", username: "writer", display_name: "Remote writer", acct: "writer", avatar: "", note: "", url: "https://source.example/@writer" },
    content: "# Shared article\n\nA **formatted** post.",
    created_at: new Date().toISOString(),
    favourites_count: 2, replies_count: 1, reblogs_count: 0,
    visibility: "public", spoiler_text: "",
    url: "https://source.example/@writer/original",
    ...overrides,
  };
}

test("same-origin sharing copies a compact UUID link that opens without an account", async () => {
  const id = "01a1b21a-0895-7011-a0ba-ae115d92861f";
  const origin = "https://lolcathost.org";
  const { app, context, click } = await postActionFixture();
  const post = { ...app.demoPosts[0], author: { ...app.demoAuthors[0], acct: "writer" }, id, url: `${origin}/objects/${id}` };
  app.state.posts = [post];
  app.state.api = new app.API(`${origin}:443/`, "private-token");
  context.location.href = `${origin}/?code=secret#home`;
  let copied;
  context.navigator = { clipboard: { writeText: async (text) => { copied = text; } } };
  click(id, "share");
  await new Promise(setImmediate);
  assert.equal(copied, `${origin}/#@writer/aGyGgiVcBGguq4RXZKGHw`);

  const requests = [];
  const reader = await postActionFixture(async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.endsWith("/context")
      ? { ancestors: [], descendants: [sharedStatus({ id: "reply", in_reply_to_id: id })] }
      : sharedStatus({ id }));
  });
  Object.assign(reader.context.location, { origin, href: copied, hash: new URL(copied).hash });
  reader.app.state.posts = [{ ...post, title: "Unrelated cached post" }];
  await reader.app.route();
  assert.equal(reader.app.state.error, "");
  assert.equal(reader.app.state.reading.id, id);
  assert.equal(reader.app.state.reading.title, "Shared article");
  assert.equal(reader.app.state.readerServer, origin);
  assert.equal(reader.app.state.comments[0].replyTo, id);
  assert.equal(reader.app.publicationLink(reader.app.state.reading), copied);
  assert.deepEqual(requests.map(({ url }) => url), [
    `${origin}/api/v1/statuses/${id}`,
    `${origin}/api/v1/statuses/${id}/context`,
  ]);
  assert.ok(requests.every(({ options }) => !options.headers.Authorization));
});

test("username links escape the author's name and keep resolving after a rename", async () => {
  const requests = [];
  const { app, context } = await postActionFixture(async (url) => {
    requests.push(url);
    return Response.json(url.endsWith("/context")
      ? { ancestors: [], descendants: [] }
      : sharedStatus());
  });
  const post = {
    ...app.demoPosts[0],
    author: { ...app.demoAuthors[0], acct: "old/name?# ü@source.example" },
    boostedBy: app.demoAuthors[1],
  };
  app.state.readerServer = context.location.origin;
  app.state.reading = post;
  const link = new URL(app.publicationLink(post));
  assert.equal(link.hash, "#@old%2Fname%3F%23%20%C3%BC/slow-web");
  context.location.hash = link.hash;
  await app.route();
  assert.equal(app.state.error, "");
  assert.equal(app.state.reading.author.acct, "writer");
  assert.deepEqual(requests, [
    "https://reader.example/api/v1/statuses/slow-web",
    "https://reader.example/api/v1/statuses/slow-web/context",
  ]);
  assert.equal(new URL(app.publicationLink(app.state.reading)).hash, "#@writer/slow-web");
});

test("existing marked UUID links with and without usernames still open the original post", async () => {
  const id = "01a1b21a-0895-7011-a0ba-ae115d92861f";
  const requests = [];
  const { app, context } = await postActionFixture(async (url) => {
    requests.push(url);
    return Response.json(url.endsWith("/context")
      ? { ancestors: [], descendants: [] }
      : sharedStatus({ id }));
  });
  for (const route of ["p", "@writer"]) {
    context.location.hash = `#${route}/~AaGyGgiVcBGguq4RXZKGHw`;
    requests.length = 0;
    await app.route();
    assert.equal(app.state.error, "");
    assert.equal(app.state.reading.id, id);
    assert.equal(requests[0], `https://reader.example/api/v1/statuses/${id}`);
    assert.equal(new URL(app.publicationLink(app.state.reading)).hash, "#@writer/aGyGgiVcBGguq4RXZKGHw");
  }
});

test("legacy p routes keep unmarked opaque IDs literal", async () => {
  const id = "AaGyGgiVcBGguq4RXZKGHw";
  const requests = [];
  const { app, context } = await postActionFixture(async (url) => {
    requests.push(url);
    return Response.json(url.endsWith("/context")
      ? { ancestors: [], descendants: [] }
      : sharedStatus({ id }));
  });
  context.location.hash = `#p/${id}`;
  await app.route();
  assert.equal(app.state.error, "");
  assert.equal(app.state.reading.id, id);
  assert.equal(requests[0], `https://reader.example/api/v1/statuses/${id}`);
  assert.equal(new URL(app.publicationLink(app.state.reading)).hash, "#@writer/%41aGyGgiVcBGguq4RXZKGHw");
});

test("share IDs preserve UUID bits and opaque IDs across origins and subdirectories", async () => {
  let id;
  const requests = [];
  const { app, context } = await postActionFixture(async (url) => {
    requests.push(url);
    return Response.json(url.endsWith("/context")
      ? { ancestors: [], descendants: [] }
      : sharedStatus({ id }));
  });
  for (id of [
    "00000000-0000-0000-0000-000000000000",
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002",
    "00000000-0000-0000-0000-000000000003",
    "00000000-0000-0000-0000-000000000004",
    "00100000-0000-0000-0000-000000000000",
    "04000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "fbefbefb-efbe-fbef-befb-efbefbefbefb",
    "01A1B21A-0895-7011-A0BA-AE115D92861F",
    "12345678901234567890",
    "AaGyGgiVcBGguq4RXZKGHw",
    "aGyGgiVcBGguq4RXZKGHw",
    "A",
    "Q",
    "g",
    "w",
    "%41",
    "~AaGyGgiVcBGguq4RXZKGHw",
    "remote/id?query#hash% ü",
  ]) {
    const post = { ...app.demoPosts[0], author: { ...app.demoAuthors[0], acct: "writer" }, id };
    app.state.readerServer = "https://source.example";
    app.state.reading = post;
    const link = new URL(app.publicationLink(post));
    assert.equal(link.pathname, "/fedistack/");
    assert.match(link.hash, /\?server=https%3A%2F%2Fsource.example$/);
    if (/^[0-9a-f-]{36}$/.test(id)) assert.match(link.hash, /^#@writer\/[A-Za-z0-9_-]{1,22}\?/);
    if (id.startsWith("~")) assert.match(link.hash, /^#@writer\/%7E/);
    context.location.hash = link.hash;
    requests.length = 0;
    await app.route();
    assert.equal(app.state.error, "", id);
    assert.equal(app.state.reading.id, id);
    assert.equal(requests[0], `https://source.example/api/v1/statuses/${encodeURIComponent(id)}`);
    assert.equal(app.publicationLink(app.state.reading), link.href);
  }
});

test("same-origin shared links resolve through a different signed-in server before interacting", async () => {
  const requests = [];
  const { app, context, click } = await postActionFixture(async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith("https://reader.example/")) return Response.json(sharedStatus());
    if (url.includes("/api/v2/search?"))
      return Response.json({ accounts: [], statuses: [sharedStatus({ id: "local-id" })] });
    if (url.endsWith("/context")) return Response.json({ ancestors: [], descendants: [] });
    return Response.json(sharedStatus({ id: "local-id", reblogged: true }));
  });
  app.state.session = { ...longServer, account: app.demoMe, server: "https://account.example", token: "local-token" };
  app.state.api = new app.API(app.state.session.server, app.state.session.token);
  app.state.posts = [{ ...app.demoPosts[0], title: "Unrelated cached post" }];
  context.location.hash = "#@writer/slow-web";
  await app.route();
  assert.equal(app.state.error, "");
  assert.equal(requests[0].url, "https://reader.example/api/v1/statuses/slow-web");
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(requests[1].options.headers.Authorization, "Bearer local-token");
  assert.equal(requests[2].url, "https://account.example/api/v1/statuses/local-id/context");
  assert.equal(app.state.reading.id, "local-id");
  assert.equal(app.state.readerServer, "");
  assert.match(app.publicationLink(app.state.reading), /^https:\/\/reader.example\/fedistack\/#@writer\/local-id\?server=https%3A%2F%2Faccount.example$/);
  click("local-id");
  await new Promise(setImmediate);
  assert.equal(requests[3].url, "https://account.example/api/v1/statuses/local-id/reblog");
  assert.equal(requests[3].options.headers.Authorization, "Bearer local-token");
});

test("short links reject malformed IDs before requesting a post", async () => {
  let calls = 0;
  const { app, context } = await postActionFixture(async () => { calls++; });
  for (const id of ["", "~", "~AaGyGgiVcBGguq4RXZKGHx", "~AaGyGgiVcBGguq4RXZKGHw=", "%E0%A4%A"]) {
    context.location.hash = `#@writer/${id}`;
    await app.route();
    assert.ok(app.state.error, id);
    assert.equal(app.state.reading, null);
  }
  assert.equal(calls, 0);
});

test("short links preserve private-post access checks and stay open after connecting", async () => {
  let visibility = "private";
  const requests = [];
  const { app, context, get } = await postActionFixture(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/context")) return Response.json({ ancestors: [], descendants: [] });
    if (!url.includes("/statuses/")) return Response.json([]);
    return Response.json(sharedStatus({ visibility }));
  });
  context.location.hash = "#@writer/slow-web";
  for (visibility of ["private", "direct"]) {
    await app.route();
    assert.equal(app.state.reading, null);
    assert.ok(app.state.error);
  }
  assert.ok(requests.every(({ options }) => !options.headers.Authorization));
  visibility = "private";
  get("modal").close = () => {};
  await app.setSession({ ...longServer, account: app.demoMe, server: context.location.origin, token: "account-token" });
  assert.equal(app.state.view, "reader");
  assert.equal(context.location.hash, "#@writer/slow-web");
  assert.equal(app.state.reading.visibility, "private");
  assert.equal(app.state.readerServer, "");
  assert.equal(requests[2].options.headers.Authorization, "Bearer account-token");
});

test("demo share links continue to open offline with legacy reader routes", async () => {
  const { app, context } = await postActionFixture();
  const post = app.demoPosts[0];
  const link = new URL(app.publicationLink(post));
  assert.equal(link.hash, `#read/${post.id}`);
  context.location.hash = link.hash;
  await app.route();
  assert.equal(app.state.reading.id, post.id);
  assert.equal(app.state.error, "");
  assert.equal(app.state.readerServer, "");
});

test("a shared link opens Markdown and public comments without a session or cached post", async () => {
  const requests = [];
  const { app, context, get } = await postActionFixture(async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.endsWith("/context") ? {
      ancestors: [],
      descendants: [
        sharedStatus({ id: "reply", content: "A *public reply*.", in_reply_to_id: "slow-web" }),
        sharedStatus({ id: "private", content: "Private reply", visibility: "private", in_reply_to_id: "slow-web" }),
      ],
    } : sharedStatus());
  });
  // The demo has the same ID; the shared link must never display that cached story.
  app.state.posts = app.demoPosts;
  context.location.hash = "#read/slow-web?server=https%3A%2F%2Fsource.example";
  await app.route();
  assert.equal(app.state.reading.title, "Shared article");
  assert.equal(app.state.readerServer, "https://source.example");
  assert.equal(app.state.api, null);
  assert.equal(app.findPost("slow-web"), app.state.reading);
  assert.match(get("app").innerHTML, /A <strong>formatted<\/strong> post/);
  assert.match(get("app").innerHTML, /A <em>public reply<\/em>/);
  assert.doesNotMatch(get("app").innerHTML, /Private reply|Published in demo|Offline demo|id="reply-form"|data-action="(?:like|repost|save|delete-publication)"/);
  assert.match(app.publicationLink(app.state.reading), /\?server=https%3A%2F%2Fsource.example$/);
  assert.equal(requests.length, 2);
  for (const { url, options } of requests) {
    assert.ok(url.startsWith("https://source.example/api/v1/statuses/slow-web"));
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, undefined);
  }
  context.location.hash = "#home";
  await app.route();
  assert.equal(app.state.readerServer, "");
  assert.notEqual(app.findPost("slow-web").title, "Shared article");
});

test("readers on another server resolve the post before sending interactions with their local ID", async () => {
  const requests = [];
  const { app, context, click } = await postActionFixture(async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith("https://source.example/")) return Response.json(sharedStatus());
    if (url.includes("/api/v2/search?")) {
      assert.equal(new URL(url).searchParams.get("q"), sharedStatus().url);
      return Response.json({ accounts: [], statuses: [sharedStatus({ id: "local-id" })] });
    }
    if (url.endsWith("/context")) return Response.json({ ancestors: [], descendants: [] });
    return Response.json(sharedStatus({ id: "local-id", reblogged: true, reblogs_count: 1 }));
  });
  app.state.session = { ...longServer, account: app.demoMe, server: "https://reader.social", token: "local-token" };
  app.state.api = new app.API(app.state.session.server, app.state.session.token);
  app.state.posts = [{ ...app.demoPosts[0], markdown: "Unrelated cached post" }];
  context.location.hash = "#read/slow-web?server=https%3A%2F%2Fsource.example";
  await app.route();
  assert.equal(app.state.reading.id, "local-id");
  assert.equal(app.state.readerServer, "");
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(requests[1].options.headers.Authorization, "Bearer local-token");
  assert.equal(requests[2].url, "https://reader.social/api/v1/statuses/local-id/context");
  click("local-id");
  await new Promise(setImmediate);
  assert.equal(requests[3].url, "https://reader.social/api/v1/statuses/local-id/reblog");
  assert.equal(requests[3].options.headers.Authorization, "Bearer local-token");
  assert.equal(app.state.reading.reposted, true);
});

test("an unresolved shared article remains readable without using another server's IDs for actions", async () => {
  const { app, context, get } = await postActionFixture(async (url) => {
    if (url.startsWith("https://reader.social/")) return Response.json({ error: "Cannot resolve" }, { status: 422 });
    if (url.endsWith("/context")) return Response.json({ error: "Login required for comments" }, { status: 401 });
    return Response.json(sharedStatus());
  });
  app.state.session = { ...longServer, account: app.demoMe, server: "https://reader.social", token: "local-token" };
  app.state.api = new app.API(app.state.session.server, app.state.session.token);
  app.state.posts = [{ ...app.demoPosts[0], markdown: "Unrelated cached post" }];
  context.location.hash = "#read/slow-web?server=https%3A%2F%2Fsource.example";
  await app.route();
  assert.equal(app.findPost("slow-web"), app.state.reading);
  assert.equal(app.state.readerServer, "https://source.example");
  assert.match(get("app").innerHTML, /<strong>formatted<\/strong>/);
  assert.match(get("app").innerHTML, /Login required for comments/);
  assert.doesNotMatch(get("app").innerHTML, /id="reply-form"|data-action="(?:like|repost|save|delete-publication)"/);
  assert.match(app.publicationLink(app.state.reading), /server=https%3A%2F%2Fsource.example/);
});

test("shared links reject unsafe servers and private content, but preserve authorized same-server access", async () => {
  let calls = 0, visibility = "private";
  const { app, context, get } = await postActionFixture(async (url, options) => {
    calls++;
    if (url.endsWith("/context")) return Response.json({ ancestors: [], descendants: [] });
    if (app.state.api) assert.equal(options.headers.Authorization, "Bearer account-token");
    return Response.json(sharedStatus({ visibility, content: "Private content" }));
  });
  context.location.hash = "#read/slow-web?server=" + encodeURIComponent("https://user:password@source.example");
  await app.route();
  assert.equal(calls, 0);
  assert.equal(app.state.reading, null);
  for (visibility of ["private", "direct"]) {
    context.location.hash = "#read/slow-web?server=https%3A%2F%2Fsource.example";
    await app.route();
    assert.equal(app.state.reading, null);
    assert.doesNotMatch(get("app").innerHTML, /Private content/);
  }
  visibility = "private";
  app.state.session = { ...longServer, account: app.demoMe, server: "https://source.example", token: "account-token" };
  app.state.api = new app.API(app.state.session.server, app.state.session.token);
  await app.route();
  assert.equal(app.state.readerServer, "");
  assert.equal(app.state.reading.visibility, "private");
  assert.match(get("app").innerHTML, /Private content/);
});

test("a late shared-post response cannot replace a newer page", async () => {
  let finish;
  const { app, context, get } = await postActionFixture(() => new Promise((resolve) => { finish = resolve; }));
  context.location.hash = "#read/slow-web?server=https%3A%2F%2Fsource.example";
  const opening = app.route();
  context.location.hash = "#settings";
  await app.route();
  finish(Response.json(sharedStatus()));
  await opening;
  assert.equal(app.state.view, "settings");
  assert.equal(app.state.reading, null);
  assert.equal(app.state.readerServer, "");
  assert.doesNotMatch(get("app").innerHTML, /Shared article/);
});

test("pending account mutations cannot overwrite public reader posts with the same IDs", async () => {
  const { app, get, click } = await postActionFixture();
  const local = { ...app.demoPosts[0], author: app.demoMe };
  let finishToggle, finishDelete;
  app.state.api = {
    toggle: () => new Promise((resolve) => { finishToggle = resolve; }),
    deleteStatus: () => new Promise((resolve) => { finishDelete = resolve; }),
  };
  app.state.posts = [local];
  get("modal").close = () => {};
  click(local.id);
  const deleting = app.deletePublication(local.id);
  const remote = { ...local, title: "Remote shared article" };
  app.state.view = "reader";
  app.state.readerServer = "https://source.example";
  app.state.reading = remote;
  app.state.comments = [{ ...local, replyTo: "remote-parent" }];
  finishToggle({ ...local, reposted: true, reposts: 1 });
  await new Promise(setImmediate);
  assert.equal(remote.title, "Remote shared article");
  assert.equal(remote.reposted, false);
  finishDelete();
  await deleting;
  assert.equal(app.state.posts.length, 0);
  assert.equal(app.state.reading, remote);
  assert.equal(app.state.comments.length, 1);
  await assert.rejects(app.deletePublication(remote.id), /only manage your own/);
});

test("repost clicks use the original status, synchronize counts, and undo without changing attribution", async () => {
  const requests = [];
  const original = {
    id: "original/id",
    account: { id: "writer", username: "writer", display_name: "Writer", acct: "writer", avatar: "", note: "", url: "" },
    content: "# An article",
    created_at: new Date().toISOString(),
    favourites_count: 5, replies_count: 2, reblogs_count: 7,
    favourited: true, reblogged: false, bookmarked: true,
    visibility: "unlisted", spoiler_text: "", url: "",
  };
  let failure = false;
  const { app, get, click } = await postActionFixture(async (url, options) => {
    requests.push({ url, options });
    if (failure) return Response.json({ error: "Repost rejected" }, { status: 403 });
    if (url.endsWith("/unreblog")) return Response.json(original);
    return Response.json({
      ...original, id: "wrapper", reblogs_count: 0,
      account: { ...original.account, display_name: "Me" },
      reblog: { ...original, reblogged: true, reblogs_count: 8 },
    });
  });
  app.state.session = { ...longServer, server: "https://example.org", token: "test", account: app.demoMe };
  app.state.api = new app.API("example.org", "test");
  const post = app.mapStatus(original);
  app.state.posts = [{ ...post, boostedBy: "A friend" }];
  app.state.ownPosts = [{ ...post }];
  app.state.comments = [{ ...post }];
  app.state.reading = { ...post };
  app.state.view = "reader";
  const button = click(post.id);
  assert.equal(button.disabled, true);
  click(post.id);
  await new Promise(setImmediate);
  assert.equal(button.disabled, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://example.org/api/v1/statuses/original%2Fid/reblog");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test");
  for (const copy of [...app.state.posts, ...app.state.ownPosts, ...app.state.comments, app.state.reading]) {
    assert.equal(copy.id, post.id);
    assert.equal(copy.reposted, true);
    assert.equal(copy.reposts, 8);
    assert.equal(copy.liked, true);
    assert.equal(copy.saved, true);
  }
  assert.equal(app.state.posts[0].boostedBy, "A friend");
  assert.equal(app.state.reading.boostedBy, undefined);
  assert.match(get("app").innerHTML, /data-action="repost"[^>]*aria-label="Undo repost"[^>]*aria-pressed="true"/);

  click(post.id);
  await new Promise(setImmediate);
  assert.equal(requests[1].url, "https://example.org/api/v1/statuses/original%2Fid/unreblog");
  assert.equal(requests[1].options.method, "POST");
  assert.equal(app.state.reading.reposted, false);
  assert.equal(app.state.reading.reposts, 7);
  assert.match(get("app").innerHTML, /data-action="repost"[^>]*aria-label="Repost"[^>]*aria-pressed="false"/);

  failure = true;
  const rejected = click(post.id);
  await new Promise(setImmediate);
  assert.equal(rejected.disabled, false);
  assert.equal(app.state.reading.reposted, false);
  assert.equal(app.state.reading.reposts, 7);
  assert.match(get("toast").textContent, /Repost rejected/);
});

test("demo reposts persist, support older stored posts, and reject private posts", async () => {
  const { app, context, get, click } = await postActionFixture();
  const post = app.demoState.posts[0];
  delete post.reposts;
  delete post.reposted;
  app.state.posts = [post];
  click(post.id);
  await new Promise(setImmediate);
  assert.equal(post.reposted, true);
  assert.equal(post.reposts, 1);
  assert.match(get("app").innerHTML, /data-action="repost"[^>]*aria-label="Undo repost"/);
  const reloaded = setup(undefined, { localStorage: context.localStorage }).app;
  assert.equal(reloaded.demoState.posts[0].reposted, true);
  assert.equal(reloaded.demoState.posts[0].reposts, 1);
  click(post.id);
  await new Promise(setImmediate);
  assert.equal(post.reposted, false);
  assert.equal(post.reposts, 0);
  assert.equal(app.readStore("demo", {}).posts[0].reposted, false);

  let requests = 0;
  app.state.api = { toggle: async () => { requests++; return post; } };
  for (const visibility of ["private", "direct"]) {
    post.visibility = visibility;
    assert.match(app.postActions(post), /data-action="repost"[^>]* disabled/);
    click(post.id);
    await new Promise(setImmediate);
    assert.equal(requests, 0);
    assert.equal(post.reposted, false);
  }
});

test("a repost response from a previous account cannot change the current feed", async () => {
  const { app, click } = await postActionFixture();
  const post = { ...app.demoPosts[0] };
  let finish;
  app.state.posts = [post];
  app.state.api = { toggle: () => new Promise((resolve) => { finish = resolve; }) };
  click(post.id);
  app.state.api = null;
  finish({ ...post, reposted: true, reposts: 1 });
  await new Promise(setImmediate);
  assert.equal(post.reposted, false);
  assert.equal(post.reposts, 0);
});

test("updating a demo publication keeps its ID and engagement without creating a second post", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  get("modal").close = () => {};
  const original = {
    ...app.demoPosts[0],
    id: "mine",
    author: app.demoMe,
    likes: 17,
    replies: 4,
    reposts: 3,
    reposted: true,
    saved: true,
  };
  app.demoState.posts.unshift(original);
  app.state.posts = [...app.demoState.posts];
  app.state.draft = { ...article, editingId: "mine", title: "Updated title" };
  await app.publishDraft();
  const matches = app.demoState.posts.filter((p) => p.id === "mine");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, "Updated title");
  assert.equal(matches[0].likes, 17);
  assert.equal(matches[0].replies, 4);
  assert.equal(matches[0].reposts, 3);
  assert.equal(matches[0].reposted, true);
  assert.equal(matches[0].saved, true);
  assert.equal(app.getDrafts().length, 0);
});

test("a rejected deletion retains the publication and other authors cannot be deleted", async () => {
  const { app } = setup();
  app.state.session = { account: { id: "me" } };
  let calls = 0;
  app.state.api = {
    deleteStatus: async () => {
      calls++;
      throw new Error("Server rejected deletion");
    },
  };
  const mine = {
    ...app.demoPosts[0],
    id: "mine",
    author: { ...app.demoMe, id: "me" },
  };
  app.state.posts = [mine, app.demoPosts[1]];
  await assert.rejects(
    app.deletePublication(app.demoPosts[1].id),
    /own publications/,
  );
  assert.equal(calls, 0);
  await assert.rejects(app.deletePublication("mine"), /Server rejected/);
  assert.equal(app.state.posts[0].id, "mine");
});

function ownPublication(app) {
  app.state.session = {
    ...longServer,
    server: "https://example.org",
    account: { ...app.demoMe, id: "me", statuses: 3 },
  };
  const post = {
    ...app.demoPosts[0],
    id: "mine",
    author: app.state.session.account,
    visibility: "private",
  };
  app.state.posts = [post];
  app.state.ownPosts = [post];
  app.state.reading = post;
  return post;
}

test("the reader offers deletion only for your comments and asks for confirmation", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const parent = ownPublication(app);
  const mine = { ...parent, id: "my-comment", replyTo: parent.id, warning: "Spoiler" };
  const other = { ...mine, id: "other-comment", author: app.demoAuthors[0] };
  app.state.comments = [mine, other];
  app.state.view = "reader";
  app.render();
  assert.match(get("app").innerHTML, /data-action="delete-publication" data-id="my-comment"[^>]*>Delete comment/);
  assert.doesNotMatch(get("app").innerHTML, /data-action="delete-publication" data-id="other-comment"/);
  assert.doesNotMatch(app.commentCard({ ...mine, visibility: "direct" }), /delete-publication/);
  const modal = get("modal");
  modal.querySelector = () => null;
  modal.showModal = () => { modal.open = true; };
  app.confirmDeletePublication(mine.id);
  assert.equal(modal.open, true);
  assert.match(modal.innerHTML, /Delete this comment\?/);
  assert.match(modal.innerHTML, /data-action="confirm-delete-publication" data-id="my-comment"[^>]*>Delete comment/);
  assert.match(modal.innerHTML, /Keep comment/);
  assert.equal(app.state.comments.length, 2);
});

test("deleting a comment removes every cached copy and updates only its parent's count once", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  get("modal").close = () => {};
  const root = ownPublication(app);
  root.replies = 4;
  const parent = { ...root, id: "parent-comment", replyTo: root.id, replies: 1 };
  const mine = { ...root, id: "my-comment", replyTo: parent.id, replies: 0 };
  const parentCopy = { ...parent };
  app.state.view = "reader";
  app.state.posts = [root, parent, mine];
  app.state.ownPosts = [parentCopy, { ...mine }];
  app.state.comments = [parent, mine];
  app.state.replyDrafts.set(root.id, "Unsent comment");
  const deleted = [];
  app.state.api = { deleteStatus: async (id) => deleted.push(id) };
  await app.deletePublication(mine.id);
  assert.deepEqual(deleted, [mine.id]);
  assert.equal(app.findPost(mine.id), undefined);
  assert.equal(app.state.comments.length, 1);
  assert.equal(app.state.reading, root);
  assert.equal(root.replies, 4);
  assert.equal(parent.replies, 0);
  assert.equal(parentCopy.replies, 0);
  assert.equal(app.state.session.account.statuses, 2);
  assert.equal(app.state.replyDrafts.get(root.id), "Unsent comment");
  assert.equal(context.location.hash, "");
  assert.equal(get("toast").textContent, "Comment deleted.");
});

test("failed comment deletion keeps the conversation intact and rejects other authors", async () => {
  const { app } = setup();
  const parent = ownPublication(app);
  const mine = { ...parent, id: "mine-comment", replyTo: parent.id };
  const other = { ...mine, id: "other-comment", author: app.demoAuthors[0] };
  app.state.comments = [mine, other];
  const replies = parent.replies;
  let requests = 0;
  app.state.api = { deleteStatus: async () => {
    requests++;
    throw new Error("Deletion failed");
  } };
  await assert.rejects(app.deletePublication(other.id), /own publications/);
  assert.equal(requests, 0);
  await assert.rejects(app.deletePublication(mine.id), /Deletion failed/);
  assert.equal(app.state.comments.length, 2);
  assert.equal(parent.replies, replies);
  assert.equal(app.state.session.account.statuses, 3);
});

test("demo replies appear in Your writing and deletion persists when reopening the conversation", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  get("modal").close = () => {};
  const parent = app.demoState.posts[0];
  const replies = parent.replies;
  const mine = {
    ...parent, id: "demo-comment", author: app.demoMe, replyTo: parent.id,
    title: "", kind: "post", markdown: "My demo comment", replies: 0,
  };
  app.demoState.comments[parent.id] = [mine];
  app.state.view = "drafts";
  app.state.libraryTab = "replies";
  app.render();
  assert.match(get("app").innerHTML, /My demo comment/);
  assert.match(get("app").innerHTML, /View conversation/);
  assert.equal(app.findPost(mine.id), mine);
  app.state.libraryTab = "published";
  app.render();
  assert.doesNotMatch(get("app").innerHTML, /My demo comment/);
  app.state.libraryTab = "replies";
  await app.deletePublication(mine.id);
  const saved = JSON.parse(context.localStorage.getItem("fedistack:demo"));
  assert.equal(saved.comments[parent.id].length, 0);
  assert.equal(saved.posts[0].replies, Math.max(0, replies - 1));
  context.location.hash = `#read/${parent.id}`;
  await app.route();
  assert.equal(app.state.comments.some((p) => p.id === mine.id), false);
  assert.doesNotMatch(get("app").innerHTML, /My demo comment/);
});

test("editing a demo comment preserves its parent and updates the stored conversation", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  get("modal").close = () => {};
  const parent = app.demoState.posts[0];
  const mine = {
    ...parent, id: "demo-comment", author: app.demoMe, replyTo: parent.id,
    title: "", kind: "post", markdown: "Original comment", replies: 0,
  };
  app.demoState.comments[parent.id] = [mine];
  app.state.draft = { ...app.newDraft("post"), editingId: mine.id, body: "Edited comment" };
  await app.publishDraft();
  assert.equal(app.state.reading.replyTo, parent.id);
  assert.equal(app.demoState.comments[parent.id][0].markdown, "Edited comment");
  app.state.view = "drafts";
  app.state.libraryTab = "replies";
  app.render();
  assert.equal(get("app").innerHTML.match(/Edited comment/g).length, 1);
  assert.doesNotMatch(get("app").innerHTML, /Original comment/);
});

test("Your writing loads and paginates replies while keeping publications, boosts, and DMs separate", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  ownPublication(app);
  app.state.view = "drafts";
  app.state.libraryTab = "replies";
  app.htmlToMarkdown = (text) => text;
  const account = {
    id: "me", username: "writer", display_name: "Writer", acct: "writer",
    avatar: "", note: "", url: "https://example.org/@writer",
  };
  const status = (id, replyTo, visibility = "public") => ({
    id, account, content: `Body of ${id}`, created_at: new Date().toISOString(),
    favourites_count: 0, replies_count: 0, visibility, spoiler_text: "",
    in_reply_to_id: replyTo,
  });
  const next = "https://example.org/api/v1/accounts/me/statuses?max_id=40&exclude_replies=false";
  const requests = [];
  app.state.api = Object.assign(new app.API("example.org"), { request: async (path) => {
    requests.push(path);
    return requests.length === 1
      ? { data: [status("article", null)], next }
      : { data: [
          status("article", null), status("reply", "parent/id"),
          status("private-message", "dm", "direct"),
          { ...status("boost", null), reblog: status("boosted", "parent") },
        ] };
  } });
  await app.loadOwnPosts();
  assert.match(requests[0], /exclude_replies=false/);
  assert.match(requests[0], /exclude_reblogs=true/);
  assert.match(get("app").innerHTML, /No replies in the loaded posts/);
  assert.match(get("app").innerHTML, /Load older replies/);
  await app.loadOwnPosts(true);
  assert.equal(requests[1], next);
  assert.deepEqual(Array.from(app.state.ownPosts, (p) => p.id), ["article", "reply"]);
  assert.match(get("app").innerHTML, /Body of reply/);
  assert.match(get("app").innerHTML, /href="#read\/parent%2Fid"/);
  assert.match(get("app").innerHTML, /Delete comment/);
  assert.doesNotMatch(get("app").innerHTML, /Body of article|Body of private-message|Body of boosted|Load older replies/);
  app.state.libraryTab = "published";
  app.render();
  assert.match(get("app").innerHTML, /Body of article/);
  assert.doesNotMatch(get("app").innerHTML, /Body of reply/);
});

test("unpublishing saves the original source before removal and opens an unpublished draft", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  get("modal").close = () => {};
  ownPublication(app);
  const source =
    "# Original title\n\nA subtitle\n\n## Section\n\n**Original body**.";
  let removed = false;
  app.state.api = {
    source: async () => ({
      text: source,
      spoiler_text: "A warning",
      content_type: "text/markdown",
    }),
    deleteStatus: async (id) => {
      assert.equal(id, "mine");
      const [draft] = app.getDrafts();
      assert.equal(app.draftMarkdown(draft), source);
      assert.equal(draft.visibility, "private");
      assert.equal(draft.warning, "A warning");
      assert.equal(draft.editingId, undefined);
      assert.equal(app.state.posts.length, 1);
      removed = true;
    },
  };
  await app.unpublishPublication("mine");
  assert.equal(removed, true);
  assert.equal(app.state.posts.length, 0);
  assert.equal(app.state.ownPosts.length, 0);
  assert.equal(app.state.reading, null);
  assert.equal(app.state.session.account.statuses, 2);
  assert.equal(
    context.location.hash,
    `write/${encodeURIComponent(app.getDrafts()[0].id)}`,
  );
});

test("unpublishing never removes a publication if its source or draft cannot be saved", async () => {
  for (const failure of ["source", "storage"]) {
    const { app, context } = setup();
    ownPublication(app);
    let removals = 0;
    app.state.api = {
      source: async () => {
        if (failure === "source") throw new Error("Source unavailable");
        return { text: "# Title\n\nBody", spoiler_text: "" };
      },
      deleteStatus: async () => {
        removals++;
      },
    };
    if (failure === "storage")
      context.localStorage.setItem = () => {
        throw new Error("Quota exceeded");
      };
    await assert.rejects(
      app.unpublishPublication("mine"),
      /Source unavailable|published version was not removed/,
    );
    assert.equal(removals, 0);
    assert.equal(app.state.posts.length, 1);
    assert.equal(app.getDrafts().length, 0);
  }
});

test("a rejected unpublish keeps the recovery draft and retry reuses it", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  get("modal").close = () => {};
  ownPublication(app);
  let sources = 0,
    removals = 0;
  app.state.api = {
    source: async () => {
      sources++;
      return { text: "# Title\n\nBody", spoiler_text: "" };
    },
    deleteStatus: async () => {
      removals++;
      if (removals === 1) throw new Error("Server unavailable");
    },
  };
  await assert.rejects(
    app.unpublishPublication("mine"),
    /draft copy is saved.*original may still be live/,
  );
  assert.equal(app.state.posts.length, 1);
  assert.equal(app.getDrafts().length, 1);
  const draftId = app.getDrafts()[0].id;
  await app.unpublishPublication("mine");
  assert.equal(sources, 1);
  assert.equal(app.getDrafts().length, 1);
  assert.equal(app.getDrafts()[0].id, draftId);
  assert.equal(app.state.posts.length, 0);
});

test("demo unpublish preserves title, subtitle, and body and republishes with a new ID", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  get("modal").close = () => {};
  const original = { ...app.demoPosts[0], id: "mine", author: app.demoMe };
  app.demoState.posts.unshift(original);
  await assert.rejects(
    app.unpublishPublication(app.demoPosts[1].id),
    /own publications/,
  );
  await app.unpublishPublication("mine");
  const [draft] = app.getDrafts();
  assert.equal(draft.title, original.title);
  assert.equal(draft.subtitle, original.subtitle);
  assert.equal(draft.body, original.markdown);
  assert.equal(draft.editingId, undefined);
  assert.equal(
    app.demoState.posts.some((p) => p.id === "mine"),
    false,
  );
  app.state.draft = draft;
  await app.publishDraft();
  assert.notEqual(app.state.reading.id, "mine");
  assert.equal(app.state.reading.likes, 0);
  assert.equal(app.state.reading.markdown, original.markdown);
});

test("language filtering matches any selected language and its regional variants", () => {
  const { app } = setup();
  const posts = ["en", "en-US", "EN_gb", "es", "eng", null, undefined].map(
    (language, id) => ({ id, language }),
  );
  assert.deepEqual(
    Array.from(app.filterByLanguages(posts, ["en"]), (p) => p.id),
    [0, 1, 2],
  );
  assert.deepEqual(
    Array.from(app.filterByLanguages(posts, ["es"]), (p) => p.id),
    [3],
  );
  assert.deepEqual(
    Array.from(app.filterByLanguages(posts, ["en", "es", "ca"]), (p) => p.id),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    Array.from(app.filterByLanguages(posts, ["EN_us", "es"]), (p) => p.id),
    [1, 3],
  );
  assert.deepEqual(Array.from(app.filterByLanguages(posts, ["fr", "ca"])), []);
  assert.equal(app.filterByLanguages(posts, []), posts);
});

test("saved language lists preserve legacy choices, validate entries, and stay cleared after reload", () => {
  for (const [saved, expected] of [
    [["es", "en", "es", "ca"], ["es", "en", "ca"]],
    [[null, "", 1, {}, "invalid", "fr"], ["fr"]],
    [{ language: "en" }, []],
    [[], []],
  ]) {
    const localStorage = storage();
    localStorage.setItem("fedistack:discovery-languages", JSON.stringify(saved));
    localStorage.setItem("fedistack:discovery-language", '"de"');
    const { app } = setup(undefined, { localStorage });
    assert.deepEqual(Array.from(app.state.discoveryLanguages), expected);
  }
  const localStorage = storage();
  localStorage.setItem("fedistack:discovery-language", '"en"');
  const { app, context } = setup(undefined, { localStorage });
  elements(context);
  assert.deepEqual(Array.from(app.state.discoveryLanguages), ["en"]);
  app.setDiscoveryLanguages(["en", "es", "ca", "en", "invalid"]);
  assert.deepEqual(Array.from(setup(undefined, { localStorage }).app.state.discoveryLanguages), ["en", "es", "ca"]);
  app.setDiscoveryLanguages([]);
  assert.deepEqual(Array.from(setup(undefined, { localStorage }).app.state.discoveryLanguages), []);
});

test("the saved language preferences filter Discover while Home and Saved retain other languages", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const posts = [
    {
      ...app.demoPosts[0],
      id: "english",
      title: "English fixture",
      language: "en-US",
    },
    {
      ...app.demoPosts[0],
      id: "spanish",
      title: "Spanish fixture",
      language: "es",
    },
    {
      ...app.demoPosts[0],
      id: "unknown",
      title: "Unknown fixture",
      language: null,
    },
  ];
  app.state.posts = posts;
  app.state.filter = "all";
  app.state.view = "discover";
  app.setDiscoveryLanguages(["en"]);
  assert.deepEqual(Array.from(app.readStore("discovery-languages", [])), ["en"]);
  assert.match(get("app").innerHTML, /English fixture/);
  assert.doesNotMatch(get("app").innerHTML, /Spanish fixture|Unknown fixture/);
  app.setDiscoveryLanguages(["en", "es", "ca"]);
  assert.match(get("app").innerHTML, /English fixture/);
  assert.match(get("app").innerHTML, /Spanish fixture/);
  assert.doesNotMatch(get("app").innerHTML, /Unknown fixture/);
  assert.doesNotMatch(get("app").innerHTML, /class="language-picker"|data-action="(?:remove-language|clear-languages)"/);
  app.setDiscoveryLanguages(["fr"]);
  assert.match(
    get("app").innerHTML,
    /No posts in the selected languages match the loaded results/,
  );
  assert.match(get("app").innerHTML, /href="#settings" class="button subtle">Change language settings/);
  assert.doesNotMatch(get("app").innerHTML, /data-action="clear-languages"/);
  for (const view of ["home", "bookmarks"]) {
    app.state.view = view;
    app.render();
    assert.match(get("app").innerHTML, /English fixture/);
    assert.match(get("app").innerHTML, /Spanish fixture/);
    assert.match(get("app").innerHTML, /Unknown fixture/);
  }
  app.state.view = "settings";
  app.render();
  assert.match(get("app").innerHTML, /id="settings-language"/);
  assert.match(get("app").innerHTML, /aria-label="Remove Français language filter"/);
  app.setDiscoveryLanguages([]);
  assert.doesNotMatch(get("app").innerHTML, /data-action="remove-language"/);
  app.state.view = "discover";
  app.render();
  assert.match(get("app").innerHTML, /Unknown fixture/);
});

test("Settings language controls add, deduplicate, remove, and clear choices", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const listeners = new Map();
  context.document.addEventListener = (name, listener) => listeners.set(name, listener);
  context.window = { addEventListener() {} };
  context.matchMedia = () => ({ matches: false, addEventListener() {} });
  get("modal").addEventListener = () => {};
  app.route = async () => {};
  await app.boot();
  const click = async (action, id = "") => {
    const button = { dataset: { action, id }, disabled: false };
    listeners.get("click")({ target: { closest: () => button } });
    await new Promise(setImmediate);
    assert.equal(button.disabled, false);
  };
  app.state.view = "settings";
  for (const value of ["en", "es", "ca", "en", ""]) {
    listeners.get("change")({ target: { id: "settings-language", value } });
  }
  assert.deepEqual(Array.from(app.state.discoveryLanguages), ["en", "es", "ca"]);
  assert.match(get("app").innerHTML, /aria-label="Remove Català language filter"/);
  assert.doesNotMatch(get("app").innerHTML, /<option value="(?:en|es|ca)"/);
  await click("remove-language", "es");
  assert.deepEqual(Array.from(app.state.discoveryLanguages), ["en", "ca"]);
  assert.doesNotMatch(get("app").innerHTML, /aria-label="Remove Español language filter"/);
  assert.match(get("app").innerHTML, /<option value="es">/);
  await click("remove-language", "en");
  await click("remove-language", "ca");
  assert.deepEqual(Array.from(app.state.discoveryLanguages), []);
  assert.match(get("app").innerHTML, /class="language-all">All languages/);
  app.setDiscoveryLanguages(app.discoveryLanguages.map(([code]) => code));
  assert.match(get("app").innerHTML, /<select id="settings-language" disabled>/);
  await click("clear-languages");
  assert.deepEqual(Array.from(app.state.discoveryLanguages), []);
});

function interestsFixture(fetch) {
  const { app, context } = setup(fetch);
  const { get } = elements(context);
  const modal = get("modal");
  modal.open = false;
  modal.showModal = () => { modal.open = true; };
  modal.close = () => { modal.open = false; };
  modal.querySelector = (selector) => selector === ".form-error" ? get("interest-error") : null;
  context.document.querySelector = (selector) => selector === "#modal" ? modal : null;
  app.htmlToMarkdown = (value) => value;
  app.state.session = { ...longServer, server: "https://example.org", token: "test", account: app.demoMe };
  app.state.api = new app.API("https://example.org", "test");
  app.state.view = "settings";
  return { app, context, get, modal };
}

test("interest APIs encode identifiers, preserve list options, and use server pagination", async () => {
  const calls = [];
  const { app } = setup(async (url, options) => {
    calls.push({ url: new URL(url), ...options, body: options.body ? JSON.parse(options.body) : undefined });
    const data = url.includes("followed_tags") ? [{ name: "Art" }] :
      url.includes("/accounts") || url.includes("/timelines/") || url.endsWith("/older") ? [] : {};
    return Response.json(data, { headers: { Link: '<https://example.org/older>; rel="next"' } });
  });
  const api = new app.API("https://example.org", "test");
  assert.equal((await api.followedTags()).next, "https://example.org/older");
  await api.followedTags("https://example.org/older");
  await api.followTag("café/test");
  await api.followTag("café/test", true);
  await api.saveList("New list");
  await api.saveList("Renamed", { id: "a/b", replies_policy: "none", exclusive: true });
  await api.listMembers("a/b");
  await api.listMembers("a/b", "https://example.org/older");
  await api.setListMember("a/b", "person");
  await api.setListMember("a/b", "person", true);
  await api.deleteList("a/b");
  await api.searchFollowing("name & surname");
  await api.timeline("tag:café/test");
  assert.equal(calls[0].url.pathname, "/api/v1/followed_tags");
  assert.equal(calls[1].url.pathname, "/older");
  assert.equal(calls[2].url.pathname, "/api/v1/tags/caf%C3%A9%2Ftest/follow");
  assert.equal(calls[3].url.pathname, "/api/v1/tags/caf%C3%A9%2Ftest/unfollow");
  assert.equal(calls[3].method, "POST");
  assert.deepEqual(calls[4].body, { title: "New list" });
  assert.equal(calls[5].method, "PUT");
  assert.equal(calls[5].url.pathname, "/api/v1/lists/a%2Fb");
  assert.deepEqual(calls[5].body, { title: "Renamed", replies_policy: "none", exclusive: true });
  assert.equal(calls[6].url.pathname, "/api/v1/lists/a%2Fb/accounts");
  assert.equal(calls[7].url.pathname, "/older");
  assert.deepEqual(calls[8].body, { account_ids: ["person"] });
  assert.equal(calls[8].method, "POST");
  assert.equal(calls[9].method, "DELETE");
  assert.equal(calls[10].method, "DELETE");
  assert.equal(calls[11].url.searchParams.get("following"), "true");
  assert.equal(calls[11].url.searchParams.get("q"), "name & surname");
  assert.equal(calls[12].url.pathname, "/api/v1/timelines/tag/caf%C3%A9%2Ftest");
  assert.equal(calls[12].url.searchParams.get("limit"), "20");
  await assert.rejects(api.followedTags("https://untrusted.example/older"), /unsafe API URL/);
  assert.equal(calls.length, 13);
});

test("hashtag subscriptions paginate, follow once, retain failed removals, and open a tag timeline", async () => {
  const calls = [];
  let reject = true;
  const { app, context, get, modal } = interestsFixture(async (url, options) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === "/api/v1/followed_tags") return Response.json([{ name: "Art" }], {
      headers: { Link: '<https://example.org/older>; rel="next"' },
    });
    if (path === "/older") return Response.json([{ name: "Art" }, { name: "Nature" }]);
    if (path.endsWith("/unfollow") && reject) return Response.json({ error: "Try later" }, { status: 503 });
    assert.equal(options.method, "POST");
    return Response.json({ name: decodeURIComponent(path.split("/")[4]), following: !path.endsWith("/unfollow") });
  });
  await app.showInterests("tags");
  assert.match(modal.innerHTML, /#Art/);
  assert.match(modal.innerHTML, /Load more hashtags/);
  await app.interestAction("more-interests", "");
  assert.match(modal.innerHTML, /#Nature/);
  assert.equal((modal.innerHTML.match(/aria-label="Unfollow #Art"/g) || []).length, 1);
  await app.submitInterestForm("follow-tag-form", " #café ");
  assert.match(modal.innerHTML, /#café/);
  const count = calls.length;
  await app.submitInterestForm("follow-tag-form", "#CAFÉ");
  assert.equal(calls.length, count);
  await app.submitInterestForm("follow-tag-form", "two tags");
  assert.equal(calls.length, count);
  assert.match(get("interest-error").textContent, /Enter one hashtag/);
  await app.interestAction("unfollow-tag", "café");
  assert.match(modal.innerHTML, /#café/);
  assert.match(get("interest-error").textContent, /Try later/);
  reject = false;
  await app.interestAction("unfollow-tag", "café");
  assert.doesNotMatch(modal.innerHTML, /#café/);
  app.state.query = "old search";
  await app.interestAction("read-tag", "Nature");
  assert.equal(app.state.timeline, "tag:Nature");
  assert.equal(app.state.query, "");
  assert.equal(context.location.hash, "discover");
  assert.equal(modal.open, false);
});

test("list management creates, renames, edits members, and requires confirmation before deletion", async () => {
  const calls = [];
  let rejectDelete = true;
  const oldList = { id: "1", title: "Friends", replies_policy: "none", exclusive: true };
  const account = (id) => ({ id, username: id, acct: id, display_name: id, note: "", avatar: "" });
  const { app, get, modal } = interestsFixture(async (url, options) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method: options.method, body });
    if (path === "/api/v1/lists") return Response.json(options.method === "GET" ? [oldList] : { id: "2", title: body.title });
    if (path === "/api/v1/lists/1" && options.method === "PUT") return Response.json({ id: "1", ...body });
    if (path === "/api/v1/lists/1" && options.method === "DELETE") return rejectDelete
      ? Response.json({ error: "Cannot delete now" }, { status: 503 }) : Response.json({});
    if (path === "/api/v1/accounts/search") return Response.json([account("new-person")]);
    if (path === "/api/v1/lists/1/accounts" && options.method === "GET") return Response.json([account("old-person")], {
      headers: { Link: '<https://example.org/more-members>; rel="next"' },
    });
    if (path === "/more-members") return Response.json([account("another-person")]);
    if (path === "/api/v1/lists/1/accounts") return Response.json({});
    throw new Error(`Unexpected request: ${path}`);
  });
  await app.showInterests("lists");
  await app.submitInterestForm("save-list-form", "Design");
  assert.deepEqual(Array.from(app.state.lists, (list) => list.title), ["Friends", "Design"]);
  await app.showInterests("members", "1");
  await app.submitInterestForm("save-list-form", "Best friends");
  assert.deepEqual(calls.find((call) => call.method === "PUT").body, { title: "Best friends", replies_policy: "none", exclusive: true });
  assert.match(modal.innerHTML, /Best friends/);
  await app.interestAction("more-interests", "");
  assert.match(modal.innerHTML, /another-person/);
  await app.submitInterestForm("list-member-search", "new");
  await app.interestAction("add-list-member", "new-person");
  assert.match(modal.innerHTML, /Remove @new-person from list/);
  await app.interestAction("remove-list-member", "old-person");
  assert.doesNotMatch(modal.innerHTML, /old-person/);
  await app.interestAction("delete-list-confirm", "");
  assert.equal(calls.some((call) => call.path === "/api/v1/lists/1" && call.method === "DELETE"), false);
  await app.interestAction("delete-list", "");
  assert.match(modal.innerHTML, /keeps your follows/);
  await app.interestAction("delete-list-confirm", "");
  assert.equal(app.state.lists.length, 2);
  assert.match(get("interest-error").textContent, /Cannot delete now/);
  rejectDelete = false;
  app.state.timeline = "list:1";
  app.state.next = "stale-list-page";
  await app.interestAction("delete-list-confirm", "");
  assert.deepEqual(Array.from(app.state.lists, (list) => list.id), ["2"]);
  assert.equal(app.state.timeline, "home");
  assert.equal(app.state.next, undefined);
  assert.doesNotMatch(modal.innerHTML, /Best friends/);
  assert.equal(calls.some((call) => /\/accounts\/.*\/(?:unfollow|follow)$/.test(call.path)), false);
});

test("interest dialogs report missing server support and ignore closed or replaced sessions", async () => {
  const { app, get, modal } = interestsFixture(async () => Response.json({ error: "Not found" }, { status: 404 }));
  await app.showInterests("tags");
  assert.match(get("interest-error").textContent, /does not support hashtag subscriptions/);
  assert.doesNotMatch(modal.innerHTML, /follow-tag-form/);
  let finish;
  app.state.api.followedTags = () => new Promise((resolve) => { finish = resolve; });
  const pending = app.showInterests("tags");
  app.closeModal();
  finish({ tags: [{ name: "late" }] });
  await pending;
  assert.equal(modal.open, false);
  assert.doesNotMatch(modal.innerHTML, /#late/);
  const oldAPI = app.state.api;
  oldAPI.get = () => new Promise((resolve) => { finish = resolve; });
  const lists = app.showInterests("lists");
  app.state.api = new app.API("https://other.example", "new");
  app.state.lists = [{ id: "new", title: "New account list" }];
  finish([{ id: "old", title: "Old account list" }]);
  await lists;
  assert.deepEqual(Array.from(app.state.lists, (list) => list.id), ["new"]);
  assert.doesNotMatch(modal.innerHTML, /Old account list/);
});

test("interest management remains reachable with no lists and escapes names returned by the server", async () => {
  const { app, get, modal } = interestsFixture(async () => Response.json([{ id: 'x"', title: '<img src=x onerror="bad()">' }]));
  app.render();
  assert.match(get("app").innerHTML, /data-action="manage-hashtags"/);
  assert.match(get("app").innerHTML, /data-action="manage-lists"/);
  app.state.view = "home";
  app.render();
  assert.match(get("app").innerHTML, /<option value="manage">Manage lists…/);
  await app.showInterests("lists");
  assert.doesNotMatch(modal.innerHTML, /<img src=x/);
  assert.match(modal.innerHTML, /&lt;img/);
  app.state.session = null;
  app.state.api = null;
  assert.match(app.interestsSettings(), /Connect your account to manage/);
  assert.doesNotMatch(app.interestsSettings(), /data-action="manage-/);
});

test("pending interest edits prevent duplicate requests and never reopen another dialog", async () => {
  const { app, get, modal } = interestsFixture(async () => Response.json([]));
  await app.showInterests("lists");
  get("interest-title").value = "Draft list name";
  let finish, writes = 0;
  app.state.api.saveList = () => {
    writes++;
    return new Promise((resolve) => { finish = resolve; });
  };
  const saving = app.submitInterestForm("save-list-form", "Draft list name");
  assert.match(modal.innerHTML, /disabled aria-busy="true"/);
  assert.match(modal.innerHTML, /value="Draft list name"/);
  await app.submitInterestForm("save-list-form", "Duplicate");
  assert.equal(writes, 1);
  app.showModal("Another dialog", "Keep this dialog open");
  finish({ id: "new", title: "Draft list name" });
  await saving;
  assert.match(modal.innerHTML, /Keep this dialog open/);
  assert.equal(app.state.lists[0].title, "Draft list name");
});

test("interest buttons, forms, and list selection are wired through application events", async () => {
  const { app, context, get } = interestsFixture(async () => Response.json([]));
  const listeners = new Map(), opened = [], submitted = [];
  context.document.addEventListener = (name, listener) => listeners.set(name, listener);
  context.window = { addEventListener() {} };
  context.matchMedia = () => ({ matches: false, addEventListener() {} });
  context.FormData = class { constructor(form) { return new Map(form.fields); } };
  get("modal").addEventListener = () => {};
  app.route = async () => {};
  await app.boot();
  app.showInterests = async (...args) => { opened.push(args); };
  app.submitInterestForm = async (...args) => { submitted.push(args); };
  for (const [action, id] of [["manage-hashtags", ""], ["manage-lists", ""], ["manage-list-members", "1"]]) {
    const button = { dataset: { action, id }, disabled: false };
    listeners.get("click")({ target: { closest: () => button } });
    await new Promise(setImmediate);
  }
  app.state.timeline = "list:1";
  const select = { id: "list-select", value: "manage" };
  listeners.get("change")({ target: select });
  assert.equal(select.value, "list:1");
  assert.deepEqual(opened, [["tags"], ["lists"], ["members", "1"], ["lists"]]);
  for (const [id, field, value] of [["follow-tag-form", "tag", "#nature"], ["save-list-form", "title", "Friends"], ["list-member-search", "query", "person"]]) {
    listeners.get("submit")({
      target: { id, fields: [[field, value]], dataset: {}, querySelector: () => null },
      preventDefault() {},
    });
    await new Promise(setImmediate);
  }
  assert.deepEqual(submitted, [["follow-tag-form", "#nature"], ["save-list-form", "Friends"], ["list-member-search", "person"]]);
  app.state.view = "bookmarks";
  app.state.query = "stale search";
  listeners.get("change")({ target: { id: "list-select", value: "list:1" } });
  assert.equal(context.location.hash, "home");
  assert.equal(app.state.query, "");
});

test("API mapping uses the original publication's language when it is boosted", () => {
  const { app } = setup();
  app.htmlToMarkdown = (text) => text;
  const original = {
    id: "original",
    language: "ca",
    content: "Original text",
    visibility: "public",
    account: { id: "writer", username: "writer", acct: "writer", note: "" },
    created_at: new Date().toISOString(),
    favourites_count: 0,
    replies_count: 0,
  };
  assert.equal(app.mapStatus(original).language, "ca");
  assert.equal(
    app.mapStatus({ ...original, language: "en", reblog: original }).language,
    "ca",
  );
  assert.equal(
    app.mapStatus({ ...original, language: undefined }).language,
    null,
  );
});

test("remote Article metadata preserves short and untitled articles", () => {
  const { app } = setup();
  app.htmlToMarkdown = (text) => text;
  const status = { id: "remote-article", object_type: "Article", title: "Remote headline",
    content: "Short body", visibility: "public", created_at: new Date().toISOString(),
    favourites_count: 0, replies_count: 0,
    account: { id: "remote", username: "writer", acct: "writer@remote.example", note: "" } };
  assert.equal(app.mapStatus(status).kind, "article");
  assert.equal(app.mapStatus(status).title, "Remote headline");
  assert.equal(app.mapStatus({ ...status, title: null }).kind, "article");
  assert.equal(app.mapStatus({ ...status, object_type: "Note", title: null }).kind, "post");
  assert.equal(app.mapStatus({ ...status, reblog: status }).kind, "article");
});

test("article classification uses the 900-character boundary or explicit markers, not link previews", () => {
  const { app } = setup();
  app.htmlToMarkdown = (text) => text;
  const status = {
    id: "original",
    content: "x".repeat(900),
    visibility: "public",
    account: { id: "writer", username: "writer", acct: "writer", note: "" },
    created_at: new Date().toISOString(),
    favourites_count: 0,
    replies_count: 0,
  };
  assert.equal(app.mapStatus(status).kind, "post");
  assert.equal(app.mapStatus({ ...status, content: "x".repeat(901) }).kind, "article");
  assert.equal(app.mapStatus({ ...status, content: "# Title\n\nShort body" }).kind, "article");
  assert.equal(app.mapStatus({ ...status, content: "Short body", tags: [{ name: "Article" }] }).kind, "article");
  const linked = {
    ...status,
    content: "A short link post",
    card: { type: "link", title: "A linked page", description: "x".repeat(1000), url: "https://example.org/article" },
  };
  const mapped = app.mapStatus(linked);
  assert.equal(mapped.kind, "post");
  assert.equal(mapped.title, "");
  assert.equal(mapped.source, linked.card.url);
  assert.equal(app.mapStatus({ ...status, reblog: linked }).kind, "post");
  assert.equal(app.mapStatus({ ...linked, content: "x".repeat(901) }).kind, "article");
});

function feedFixture() {
  const { app, context } = setup();
  const { get } = elements(context);
  const post = (id, extra = {}) => ({ ...app.demoPosts[0], id, ...extra });
  const requests = [];
  app.state.api = {
    async timeline(timeline, next) {
      requests.push({ timeline, next });
      return { posts: [] };
    },
    async relationships() { return []; },
  };
  return { app, context, get, post, requests };
}

test("federated browsing and new searches show remote notes before optional filtering", async () => {
  const { app, context, get, post } = feedFixture();
  const listeners = new Map();
  context.document.addEventListener = (name, listener) => listeners.set(name, listener);
  context.window = { addEventListener() {} };
  context.matchMedia = () => ({ matches: false, addEventListener() {} });
  context.FormData = class { constructor(form) { return new Map(form.fields); } };
  get("modal").addEventListener = () => {};
  app.route = async () => {};
  await app.boot();
  const remote = post("remote-note", { kind: "post", title: "", markdown: "Remote note from another instance",
    author: { ...app.demoAuthors[0], id: "remote", acct: "writer@remote.example" } });
  app.state.api.timeline = async () => ({ posts: [post("local-article"), remote] });
  const click = async (action, id) => {
    listeners.get("click")({ target: { closest: () => ({ dataset: { action, id }, disabled: false }) } });
    await new Promise(setImmediate);
  };
  assert.equal(app.state.filter, "article");
  await click("timeline", "federated");
  assert.equal(app.state.filter, "all");
  assert.match(get("app").innerHTML, /Remote note from another instance/);
  await click("filter", "article");
  assert.doesNotMatch(get("app").innerHTML, /Remote note from another instance/);
  app.navigate = () => {};
  app.state.api.search = async () => ({ accounts: [], posts: [remote] });
  listeners.get("submit")({ target: { id: "discover-search", fields: [["query", "remote"]], dataset: {}, querySelector: () => null }, preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(app.state.filter, "all");
  await app.loadFeed();
  assert.match(get("app").innerHTML, /Remote note from another instance/);
});

test("sparse timelines scan past notes and duplicate boosts for ten new articles per load", async () => {
  const { app, get, post, requests } = feedFixture();
  const articles = Array.from({ length: 20 }, (_, i) => post(`article-${i}`));
  const note = post("note", { kind: "post", markdown: "A short note" });
  const pages = [
    [note],
    articles.slice(0, 5),
    [articles[0], ...articles.slice(5, 10)],
    articles.slice(0, 10),
    articles.slice(10),
  ];
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    return { posts: pages[requests.length - 1], next: `page-${requests.length}` };
  };
  await app.loadFeed();
  assert.equal(requests.length, 3);
  assert.equal(app.state.posts.length, 11);
  assert.equal(app.state.next, "page-3");
  assert.doesNotMatch(get("app").innerHTML, /A short note/);
  await app.loadFeed(true);
  assert.equal(requests.length, 5);
  assert.equal(app.state.posts.length, 21);
  assert.equal(requests[3].next, "page-3");
  assert.equal(app.state.next, "page-5");
  assert.equal(app.state.loading, false);
});

test("automatic scanning is bounded and the next load resumes after the scanned pages", async () => {
  const { app, post, requests } = feedFixture();
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    return {
      posts: requests.length <= 10 ? [] : [post("found")],
      next: requests.length <= 10 ? `page-${requests.length}` : undefined,
    };
  };
  await app.loadFeed();
  assert.equal(requests.length, 10);
  assert.equal(app.state.next, "page-10");
  await app.loadFeed(true);
  assert.equal(requests.length, 11);
  assert.equal(requests[10].next, "page-10");
  assert.equal(app.state.posts[0].id, "found");
  assert.equal(app.state.next, undefined);
  await app.loadFeed(true);
  assert.equal(requests.length, 11);
});

test("scanning counts articles in any selected language that match the following filter", async () => {
  const { app, post, requests } = feedFixture();
  app.state.view = "discover";
  app.state.discoveryLanguages = ["en", "es", "ca"];
  app.state.followingOnly = true;
  const author = (id) => ({ ...app.demoAuthors[0], id });
  const pages = [
    Array.from({ length: 10 }, (_, i) => post(`french-${i}`, { language: "fr", author: author("friend") })),
    Array.from({ length: 10 }, (_, i) => post(`stranger-${i}`, { language: "en", author: author("stranger") })),
    Array.from({ length: 10 }, (_, i) => post(`match-${i}`, { language: ["en-US", "es", "ca"][i % 3], author: author("friend") })),
  ];
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    return { posts: pages[requests.length - 1], next: `page-${requests.length}` };
  };
  app.state.api.relationships = async (ids) => ids.map((id) => ({ id, following: id === "friend" }));
  await app.loadFeed();
  assert.equal(requests.length, 3);
  assert.equal(app.state.posts.length, 30);
  assert.equal(app.state.next, "page-3");
});

test("cyclic pagination stops without repeatedly fetching the same page", async () => {
  const { app, requests } = feedFixture();
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    return { posts: [], next: next === "older" ? "oldest" : "older" };
  };
  await app.loadFeed();
  assert.equal(requests.length, 3);
  assert.equal(app.state.next, undefined);
  assert.equal(app.state.loading, false);
});

test("a server error stops scanning but retains partial results and the failed cursor for retry", async () => {
  const { app, get, post, requests } = feedFixture();
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    if (requests.length === 2) throw new app.APIError("Rate limited", 429);
    return { posts: [post(requests.length === 1 ? "first" : "last")], next: requests.length === 1 ? "older" : undefined };
  };
  await app.loadFeed();
  assert.equal(requests.length, 2);
  assert.equal(app.state.posts[0].id, "first");
  assert.equal(app.state.next, "older");
  assert.equal(app.state.error, "Rate limited");
  assert.equal(app.state.loading, false);
  assert.match(get("app").innerHTML, /Rate limited/);
  await app.loadFeed(true);
  assert.equal(requests[2].next, "older");
  assert.deepEqual(Array.from(app.state.posts, (p) => p.id), ["first", "last"]);
  assert.equal(app.state.error, "");
});

test("switching timelines discards pending results and stops the old scan", async () => {
  const { app, post, requests } = feedFixture();
  let finishOld;
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    if (timeline === "home") return new Promise((resolve) => { finishOld = resolve; });
    return { posts: [post("local")] };
  };
  const oldLoad = app.loadFeed();
  app.state.timeline = "local";
  await app.loadFeed();
  finishOld({ posts: [post("stale")], next: "stale-page" });
  await oldLoad;
  assert.equal(requests.length, 2);
  assert.deepEqual(Array.from(app.state.posts, (p) => p.id), ["local"]);
  assert.equal(app.state.next, undefined);
  assert.equal(app.state.loading, false);
});

test("changing a filter tops up sparse results without discarding already loaded posts", async () => {
  const { app, post, requests } = feedFixture();
  app.state.posts = [post("old-note", { kind: "post" }), post("old-article")];
  app.state.next = "older";
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    return { posts: Array.from({ length: 9 }, (_, i) => post(`new-${i}`)), next: "more" };
  };
  app.updateFeedFilters();
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].next, "older");
  assert.equal(app.state.posts.length, 11);
  app.updateFeedFilters();
  assert.equal(requests.length, 1);
});

test("All and Saved stop when enough posts are visible, while search remains a single request", async () => {
  const { app, post, requests } = feedFixture();
  app.state.filter = "all";
  app.state.view = "bookmarks";
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    return { posts: Array.from({ length: 20 }, (_, i) => post(`note-${i}`, { kind: "post" })), next: "older" };
  };
  await app.loadFeed();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].timeline, "bookmarks");
  let searches = 0;
  app.state.api.search = async () => {
    searches++;
    return { posts: [post("search-result")], accounts: [] };
  };
  app.state.query = "topic";
  await app.loadFeed();
  assert.equal(searches, 1);
  assert.equal(requests.length, 1);
  assert.equal(app.state.next, undefined);
});

test("Zen mode preserves the editor and Escape dismisses a dialog before leaving Zen", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const toggles = new Map();
  context.document.body.classList.toggle = (name, enabled) =>
    toggles.set(name, enabled);
  app.state.view = "editor";
  app.state.draft = { ...article };
  const textarea = get("draft-body");
  textarea.selectionStart = 5;
  get("app").innerHTML = "Existing editor";
  app.toggleFocus();
  assert.equal(toggles.get("zen-mode"), true);
  assert.equal(get("app").innerHTML, "Existing editor");
  assert.equal(textarea.selectionStart, 5);
  assert.match(app.editorView(), /Exit Zen/);
  get("modal").open = true;
  app.editorKeydown({ key: "Escape" });
  assert.equal(app.state.focus, true);
  get("modal").open = false;
  app.editorKeydown({ key: "Escape" });
  assert.equal(toggles.get("zen-mode"), false);
  app.state.view = "reader";
  app.toggleFocus();
  assert.equal(toggles.get("focus-mode"), true);
  assert.equal(toggles.get("zen-mode"), false);
});

test("opening a Note preserves the article draft and resumes in its compact composer", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.state.view = "editor";
  app.state.draft = { ...article };
  context.location.hash = "#note";
  await app.route();
  assert.equal(app.state.draft.kind, "post");
  assert.equal(
    app.getDrafts().find((d) => d.id === article.id).body,
    article.body,
  );
  const note = app.state.draft;
  note.body = "A quick thought for today.";
  assert.equal(app.flushDraft(), true);
  context.location.hash = `#write/${note.id}`;
  await app.route();
  assert.equal(app.state.draft.body, note.body);
  const output = app.editorView();
  assert.match(output, /class="note-composer"/);
  assert.match(output, /data-action="publish-note"[^>]*>Note<\/button>/);
  assert.doesNotMatch(
    output,
    /id="draft-title"|id="draft-subtitle"|class="editor-toolbar"|data-action="preview"|data-action="focus"/,
  );
  assert.match(output, /data-state="saved"/);
  app.state.view = "drafts";
  app.render();
  assert.match(get("app").innerHTML, /A quick thought for today\./);
});

test("Notes preserve literal text on plain-text servers and retain drafts if publishing fails", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  get("modal").close = () => {};
  const body = "Use **literal** markers and x_y_z\n#topic <3";
  const note = {
    ...app.newDraft("post"),
    body,
    visibility: "private",
    warning: "CW",
  };
  app.state.draft = note;
  app.state.session = {
    ...longServer,
    format: "text/plain",
    server: "https://example.org",
    account: { id: "me" },
  };
  let reject = true;
  app.state.api = {
    capabilities: async () => ({ ...longServer, format: "text/plain" }),
    createStatus: async (text, visibility, reply, warning, key, format) => {
      assert.equal(text, body);
      assert.equal(visibility, "private");
      assert.equal(warning, "CW");
      assert.equal(format, "text/plain");
      if (reject) throw new Error("Server unavailable");
      return {
        ...app.demoPosts[0],
        id: "new-note",
        kind: "post",
        markdown: text,
      };
    },
  };
  await assert.rejects(app.publishDraft(), /Server unavailable/);
  assert.equal(app.getDrafts()[0].body, body);
  assert.equal(app.state.draft.id, note.id);
  reject = false;
  await app.publishDraft();
  assert.equal(app.getDrafts().length, 0);
  assert.equal(app.state.draft, null);
  assert.equal(context.location.hash, "read/new-note");
});

test("the Note composer keeps save and limit checks without article formatting or Zen shortcuts", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.state.view = "editor";
  app.state.draft = app.newDraft("post");
  app.state.session = { format: "text/plain", maxChars: 10 };
  const textarea = get("draft-body");
  textarea.value = "";
  textarea.id = "draft-body";
  context.document.activeElement = textarea;
  get("note-publish");
  get("modal").open = false;
  app.updateEditorMeta();
  assert.equal(get("note-publish").disabled, true);
  textarea.value = "A note";
  app.captureDraft();
  assert.equal(get("note-publish").disabled, false);
  app.editorKeydown({
    key: "b",
    ctrlKey: true,
    preventDefault() {
      assert.fail("Notes must not apply article formatting");
    },
  });
  app.editorKeydown({
    key: "f",
    ctrlKey: true,
    shiftKey: true,
    preventDefault() {
      assert.fail("Notes must not enter Zen");
    },
  });
  app.toggleFocus();
  assert.equal(app.state.focus, false);
  textarea.value = "This note is too long";
  app.captureDraft();
  assert.equal(get("note-publish").disabled, true);
  assert.match(
    app.publishProblem(app.state.draft, app.state.session),
    /allows 10/,
  );
});

function scheduledServer() {
  const statuses = new Map(), requests = [], keys = new Map();
  let sequence = 0;
  const server = {
    statuses, requests,
    fail: null,
    beforeCreate: null,
    async fetch(url, options = {}) {
      const path = new URL(url).pathname;
      const method = options.method || "GET";
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ path, method, body, headers: options.headers });
      const failure = server.fail?.({ path, method, body });
      if (failure) return new Response(JSON.stringify({ error: failure }), { status: 422 });
      if (/^\/api\/v[12]\/instance$/.test(path))
        return Response.json({ configuration: { statuses: {
          max_characters: longServer.maxChars,
          supported_mime_types: ["text/plain", longServer.format],
        } } });
      if (method === "POST" && path === "/api/v1/statuses") {
        await server.beforeCreate?.();
        const key = options.headers["Idempotency-Key"];
        if (keys.has(key)) return Response.json(keys.get(key));
        const result = {
          id: String(++sequence), scheduled_at: body.scheduled_at,
          params: { text: body.status, spoiler_text: body.spoiler_text,
            visibility: body.visibility, content_type: body.content_type },
          media_attachments: [],
        };
        statuses.set(result.id, result);
        keys.set(key, result);
        return Response.json(result);
      }
      if (path === "/api/v1/scheduled_statuses") return Response.json([...statuses.values()]);
      const id = path.split("/").pop();
      if (!statuses.has(id)) return Response.json({ error: "Not found" }, { status: 404 });
      if (method === "DELETE") {
        statuses.delete(id);
        return new Response(null, { status: 204 });
      }
      if (method === "PUT") statuses.get(id).scheduled_at = body.scheduled_at;
      return Response.json(statuses.get(id));
    },
  };
  return server;
}
function draftClient(server, stores) {
  const client = setup(server.fetch, stores);
  client.app.state.session = { ...longServer, server: "https://example.org", token: "token", account: { id: "me" } };
  client.app.state.api = new client.app.API("https://example.org", "token");
  return client;
}

test("server drafts round-trip Markdown and editing metadata and load on another device", async () => {
  const server = scheduledServer(), first = draftClient(server);
  const draft = { ...article, body: "\n**Accents é and emoji 🦊**\n", editingId: "original", warning: "CW", visibility: "private" };
  assert.equal(first.app.saveDraft(draft), true);
  assert.equal(server.requests.length, 0, "local save is immediate and independent of the network");
  await first.app.syncServerDraft(draft.id);
  assert.equal(server.statuses.size, 1);
  const remote = [...server.statuses.values()][0];
  assert.match(remote.scheduled_at, /^9999-/);
  assert.match(remote.params.text, /# An independent publication/);
  const second = draftClient(server);
  await second.app.loadServerDrafts();
  assert.equal(second.app.getDrafts().length, 1);
  assert.equal(second.app.draftContent(second.app.getDrafts()[0]), second.app.draftContent(draft));
  assert.equal(second.app.serverDraftLabel(second.app.getDrafts()[0]), "Saved on server");
  assert.equal(second.app.state.scheduledPosts.length, 0);
});

test("a failed server save keeps the local draft and never retries as an immediate post", async () => {
  const server = scheduledServer(), { app } = draftClient(server);
  server.fail = ({ method }) => method === "POST" && "Unsupported scheduled date";
  app.saveDraft({ ...article });
  await assert.rejects(app.syncServerDraft(article.id), /Unsupported scheduled date/);
  assert.equal(app.getDrafts()[0].body, article.body);
  assert.match(app.serverDraftLabel(app.getDrafts()[0]), /Server save failed/);
  const writes = server.requests.filter((r) => r.method === "POST");
  assert.equal(writes.length, 1);
  assert.match(writes[0].body.scheduled_at, /^9999-/);
});

test("draft replacement creates the new copy before deleting the previous copy", async () => {
  const server = scheduledServer(), { app } = draftClient(server);
  app.saveDraft({ ...article });
  await app.syncServerDraft(article.id);
  const original = app.getDrafts()[0].serverId;
  app.saveDraft({ ...app.getDrafts()[0], body: "New body" });
  server.fail = ({ method }) => method === "POST" && "Storage unavailable";
  await assert.rejects(app.syncServerDraft(article.id));
  assert.equal(server.statuses.has(original), true);
  server.fail = null;
  await app.syncServerDraft(article.id);
  assert.equal(server.statuses.size, 1);
  assert.notEqual(app.getDrafts()[0].serverId, original);
  const requests = server.requests.filter((r) => ["POST", "DELETE"].includes(r.method));
  assert.equal(requests.at(-2).method, "POST");
  assert.equal(requests.at(-1).method, "DELETE");
});

test("failed replacement cleanup is retried without creating another copy", async () => {
  const server = scheduledServer(), { app } = draftClient(server);
  app.saveDraft({ ...article });
  await app.syncServerDraft(article.id);
  app.saveDraft({ ...app.getDrafts()[0], body: "Updated" });
  server.fail = ({ method }) => method === "DELETE" && "Try later";
  await assert.rejects(app.syncServerDraft(article.id));
  assert.equal(server.statuses.size, 2);
  assert.equal(app.getDrafts()[0].serverPreviousIds.length, 1);
  server.fail = null;
  await app.syncServerDraft(article.id);
  assert.equal(server.statuses.size, 1);
  assert.equal(server.requests.filter((r) => r.method === "POST").length, 2);
});

test("editing while a server request is pending preserves newer local text and server identity", async () => {
  const server = scheduledServer(), { app, context } = draftClient(server);
  elements(context);
  app.state.view = "editor";
  app.state.draft = { ...article };
  app.saveDraft(app.state.draft);
  let release, started;
  const entered = new Promise((resolve) => { started = resolve; });
  server.beforeCreate = () => { started(); return new Promise((resolve) => { release = resolve; }); };
  const saving = app.syncServerDraft(article.id);
  await entered;
  app.state.draft.body = "Typed while saving";
  app.saveDraft(app.state.draft);
  release();
  await saving;
  assert.equal(app.getDrafts()[0].body, "Typed while saving");
  assert.equal(app.state.draft.serverId, app.getDrafts()[0].serverId);
  assert.match(app.serverDraftLabel(app.state.draft), /pending/);
  server.beforeCreate = null;
  await app.syncServerDraft(article.id);
  assert.equal(server.statuses.size, 1);
  assert.match([...server.statuses.values()][0].params.text, /Typed while saving/);
});

test("a stale client cannot overwrite remote edits and refresh retains both versions", async () => {
  const server = scheduledServer(), first = draftClient(server), second = draftClient(server);
  first.app.saveDraft({ ...article });
  await first.app.syncServerDraft(article.id);
  await second.app.loadServerDrafts();
  first.app.saveDraft({ ...first.app.getDrafts()[0], body: "First device" });
  await first.app.syncServerDraft(article.id);
  second.app.saveDraft({ ...second.app.getDrafts()[0], body: "Offline second device" });
  await assert.rejects(second.app.syncServerDraft(article.id));
  await second.app.loadServerDrafts();
  assert.deepEqual(Array.from(second.app.getDrafts(), (d) => d.body).sort(), ["First device", "Offline second device"]);
  assert.equal(new Set(second.app.getDrafts().map((d) => d.id)).size, 2);
});

test("a clean copy deleted elsewhere stays deleted after refresh", async () => {
  const server = scheduledServer(), { app } = draftClient(server);
  app.saveDraft({ ...article });
  await app.syncServerDraft(article.id);
  server.statuses.clear();
  await app.loadServerDrafts();
  assert.equal(app.getDrafts().length, 0);
});

test("late draft responses stay scoped to the original account", async () => {
  const server = scheduledServer(), { app } = draftClient(server);
  app.saveDraft({ ...article });
  const key = app.draftKey();
  let release, started;
  const entered = new Promise((resolve) => { started = resolve; });
  server.beforeCreate = () => { started(); return new Promise((resolve) => { release = resolve; }); };
  const saving = app.syncServerDraft(article.id);
  await entered;
  app.state.session = { ...app.state.session, account: { id: "other" } };
  app.state.api = new app.API("https://example.org", "other");
  release();
  await saving;
  assert.equal(app.getDrafts().length, 0);
  assert.ok(app.readStore(key, [])[0].serverId);
});

test("erasing a synced draft also removes its server copy", async () => {
  const server = scheduledServer(), { app, context } = draftClient(server);
  elements(context);
  app.state.draft = { ...article };
  app.saveDraft(app.state.draft);
  await app.syncServerDraft(article.id);
  Object.assign(app.state.draft, { title: "", subtitle: "", body: "" });
  assert.equal(app.flushDraft(), true);
  await app.syncServerDraft(article.id);
  assert.equal(server.statuses.size, 0);
  assert.equal(app.getDrafts().length, 0);
});

test("server limits include draft metadata and leave an exportable local copy", async () => {
  const server = scheduledServer(), { app } = draftClient(server);
  app.state.session.maxChars = 100;
  app.saveDraft({ ...article });
  await assert.rejects(app.syncServerDraft(article.id), /metadata exceed/);
  assert.equal(server.requests.some((r) => r.method === "POST"), false);
  assert.equal(app.getDrafts()[0].body, article.body);
});

test("schedule validation rejects missing, invalid, past and too-near dates before sending", async () => {
  const server = scheduledServer(), { app } = draftClient(server);
  for (const time of [undefined, null, "", "never", "2000-01-01T00:00:00Z", new Date(Date.now() + 60000).toISOString()]) {
    await assert.rejects(app.state.api.createScheduledStatus("text", "public", "", "text/plain", time, "key"), /five minutes/);
  }
  assert.equal(server.requests.length, 0);
});

test("explicit scheduling sends publish-ready content, removes server drafts and supports rescheduling", async () => {
  const server = scheduledServer(), { app, context } = draftClient(server);
  elements(context);
  app.state.view = "editor";
  app.state.draft = { ...article };
  app.saveDraft(app.state.draft);
  await app.syncServerDraft(article.id);
  const when = new Date(Date.now() + 3600000).toISOString();
  await app.scheduleDraft(when);
  assert.equal(app.state.draft, null);
  assert.equal(app.getDrafts().length, 0);
  assert.equal(server.statuses.size, 1);
  let remote = [...server.statuses.values()][0];
  assert.equal(remote.scheduled_at, when);
  assert.equal(remote.params.text, app.draftMarkdown(article));
  assert.equal(remote.params.content_type, "text/markdown");
  assert.doesNotMatch(remote.params.text, /fedistack-draft/);
  const later = new Date(Date.now() + 7200000).toISOString();
  await app.state.api.rescheduleStatus(remote.id, later);
  await app.loadServerDrafts();
  assert.equal(app.state.scheduledPosts[0].scheduled_at, later);
  assert.match(app.scheduledPostsView(), /Change time/);
  await app.state.api.deleteScheduledStatus(remote.id);
  await app.loadServerDrafts();
  assert.equal(app.state.scheduledPosts.length, 0);
});

test("failed scheduling retains the local draft and reuses its idempotency key", async () => {
  const server = scheduledServer(), { app, context } = draftClient(server);
  elements(context);
  app.state.view = "editor";
  app.state.draft = { ...article };
  server.fail = ({ method }) => method === "POST" && "Rejected";
  const when = new Date(Date.now() + 3600000).toISOString();
  await assert.rejects(app.scheduleDraft(when), /Rejected/);
  assert.equal(app.getDrafts()[0].body, article.body);
  const originalKey = app.getDrafts()[0].scheduleKey;
  server.fail = null;
  await app.scheduleDraft(when);
  const posts = server.requests.filter((r) => r.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].headers["Idempotency-Key"], originalKey);
  assert.equal(posts[1].headers["Idempotency-Key"], originalKey);
});

test("schedules from other clients, media posts and unrecognized data are never adopted as drafts", async () => {
  const server = scheduledServer(), { app } = draftClient(server);
  const base = { params: { text: app.encodeServerDraft(article), visibility: "public" }, media_attachments: [] };
  server.statuses.set("1", { ...base, id: "1", scheduled_at: "9999-01-01T00:00:00Z", media_attachments: [{}] });
  server.statuses.set("2", { ...base, id: "2", scheduled_at: new Date(Date.now() + 3600000).toISOString() });
  server.statuses.set("3", { ...base, id: "3", scheduled_at: "9999-01-01T00:00:00Z", params: { text: "<!-- broken -->" } });
  await app.loadServerDrafts();
  assert.equal(app.getDrafts().length, 0);
  assert.equal(app.state.scheduledPosts.length, 3);
  assert.equal(server.requests.every((r) => r.method === "GET"), true);
});

test("simultaneous server revisions remain individually editable and deletable", async () => {
  const server = scheduledServer(), { app } = draftClient(server);
  for (const [id, body] of [["a", "First revision"], ["b", "Second revision"]]) {
    server.statuses.set(id, { id, scheduled_at: app.serverDraftTime(article.id),
      params: { text: app.encodeServerDraft({ ...article, body }), visibility: "public" }, media_attachments: [] });
  }
  await app.loadServerDrafts();
  assert.equal(app.getDrafts().length, 2);
  assert.equal(new Set(app.getDrafts().map((d) => d.id)).size, 2);
  await app.loadServerDrafts();
  assert.equal(app.getDrafts().length, 2);
  const copy = app.getDrafts().find((d) => d.serverId === "b");
  app.saveDraft({ ...copy, body: "Edited second revision" });
  await app.syncServerDraft(copy.id);
  assert.equal(server.statuses.size, 2);
  await app.deleteSyncedDraft(copy.id);
  assert.equal(server.statuses.size, 1);
  assert.equal(server.statuses.has("a"), true);
});

test("a background refresh leaves the active editor and its pending local changes untouched", async () => {
  const server = scheduledServer(), { app, context } = draftClient(server);
  elements(context);
  app.saveDraft({ ...article });
  await app.syncServerDraft(article.id);
  app.state.draft = { ...app.getDrafts()[0], body: "Still typing" };
  app.state.view = "editor";
  await app.loadServerDrafts();
  assert.equal(app.state.draft.body, "Still typing");
  app.flushDraft();
  assert.equal(app.getDrafts()[0].body, "Still typing");
});

test("a server draft rescheduled elsewhere cannot be overwritten or erased by autosave", async () => {
  const server = scheduledServer(), { app, context } = draftClient(server);
  elements(context);
  app.state.draft = { ...article };
  app.saveDraft(app.state.draft);
  await app.syncServerDraft(article.id);
  const remote = [...server.statuses.values()][0];
  remote.scheduled_at = new Date(Date.now() + 3600000).toISOString();
  Object.assign(app.state.draft, { title: "", subtitle: "", body: "" });
  app.flushDraft();
  await assert.rejects(app.syncServerDraft(article.id), /scheduled or changed elsewhere/);
  assert.equal(server.statuses.size, 1);
});

test("the scheduled API paginates and rejects an unconfirmed server timestamp", async () => {
  let count = 0;
  const { app } = setup(async (url, options) => {
    if (options.method === "POST") return Response.json({ id: "oops", params: { text: "text" }, scheduled_at: null });
    count++;
    return Response.json([{ id: String(count) }], count === 1 ? {
      headers: { Link: '<https://example.org/api/v1/scheduled_statuses?max_id=2>; rel="next"' },
    } : {});
  });
  const api = new app.API("https://example.org", "token");
  assert.equal((await api.scheduledStatuses()).length, 2);
  assert.equal(count, 2);
  await assert.rejects(api.createScheduledStatus("text", "public", "", "text/plain",
    new Date(Date.now() + 3600000).toISOString(), "key"), /did not confirm/);
});

test("continued typing shares the pending 30-second upload and sends the latest draft", async () => {
  const server = scheduledServer(), { app, context } = draftClient(server);
  const timers = [];
  context.setTimeout = (run, delay) => {
    timers.push({ run, delay, cancelled: false });
    return timers.length;
  };
  context.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; };
  app.saveDraft({ ...article });
  app.saveDraft({ ...article, body: "Latest text after continued typing" });
  assert.equal(server.requests.length, 0);
  assert.equal(timers.length, 1, "typing must not postpone the pending upload");
  assert.equal(timers[0].delay, 30000);
  assert.equal(timers[0].cancelled, false);
  timers[0].run();
  await app.syncServerDraft(article.id);
  assert.equal(server.requests.filter((r) => r.method === "POST").length, 1);
  assert.match([...server.statuses.values()][0].params.text, /Latest text after continued typing/);
});

const profileAccount = (id = "me", extra = {}) => ({
  id, username: id, display_name: `Writer ${id}`, acct: `${id}@example.org`,
  avatar: "https://example.org/avatar.png", header: "https://example.org/header.png",
  note: "A writer on the open web", url: `https://example.org/@${id}`,
  followers_count: 123, following_count: 42, statuses_count: 77,
  created_at: "2020-01-02T00:00:00Z", ...extra,
});
async function profileFixture(fetch) {
  const fixture = await postActionFixture(fetch);
  const { app } = fixture;
  app.state.session = { ...longServer, server: "https://example.org", token: "profile-token", account: app.mapAccount(profileAccount()) };
  app.state.api = new app.API("example.org", "profile-token");
  return fixture;
}

test("own profile refreshes header and counts, shows loaded engagement and settings, and pages posts", async () => {
  const calls = [];
  const { app, context, get } = await profileFixture(async (url) => {
    const u = new URL(url); calls.push(u);
    if (u.pathname.endsWith("/relationships")) return Response.json([]);
    if (u.pathname.endsWith("/statuses")) return Response.json([
      sharedStatus({ id: u.searchParams.has("max_id") ? "older" : "newer", account: profileAccount(), favourites_count: 6, reblogs_count: 3 }),
      sharedStatus({ id: "dm", visibility: "direct", account: profileAccount() }),
      sharedStatus({ id: "reply", in_reply_to_id: "parent", account: profileAccount() }),
    ], { headers: u.searchParams.has("max_id") ? {} : { Link: '<https://example.org/api/v1/accounts/me/statuses?max_id=40>; rel="next"' } });
    return Response.json(profileAccount("me", { header: "https://example.org/fresh-header.png", followers_count: 124 }));
  });
  context.location.hash = "#profile";
  await app.route();
  assert.equal(app.state.profile.owner, true);
  assert.equal(app.state.session.account.followers, 124);
  assert.equal(app.state.profile.posts.length, 1);
  assert.match(get("app").innerHTML, /fresh-header.png/);
  assert.match(get("app").innerHTML, /On these 1 loaded posts/);
  assert.match(get("app").innerHTML, /Likes received/);
  assert.match(get("app").innerHTML, /href="#settings" class="button subtle small-button"/);
  assert.match(get("app").innerHTML, /aria-label="Your profile" aria-current="page"/);
  await app.loadProfilePage(true);
  assert.deepEqual(Array.from(app.state.profile.posts, (p) => p.id), ["newer", "older"]);
  assert.equal(app.state.profile.next, undefined);
  assert.equal(calls.filter((u) => u.pathname.endsWith("/statuses")).length, 2);
});

test("another account uses the same profile without requesting private likes or showing owner controls", async () => {
  const paths = [];
  const { app, context, get } = await profileFixture(async (url) => {
    const path = new URL(url).pathname; paths.push(path);
    if (path.endsWith("/relationships")) return Response.json([{ id: "other", following: false, requested: false, followed_by: true }]);
    if (path.endsWith("/statuses")) return Response.json([]);
    return Response.json(profileAccount("other"));
  });
  context.location.hash = "#profile/other?tab=likes";
  await app.route();
  assert.equal(app.state.profile.owner, false);
  assert.equal(app.state.profile.tab, "posts");
  assert.equal(paths.includes("/api/v1/favourites"), false);
  assert.match(get("app").innerHTML, /Follows you/);
  assert.match(get("app").innerHTML, /data-action="message-account" data-id="other"/);
  assert.doesNotMatch(get("app").innerHTML, /tab=likes|Likes received|On these/);
  assert.equal(app.state.session.account.id, "me");
});

test("boosts scan sparse pages, retain the cursor, and stop repeated pagination links", async () => {
  let pages = 0;
  const cursor = "https://example.org/api/v1/accounts/me/statuses?max_id=";
  const { app, context } = await profileFixture(async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/relationships")) return Response.json([]);
    if (!u.pathname.endsWith("/statuses")) return Response.json(profileAccount());
    pages++;
    if (pages === 1) assert.equal(u.searchParams.get("exclude_reblogs"), "false");
    return Response.json(pages <= 4 ? [sharedStatus({ id: `own-${pages}` })] : [
      sharedStatus({ id: "wrapper", reblog: sharedStatus({ id: "boosted", account: profileAccount("friend") }) }),
      sharedStatus({ id: "private-wrapper", reblog: sharedStatus({ visibility: "direct" }) }),
      sharedStatus({ id: "filtered-wrapper", reblog: sharedStatus({ id: "filtered", filtered: [{ filter: { filter_action: "hide" } }] }) }),
    ], { headers: { Link: `<${cursor}${Math.min(pages, 4)}>; rel="next"` } });
  });
  context.location.hash = "#profile?tab=boosts";
  await app.route();
  assert.equal(pages, 4);
  assert.equal(app.state.profile.posts.length, 0);
  assert.ok(app.state.profile.next);
  await app.loadProfilePage(true);
  assert.equal(pages, 5);
  assert.deepEqual(Array.from(app.state.profile.posts, (p) => p.id), ["boosted"]);
  assert.equal(app.state.profile.posts[0].reposted, true);
  assert.equal(app.state.profile.next, undefined);
  assert.equal(app.findPost("boosted").id, "boosted");
});

test("following lists paginate, deduplicate accounts, and reflect unfollows without leaving the profile", async () => {
  const { app, context, click } = await profileFixture(async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/unfollow")) return Response.json({ id: "friend", following: false, requested: false });
    if (u.pathname.endsWith("/relationships")) return Response.json([{ id: "friend", following: true, requested: false }]);
    if (u.pathname.endsWith("/following")) return Response.json(
      u.searchParams.has("max_id") ? [profileAccount("friend"), profileAccount("older-friend")] : [profileAccount("friend")],
      { headers: u.searchParams.has("max_id") ? {} : { Link: '<https://example.org/api/v1/accounts/me/following?max_id=40>; rel="next"' } });
    return Response.json(profileAccount());
  });
  context.location.hash = "#profile?tab=following";
  await app.route();
  await app.loadProfilePage(true);
  assert.deepEqual(Array.from(app.state.profile.people, (a) => a.id), ["friend", "older-friend"]);
  click("friend", "follow");
  await new Promise(setImmediate);
  assert.equal(app.state.profile.account.following, 41);
  assert.deepEqual(Array.from(app.state.profile.people, (a) => a.id), ["older-friend"]);
  assert.equal(app.state.view, "profile");
});

test("private likes come from favourites and unlike updates every cached copy after success only", async () => {
  let fail = true;
  const { app, context, click, get } = await profileFixture(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/relationships")) return Response.json([]);
    if (path.endsWith("/unfavourite")) return fail ? Response.json({ error: "Try later" }, { status: 503 }) : Response.json(sharedStatus({ favourited: false, favourites_count: 1 }));
    if (path === "/api/v1/favourites") return Response.json([sharedStatus({ account: profileAccount("other") })]);
    return Response.json(profileAccount());
  });
  context.location.hash = "#profile?tab=likes";
  await app.route();
  assert.equal(app.state.profile.posts[0].liked, true);
  assert.match(get("app").innerHTML, /Your likes · Only visible to you/);
  // A cached timeline copy can predate the like made in another client.
  app.state.posts = [{ ...app.state.profile.posts[0], liked: false }];
  click("slow-web", "like");
  await new Promise(setImmediate);
  assert.equal(app.state.profile.posts.length, 1);
  assert.equal(app.state.profile.posts[0].liked, true);
  fail = false;
  click("slow-web", "like");
  await new Promise(setImmediate);
  assert.equal(app.state.profile.posts.length, 0);
  assert.equal(app.state.posts[0].liked, false);
});

test("profile responses cannot overwrite a newer route or a different account session", async () => {
  let finish;
  const { app, context } = await profileFixture(async () => new Promise((resolve) => { finish = resolve; }));
  context.location.hash = "#profile";
  const loading = app.route();
  context.location.hash = "#settings";
  await app.route();
  finish(Response.json(profileAccount("me", { followers_count: 999 })));
  await loading;
  assert.equal(app.state.view, "settings");
  assert.equal(app.state.profile, null);
  assert.equal(app.state.session.account.followers, 123);
  context.location.hash = "#profile";
  const second = app.route();
  app.state.api = new app.API("different.example");
  finish(Response.json(profileAccount("me", { followers_count: 999 })));
  await second;
  assert.equal(app.state.session.account.followers, 123);
});

test("public profiles preserve source-server IDs without exposing account tokens or owner actions", async () => {
  const calls = [];
  const { app, context, get } = await profileFixture(async (url, options) => {
    calls.push({ url, options });
    return Response.json(new URL(url).pathname.endsWith("/statuses") ? [
      sharedStatus({ account: profileAccount(), id: "public-post" }),
      sharedStatus({ id: "private-post", visibility: "private" }),
    ] : profileAccount());
  });
  context.location.hash = "#profile/me?server=https%3A%2F%2Fremote.example&tab=likes";
  await app.route();
  assert.equal(app.state.profile.owner, false);
  assert.equal(app.state.profile.tab, "posts");
  assert.equal(app.state.readerServer, "https://remote.example");
  assert.equal(app.state.profile.posts.length, 1);
  assert.ok(calls.every(({ url, options }) => url.startsWith("https://remote.example/") && !options.headers.Authorization));
  assert.match(get("app").innerHTML, /href="#profile\/me\?server=https%3A%2F%2Fremote.example"/);
  assert.doesNotMatch(get("app").innerHTML, /data-action="(?:follow|like|save|repost|delete-publication)"|tab=likes/);
  assert.match(app.postReadLink("public-post"), /server=https%3A%2F%2Fremote.example/);
});

test("recommendations filter followed, requested, muted, blocked and own accounts, and stay out of Saved", async () => {
  const { app, context, get } = await profileFixture(async (url) => {
    if (url.includes("/suggestions")) return Response.json(["me", "following", "requested", "blocked", "muted", "new"].map((id) => ({ account: profileAccount(id) })));
    return Response.json(["me", "following", "requested", "blocked", "muted", "new"].map((id) => ({
      id, following: id === "following", requested: id === "requested", blocking: id === "blocked", muting: id === "muted",
    })));
  });
  app.state.posts = app.demoPosts;
  app.state.filter = "all";
  await app.loadSuggestions();
  assert.deepEqual(Array.from(app.suggestedAccounts(), (a) => a.id), ["new"]);
  assert.match(get("app").innerHTML, /class="feed-suggestions"/);
  app.state.view = "bookmarks";
  app.render();
  assert.doesNotMatch(get("app").innerHTML, /class="feed-suggestions"/);
  app.state.relationships.set("new", { id: "new", following: true, requested: false });
  assert.equal(app.suggestedAccounts().length, 0);
  context.location.hash = "#settings";
});

test("unavailable suggestions fall back to v1 only for unsupported endpoints and never block reading", async () => {
  const calls = [];
  const { app } = setup(async (url) => {
    calls.push(url);
    if (url.includes("v2")) return Response.json({}, { status: 404 });
    return Response.json([profileAccount("new")]);
  });
  app.htmlToMarkdown = (text) => text;
  const api = new app.API("example.org");
  assert.equal((await api.suggestions())[0].id, "new");
  assert.equal(calls.length, 2);
  const { app: denied } = setup(async () => Response.json({}, { status: 403 }));
  await assert.rejects(new denied.API("example.org").suggestions(), /403/);
});

test("demo profiles show local activity and following; profile fields are escaped", async () => {
  const { app, context, get } = await postActionFixture();
  const liked = app.demoState.posts[0]; liked.liked = true;
  context.location.hash = "#profile?tab=likes";
  await app.route();
  assert.equal(app.state.profile.posts[0].id, liked.id);
  context.location.hash = "#profile?tab=following";
  await app.route();
  assert.equal(app.state.profile.people.length, app.demoState.follows.length);
  app.state.profile.account.name = '<img src=x onerror=alert(1)>';
  app.state.profile.account.fields = [{ name: "<script>", value: '<iframe src="bad">' }];
  app.render();
  assert.doesNotMatch(get("app").innerHTML, /<script>|<iframe|<img src=x/);
  assert.match(get("app").innerHTML, /&lt;script&gt;/);
});
