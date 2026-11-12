import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

const bundle = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
const configScript = readFileSync(new URL("../dist/config.js", import.meta.url), "utf8");
const vimScript = readFileSync(new URL("../dist/editor-vim.js", import.meta.url), "utf8");
const highlightScript = readFileSync(new URL("../dist/highlight.min.js", import.meta.url), "utf8");
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
  config,
) {
  const context = vm.createContext({
    URL,
    URLSearchParams,
    FormData,
    Headers,
    Response,
    TextEncoder,
    TextDecoder,
    AbortController,
    Image: class {
      naturalWidth = 32;
      set src(value) { this.url = value; queueMicrotask(() => this.onload?.()); }
    },
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
  if (config === undefined) vm.runInContext(configScript, context);
  else if (config !== null) context.FEDISTACK_CONFIG = config;
  vm.runInContext(highlightScript, context);
  vm.runInContext(vimScript, context);
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
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name] ?? null; },
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
    server: "https://nyap.example", token: "test-token",
    account: { id: "me", name: "Writer", acct: "writer", avatar: "", bio: "" },
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
  context.document.hidden = true;
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
  assert.match(html, /<script src="highlight.min.js" defer>[\s\S]*<script src="app.js" defer>/);
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
    rendered.replace(/<\/?span\b[^>]*>/g, ""),
    /<pre><code[^>]*>&lt;script&gt;\*\*code\*\*&lt;\/script&gt;<\/code><\/pre>/,
  );
  assert.match(rendered, /rel="noopener noreferrer"/);
});

test("code fences highlight explicit languages and aliases, and detect unlabeled code", () => {
  const { app } = setup();
  for (const [language, code] of [
    ["ts", "const answer: number = 42;"],
    ["js", "const answer = 42;"],
    ["python", "def answer():\n    return 42"],
    ["c", "int main(void) { return 42; }"],
    ["bash", 'echo "$HOME"'],
  ]) {
    const rendered = app.markdown(`\`\`\`${language}\n${code}\n\`\`\``);
    assert.match(rendered, new RegExp(`class="hljs language-${language}"`));
    assert.match(rendered, /<span class="hljs-/);
    assert.equal(rendered.replace(/<[^>]*>/g, ""), app.escapeHTML(code));
  }
  assert.match(app.markdown('```\n{"answer": 42, "ready": true}\n```'), /<span class="hljs-/);
  assert.match(app.markdown('```TS title=example\nconst answer = 42;\n```'), /class="hljs language-ts"/);
});

test("highlighted code stays escaped, with plain fallbacks for unsupported languages", () => {
  const { app, context } = setup();
  const code = '<script>alert("x")</script> & <img src=x onerror=alert(1)>';
  for (const language of ["html", "js", "", "unknown", "text", 'js"onclick="alert(1)', "__proto__"]) {
    const rendered = app.markdown(`\`\`\`${language}\n${code}\n\`\`\``);
    assert.doesNotMatch(rendered, /<script|<img|<code[^>]*onclick=/);
    assert.equal(rendered.replace(/<[^>]*>/g, ""), app.escapeHTML(code));
    if (!["html", "js", ""].includes(language)) assert.doesNotMatch(rendered, /<span/);
  }
  context.hljs = undefined;
  const rendered = app.markdown(`\`\`\`js\n${code}\n\`\`\``);
  assert.doesNotMatch(rendered, /<span|<script|<img/);
  assert.equal(rendered.replace(/<[^>]*>/g, ""), app.escapeHTML(code));
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

test("a configured default prefills the picker and still allows other instances", async () => {
  const { app } = setup(undefined, {}, { defaultServer: " HTTPS://Example.ORG:443/ " });
  let html;
  app.showModal = (_title, body) => { html = body; };
  app.connectDialog();
  assert.match(html, /name="fediverse-server"[^>]*value=" HTTPS:\/\/Example.ORG:443\/ "/);
  assert.equal(app.loginServer(""), "https://example.org");
  assert.equal(app.loginServer("elsewhere.example"), "https://elsewhere.example");
  assert.equal(new app.API("elsewhere.example", "token").server, "https://elsewhere.example");
});

test("locked sign-in skips server entry for OAuth and manual tokens", async () => {
  const requests = [];
  const { app, context } = setup(async (url) => {
    requests.push(url);
    return Response.json({ client_id: "client", client_secret: "secret" });
  }, {}, { defaultServer: "EXAMPLE.org", allowOtherServers: false });
  const { get } = elements(context);
  let html;
  app.showModal = (_title, body) => { html = body; };
  app.connectDialog();
  assert.doesNotMatch(html, /name="fediverse-server"|check-server|Enter your server|choose a server/);
  assert.match(html, /Continue to EXAMPLE.org/);
  assert.match(html, /name="remember"/);
  get("remember-session").checked = true;
  app.connectTokenDialog();
  assert.match(html, /data-server="https:\/\/example.org"/);
  assert.match(html, /name="remember" checked/);
  await app.startOAuth("", false, true);
  assert.deepEqual(requests, ["https://example.org/api/v1/apps"]);
  assert.equal(new URL(context.location.assigned).origin, "https://example.org");
  assert.equal(app.readStore("oauth", null, true).remember, true);
  assert.equal(new app.API("https://EXAMPLE.org:443/", "token").server, "https://example.org");
});

test("locked sign-in rejects foreign OAuth, tokens, and sessions before making requests", async () => {
  let requests = 0;
  const { app } = setup(async () => { requests++; }, {}, {
    defaultServer: "example.org", allowOtherServers: false,
  });
  for (const server of ["other.example", "example.org.evil.example", "https://example.org:8443"]) {
    await assert.rejects(app.startOAuth(server), /only supports signing in to example.org/);
    assert.throws(() => new app.API(server, "token"), /only supports signing in/);
    assert.throws(() => app.saveSession({ server, token: "token" }), /only supports signing in/);
  }
  for (const redirect of ["https://reader.example/fedistack/", "urn:ietf:wg:oauth:2.0:oob"]) {
    app.writeStore("oauth", {
      server: "https://other.example", redirect, state: "expected", created: Date.now(),
    }, true);
    await assert.rejects(app.finishOAuth("code", "expected"), /only supports signing in/);
    assert.equal(app.readStore("oauth", null, true), null);
  }
  assert.equal(requests, 0);
});

test("locked deployments ignore old foreign sessions in either store and keep drafts", () => {
  for (const remember of [false, true]) {
    const stores = { localStorage: storage(), sessionStorage: storage() };
    const session = { server: "https://other.example", token: "old-token", remember };
    stores[remember ? "localStorage" : "sessionStorage"].setItem("fedistack:session", JSON.stringify(session));
    stores.localStorage.setItem("fedistack:drafts:https://other.example:me", JSON.stringify([article]));
    const { app } = setup(undefined, stores, { defaultServer: "example.org", allowOtherServers: false });
    assert.equal(app.state.session, null);
    assert.equal(app.readStore("drafts:https://other.example:me", [])[0].id, article.id);
    stores.localStorage.setItem("fedistack:session", JSON.stringify({ ...session, server: "https://EXAMPLE.org:443/" }));
    assert.equal(app.loadSession().server, "https://example.org");
  }
});

test("a missing config script leaves the server picker and sign-in available", async () => {
  const { app, context } = setup(async () =>
    Response.json({ client_id: "client", client_secret: "secret" }), {}, null);
  assert.equal("FEDISTACK_CONFIG" in context, false);
  let html;
  app.showModal = (_title, body) => { html = body; };
  app.connectDialog();
  assert.match(html, /name="fediverse-server"[^>]*value=""/);
  assert.equal(new app.API("example.org", "token").server, "https://example.org");
  await app.startOAuth("example.org");
  assert.equal(new URL(context.location.assigned).origin, "https://example.org");
});

test("an invalid default server can be corrected in the picker before sign-in", () => {
  for (const defaultServer of ["http://example.org", "https://example.org/path"]) {
    const { app } = setup(undefined, {}, { defaultServer });
    let html;
    app.showModal = (_title, body) => { html = body; };
    app.connectDialog();
    assert.match(html, /name="fediverse-server"/);
    assert.throws(() => app.loginServer(""), /Enter an HTTPS server domain/);
    assert.equal(app.loginServer("example.org"), "https://example.org");
  }
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
  assert.equal(app.saveSession({ server: "https://example.org", token: "new-account", remember: true }), false);
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

test("DM bubbles and previews hide participant mentions without changing stored messages", () => {
  const { app } = setup();
  const me = { ...app.demoMe, id: "me", acct: "me", url: "https://home.example/@me" };
  const alice = { ...app.demoAuthors[0], id: "alice", acct: "a@b.com", url: "https://b.com/@a" };
  const bob = { ...app.demoAuthors[1], id: "bob", acct: "bob@other.example", url: "https://other.example/users/bob" };
  app.state.session = { account: me, server: "https://home.example" };
  app.state.conversation = "chat";
  const cases = [
    ["@a@b.com hello", "hello"],
    ["hello @a@b.com", "hello"],
    ["hello @a@b.com how are you?", "hello how are you?"],
    ["@a@b.com @bob@other.example hello", "hello"],
    ["@a@b.com\n\n**Hello**\nsecond line", "**Hello**\nsecond line"],
    ["hello @A@B.COM!", "hello!"],
    ["@me @me@home.example hello", "hello"],
    ["[@a](https://b.com/@a) hello", "hello"],
    ["hello [@a@b.com](https://b.com/@a/)", "hello"],
    ["[@me](https://home.example/@me) [@bob](https://other.example/users/bob) hello", "hello"],
    ["@a@b.com", ""],
    ["@outsider@elsewhere.example hello", "@outsider@elsewhere.example hello"],
    ["@a@b.com.evil hello", "@a@b.com.evil hello"],
    ["@a hello", "@a hello"],
    ["Email user@b.com or literal user@a@b.com", "Email user@b.com or literal user@a@b.com"],
    ["@a@b.com See https://b.com/@a@b.com", "See https://b.com/@a@b.com"],
    ["@a@b.com Use `@a@b.com` in the example", "Use `@a@b.com` in the example"],
    ["@a@b.com\n\n```\n  @a@b.com  example\n```", "```\n  @a@b.com  example\n```"],
    ["```\n@a@b.com", "```\n@a@b.com"],
    ["\\@a@b.com", "\\@a@b.com"],
    ["[@a](https://unrelated.example)", "[@a](https://unrelated.example)"],
    ["[Alice's profile](https://b.com/@a)", "[Alice's profile](https://b.com/@a)"],
    ["![@a](https://b.com/@a)", "![@a](https://b.com/@a)"],
  ];
  for (const [source, expected] of cases) {
    for (const author of [me, alice]) {
      const post = { ...app.demoPosts[0], id: "dm", author, markdown: source, visibility: "direct", warning: "" };
      app.state.conversations = [{ id: "chat", accounts: [alice, bob], unread: false, messages: [post] }];
      const html = app.messagesView();
      const bubble = html.match(/<div class="message-bubble prose">([\s\S]*?)<\/div><small>/)?.[1];
      const preview = html.match(/class="conversation-item [^"]*"[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1];
      assert.equal(bubble, app.markdown(expected), source);
      assert.equal(preview, app.escapeHTML(app.plainText(expected).slice(0, 65)), source);
      assert.equal(post.markdown, source);
      post.warning = "Content warning";
      assert.ok(app.messagesView().includes(`<details><summary>Content warning</summary>${app.markdown(expected)}</details>`), source);
    }
  }
});

test("DMs automatically address every participant while displaying only the message", async () => {
  const { app } = setup();
  const me = { ...app.demoMe, id: "me", acct: "me", url: "https://home.example/@me" };
  const alice = { ...app.demoAuthors[0], id: "alice", acct: "a@b.com", url: "https://b.com/@a" };
  const bob = { ...app.demoAuthors[1], id: "bob", acct: "bob@other.example", url: "https://other.example/@bob" };
  const previous = { ...app.demoPosts[0], id: "previous", author: alice, markdown: "Hi", visibility: "direct", warning: "" };
  const conversation = { id: "chat", accounts: [alice, bob, me], unread: false, messages: [previous] };
  const requests = [];
  app.state.session = { account: me, server: "https://home.example", maxChars: 500 };
  app.state.conversations = [conversation];
  app.state.conversation = "chat";
  app.state.api = {
    createStatus: async (...args) => {
      requests.push(args);
      return { ...previous, id: "sent", author: me, markdown: args[0] };
    },
  };
  await app.sendMessage("chat", "hello");
  assert.deepEqual(requests, [["@a@b.com @bob@other.example hello", "direct", "previous"]]);
  assert.equal(conversation.messages[1].markdown, requests[0][0]);
  const html = app.messagesView();
  assert.match(html, /<div class="message outgoing"><div class="message-bubble prose"><p>hello<\/p>/);
  assert.match(html, /class="conversation-item [^"]*"[\s\S]*?<p>hello<\/p>/);
  app.state.session.maxChars = 10;
  await assert.rejects(app.sendMessage("chat", "hello"), /including recipient mentions/);
  assert.equal(requests.length, 1);
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

test("a failed avatar gets a fresh image element when the profile is rendered again", () => {
  const { app, root, content, image } = imageRenderFixture();
  const failed = image("https://example.org/avatar.png"), loaded = image("https://example.org/cover.png");
  failed.complete = true;
  failed.naturalWidth = 0;
  loaded.complete = true;
  loaded.naturalWidth = 100;
  root.images = [failed, loaded];
  const retry = image(failed.src);
  content.images = [retry, image(loaded.src)];
  app.renderHTML(root, "refresh after the server's image becomes available");
  assert.deepEqual(root.images, [retry, loaded]);
  assert.equal(retry.src, failed.src);
});

test("failed avatar images reveal initials without hiding other page images", () => {
  const { app } = setup();
  const account = { id: "me", name: "Writer Me", avatar: "https://example.org/missing.png" };
  assert.match(app.avatar(account), /<span class="avatar-initials">WM<\/span>/);
  const avatar = { matches: (selector) => selector === "img[data-avatar-key]", hidden: false };
  app.imageLoadError({ target: avatar });
  assert.equal(avatar.hidden, true);
  const cover = { matches: () => false, hidden: false };
  app.imageLoadError({ target: cover });
  assert.equal(cover.hidden, false);
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

test("the DM keyboard hides navigation and keeps the latest message visible without interrupting history reading", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  context.window = { innerWidth: 390, innerHeight: 800 };
  assert.doesNotThrow(() => app.updateConversationViewport());

  const classes = new Map();
  context.document.body.classList.toggle = (name, enabled) => classes.set(name, enabled);
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
  context.window.visualViewport = { height: 800, offsetTop: 0, scale: 1 };
  app.updateConversationViewport();
  context.document.activeElement = { id: "message-body" };
  app.updateConversationViewport();
  assert.equal(classes.get("conversation-keyboard-open"), false);

  Object.assign(context.window.visualViewport, { height: 500, offsetTop: 40 });
  app.updateConversationViewport();
  assert.equal(classes.get("conversation-keyboard-open"), true);
  assert.equal(styles.get("--conversation-height"), "500px");
  assert.equal(styles.get("--conversation-top"), "40px");
  assert.equal(thread.scrollTop, 1500);

  // Reading an earlier message must not jump to the newest one on a resize.
  thread.scrollTop = 100;
  context.window.innerHeight = 450;
  Object.assign(context.window.visualViewport, { height: 450, offsetTop: 60 });
  app.updateConversationViewport();
  assert.equal(classes.get("conversation-keyboard-open"), true);
  assert.equal(thread.scrollTop, 100);

  thread.scrollTop = thread.scrollHeight;
  context.window.innerHeight = 800;
  Object.assign(context.window.visualViewport, { height: 800, offsetTop: 0 });
  app.updateConversationViewport();
  assert.equal(classes.get("conversation-keyboard-open"), false);
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
  const { app, context } = editorNavigationFixture();
  app.state.view = "editor";
  app.state.draft = { ...article };
  context.location.hash = "#settings";
  await app.route();
  assert.equal(app.state.view, "editor");
  await app.saveAndLeaveEditor();
  await app.route();
  assert.equal(app.state.draft, null);
  app.removeDraft(article.id);
  app.flushDraft();
  assert.equal(app.getDrafts().length, 0);
});

test("an unsaved draft stays in the editor if storage fails during navigation", async () => {
  const { app, context, get } = editorNavigationFixture();
  app.state.view = "editor";
  app.state.draft = { ...article };
  context.localStorage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  context.location.hash = "#settings";
  await app.route();
  await assert.rejects(app.saveAndLeaveEditor(), /could not be saved/);
  assert.equal(get("modal").open, true);
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

test("the editor uses concise save feedback and still reports failed saves", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.state.draft = { ...article };
  assert.match(app.editorView(), /data-action="save-draft"[^>]*>Save draft<\/button>/);
  assert.match(app.editorView(), />Unsaved<\/span>/);
  assert.doesNotMatch(app.editorView(), /Draft · unpublished|Saved at|this device|server-save-status/);
  get("save-status");
  assert.equal(app.flushDraft(), true);
  assert.equal(get("save-status").dataset.state, "saved");
  assert.equal(get("save-status").textContent, "Saved");
  assert.match(app.editorView(), /data-state="saved"/);
  context.localStorage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  app.state.draft.body = "Changed text";
  assert.equal(app.flushDraft(), false);
  assert.equal(get("save-status").dataset.state, "error");
  assert.match(get("save-status").textContent, /Save failed/);
});

for (const kind of ["article", "post"]) test(`Save draft captures the latest ${kind} text without publishing or leaving the editor`, async () => {
  const { app, context, get, click } = await postActionFixture();
  app.state.view = "editor";
  app.state.draft = { ...article, kind };
  get("draft-body").value = "Latest text, before the autosave timer runs.";
  get("save-status");
  const output = app.editorView();
  assert.match(output, /data-action="save-draft"[^>]*>Save draft<\/button>/);
  assert.doesNotMatch(output, /Draft · unpublished|Save &amp; close|Save & close|server-save-status/);
  click("", "save-draft");
  await new Promise(setImmediate);
  assert.equal(app.getDrafts()[0].body, get("draft-body").value);
  assert.equal(get("save-status").textContent, "Saved");
  assert.equal(get("toast").textContent, "Draft saved.");
  assert.equal(app.state.view, "editor");
  assert.equal(context.location.hash, "");

  context.localStorage.setItem = () => { throw new Error("Quota exceeded"); };
  get("draft-body").value = "Changes that cannot be saved";
  click("", "save-draft");
  await new Promise(setImmediate);
  assert.equal(get("save-status").dataset.state, "error");
  assert.match(get("toast").textContent, /Could not save/);
  assert.equal(app.state.draft.body, "Changes that cannot be saved");
  assert.equal(app.getDrafts()[0].body, "Latest text, before the autosave timer runs.");
});

test("the save shortcut captures current input and does not create empty drafts", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.state.view = "editor";
  app.state.draft = app.newDraft();
  get("draft-body").value = "";
  get("save-status");
  get("modal").open = false;
  let prevented = 0;
  const save = () => app.editorKeydown({ key: "s", ctrlKey: true, preventDefault() { prevented++; } });
  save();
  assert.equal(app.getDrafts().length, 0);
  assert.equal(get("toast").textContent, "Nothing to save yet.");
  get("draft-body").value = "Text captured by the keyboard shortcut";
  save();
  assert.equal(app.getDrafts()[0].body, get("draft-body").value);
  assert.equal(get("toast").textContent, "Draft saved.");
  assert.equal(prevented, 2);
});

test("the reader puts Edit above the title and places bookmark between repost and sharing links", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const own = { ...app.demoPosts[0], author: app.demoMe, url: "https://example.org/own" };
  app.state.view = "reader";
  app.state.reading = own;
  app.render();
  const html = get("app").innerHTML;
  assert.match(html, /class="page-top">[^]*data-action="edit-publication"[^]*<\/header><article class="reader">[^]*<h1>/);
  assert.match(html, /data-action="repost"[^]*data-action="save"[^]*data-action="share"[^]*aria-label="Open original post"/);
  assert.doesNotMatch(html, /data-action="(?:delete|unpublish)-publication"/);
  assert.match(app.postCard(own), /data-action="edit-publication"[^]*<h2>/);
  for (const post of [app.demoPosts[0], { ...own, visibility: "direct" }]) {
    app.state.reading = post;
    app.render();
    assert.doesNotMatch(get("app").innerHTML, /data-action="edit-publication"/);
  }
});

test("Delete and Unpublish are available only when editing a publication", () => {
  const { app } = setup();
  for (const kind of ["article", "post"]) {
    const draft = app.newDraft(kind);
    app.state.draft = draft;
    assert.doesNotMatch(app.editorView(), /data-action="(?:unpublish|delete)-publication"/);
    draft.editingId = "original";
    assert.match(app.editorView(), /data-action="unpublish-publication" data-id="original"/);
    assert.match(app.editorView(), /data-action="delete-publication" data-id="original"/);
  }
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
  const windowListeners = new Map();
  context.window = { addEventListener: (name, listener) => windowListeners.set(name, listener) };
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
  return { app, context, get, click, listeners, windowListeners };
}

function editorNavigationFixture(stores) {
  const client = setup(undefined, stores);
  let hash = "";
  Object.defineProperty(client.context.location, "hash", {
    get: () => hash,
    set: (value) => { hash = value && !value.startsWith("#") ? `#${value}` : value; },
  });
  const { get } = elements(client.context);
  const modal = get("modal");
  modal.querySelector = () => null;
  modal.showModal = () => { modal.open = true; };
  modal.close = () => { modal.open = false; };
  client.context.history.replaceState = (_state, _title, url) => { client.context.location.hash = url; };
  return { ...client, get };
}

for (const kind of ["article", "post"]) test(`leaving a ${kind} requires confirmation and saves the latest input before continuing`, async () => {
  for (const destination of ["home", "drafts", "note", "write", "write/another", "discover?q=writing"]) {
    const { app, context, get } = editorNavigationFixture();
    const draft = { ...article, kind, editingId: "original", media: [{ id: "image", description: "A picture" }] };
    app.state.view = "editor";
    app.state.draft = draft;
    app.saveDraft(draft);
    context.location.hash = `#write/${draft.id}`;
    const textarea = get("draft-body");
    Object.assign(textarea, { value: "Fresh writing before autosave", selectionStart: 8, selectionEnd: 12 });
    get("app").innerHTML = "The existing editor";
    app.navigate(destination);
    assert.equal(context.location.hash, `#write/${draft.id}`);
    assert.equal(app.state.draft, draft);
    assert.equal(get("app").innerHTML, "The existing editor");
    assert.match(get("modal").innerHTML, /unsaved changes/);
    assert.match(get("modal").innerHTML, /Keep editing/);
    assert.match(get("modal").innerHTML, /published version stays unchanged/);
    app.closeModal();
    await app.saveAndLeaveEditor();
    assert.equal(app.state.draft, draft, "a dismissed dialog cannot navigate later");
    assert.equal(textarea.selectionStart, 8);
    assert.equal(textarea.selectionEnd, 12);

    app.navigate(destination);
    get("modal").close(); // Native Escape closes the dialog without a button action.
    await app.saveAndLeaveEditor();
    assert.equal(app.state.draft, draft);

    app.flushDraft();
    app.navigate(destination);
    assert.match(get("modal").innerHTML, /saved on this device/);
    assert.equal(app.state.view, "editor", "autosaved work still gets a leave confirmation");
    await app.saveAndLeaveEditor();
    assert.equal(context.location.hash, `#${destination}`);
    assert.equal(app.state.draft, null);
    const saved = app.getDrafts()[0];
    assert.equal(saved.body, textarea.value);
    assert.equal(saved.editingId, "original");
    assert.equal(saved.media[0].description, "A picture");
  }
});

test("Back/Forward hash navigation restores the editor URL and can be cancelled or confirmed", async () => {
  const { app, context, get } = editorNavigationFixture();
  app.state.view = "editor";
  app.state.draft = { ...article };
  get("draft-body").value = "An edit made just before Back";
  context.location.hash = "#settings";
  await app.route();
  assert.equal(context.location.hash, `#write/${article.id}`);
  assert.equal(app.state.view, "editor");
  app.closeModal();
  assert.equal(app.state.draft.body, "An edit made just before Back");
  context.location.hash = "#settings";
  await app.route();
  await app.saveAndLeaveEditor();
  context.location.hash = "#settings";
  await app.route();
  assert.equal(app.state.view, "settings");
  assert.equal(app.getDrafts()[0].body, "An edit made just before Back");
});

test("save-and-leave retries a failed save without navigating or losing input", async () => {
  const { app, context, get } = editorNavigationFixture();
  app.state.view = "editor";
  app.state.draft = { ...article };
  app.saveDraft(app.state.draft);
  context.location.hash = `#write/${article.id}`;
  get("draft-body").value = "Keep these unsaved edits";
  const setItem = context.localStorage.setItem;
  context.localStorage.setItem = () => { throw new Error("Storage full"); };
  app.navigate("drafts");
  await assert.rejects(app.saveAndLeaveEditor(), /could not be saved/);
  assert.equal(get("modal").open, true);
  assert.equal(context.location.hash, `#write/${article.id}`);
  assert.equal(app.state.draft.body, "Keep these unsaved edits");
  assert.equal(app.getDrafts()[0].body, article.body);
  context.localStorage.setItem = setItem;
  await app.saveAndLeaveEditor();
  assert.equal(context.location.hash, "#drafts");
  assert.equal(app.getDrafts()[0].body, "Keep these unsaved edits");
});

test("empty editors leave freely, warning-only drafts are saved, and the same draft keeps its editor", async () => {
  const { app, context, get } = editorNavigationFixture();
  app.state.view = "editor";
  app.state.draft = app.newDraft();
  app.navigate("settings");
  assert.equal(context.location.hash, "#settings");
  assert.equal(get("modal").open, undefined);
  assert.equal(app.getDrafts().length, 0);
  app.state.draft.warning = "Keep this content warning";
  context.location.hash = `#write/${app.state.draft.id}`;
  app.navigate("settings");
  assert.equal(get("modal").open, true);
  await app.saveAndLeaveEditor();
  assert.equal(app.getDrafts()[0].warning, "Keep this content warning");
  app.state.draft = { ...article };
  get("app").innerHTML = "Keep selection and undo history";
  app.navigate(`write/${article.id}`);
  context.location.hash = `#write/${article.id}`;
  await app.route();
  assert.equal(get("app").innerHTML, "Keep selection and undo history");
});

test("Your writing offers the last edited draft above every tab and restores it after reload", async () => {
  const { app, context, get } = editorNavigationFixture();
  app.saveDraft({ ...article, editingId: "published-id", body: "Unpublished edits" });
  app.saveDraft({ ...article, id: "other", title: "Another draft" });
  context.location.hash = `#write/${article.id}`;
  await app.route();
  app.navigate("drafts");
  await app.saveAndLeaveEditor();
  context.location.hash = "#drafts";
  await app.route();
  for (const tab of ["drafts", "published", "replies", "scheduled"]) {
    app.state.libraryTab = tab;
    app.render();
    const html = get("app").innerHTML;
    assert.match(html, /WORK IN PROGRESS · UNPUBLISHED CHANGES/);
    assert.match(html, /class="continue-editing"[^]*?href="#write\/draft-one"[^]*?>Continue editing/);
    assert.ok(html.indexOf('class="continue-editing"') < html.indexOf('class="timeline-tabs"'));
  }
  const reloaded = editorNavigationFixture({ localStorage: context.localStorage });
  reloaded.context.location.hash = "#drafts";
  await reloaded.app.route();
  assert.match(reloaded.get("app").innerHTML, /WORK IN PROGRESS · UNPUBLISHED CHANGES/);
  reloaded.context.location.hash = `#write/${article.id}`;
  await reloaded.app.route();
  assert.equal(reloaded.app.state.draft.body, "Unpublished edits");
  assert.equal(reloaded.app.state.draft.editingId, "published-id");
  app.removeDraft(article.id);
  app.render();
  assert.match(get("app").innerHTML, /class="continue-editing"[^]*?href="#write\/other"/);
  app.removeDraft("other");
  app.render();
  assert.doesNotMatch(get("app").innerHTML, /class="continue-editing"/);
  app.state.session = { server: "https://another.example", account: { id: "someone-else" } };
  assert.equal(app.getDrafts().length, 0);
});

test("internal links use the leave guard while modified clicks keep their normal behavior", async () => {
  const { app, context, get, listeners } = await postActionFixture();
  const modal = get("modal");
  modal.querySelector = () => null;
  modal.showModal = () => { modal.open = true; };
  modal.close = () => { modal.open = false; };
  app.state.view = "editor";
  app.state.draft = { ...article };
  context.location.hash = `#write/${article.id}`;
  const link = { hash: "#home", target: "", hasAttribute: () => false };
  let prevented = false;
  const event = { button: 0, target: { closest: (selector) => selector === 'a[href^="#"]' ? link : null }, preventDefault() { prevented = true; } };
  listeners.get("click")({ ...event, ctrlKey: true });
  assert.equal(prevented, false);
  assert.equal(modal.open, undefined);
  listeners.get("click")(event);
  assert.equal(prevented, true);
  assert.equal(modal.open, true);
  assert.equal(context.location.hash, `#write/${article.id}`);
});

test("page exit captures the latest input and warns when local saving fails", async () => {
  const { app, context, get, windowListeners } = await postActionFixture();
  app.state.view = "editor";
  app.state.draft = { ...article };
  get("draft-body").value = "Last input before hiding the page";
  windowListeners.get("pagehide")();
  assert.equal(app.getDrafts()[0].body, get("draft-body").value);
  get("draft-body").value = "Last input before closing the tab";
  let prevented = false;
  const event = { preventDefault() { prevented = true; } };
  windowListeners.get("beforeunload")(event);
  assert.equal(app.getDrafts()[0].body, get("draft-body").value);
  assert.equal(prevented, false);
  context.localStorage.setItem = () => { throw new Error("Storage full"); };
  get("draft-body").value = "Unsaved text that must not disappear";
  windowListeners.get("beforeunload")(event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, "");
  assert.equal(app.state.draft.body, get("draft-body").value);
});

test("blocked Back navigation preserves scrolling, while resuming a draft starts at the editor header", async () => {
  const { app, context, get, windowListeners } = await postActionFixture();
  const modal = get("modal");
  modal.querySelector = () => null;
  modal.showModal = () => { modal.open = true; };
  modal.close = () => { modal.open = false; };
  app.state.view = "editor";
  app.state.draft = { ...article };
  app.saveDraft(app.state.draft);
  const scrolls = [];
  context.window.scrollY = 400;
  context.window.scrollTo = (...args) => { scrolls.push(args); context.window.scrollY = args[1]; };
  context.location.hash = "#settings";
  windowListeners.get("hashchange")();
  assert.equal(app.state.view, "editor");
  assert.equal(scrolls.length, 0);
  app.closeModal();
  app.state.view = "drafts";
  app.state.draft = null;
  context.location.hash = `#write/${article.id}`;
  windowListeners.get("hashchange")();
  assert.equal(app.state.view, "editor");
  assert.deepEqual(scrolls, [[0, 0]]);
});

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

test("publication metadata uses the article subtitle and its own images", () => {
  const { app } = setup();
  const post = {
    ...app.demoPosts[0], title: 'Title with "quotes" & <angle brackets>', subtitle: "A useful subtitle",
    markdown: "# Title\n\nArticle text.", image: "https://images.example/cover.jpg", imageAlt: "The cover",
    linkPreview: { title: "Someone else's page", image: "https://images.example/unrelated.jpg" },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(app.publicationMetadata(post))), {
    title: post.title, description: post.subtitle, image: post.image, imageAlt: "The cover", type: "article",
  });
  post.media = [{ type: "image", url: "https://images.example/full.jpg", previewUrl: "https://images.example/thumb.jpg", description: "Full image" }];
  assert.equal(app.publicationMetadata(post).image, post.media[0].url);
  post.image = "javascript:alert(1)";
  post.media = [];
  post.subtitle = "";
  post.markdown = `# ${post.title}\n\nInferred subtitle\n\nBody text.\n\n![A \\[quoted\\] & image](https://images.example/inline.jpg?a=1&b=2)`;
  const inferred = app.publicationMetadata(post);
  assert.equal(inferred.description, "Inferred subtitle");
  assert.equal(inferred.image, "https://images.example/inline.jpg?a=1&b=2");
  assert.equal(inferred.imageAlt, "A [quoted] & image");
  post.markdown = "A **formatted** body without a subtitle.\n\n```md\n![Code](https://images.example/code.jpg)\n```";
  const excerpt = app.publicationMetadata(post);
  assert.match(excerpt.description, /^A formatted body without a subtitle/);
  assert.equal(excerpt.image, "");
  for (const visibility of ["private", "direct"]) {
    const metadata = app.publicationMetadata({ ...post, visibility });
    assert.equal(metadata.type, "website");
    assert.doesNotMatch(JSON.stringify(metadata), /formatted body|quotes/);
  }
  const warning = app.publicationMetadata({ ...post, warning: "Sensitive topic" });
  assert.equal(warning.description, "Sensitive topic");
  assert.equal(warning.image, "");
  assert.doesNotMatch(warning.title, /quotes/);
});

test("reader sharing tags update in place and clear when leaving an article", () => {
  const { app, context } = setup();
  elements(context);
  const tags = [];
  context.document.head = {
    querySelector(selector) {
      const [, attribute, value] = /^meta\[(\w+)="([^"]+)"\]$/.exec(selector);
      return tags.find((tag) => tag[attribute] === value) || null;
    },
    appendChild(tag) { tags.push(tag); },
  };
  context.document.createElement = () => ({
    setAttribute(key, value) { this[key] = value; },
    remove() { tags.splice(tags.indexOf(this), 1); },
  });
  const value = (key) => tags.find((tag) => tag.name === key || tag.property === key)?.content;
  app.state.view = "reader";
  app.state.reading = { ...app.demoPosts[0], title: 'A "title" & more', subtitle: "The subtitle", image: "assets/garden.svg" };
  app.render();
  app.render();
  assert.equal(value("og:title"), 'A "title" & more');
  assert.equal(value("og:description"), "The subtitle");
  assert.equal(value("description"), "The subtitle");
  assert.equal(value("og:type"), "article");
  assert.equal(value("og:image"), "https://reader.example/fedistack/assets/garden.svg");
  assert.equal(value("twitter:card"), "summary_large_image");
  assert.equal(value("og:url"), app.publicationLink(app.state.reading));
  assert.equal(tags.filter((tag) => tag.property === "og:title").length, 1);
  app.state.reading = { ...app.state.reading, image: "", markdown: "No picture.", subtitle: "Another article" };
  app.render();
  assert.equal(value("og:description"), "Another article");
  assert.equal(value("og:image"), undefined);
  assert.equal(value("og:image:alt"), undefined);
  assert.equal(value("twitter:image"), undefined);
  assert.equal(value("twitter:card"), "summary");
  app.state.view = "home";
  app.render();
  assert.equal(value("og:type"), "website");
  assert.equal(value("og:url"), "https://reader.example/fedistack/");
  assert.match(value("og:title"), /^Fedistack/);
  assert.doesNotMatch(value("description"), /Another article/);
});

test("preview-enabled share links reach the server and open the same public reader", async () => {
  const id = "~opaque/id?&";
  const { app, context } = await postActionFixture(async (url) => Response.json(url.endsWith("/context")
    ? { ancestors: [], descendants: [] } : sharedStatus({ id })));
  app.loginConfig.sharePreviews = true;
  app.state.api = new app.API("https://source.example", "secret-token");
  const post = { ...app.demoPosts[0], id };
  context.location.href = "https://reader.example/fedistack/?code=secret#home";
  const link = new URL(app.publicationLink(post));
  assert.equal(link.hash, "");
  assert.equal(link.searchParams.get("p"), id);
  assert.equal(link.searchParams.get("server"), "https://source.example");
  assert.doesNotMatch(link.href, /secret/);
  const privateLink = new URL(app.publicationLink({ ...post, visibility: "private" }));
  assert.equal(privateLink.search, "");
  assert.match(privateLink.hash, /^#@/);
  app.state.api = null;
  Object.assign(context.location, { href: link.href, search: link.search, hash: "" });
  context.history.replaceState = (_state, _title, path) => {
    const url = new URL(path, context.location.href);
    Object.assign(context.location, { href: url.href, hash: url.hash, search: url.search });
  };
  app.openSharedPublication();
  assert.equal(context.location.search, "");
  await app.route();
  assert.equal(app.state.error, "");
  assert.equal(app.state.reading.id, id);
  assert.equal(app.publicationLink(app.state.reading), link.href);
  app.state.readerServer = context.location.origin;
  assert.equal(new URL(app.publicationLink(post)).searchParams.has("server"), false);
});

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
      ? { ancestors: [], descendants: [sharedStatus({ id: "reply", in_reply_to_id: id, replies_count: 0 })] }
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

test("signing in from a demo publication opens Home without requesting its fictional ID", async () => {
  const requests = [];
  const { app, context, get } = await postActionFixture(async (url) => {
    const path = new URL(url).pathname;
    requests.push(path);
    if (path.startsWith("/api/v1/statuses/")) return new Response("status not found", { status: 404 });
    return Response.json([]);
  });
  context.location.hash = "#read/slow-web";
  await app.route();
  assert.equal(app.state.reading.id, "slow-web");
  get("modal").close = () => {};
  context.history.replaceState = (_, __, url) => { context.location.hash = new URL(url, context.location.href).hash; };

  await app.setSession({ ...longServer, account: app.demoMe, server: "https://nyap.example", token: "account-token" });

  assert.equal(context.location.hash, "#home");
  assert.equal(app.state.view, "home");
  assert.equal(app.state.reading, null);
  assert.equal(app.state.error, "");
  assert.ok(requests.includes("/api/v1/timelines/home"));
  assert.ok(requests.every((path) => !path.startsWith("/api/v1/statuses/")));
  assert.doesNotMatch(get("app").innerHTML, /Publication unavailable/);
});

test("startup with a saved session recovers a stale demo reader URL", async () => {
  const requests = [], localStorage = storage();
  const session = { ...longServer, account: { id: "me", name: "Reader", acct: "reader", avatar: "", bio: "" }, server: "https://nyap.example", token: "account-token", remember: true };
  localStorage.setItem("fedistack:session", JSON.stringify(session));
  const { app, context } = setup(async (url) => {
    const path = new URL(url).pathname;
    requests.push(path);
    if (path.startsWith("/api/v1/statuses/")) return new Response("status not found", { status: 404 });
    if (path.endsWith("/instance")) return Response.json({ version: "nyap", configuration: { statuses: {
      max_characters: 32768, supported_mime_types: ["text/plain", "text/markdown"],
    } } });
    return Response.json([]);
  }, { localStorage });
  const { get } = elements(context);
  context.document.addEventListener = () => {};
  context.window = { addEventListener() {} };
  context.matchMedia = () => ({ matches: false, addEventListener() {} });
  get("modal").addEventListener = () => {};
  context.location.hash = "#read/slow-web";
  context.history.replaceState = (_, __, url) => { context.location.hash = new URL(url, context.location.href).hash; };

  await app.boot();

  assert.equal(context.location.hash, "#home");
  assert.equal(app.state.view, "home");
  assert.equal(app.state.error, "");
  assert.ok(requests.includes("/api/v1/timelines/home"));
  assert.ok(requests.every((path) => !path.startsWith("/api/v1/statuses/")));
  assert.doesNotMatch(get("app").innerHTML, /Publication unavailable/);
});

test("bare reader links still open uncached real posts and cached posts with demo IDs", async () => {
  const requests = [];
  const { app, context } = await postActionFixture(async (url) => {
    const path = new URL(url).pathname;
    requests.push(path);
    return Response.json(path.endsWith("/context")
      ? { ancestors: [], descendants: [] }
      : sharedStatus({ id: "real-post" }));
  });
  app.state.session = { ...longServer, account: app.demoMe, server: "https://nyap.example", token: "account-token" };
  app.state.api = new app.API(app.state.session.server, app.state.session.token);
  for (const id of ["real-post", "slow-web"]) {
    if (id === "slow-web") app.state.posts = [app.mapStatus(sharedStatus())];
    context.location.hash = `#read/${id}`;
    await app.route();
    assert.equal(app.state.view, "reader");
    assert.equal(app.state.reading.id, id);
    assert.equal(app.state.reading.title, "Shared article");
    assert.equal(app.state.error, "");
  }
  assert.deepEqual(requests, ["/api/v1/statuses/real-post", "/api/v1/statuses/real-post/context", "/api/v1/statuses/slow-web/context"]);
});

test("the article renders while its comments are still loading", async () => {
  let releaseComments, contextStarted;
  const comments = new Promise((resolve) => { releaseComments = resolve; });
  const started = new Promise((resolve) => { contextStarted = resolve; });
  const { app, context, get } = await postActionFixture(async (url) => {
    if (url.endsWith("/context")) {
      contextStarted();
      await comments;
      return Response.json({ ancestors: [], descendants: [] });
    }
    return Response.json(sharedStatus());
  });
  context.location.hash = "#read/slow-web?server=https%3A%2F%2Fsource.example";
  const loading = app.route();
  await started;
  assert.equal(app.state.loading, true);
  assert.match(get("app").innerHTML, /Shared article/);
  assert.doesNotMatch(get("app").innerHTML, /Opening your next read/);
  releaseComments();
  await loading;
  assert.equal(app.state.loading, false);
  assert.equal(app.state.error, "");
});

test("the reader recovers missing nested replies without reopening complete branches", async () => {
  const calls = [];
  const reply = (id, parent, extra) => sharedStatus({
    id, in_reply_to_id: parent, content: id, replies_count: 0, ...extra,
  });
  const parent = reply("my-reply", "root", { replies_count: 1 });
  const nested = reply("nested-reply", parent.id);
  const other = reply("other-branch", "root", { replies_count: 1 });
  const { app, context, get } = await postActionFixture(async (url) => {
    const [, id, endpoint] = new URL(url).pathname.match(/statuses\/([^/]+)(\/context)?$/);
    calls.push([id, !!endpoint]);
    if (!endpoint) return Response.json(reply(id, undefined, { replies_count: 3 }));
    if (id === "root") return Response.json({
      ancestors: [],
      descendants: [reply("already-loaded", other.id), parent, other,
        reply("unavailable-branch", "root", { replies_count: 1 })],
    });
    if (id === "unavailable-branch") return Response.json({ error: "Unavailable" }, { status: 404 });
    assert.equal(id, parent.id);
    return Response.json({
      ancestors: [reply("root")],
      descendants: [nested, nested, reply("direct-child", parent.id, { visibility: "direct" }),
        reply("filtered-child", parent.id, { filtered: [{ filter: { filter_action: "hide" } }] })],
    });
  });
  context.location.hash = "#read/root?server=https%3A%2F%2Fsource.example";
  await app.route();
  const html = get("app").innerHTML;
  assert.deepEqual(calls, [["root", false], ["root", true], ["my-reply", true], ["unavailable-branch", true]]);
  assert.equal(app.state.error, "");
  assert.equal(html.match(/<p>nested-reply<\/p>/g).length, 1);
  assert.match(html, /<p>my-reply<\/p>[\s\S]*?--reply-depth: 1[\s\S]*?<p>nested-reply<\/p>/);
  assert.match(html, /href="#read\/nested-reply\?server=https%3A%2F%2Fsource.example"/);
  assert.ok(html.indexOf("<p>other-branch</p>") < html.indexOf("<p>already-loaded</p>"));
  assert.doesNotMatch(html, /direct-child|filtered-child/);
});

test("the demo reader follows saved nested replies across both thread entry points", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const root = app.demoState.posts[0];
  const parent = { ...root, id: "parent", markdown: "First reply", replyTo: root.id };
  const child = { ...parent, id: "child", markdown: "Nested reply", replyTo: parent.id };
  app.demoState.comments[root.id] = [parent];
  app.demoState.comments[parent.id] = [child];
  context.location.hash = `#read/${root.id}`;
  await app.route();
  assert.match(get("app").innerHTML, /<p>First reply<\/p>[\s\S]*?<p>Nested reply<\/p>/);
  context.location.hash = "#read/parent";
  await app.route();
  assert.equal(app.state.comments[0].id, root.id);
  assert.match(get("app").innerHTML, /<p>Nested reply<\/p>/);
});

test("a shared link opens Markdown and public comments without a session or cached post", async () => {
  const requests = [];
  const { app, context, get } = await postActionFixture(async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.endsWith("/context") ? {
      ancestors: [],
      descendants: [
        sharedStatus({ id: "reply", content: "A *public reply*.", in_reply_to_id: "slow-web", replies_count: 0 }),
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
  await new Promise(setImmediate);
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

test("the reader offers deletion only for your comments and asks for confirmation", async () => {
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
  await app.confirmDeletePublication(mine.id);
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
  assert.match(get("app").innerHTML, /data-action="edit-publication" data-id="reply"/);
  assert.doesNotMatch(get("app").innerHTML, /Body of article|Body of private-message|Body of boosted|Load older replies/);
  app.state.libraryTab = "published";
  app.render();
  assert.match(get("app").innerHTML, /Body of article/);
  assert.doesNotMatch(get("app").innerHTML, /Body of reply/);
});

test("a resumed edit can delete or unpublish the uncached original and keep the draft", async () => {
  for (const action of ["delete", "unpublish"]) {
    const { app, context } = setup();
    const { get } = elements(context);
    const post = ownPublication(app);
    app.state.posts = [];
    app.state.ownPosts = [];
    app.state.reading = null;
    app.state.view = "editor";
    const draft = { ...article, body: "Local edits", editingId: post.id };
    app.state.draft = draft;
    assert.equal(app.saveDraft(draft), true);
    const modal = get("modal");
    modal.querySelector = () => null;
    modal.showModal = () => { modal.open = true; };
    modal.close = () => { modal.open = false; };
    const deleted = [];
    app.state.api = {
      status: async (id) => { assert.equal(id, post.id); return post; },
      deleteStatus: async (id) => deleted.push(id),
    };
    const confirm = action === "delete" ? app.confirmDeletePublication : app.confirmUnpublishPublication;
    await confirm(post.id);
    assert.match(modal.innerHTML, new RegExp(`data-action="confirm-${action}-publication" data-id="mine"`));
    assert.deepEqual(deleted, []);
    const remove = action === "delete" ? app.deletePublication : app.unpublishPublication;
    await remove(post.id);
    assert.deepEqual(deleted, [post.id]);
    assert.equal(draft.editingId, undefined);
    assert.equal(app.getDrafts().length, 1);
    const [saved] = app.getDrafts();
    assert.equal(saved.id, draft.id);
    assert.equal(saved.body, "Local edits");
    assert.equal(saved.editingId, undefined);
    assert.equal(context.location.hash, action === "delete" ? "drafts" : "");
  }
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
    (language, id) => ({ id, language, kind: id === 1 ? "post" : "article" }),
  );
  for (const [languages, expected] of [
    [["en"], [0, 1, 2]], [["es"], [3]], [["en", "es", "ca"], [0, 1, 2, 3]],
    [["fr", "ca"], []], [[], [0, 1, 2, 3, 4, 5, 6]],
  ]) {
    app.state.discoveryLanguages = languages;
    assert.deepEqual(posts.filter((post) => app.matchesPublication(post)).map((post) => post.id), expected);
  }
  app.state.discoveryLanguages = ["en"];
  assert.deepEqual(posts.filter((post) => app.matchesPublication(post, "post")).map((post) => post.id), [1]);
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

test("the saved language preferences filter Discover, Following, lists, and Saved", () => {
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
  app.setDiscoveryLanguages(["en"]);
  app.state.session = { ...longServer, server: "https://example.org", account: app.demoMe };
  for (const [view, timeline] of [["home", "home"], ["home", "list:friends"], ["bookmarks", "home"]]) {
    app.state.view = view;
    app.state.timeline = timeline;
    app.render();
    assert.match(get("app").innerHTML, /English fixture/);
    assert.doesNotMatch(get("app").innerHTML, /Spanish fixture|Unknown fixture/);
    assert.match(get("app").innerHTML, /aria-label="Content type"/);
  }
  app.state.view = "settings";
  app.render();
  assert.match(get("app").innerHTML, /id="settings-language"/);
  assert.match(get("app").innerHTML, /aria-label="Remove English language filter"/);
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
  assert.equal(calls[12].url.searchParams.get("limit"), "40");
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
  assert.equal(context.location.hash, "discover?q=%23Nature");
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
  app.state.view = "home";
  app.state.homeTimeline = app.state.timeline = "list:1";
  app.state.next = "stale-list-page";
  await app.interestAction("delete-list-confirm", "");
  assert.deepEqual(Array.from(app.state.lists, (list) => list.id), ["2"]);
  assert.equal(app.state.timeline, "home");
  assert.equal(app.state.homeTimeline, "home");
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
  assert.match(get("app").innerHTML, /data-id="lists"[^>]*>Lists<\/button>/);
  assert.doesNotMatch(get("app").innerHTML, /id="list-select"|connected-dot|>Signed in</);
  assert.match(get("app").innerHTML, /class="brand-date"/);
  app.state.timeline = "lists";
  app.render();
  assert.match(get("app").innerHTML, /No lists yet/);
  assert.match(get("app").innerHTML, /data-action="manage-lists"/);
  assert.doesNotMatch(get("app").innerHTML, /class="feed"|id="list-select"/);
  await app.showInterests("lists");
  assert.doesNotMatch(modal.innerHTML, /<img src=x/);
  assert.match(modal.innerHTML, /&lt;img/);
  assert.doesNotMatch(get("app").innerHTML, /<img src=x/);
  assert.match(get("app").innerHTML, /id="list-select"/);
  app.state.session = null;
  app.state.api = null;
  assert.match(app.interestsSettings(), /Sign in to manage/);
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
  assert.deepEqual(opened, [["tags"], ["lists"], ["members", "1"]]);
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

  const timelines = [];
  app.state.api.timeline = async (timeline) => { timelines.push(timeline); return { posts: [] }; };
  app.loadSuggestions = async () => {};
  app.state.lists = [{ id: "1", title: "Friends" }];
  app.state.view = "home";
  app.state.homeTimeline = app.state.timeline = "home";
  const clickTimeline = async (id) => {
    const button = { dataset: { action: "timeline", id }, disabled: false };
    listeners.get("click")({ target: { closest: () => button } });
    await new Promise(setImmediate);
  };
  await clickTimeline("lists");
  assert.deepEqual(timelines, []);
  assert.match(get("app").innerHTML, /data-id="lists" class="active" aria-pressed="true"/);
  assert.match(get("app").innerHTML, /Choose a list to read its posts/);
  listeners.get("change")({ target: { id: "list-select", value: "list:1" } });
  await new Promise(setImmediate);
  assert.deepEqual(timelines, ["list:1"]);
  assert.match(get("app").innerHTML, /data-id="lists" class="active"/);
  assert.match(get("app").innerHTML, /value="list:1" selected>Friends/);
  listeners.get("change")({ target: { id: "list-select", value: "" } });
  await new Promise(setImmediate);
  assert.equal(app.state.timeline, "lists");
  await clickTimeline("home");
  assert.deepEqual(timelines, ["list:1", "home"]);
  assert.doesNotMatch(get("app").innerHTML, /id="list-select"/);
});

test("Saved is a Home tab that loads bookmarks and returns to the selected list or Following", async () => {
  const { app, context, get, click } = await postActionFixture();
  app.state.session = { ...longServer, server: "https://example.org", token: "test", account: app.demoMe };
  app.state.api = new app.API("https://example.org", "test");
  app.state.filter = "all";
  app.state.homeTimeline = app.state.timeline = "list:friends";
  app.state.lists = [{ id: "friends", title: "Friends" }];
  app.loadSuggestions = async () => {};
  app.state.api.relationships = async () => [];
  const timelines = [];
  app.state.api.timeline = async (timeline) => {
    timelines.push(timeline);
    return { posts: [{ ...app.demoPosts[0], id: timeline, saved: timeline === "bookmarks" }] };
  };
  const select = async (id) => {
    click(id, "timeline");
    await new Promise(setImmediate);
    // The location mock does not dispatch hashchange or add the browser's #.
    if (!context.location.hash.startsWith("#")) {
      context.location.hash = `#${context.location.hash}`;
      await app.route();
    }
  };
  app.render();
  assert.match(get("app").innerHTML, /data-id="bookmarks"[^>]*>Saved<\/button>/);
  app.state.query = "stale search";
  await select("bookmarks");
  assert.equal(app.state.view, "bookmarks");
  assert.equal(app.state.query, "");
  assert.equal(app.state.timeline, "list:friends");
  assert.equal(app.state.posts[0].id, "bookmarks");
  assert.match(get("app").innerHTML, /data-id="bookmarks" class="active" aria-pressed="true"/);
  assert.match(get("app").innerHTML, /href="#home" class="nav-item active" aria-current="page"/);
  assert.match(get("app").innerHTML, /href="#home" aria-label="Home" aria-current="page"/);
  assert.doesNotMatch(get("app").innerHTML, /id="list-select"|href="#bookmarks"/);
  await select("bookmarks");
  assert.equal(app.state.view, "bookmarks", "tapping the active tab keeps Saved open");
  await select("lists");
  assert.equal(app.state.view, "home");
  assert.equal(app.state.timeline, "list:friends");
  assert.match(get("app").innerHTML, /value="list:friends" selected>Friends/);
  await select("bookmarks");
  await select("home");
  assert.equal(app.state.view, "home");
  assert.equal(app.state.timeline, "home");
  assert.deepEqual(timelines, ["bookmarks", "list:friends", "home"]);
});

test("the Saved tab also opens bookmarked posts in the offline demo", async () => {
  const { app, context, get, click } = await postActionFixture();
  app.state.filter = "all";
  app.demoState.posts.forEach((post, i) => { post.saved = i === 0; });
  app.render();
  assert.match(get("app").innerHTML, /data-id="bookmarks"[^>]*>Saved<\/button>/);
  click("bookmarks", "timeline");
  assert.equal(context.location.hash, "bookmarks");
  context.location.hash = "#bookmarks";
  await app.route();
  assert.deepEqual(Array.from(app.state.posts, (post) => post.id), [app.demoState.posts[0].id]);
  assert.match(get("app").innerHTML, /data-id="bookmarks" class="active" aria-pressed="true"/);
});

test("opening Lists cancels a pending timeline and does not fetch or refresh an unselected list", async () => {
  const { app, context, get } = interestsFixture();
  app.state.view = "home";
  app.loadSuggestions = async () => {};
  let finish, signal;
  app.state.api.timeline = async (_timeline, _next, currentSignal) => {
    if (_timeline === "lists") throw new Error("List selection must not fetch a timeline");
    signal = currentSignal;
    return new Promise((resolve) => { finish = resolve; });
  };
  const pending = app.loadFeed();
  app.state.timeline = "lists";
  await app.loadFeed();
  assert.equal(signal.aborted, true);
  finish({ posts: app.demoPosts, next: "older" });
  await pending;
  assert.equal(app.state.posts.length, 0);
  assert.equal(app.state.loading, false);
  assert.equal(app.state.next, undefined);
  assert.match(get("app").innerHTML, /No lists yet/);
  app.state.api.timeline = async () => { assert.fail("No list has been selected"); };
  context.document.hidden = false;
  await app.refreshReading(Date.now());
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

test("remote emoji use the status and account mappings independently across feeds and the reader", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.htmlToMarkdown = (text) => text;
  const emoji = (host, extra = {}) => ({
    shortcode: "blob_happy_cat", url: `https://${host}/animated.gif`,
    static_url: `https://${host}/still.png`, ...extra,
  });
  const original = sharedStatus({
    account: { ...sharedStatus().account, display_name: "Remote :blob_happy_cat: <writer>", emojis: [emoji("author.example")] },
    content: "Hello :blob_happy_cat: _:blob_happy_cat:_ `:blob_happy_cat:` :missing: :unsafe:",
    emojis: [emoji("post.example", { visible_in_picker: false }), { shortcode: "unsafe", url: "javascript:alert(1)" }],
  });
  const boost = { ...original, account: { ...original.account, emojis: [emoji("boost.example")] }, emojis: [emoji("wrapper.example")], reblog: original };
  const note = app.mapStatus(boost);
  const output = app.postCard(note);
  assert.match(output, /Shared by .*src="https:\/\/boost\.example\/still\.png"/);
  assert.match(output, /src="https:\/\/author\.example\/still\.png"[^>]+> &lt;writer&gt;/);
  assert.match(output, /Hello <img class="custom-emoji" src="https:\/\/post\.example\/still\.png"[^>]+> <em><img[^>]+><\/em> <code>:blob_happy_cat:<\/code> :missing: :unsafe:/);
  assert.doesNotMatch(output, /wrapper\.example|animated\.gif|javascript:/);
  assert.match(app.commentCard(note), /Hello <img class="custom-emoji"/);

  const article = app.mapStatus({
    ...original,
    content: "# A title :blob_happy_cat:\n\nA subtitle :blob_happy_cat: with @reader@remote.example\n\nThe body :blob_happy_cat: with @reader@remote.example",
    mentions: [{ id: "reader", acct: "reader@remote.example", url: "https://remote.example/users/reader" }],
  });
  const card = app.postCard(article);
  assert.match(card, /<h2>A title <img class="custom-emoji"/);
  const link = /href="https:\/\/remote\.example\/users\/reader"[^>]*>@reader<\/a>/;
  assert.match(card.match(/<p class="excerpt">([^]*?)<\/p>/)?.[1] ?? "", link);
  assert.match(card, /class="excerpt">A subtitle <img class="custom-emoji"/);
  app.state.view = "reader";
  app.state.reading = article;
  app.render();
  assert.match(get("app").innerHTML, /<h1>A title <img class="custom-emoji"/);
  assert.match(get("app").innerHTML, /class="reader-subtitle">A subtitle <img class="custom-emoji"/);
  assert.match(get("app").innerHTML, /The body <img class="custom-emoji"/);
  assert.equal(get("app").innerHTML.match(new RegExp(link.source, "g"))?.length, 2);
});

test("the custom emoji picker retries, uses the signed-in instance, and inserts a shortcode into the draft", async () => {
  const requests = [];
  let unavailable = true;
  const { app, get } = await postActionFixture(async (url) => {
    requests.push(url);
    if (unavailable) return Response.json({}, { status: 503 });
    return Response.json([
      { shortcode: "blob_happy_cat", url: `${new URL(url).origin}/happy.png`, visible_in_picker: true },
      { shortcode: "hidden", url: "https://cdn.example/hidden.png", visible_in_picker: false },
      { shortcode: "remote@other.example", url: "https://other.example/remote.png", visible_in_picker: true },
    ]);
  });
  const modal = get("modal");
  modal.querySelector = () => null;
  modal.showModal = () => { modal.open = true; };
  modal.close = () => { modal.open = false; };
  const field = get("draft-body");
  Object.assign(field, {
    id: "draft-body", value: "Hello world!", selectionStart: 6, selectionEnd: 11, maxLength: -1,
    setSelectionRange() {},
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); },
  });
  app.state.view = "editor";
  app.state.draft = { ...article, body: field.value };
  app.state.api = new app.API("https://first.example", "token");
  assert.match(app.editorView(), /data-action="pick-emoji"/);
  const search = get("emoji-search");
  search.value = "";
  search.addEventListener = (_, listener) => { search.filter = listener; };
  const results = get("emoji-results");
  await app.openEmojiPicker("draft-body");
  assert.match(results.innerHTML, /Could not load/);
  unavailable = false;
  await app.openEmojiPicker("draft-body");
  assert.match(results.innerHTML, /first\.example\/happy\.png/);
  assert.doesNotMatch(results.innerHTML, /hidden|other\.example/);
  search.value = "nothing";
  search.filter();
  assert.match(results.innerHTML, /No matching emoji/);
  search.value = ":HAPPY";
  search.filter();
  assert.match(results.innerHTML, /Insert :blob_happy_cat:/);
  app.insertPickedEmoji(":blob_happy_cat:");
  assert.equal(app.state.draft.body, "Hello :blob_happy_cat:!");
  for (const format of ["text/plain", "text/markdown", "text/html"])
    assert.match(app.publicationPayload(app.state.draft, format), /Hello :blob_happy_cat:!/);

  await app.openEmojiPicker("draft-body");
  app.state.api = new app.API("https://second.example", "token");
  app.insertPickedEmoji(":blob_happy_cat:");
  assert.equal(app.state.draft.body, "Hello :blob_happy_cat:!");
  await app.openEmojiPicker("draft-body");
  assert.match(results.innerHTML, /second\.example\/happy\.png/);
  assert.deepEqual(requests, [
    "https://first.example/api/v1/custom_emojis",
    "https://first.example/api/v1/custom_emojis",
    "https://second.example/api/v1/custom_emojis",
  ]);
});

test("link cards preserve video metadata without replacing publication covers or titles", () => {
  const { app } = setup();
  app.htmlToMarkdown = (text) => text;
  const card = { type: "video", title: "A video", description: "Video description", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12", image: "https://images.example/video.jpg", provider_name: "YouTube", image_description: "Video artwork", html: '<iframe src="https://embed.example"></iframe>' };
  const post = app.mapStatus(sharedStatus({ content: "My own words", card }));
  assert.equal(post.title, "");
  assert.equal(post.image, "");
  assert.equal(post.linkPreview.type, "video");
  assert.equal(post.linkPreview.imageAlt, "Video artwork");
  const output = app.postCard(post);
  assert.match(output, /link-preview-video/);
  assert.match(output, /href="https:\/\/www.youtube.com\/watch\?v=dQw4w9WgXcQ&amp;t=12"/);
  assert.match(output, /loading="lazy" decoding="async" referrerpolicy="no-referrer"/);
  assert.doesNotMatch(output, /iframe|reader-cover|class="thumbnail"/);
  const attached = app.mapStatus(sharedStatus({ card, media_attachments: [{ id: "photo", type: "image", preview_url: "https://images.example/own.jpg" }] }));
  assert.equal(attached.image, "https://images.example/own.jpg");
  assert.equal(attached.linkPreview.image, card.image);
  for (const site of ["github.com", "www.instagram.com"]) {
    const linked = app.mapStatus(sharedStatus({ card: { ...card, type: "link", url: `https://${site}/example`, image: null } }));
    assert.match(app.postCard(linked), /class="link-preview"/);
  }
  assert.equal(app.mapStatus(sharedStatus({ card: { ...card, url: "javascript:alert(1)" } })).linkPreview, undefined);
});

test("YouTube thumbnail fallbacks support public URL forms and reject lookalike hosts", () => {
  const { app } = setup();
  for (const url of [
    "https://youtu.be/dQw4w9WgXcQ?t=12", "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) {
    const preview = app.basicLinkPreview(url);
    assert.equal(preview.type, "video", url);
    assert.equal(preview.image, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    assert.equal(preview.url, url);
  }
  for (const url of ["https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ", "https://youtu.be/invalid", "https://youtube.com/playlist?list=abc"]) {
    assert.equal(app.basicLinkPreview(url).image, "");
  }
});

test("preview candidates skip code, attached images, mentions and tags and deduplicate links", () => {
  const { app } = setup();
  const source = [
    "`https://code.example/` ![picture](https://image.example/a.png)",
    "```html", "https://fenced.example/", "```",
    "[@person](https://social.example/@person) [#tag](https://social.example/tags/tag)",
    "**[Repository](https://github.com/trufae/fedistack)**",
    "https://github.com/trufae/fedistack", "(https://youtu.be/dQw4w9WgXcQ).",
    "[#docs](https://docs.example/)", "```", "https://unfinished-code.example/",
  ].join("\n");
  assert.deepEqual(Array.from(app.markdownLinks(source)), ["https://github.com/trufae/fedistack", "https://youtu.be/dQw4w9WgXcQ", "https://docs.example/"]);
});

test("link preview text is escaped and unsafe thumbnail and navigation URLs are rejected", () => {
  const { app } = setup();
  const preview = { ...app.basicLinkPreview("https://github.com/example/repo"), title: '<img src=x onerror="alert(1)">', description: "<script>bad()</script>", siteName: "<b>GitHub</b>", image: "javascript:alert(1)" };
  const html = app.linkPreviewCard(preview);
  assert.doesNotMatch(html, /<img|<script|<b>|javascript:/);
  assert.match(html, /&lt;img/);
  assert.equal(app.linkPreviewCard({ ...preview, url: "data:text/html,bad" }), "");
});

test("Open Graph metadata takes precedence and resolves relative images safely", () => {
  const { app, context } = setup();
  let metadata = [
    { property: "og:title", content: "A title & more" },
    { property: "og:title", content: "Second title" },
    { name: "twitter:title", content: "Twitter title" },
    { property: "og:image", content: "../image.png" },
    { property: "og:image:alt", content: "A useful description" },
    { property: "og:description", content: "Page description" },
    { property: "og:site_name", content: "Example" },
    { property: "og:type", content: "video.other" },
  ];
  context.document = { createElement(tag) {
    assert.equal(tag, "template");
    return { content: {
      querySelectorAll: () => metadata.map((attributes) => ({ getAttribute: (key) => attributes[key] || null })),
      querySelector: () => ({ textContent: "Document title" }),
    } };
  } };
  const preview = app.parseLinkPreview("<html>fixture</html>", "https://example.org/posts/article");
  assert.equal(preview.title, "A title & more");
  assert.equal(preview.image, "https://example.org/image.png");
  assert.equal(preview.imageAlt, "A useful description");
  assert.equal(preview.siteName, "Example");
  assert.equal(preview.type, "video");
  metadata = [{ name: "twitter:image", content: "//cdn.example/image.jpg" }];
  assert.equal(app.parseLinkPreview("", preview.url).image, "https://cdn.example/image.jpg");
  metadata = [{ property: "og:image", content: "data:image/svg+xml,unsafe" }];
  assert.equal(app.parseLinkPreview("", preview.url).image, "");
  assert.equal(app.parseLinkPreview("", preview.url).title, "Document title");
});

test("preview lookups share requests, bound response size and cache CORS failures", async () => {
  let calls = 0, options, parsed;
  const { app, context } = setup(async (_url, init) => {
    calls++; options = init;
    return new Response("x".repeat(600 * 1024), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  });
  context.document = { createElement: () => ({
    set innerHTML(html) { parsed = html; },
    content: { querySelectorAll: () => [], querySelector: () => ({ textContent: "Loaded" }) },
  }) };
  const first = app.loadLinkPreview("https://example.org/page");
  assert.equal(first, app.loadLinkPreview("https://example.org/page"));
  assert.equal((await first).title, "Loaded");
  assert.equal(parsed.length, 512 * 1024);
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.mode, "cors");
  assert.equal(options.headers.Authorization, undefined);
  await app.loadLinkPreview("https://example.org/page");
  assert.equal(calls, 1);
  const post = { ...app.demoPosts[0], markdown: "https://example.org/page" };
  assert.match(app.postLinkPreview(post), /<strong>Loaded<\/strong>/);
  let blockedCalls = 0;
  const blocked = setup(async () => { blockedCalls++; throw new TypeError("Blocked by CORS"); }).app;
  assert.equal(await blocked.loadLinkPreview("https://blocked.example/"), null);
  assert.equal(await blocked.loadLinkPreview("https://blocked.example/"), null);
  assert.equal(await blocked.loadLinkPreview("javascript:alert(1)"), null);
  assert.equal(await blocked.loadLinkPreview("http://example.org/"), null);
  assert.equal(blockedCalls, 1);
});

test("turning link previews off persists, hides cards, aborts work and prevents queued requests", async () => {
  const requests = [];
  const { app, context } = setup((_url, options) => new Promise((_resolve, reject) => {
    requests.push(options);
    options.signal.addEventListener("abort", () => reject(new Error("Aborted")));
  }));
  const { get } = elements(context);
  app.state.view = "settings";
  app.render();
  assert.match(get("app").innerHTML, /role="switch" aria-checked="true"/);
  const pending = Array.from({ length: 5 }, (_, index) => app.loadLinkPreview(`https://example.org/${index}`));
  assert.equal(requests.length, 3);
  app.setLinkPreviews(false);
  assert.ok(requests.every((options) => options.signal.aborted));
  assert.deepEqual(await Promise.all(pending), [null, null, null, null, null]);
  assert.equal(requests.length, 3);
  assert.match(get("app").innerHTML, /role="switch" aria-checked="false"/);
  assert.equal(context.localStorage.getItem("fedistack:link-previews"), "false");
  const post = { ...app.demoPosts[0], markdown: "https://youtu.be/dQw4w9WgXcQ", linkPreview: app.basicLinkPreview("https://github.com/example/repo") };
  assert.doesNotMatch(app.postCard(post), /link-preview|ytimg/);
  assert.equal(await app.loadLinkPreview("https://example.org/new"), null);
  assert.equal(requests.length, 3);
  const reloaded = setup(undefined, { localStorage: context.localStorage }).app;
  assert.equal(reloaded.state.linkPreviews, false);
  app.setLinkPreviews(true);
  assert.match(app.postCard(post), /link-preview/);
  assert.equal(context.localStorage.getItem("fedistack:link-previews"), "true");
});

test("preview lookups wait for visibility and ignore observers from earlier renders", async () => {
  const requests = [], observers = [];
  const { app, context } = setup(async (url) => { requests.push(url); throw new TypeError("Offline"); });
  context.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    unobserve() {}
    disconnect() { this.disconnected = true; }
  };
  const element = { isConnected: true, dataset: { linkPreview: "https://example.org/lazy" } };
  const root = { querySelectorAll: () => [element] };
  app.setupLinkPreviews(root);
  const old = observers.at(-1);
  app.setupLinkPreviews(root);
  const current = observers.at(-1);
  old.callback([{ isIntersecting: true, target: element }]);
  current.callback([{ isIntersecting: false, target: element }]);
  assert.equal(requests.length, 0);
  current.callback([{ isIntersecting: true, target: element }]);
  await app.loadLinkPreview(element.dataset.linkPreview);
  assert.deepEqual(requests, [element.dataset.linkPreview]);
  element.isConnected = false;
  element.dataset.linkPreview = "https://example.org/detached";
  current.callback([{ isIntersecting: true, target: element }]);
  assert.equal(requests.length, 1);
  app.state.linkPreviews = false;
  app.setupLinkPreviews(root);
  assert.equal(current.disconnected, true);
  assert.equal(observers.length, 2);
});

test("content warnings suppress link previews in feeds and the reader until revealed", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const post = { ...app.demoPosts[0], warning: "Spoilers", markdown: "https://youtu.be/dQw4w9WgXcQ", linkPreview: app.basicLinkPreview("https://youtu.be/dQw4w9WgXcQ") };
  assert.doesNotMatch(app.postCard(post), /link-preview|ytimg/);
  app.state.view = "reader";
  app.state.reading = post;
  app.render();
  assert.doesNotMatch(get("app").innerHTML, /link-preview|ytimg/);
  app.state.revealed.add(post.id);
  app.render();
  assert.match(get("app").innerHTML, /link-preview-video/);
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

test("untitled long posts get a preview headline and retain their original reader content", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.htmlToMarkdown = (text) => text;
  const opening = "Let me elaborate. Alien tokens are words in the source.";
  const post = app.mapStatus(sharedStatus({
    content: `${opening}\n\n${"More details. ".repeat(80)}\n\n# A later section`,
    card: { type: "link", title: "Linked headline", description: opening, url: "https://example.org/article" },
  }));
  assert.equal(post.kind, "article");
  const card = app.postCard(post);
  assert.match(card, /class="link-preview"[^]*<strong>Linked headline<\/strong>/);
  assert.match(card, /class="article-link"><h2>Let me elaborate\.<\/h2><\/a><p class="excerpt">Alien tokens/);
  assert.match(card, /class="continue-reading">Continue reading/);
  assert.equal(post.title, "");
  app.state.view = "reader";
  app.state.reading = post;
  app.render();
  const html = get("app").innerHTML;
  assert.doesNotMatch(html, /reader-subtitle/);
  assert.equal(html.split(opening).length, 3); // Post text and the linked page's description.
  assert.match(html, /<div class="prose reading-prose"[^>]*><p>Let me elaborate/);
  assert.match(html, /<h1>A later section<\/h1>/);
  assert.match(html, /class="link-preview" href="https:\/\/example.org\/article"/);
});

test("the reader and card show an authored headline once and preserve distinct headings", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.htmlToMarkdown = (text) => text;
  const post = app.mapStatus(sharedStatus({ content: "# **Headline**\n\n## Section\n\nArticle body." }));
  app.state.view = "reader";
  app.state.reading = post;
  app.render();
  assert.match(get("app").innerHTML, /<h1>Headline<\/h1>/);
  assert.equal(get("app").innerHTML.split("Headline").length, 2);
  assert.match(app.postCard(post), /<h2>Headline<\/h2><\/a><p class="excerpt">Section/);
  assert.match(get("app").innerHTML, /<div class="prose reading-prose"[^>]*><h2>Section<\/h2>/);

  app.state.reading = { ...post, title: "Remote title", subtitle: "An authored subtitle" };
  app.render();
  assert.match(get("app").innerHTML, /<h1>Remote title<\/h1><p class="reader-subtitle">An authored subtitle<\/p>/);
  assert.match(get("app").innerHTML, /<div class="prose reading-prose"[^>]*><h1><strong>Headline<\/strong><\/h1>/);
});

test("article previews use the authored subtitle and link to the complete post", () => {
  const { app } = setup();
  const post = { ...app.demoPosts[0], title: "A <clear> headline", subtitle: "A short & useful subtitle",
    markdown: "The full article is reserved for the reader." };
  const card = app.postCard(post);
  assert.match(card, /<h2>A &lt;clear&gt; headline<\/h2><\/a><p class="excerpt">A short &amp; useful subtitle<\/p>/);
  assert.match(card, /href="#read\/slow-web" class="article-link">[^]*href="#read\/slow-web" class="continue-reading">Continue reading/);
  assert.doesNotMatch(card, /The full article is reserved/);
});

test("published articles put the subtitle below a single title, before the byline and actions", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.htmlToMarkdown = (text) => text;
  const title = "Myths in R2Land";
  const subtitle = "How to turn 372 critical advisories into safer software.";
  const body = "## The findings\n\nThe full article starts here.\n\n# A distinct heading";
  for (const duplicate of ["", `# **${title}**\n\n`]) {
    const source = `# ${title}\n\n${subtitle}\n\n${duplicate}${body}`;
    const post = app.mapStatus(sharedStatus({ content: source }));
    assert.equal(post.subtitle, subtitle);
    assert.equal(post.markdown, source);
    // Old feed caches did not retain subtitle metadata.
    for (const cached of [post, { ...post, subtitle: "" }]) {
      app.state.view = "reader";
      app.state.reading = cached;
      app.render();
      const html = get("app").innerHTML;
      assert.equal(html.split(title).length, 2);
      assert.equal(html.split(subtitle).length, 2);
      assert.match(html, /<h1>Myths in R2Land<\/h1><p class="reader-subtitle">How to turn 372 critical advisories into safer software\.<\/p>\s*<div class="post-byline">/);
      assert.ok(html.indexOf("reader-subtitle") < html.indexOf('class="post-actions"'));
      assert.match(html, /<div class="prose reading-prose"[^>]*><h2>The findings<\/h2>/);
      assert.match(html, /<h1>A distinct heading<\/h1>/);
      assert.match(app.postCard(cached), /<p class="excerpt">How to turn 372 critical advisories into safer software\.<\/p>/);
    }
  }
});

test("subtitle extraction preserves articles without an introductory subtitle", () => {
  const { app } = setup();
  for (const body of [
    "The only paragraph.",
    "## Section\n\nA paragraph.",
    "- First item\n\nA paragraph.",
    "> A quote\n\nA paragraph.",
    "```\n\ncode\n```",
    "![A cover](https://example.org/cover.png)\n\nA paragraph.",
    "A long opening paragraph. ".repeat(25) + "\n\nMore text.",
    "Two lines\nin the first paragraph.\n\nMore text.",
  ]) {
    const content = app.articleContent({ title: "Title", subtitle: "", markdown: `# Title\n\n${body}` });
    assert.equal(content.subtitle, "");
    assert.equal(content.body, body);
  }
  const markdown = "Opening paragraph.\n\n# A later title";
  const content = app.articleContent({ title: "", subtitle: "", markdown });
  assert.equal(content.subtitle, "");
  assert.equal(content.body, markdown);
});

test("the editing preview removes a pasted title without changing the draft", () => {
  const { app } = setup();
  const body = `# ${article.title}\n\n## Section\n\nOriginal body.`;
  app.state.draft = { ...article, body };
  app.state.preview = true;
  const html = app.editorView();
  assert.equal(html.split(article.title).length, 2);
  assert.match(html, /<h1>An independent publication<\/h1><p class="reader-subtitle">A place for ideas<\/p>/);
  assert.match(html, /<div class="prose reading-prose"><h2>Section<\/h2>/);
  assert.equal(app.state.draft.body, body);
});

test("notes show their complete body and inline links in the feed and reader", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const markdown = "[@friend](https://social.example/@friend)\n**A small discovery.** A [quiet corner](https://example.org/quiet) of the web. " +
    "There is more to this story. ".repeat(18) + "\n\nHere is the ending. #Nature";
  const post = { ...app.demoPosts[0], id: "compact-note", kind: "post", title: "", subtitle: "", markdown, image: "" };
  const card = app.postCard(post);
  assert.match(card, /class="note-permalink" href="#read\/compact-note"/);
  assert.doesNotMatch(card, /<h[12]|class="excerpt"|Continue reading|article-meta/);
  assert.match(card, /class="link-preview" href="https:\/\/example\.org\/quiet"/);
  app.state.view = "reader";
  app.state.reading = post;
  app.render();
  const reader = get("app").innerHTML;
  assert.doesNotMatch(reader, /A note from|reader-subtitle|reader-end|min read/);
  for (const html of [card, reader]) {
    assert.match(html, /class="prose note-body[^>]*><p><a href="https:\/\/social\.example\/@friend"[^>]*>@friend<\/a><br><strong>A small discovery\.<\/strong>/);
    assert.match(html, /href="https:\/\/example\.org\/quiet"[^>]*>quiet corner<\/a>/);
    assert.match(html, /<p>Here is the ending\. <a [^>]*>#Nature<\/a><\/p>/);
    assert.equal(html.split("A small discovery.").length, 2);
  }
  assert.equal(post.markdown, markdown);
  assert.equal(post.title, "");
});

test("media-only notes show their attachments and respect content warnings", () => {
  const { app } = setup();
  const note = { ...app.demoPosts[0], kind: "post", title: "", subtitle: "", image: "" };
  const url = "https://example.org/photo.jpg";
  const previewUrl = "https://example.org/small.jpg";
  const media = [{ id: "photo", type: "image", url, previewUrl, description: "A sleeping cat" }];
  const post = { ...note, markdown: "", image: previewUrl, media, warning: "Spoilers" };
  assert.doesNotMatch(app.postCard(post), /attachment-gallery|small\.jpg/);
  app.state.revealed.add(post.id);
  const card = app.postCard(post);
  assert.doesNotMatch(card, /note-body|<h2|Continue reading/);
  assert.match(card, /class="attachment-gallery"[^]*href="https:\/\/example\.org\/photo\.jpg"[^]*src="https:\/\/example\.org\/small\.jpg" alt="A sleeping cat"/);
  assert.equal(card.split("small.jpg").length, 2);
  assert.doesNotMatch(app.postCard({ ...post, markdown: app.mediaMarkdown(media[0]) }), /attachment-gallery/);
  assert.match(app.postCard({ ...post, media: undefined }), /class="attachment-gallery"[^]*src="https:\/\/example\.org\/small\.jpg"/);
});

test("untitled article previews skip opening URLs and move leading mentions into the excerpt", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const url = "https://example.org/a_long_article";
  const article = { ...app.demoPosts[0], title: "", subtitle: "", image: "" };
  for (const opening of [`${url} `, `[${url}](${url})\n\n`, `**${url}**\n<https://example.net/>\n`]) {
    const card = app.postCard({ ...article, markdown: `${opening}A melting statue. It's a cute hack.` });
    assert.match(card, /<h2>A melting statue\.<\/h2><\/a><p class="excerpt">It&#39;s a cute hack\.<\/p>/);
    assert.ok(card.includes(`class="link-preview" href="${url}"`));
  }
  const withMentions = { ...article, markdown: `[@flying_penguin](https://social.example/@flying_penguin), ${url}\n\n**@joxean@mastodon.social**\n\nA melting statue. It's a cute hack.` };
  assert.match(app.postCard(withMentions), /<h2>A melting statue\.<\/h2><\/a><p class="excerpt"><a href="https:\/\/social\.example\/@flying_penguin"[^>]*>@flying_penguin<\/a> <a href="https:\/\/mastodon\.social\/@joxean"[^>]*>@joxean<\/a> It&#39;s a cute hack\.<\/p>/);
  assert.match(app.postCard({ ...article, markdown: "@flyingpenguin" }), /<h2>Untitled article<\/h2><\/a><p class="excerpt">@flyingpenguin<\/p>/);
  assert.match(app.postCard({ ...article, title: "An authored title", markdown: withMentions.markdown }), /<h2>An authored title<\/h2>/);
  app.state.view = "reader";
  app.state.reading = withMentions;
  app.render();
  assert.match(get("app").innerHTML, /<a href="https:\/\/social\.example\/@flying_penguin"[^>]*>@flying_penguin<\/a>, <a /);
  assert.match(get("app").innerHTML, /<p><strong><a href="https:\/\/mastodon\.social\/@joxean"[^>]*>@joxean<\/a><\/strong><\/p>\s*<p>A melting statue/);
  app.state.linkPreviews = false;
  const linkNote = app.postCard({ ...article, kind: "post", markdown: `[${url}](${url})` });
  assert.ok(linkNote.includes(`href="${url}"`));
  assert.doesNotMatch(linkNote, /<h2|class="link-preview"/);
});

test("thread comments hide a leading direct addressee and link other mentions", () => {
  const { app, context } = setup();
  const { get } = elements(context);
  app.htmlToMarkdown = (text) => text;
  const parent = app.mapStatus(sharedStatus({ id: "parent" }));
  parent.author.acct = "writer@source.example";
  const profile = "https://elsewhere.example/users/friend";
  const content = "@writer@source.example @friend@elsewhere.example, see `@literal@source.example` and mail@example.org.";
  const reply = app.mapStatus(sharedStatus({
    id: "reply", in_reply_to_id: parent.id, content,
    account: { ...sharedStatus().account, id: "another-writer" },
    mentions: [{ id: "friend", acct: "friend@elsewhere.example", url: profile }],
  }));
  app.state.view = "reader";
  app.state.reading = parent;
  app.state.comments = [reply];
  app.render();
  assert.match(get("app").innerHTML, /class="comment"[^]*<p><a href="https:\/\/elsewhere\.example\/users\/friend"[^>]*>@friend<\/a>, see <code>@literal@source\.example<\/code> and mail@example\.org\.<\/p>/);
  assert.equal(reply.markdown, content);
  assert.ok(app.postCard(reply).includes('href="https://source.example/@writer"'));
  assert.match(app.commentCard({ ...reply, markdown: "[@writer](https://source.example/@writer/) Thanks", warning: "Spoiler" }, parent),
    /<details><summary>Spoiler<\/summary><div class="prose"><p>Thanks<\/p>/);
  for (const markdown of ["@writer@other.example Thanks", "Thanks @writer@source.example", "@writer@source.example"]) {
    assert.match(app.commentCard({ ...reply, markdown }, parent), /href="https:\/\/(?:source|other)\.example\/@writer"[^>]*>@writer<\/a>/);
  }
  assert.match(app.commentCard({ ...reply, replyTo: "another-post" }, parent), /href="https:\/\/source\.example\/@writer"[^>]*>@writer<\/a>/);
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

test("Following skips replies when filling the feed and leaves list timelines alone", async () => {
  const { app, context, get, post, requests } = feedFixture();
  const replies = Array.from({ length: 10 }, (_, i) => post(`reply-${i}`, {
    title: "A conversation reply", ...(i % 2 ? { replyTo: "parent" } : { isReply: true }),
  }));
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    if (timeline === "home" && next) return { posts: [post("root", { title: "A standalone post" })] };
    return { posts: replies, next: timeline === "home" ? "older" : undefined };
  };
  await app.route();
  assert.deepEqual(requests, [{ timeline: "home", next: undefined }, { timeline: "home", next: "older" }]);
  assert.match(get("app").innerHTML, /A standalone post/);
  assert.doesNotMatch(get("app").innerHTML, /A conversation reply/);

  app.state.session = { ...longServer, server: "https://account.example", account: app.demoMe };
  app.state.homeTimeline = "list:friends";
  context.location.hash = "#home";
  await app.route();
  assert.match(get("app").innerHTML, /A conversation reply/);
});

test("Discover browses public articles and topics while Home keeps its own feed and filter", async () => {
  const { app, context, get, post, requests } = feedFixture();
  const article = post("guide", { title: "A public guide", tags: ["Café", "café"] });
  const note = post("note", { kind: "post", title: "", subtitle: "", markdown: "A short public note", tags: ["Notes"] });
  const hidden = [
    post("private", { visibility: "private", title: "Private draft", tags: ["Private"] }),
    post("warning", { warning: "CW", title: "Hidden article", tags: ["Hidden"] }),
    post("reply", { replyTo: "guide", title: "Reply article", tags: ["Reply"] }),
  ];
  app.state.api.timeline = async (timeline) => {
    requests.push(timeline);
    return { posts: timeline === "federated" ? [note, ...hidden, article] : [note] };
  };
  const renderRoute = async (hash) => {
    context.location.hash = hash;
    await app.route();
    return get("app").innerHTML;
  };

  const home = await renderRoute("#home");
  assert.match(home, /<h1>Home<\/h1>/);
  assert.match(home, /A short public note/);
  assert.doesNotMatch(home, /Public timelines|id="discover-search"|Following only/);
  app.setFeedFilter("post");
  assert.equal(app.readStore("home-filter", "all"), "post");

  const discover = await renderRoute("#discover");
  assert.match(discover, /<h1>Discover<\/h1>/);
  assert.ok(discover.indexOf('id="discover-search"') < discover.indexOf("<h2>Topics"));
  assert.match(discover, /href="#discover\?q=%23Caf%C3%A9" class="topic">#Café/);
  assert.match(discover, /href="#read\/guide" class="article-link"/);
  assert.match(discover, /aria-label="Local and federated posts"/);
  assert.match(discover, /A short public note/);
  assert.doesNotMatch(discover, /Private draft|Hidden article|Reply article|Personal timelines|discovery-timeline|More from Federated|More from Local/);
  assert.equal((discover.match(/class="post-card/g) || []).length, 2);

  const local = await renderRoute("#discover?timeline=local");
  assert.match(local, /<h2>Local timeline<\/h2>/);
  assert.match(local, /A short public note/);
  assert.doesNotMatch(local, /Articles to explore|Personal timelines/);

  const returned = await renderRoute("#home");
  assert.match(returned, /data-id="post" class="selected" aria-pressed="true"/);
  assert.deepEqual(requests, ["home", "federated", "local", "local", "home"]);
});

function discoveryFixture() {
  const fixture = feedFixture();
  const { app, context, requests } = fixture;
  app.state.session = { server: "https://discovery.example", account: { ...app.demoMe, id: "me" }, remember: true };
  Object.assign(app.state.api, {
    server: app.state.session.server,
    favourites: async () => ({ posts: [] }),
    followedTags: async () => ({ tags: [] }),
    get: async () => [],
    suggestions: async () => [],
  });
  vm.runInContext("Math.random = () => 0.5", context);
  context.location.hash = "#discover";
  const sources = {};
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    return { posts: sources[timeline] || [] };
  };
  return { ...fixture, sources };
}

test("the Discover mix switches between articles and notes without discarding other languages", async () => {
  const { app, get, post, sources, requests } = discoveryFixture();
  app.state.discoveryLanguages = ["en"];
  sources.federated = [
    post("english-article", { title: "English article", language: "en" }),
    post("english-note", { kind: "post", markdown: "English note", language: "en-GB" }),
    post("german-article", { title: "German article", language: "de" }),
  ];
  await app.route();
  const count = requests.length;
  assert.match(get("app").innerHTML, /English article/);
  assert.match(get("app").innerHTML, /English note/);
  assert.doesNotMatch(get("app").innerHTML, /German article/);
  app.setFeedFilter("post");
  assert.match(get("app").innerHTML, /English note/);
  assert.doesNotMatch(get("app").innerHTML, /English article|German article/);
  app.setFeedFilter("article");
  app.setDiscoveryLanguages(["de"]);
  assert.match(get("app").innerHTML, /German article/);
  assert.doesNotMatch(get("app").innerHTML, /English article|English note/);
  assert.equal(requests.length, count);
});

test("Discover samples likes, followed hashtags and lists, and prefers matching articles from varied sources", async () => {
  const { app, post, sources, requests } = discoveryFixture();
  const author = (id, server) => ({ ...app.demoAuthors[0], id, acct: `${id}@${server}` });
  const liked = post("liked", { liked: true, tags: ["rust"] });
  const privateList = post("list-signal", { visibility: "private", tags: ["gardens"] });
  sources.federated = [post("unrelated", { tags: [], author: author("stranger", "other.example") })];
  sources.local = [];
  sources["list:friends"] = [privateList];
  sources["tag:rust"] = [post("rust-match", { tags: ["rust"], author: author("coder", "code.example") })];
  sources["tag:space"] = [post("space-match", { tags: ["space"], author: author("sky", "space.example") })];
  sources["tag:gardens"] = [post("garden-match", { tags: ["gardens"], author: author("grower", "plants.example") })];
  let preferences = 0;
  app.state.api.favourites = async () => { preferences++; return { posts: [liked] }; };
  app.state.api.followedTags = async () => ({ tags: [{ name: "space" }] });
  app.state.api.get = async () => [{ id: "friends", title: "Friends" }];
  await app.route();
  assert.deepEqual(new Set(app.discoveryArticles().map((p) => p.id)), new Set(["rust-match", "space-match", "garden-match"]));
  assert.deepEqual(new Set(requests.map((r) => r.timeline)), new Set(["local", "federated", "list:friends", "tag:rust", "tag:space", "tag:gardens"]));
  assert.equal(app.state.posts.some((p) => p.id === "list-signal" || p.id === "liked"), false);
  await app.loadFeed();
  assert.equal(preferences, 1);
  app.clearFeedCache();
  await app.loadFeed();
  assert.equal(preferences, 2);
});

test("Discover excludes liked, private, warned, own, muted and reply posts, deduplicates boosts and keeps languages", async () => {
  const { app, get, post, sources } = discoveryFixture();
  app.state.discoveryLanguages = ["en"];
  const good = post("good", { language: "en-US", title: "Fresh reading", url: "https://writer.example/p/1" });
  const liked = post("liked", { liked: true, language: "en" });
  sources.federated = [good, { ...good, id: "boost", boostedBy: "Another reader" }, liked,
    post("past-like", { language: "en", title: "Previously liked" }),
    post("private", { visibility: "private", language: "en" }),
    post("warned", { warning: "Spoilers", language: "en" }),
    post("reply", { isReply: true, language: "en" }),
    post("mine", { author: app.state.session.account, language: "en" }),
    post("muted", { author: { ...good.author, id: "muted" }, language: "en" }),
    post("spanish", { language: "es" })];
  sources.local = [good];
  app.state.relationships.set("muted", { id: "muted", muting: true });
  app.state.api.favourites = async () => ({ posts: [post("past-like", { liked: true })] });
  await app.route();
  assert.deepEqual(Array.from(app.visibleDiscoveryPosts(), (p) => p.id), ["good"]);
  assert.doesNotMatch(get("app").innerHTML, /Previously liked/);
  const history = app.undiscoveredPosts([{ ...liked, liked: false }]);
  assert.equal(history.length, 0);
  assert.match(app.discoveryTimelineView(), /Fresh reading/);
});

test("Discover refreshes on return and rotates unseen articles before repeating older selections", async () => {
  const { app, context, post, sources, requests } = discoveryFixture();
  sources.federated = Array.from({ length: 9 }, (_, i) => post(`fresh-${i}`, { tags: [] }));
  await app.route();
  const first = Array.from(app.discoveryArticles(), (p) => p.id);
  const repeatedRender = Array.from(app.discoveryArticles(), (p) => p.id);
  assert.deepEqual(repeatedRender, first);
  context.location.hash = "#home";
  await app.route();
  context.location.hash = "#discover";
  await app.route();
  const second = Array.from(app.discoveryArticles(), (p) => p.id);
  assert.ok(second.every((id) => !first.includes(id)));
  await app.loadFeed();
  const third = Array.from(app.discoveryArticles(), (p) => p.id);
  assert.ok(third.every((id) => ![...first, ...second].includes(id)));
  await app.loadFeed();
  assert.deepEqual(Array.from(app.discoveryArticles(), (p) => p.id), first);
  assert.equal(requests.filter((r) => r.timeline === "federated").length, 4);
  const reloaded = discoveryFixture();
  reloaded.context.localStorage = context.localStorage;
  reloaded.sources.federated = sources.federated;
  await reloaded.app.route();
  assert.deepEqual(Array.from(reloaded.app.discoveryArticles(), (p) => p.id), second);
});

test("Discover bounds page scans and appends older public pages without replacing earlier posts", async () => {
  const { app, post, requests } = discoveryFixture();
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    if (timeline === "local") return { posts: [] };
    const page = Number(next || 0);
    return { posts: [post(`page-${page}`, { kind: page >= 3 ? "article" : "post", tags: [] })], next: String(page + 1) };
  };
  await app.route();
  assert.deepEqual(requests.filter((r) => r.timeline === "federated").map((r) => r.next), [undefined, "1", "2"]);
  await app.loadFeed(true);
  assert.deepEqual(requests.filter((r) => r.timeline === "federated").map((r) => r.next), [undefined, "1", "2", "3", "4", "5"]);
  assert.deepEqual(Array.from(app.state.posts, (p) => p.id), ["page-0", "page-1", "page-2", "page-3", "page-4", "page-5"]);
  assert.deepEqual(new Set(app.discoveryArticles().map((p) => p.id)), new Set(["page-3", "page-4", "page-5"]));
});

test("duplicate boosted articles do not stop discovery before scanning the next page", async () => {
  const { app, post, requests } = discoveryFixture();
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    if (timeline === "local") return { posts: [] };
    return next ? { posts: [post("second"), post("third")] }
      : { posts: [post("first"), post("first"), post("first")], next: "older" };
  };
  await app.route();
  assert.deepEqual(new Set(app.discoveryArticles().map((p) => p.id)), new Set(["first", "second", "third"]));
  assert.equal(requests.filter((r) => r.timeline === "federated").length, 2);
});

test("Discover mixes twenty previews per batch, drains buffered posts and paginates both sources without duplicates", async () => {
  const { app, get, post, requests } = discoveryFixture();
  const shared = post("shared", { url: "https://writer.example/shared" });
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    return next
      ? { posts: [shared, ...Array.from({ length: 10 }, (_, i) => post(`${timeline}-older-${i}`))] }
      : { posts: [shared, ...Array.from({ length: 20 }, (_, i) => post(`${timeline}-${i}`))], next: `${timeline}-older` };
  };
  const cards = () => (get("app").innerHTML.match(/class="post-card/g) || []).length;
  await app.route();
  assert.equal(cards(), 20);
  assert.match(get("app").innerHTML, /href="#read\/local-0"/);
  assert.match(get("app").innerHTML, /href="#read\/federated-0"/);
  assert.equal(app.state.posts.length, 41);
  const first = Array.from(app.state.posts, (p) => p.id);
  await app.loadFeed(true);
  assert.equal(cards(), 40);
  assert.equal(requests.length, 2, "use already fetched posts before requesting another page");
  await app.loadFeed(true);
  assert.equal(cards(), 60);
  assert.deepEqual(requests.slice(2).map(({ timeline, next }) => [timeline, next]),
    [["federated", "federated-older"], ["local", "local-older"]]);
  assert.deepEqual(Array.from(app.state.posts.slice(0, first.length), (p) => p.id), first);
  assert.equal(app.state.posts.filter((p) => p.id === "shared").length, 1);
  await app.loadFeed(true);
  assert.equal(cards(), 61);
  assert.equal(requests.length, 4);
  assert.equal(app.state.next, undefined);
  assert.doesNotMatch(get("app").innerHTML, /id="discovery-more"|discovery-timeline/);
});

test("Discover automatically loads near the bottom and ignores stale observers after navigation", async () => {
  const { app, context, get, post, sources } = discoveryFixture();
  sources.federated = Array.from({ length: 45 }, (_, i) => post(`scroll-${i}`));
  const observers = [];
  context.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  const sentinel = get("discovery-more");
  await app.route();
  const observer = observers.at(-1);
  assert.equal(observer.target, sentinel);
  assert.equal(observer.options.rootMargin, "600px 0px");
  const loadFeed = app.loadFeed;
  const calls = [];
  let pending;
  app.loadFeed = (...args) => { calls.push(args); return pending = loadFeed(...args); };
  observer.callback([{ isIntersecting: true }]);
  observer.callback([{ isIntersecting: true }]);
  await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], true);
  assert.equal((get("app").innerHTML.match(/class="post-card/g) || []).length, 40);
  const stale = observers.at(-1);
  context.location.hash = "#home";
  await app.route();
  assert.equal(stale.disconnected, true);
  const before = calls.length;
  stale.callback([{ isIntersecting: true }]);
  assert.equal(calls.length, before);
  assert.equal(app.state.view, "home");
});

test("Discover preserves the feed on failed pagination and permits a manual retry", async () => {
  const { app, get, post } = discoveryFixture();
  let fail = true;
  app.state.api.timeline = async (timeline, next) => {
    if (next && fail) throw new Error("Temporarily unavailable");
    return { posts: Array.from({ length: 20 }, (_, i) => post(`${timeline}-${next ? "older-" : ""}${i}`)),
      next: next ? undefined : "older" };
  };
  await app.route();
  await app.loadFeed(true);
  const earlier = Array.from(app.state.posts, (p) => p.id);
  await app.loadFeed(true);
  assert.deepEqual(Array.from(app.state.posts, (p) => p.id), earlier);
  assert.equal(app.discovery.autoLoad, false);
  assert.match(get("app").innerHTML, /Temporarily unavailable/);
  assert.match(get("app").innerHTML, /Load more posts/);
  fail = false;
  await app.loadFeed(true);
  assert.equal(app.state.posts.length, 80);
  assert.deepEqual(Array.from(app.state.posts.slice(0, earlier.length), (p) => p.id), earlier);
  assert.equal(app.discovery.autoLoad, true);
  assert.doesNotMatch(get("app").innerHTML, /Temporarily unavailable/);
});

test("Discover stops automatic scanning when older pages contain no eligible posts", async () => {
  const { app, post, requests } = discoveryFixture();
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    if (timeline === "local") return { posts: [] };
    return { posts: Array.from({ length: 20 }, (_, i) => post(`${next || "first"}-${i}`, { visibility: next ? "private" : "public" })),
      next: String(Number(next || 0) + 1) };
  };
  await app.route();
  await app.loadFeed(true);
  assert.equal(requests.filter((r) => r.timeline === "federated").length, 4);
  assert.equal(app.state.posts.length, 20);
  assert.equal(app.discovery.autoLoad, false);
  assert.ok(app.state.next, "manual loading is still available");
});

test("returning from a Discover post restores every loaded batch without refreshing the feed", async () => {
  const { app, context, get, post, sources, requests } = discoveryFixture();
  sources.federated = Array.from({ length: 45 }, (_, i) => post(`reading-${i}`));
  app.state.api.context = async () => [];
  await app.route();
  await app.loadFeed(true);
  const earlier = Array.from(app.state.posts, (p) => p.id);
  const count = requests.length;
  context.location.hash = "#read/reading-30";
  await app.route();
  assert.equal(app.state.reading.id, "reading-30");
  assert.match(get("app").innerHTML, /class="text-button reader-back" href="#discover"[^>]*>[^]*?Back to reading/);
  context.location.hash = "#discover";
  await app.route();
  assert.equal(requests.length, count);
  assert.deepEqual(Array.from(app.state.posts, (p) => p.id), earlier);
  assert.equal((get("app").innerHTML.match(/class="post-card/g) || []).length, 40);
  await app.refreshReading(Date.now() + 60000);
  assert.equal(requests.length, count, "background polling must not reorder the stream");
});

test("Discover tolerates unavailable interests and a failed timeline, retaining its own reading on refresh failure", async () => {
  const { app, context, get, post } = discoveryFixture();
  const unavailable = async () => { throw new Error("Unavailable"); };
  app.state.api.favourites = unavailable;
  app.state.api.followedTags = unavailable;
  app.state.api.get = unavailable;
  app.state.api.timeline = async (timeline) => {
    if (timeline === "local") throw new Error("Local timeline unavailable");
    return { posts: [post("readable", { title: "Readable discovery" })] };
  };
  await app.route();
  assert.equal(app.state.error, "");
  assert.match(get("app").innerHTML, /Readable discovery/);
  assert.match(app.discoveryTimelineView(), /Local timeline unavailable/);
  context.location.hash = "#home";
  app.state.api.timeline = async () => ({ posts: [post("home-only", { title: "Home only", visibility: "private" })] });
  await app.route();
  app.state.api.timeline = unavailable;
  context.location.hash = "#discover";
  await app.route();
  assert.match(get("app").innerHTML, /Readable discovery/);
  assert.doesNotMatch(get("app").innerHTML, /Home only/);
  assert.equal(app.state.loading, false);
  assert.match(app.state.error, /Could not refresh/);
});

test("navigating away cancels Discover and late responses cannot replace Home or contaminate its history", async () => {
  const { app, context, post } = discoveryFixture();
  const pending = [];
  app.state.api.timeline = (timeline, next, signal) => timeline === "home"
    ? Promise.resolve({ posts: [post("home")] })
    : new Promise((resolve) => pending.push({ resolve, signal }));
  const discoveryLoad = app.route();
  context.location.hash = "#home";
  await app.route();
  assert.ok(pending.every(({ signal }) => signal.aborted));
  pending.forEach(({ resolve }) => resolve({ posts: [post("late", { liked: true })] }));
  await discoveryLoad;
  assert.equal(app.state.view, "home");
  assert.deepEqual(Array.from(app.state.posts, (p) => p.id), ["home"]);
  assert.equal(app.undiscoveredPosts([post("late")]).length, 1);
});

test("discovery likes survive reload, stay account scoped, and a successful like disappears from the preview immediately", async () => {
  const { app, context, get, click } = await postActionFixture();
  app.state.session = { server: "https://example.org", account: { ...app.demoMe, id: "me" }, remember: true };
  app.state.api = { server: "https://example.org", toggle: async (post) => ({ ...post, liked: true }) };
  const post = { ...app.demoPosts[0], id: "new-article", title: "Like this article" };
  app.state.posts = [post];
  app.state.view = "discover";
  app.state.exploring = true;
  click("new-article", "like");
  await new Promise(setImmediate);
  assert.doesNotMatch(get("app").innerHTML, /Like this article/);
  const reloaded = setup(undefined, { localStorage: context.localStorage }).app;
  reloaded.state.session = app.state.session;
  assert.equal(reloaded.undiscoveredPosts([{ ...post, liked: false }]).length, 0);
  reloaded.state.session = { ...app.state.session, account: { ...app.demoMe, id: "other" } };
  assert.equal(reloaded.undiscoveredPosts([{ ...post, liked: false }]).length, 1);
});

test("federated browsing and new searches show remote notes before optional filtering", async () => {
  const { app, context, get, post } = feedFixture();
  const listeners = new Map();
  context.document.addEventListener = (name, listener) => listeners.set(name, listener);
  context.window = { addEventListener() {} };
  context.matchMedia = () => ({ matches: false, addEventListener() {} });
  context.FormData = class { constructor(form) { return new Map(form.fields); } };
  get("modal").addEventListener = () => {};
  const route = app.route;
  app.route = async () => {};
  await app.boot();
  app.route = route;
  const remote = post("remote-note", { kind: "post", title: "", markdown: "Remote note from another instance",
    author: { ...app.demoAuthors[0], id: "remote", acct: "writer@remote.example" } });
  app.state.api.timeline = async () => ({ posts: [post("local-article"), remote] });
  const click = async (action, id) => {
    listeners.get("click")({ target: { closest: () => ({ dataset: { action, id }, disabled: false }) } });
    await new Promise(setImmediate);
  };
  context.location.hash = "#discover?timeline=federated";
  await app.route();
  assert.equal(app.state.filter, "all");
  assert.match(get("app").innerHTML, /Remote note from another instance/);
  await click("filter", "article");
  assert.doesNotMatch(get("app").innerHTML, /Remote note from another instance/);
  app.state.api.search = async () => ({ accounts: [], posts: [remote] });
  listeners.get("submit")({ target: { id: "discover-search", fields: [["query", "remote"]], dataset: {}, querySelector: () => null }, preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(context.location.hash, "discover?q=remote");
  context.location.hash = `#${context.location.hash}`;
  await app.route();
  assert.equal(app.state.filter, "all");
  assert.match(get("app").innerHTML, /Remote note from another instance/);
});

test("sparse timelines scan past notes and duplicate boosts for ten new articles per load", async () => {
  const { app, get, post, requests } = feedFixture();
  app.state.filter = "article";
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
      posts: requests.length <= 3 ? [] : [post("found")],
      next: requests.length <= 3 ? `page-${requests.length}` : undefined,
    };
  };
  await app.loadFeed();
  assert.equal(requests.length, 3);
  assert.equal(app.state.next, "page-3");
  await app.loadFeed(true);
  assert.equal(requests.length, 4);
  assert.equal(requests[3].next, "page-3");
  assert.equal(app.state.posts[0].id, "found");
  assert.equal(app.state.next, undefined);
  await app.loadFeed(true);
  assert.equal(requests.length, 4);
});

test("scanning counts articles in any selected language", async () => {
  const { app, post, requests } = feedFixture();
  app.state.view = "discover";
  app.state.discoveryLanguages = ["en", "es", "ca"];
  app.state.filter = "article";
  const pages = [
    Array.from({ length: 10 }, (_, i) => post(`french-${i}`, { language: "fr" })),
    Array.from({ length: 10 }, (_, i) => post(`note-${i}`, { language: "en", kind: "post" })),
    Array.from({ length: 10 }, (_, i) => post(`match-${i}`, { language: ["en-US", "es", "ca"][i % 3] })),
  ];
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    return { posts: pages[requests.length - 1], next: `page-${requests.length}` };
  };
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
  app.setFeedFilter("all");
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].next, "older");
  assert.equal(app.state.posts.length, 11);
  app.setFeedFilter("all");
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
  const { app, context, get } = editorNavigationFixture();
  app.state.view = "editor";
  app.state.draft = { ...article };
  context.location.hash = "#note";
  await app.route();
  assert.equal(app.state.draft.kind, "article");
  await app.saveAndLeaveEditor();
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
  app.state.session = { account: app.demoMe, format: "text/plain", maxChars: 10 };
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

test("server sync preserves warning-only drafts and unfinished edits with an empty body", async () => {
  for (const fields of [{ warning: "Keep this warning" }, { editingId: "original" }, { visibility: "private" }]) {
    const server = scheduledServer(), { app } = draftClient(server);
    const draft = { ...app.newDraft(), ...fields };
    app.saveDraft(draft);
    await app.syncServerDraft(draft.id);
    assert.equal(app.getDrafts().length, 1);
    const second = draftClient(server);
    await second.app.loadServerDrafts();
    assert.equal(second.app.getDrafts().length, 1);
    assert.equal(second.app.draftContent(second.app.getDrafts()[0]), app.draftContent(draft));
  }
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

for (const kind of ["avatar", "header"]) test(`the ${kind} picker uploads multipart images and refreshes the saved account`, async () => {
  let finish, picker, opened = 0;
  const writes = [];
  let account = profileAccount();
  const { app, context, get, click } = await profileFixture(async (url, options) => {
    if (options.method === "PATCH") {
      writes.push({ url, ...options });
      await new Promise((resolve) => { finish = resolve; });
      account = profileAccount("me", { [kind]: `https://example.org/new-${kind}.png` });
      return Response.json(account);
    }
    if (url.includes("/statuses")) return Response.json([sharedStatus({ account })]);
    if (url.includes("/relationships")) return Response.json([]);
    return Response.json(account);
  });
  const remember = kind === "header";
  app.state.session.remember = remember;
  context.location.hash = "#profile";
  await app.route();
  app.state.posts = [{ ...app.state.profile.posts[0], author: { ...app.state.session.account } }];
  app.writeFeedCache({ key: app.feedCacheKey("home"), posts: app.state.posts, relationships: [], updated: Date.now() });
  context.document.createElement = (tag) => {
    assert.equal(tag, "input");
    picker = { files: [], addEventListener(name, callback) { this[name] = callback; }, click() { opened++; } };
    return picker;
  };
  assert.match(get("app").innerHTML, /aria-label="Change profile picture"/);
  assert.match(get("app").innerHTML, /aria-label="Change background image"/);
  click(kind, "profile-image");
  assert.equal(opened, 1, "open the picker during the tap gesture");
  assert.equal(picker.type, "file");
  assert.equal(picker.accept, "image/*");
  picker.change();
  assert.equal(writes.length, 0, "cancelling does not update the account");
  await new Promise(setImmediate);
  click(kind, "profile-image");
  picker.files = [new File(["image bytes"], "replacement.png", { type: "image/png" })];
  picker.change();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, "https://example.org/api/v1/accounts/update_credentials");
  assert.equal(writes[0].headers.Authorization, "Bearer profile-token");
  assert.equal(writes[0].headers["Content-Type"], undefined, "the browser supplies the multipart boundary");
  assert.ok(writes[0].body instanceof FormData);
  assert.deepEqual([...writes[0].body.keys()], [kind]);
  assert.equal(writes[0].body.get(kind).name, "replacement.png");
  assert.equal(await writes[0].body.get(kind).text(), "image bytes");
  assert.match(get("app").innerHTML, /role="status">Updating/);
  assert.equal((get("app").innerHTML.match(/class="profile-image-button"[^>]* disabled/g) || []).length, 2);
  await app.updateProfileImage(kind, picker.files[0]);
  assert.equal(writes.length, 1, "do not submit concurrent image updates");
  finish();
  await new Promise(setImmediate);
  const updated = `https://example.org/new-${kind}.png`;
  assert.equal(app.state.profile.account[kind], updated);
  assert.equal(app.state.profile.posts[0].author[kind], updated);
  assert.equal(app.state.posts[0].author[kind], updated);
  assert.equal(app.loadSession().account[kind], updated);
  assert.equal((remember ? context.sessionStorage : context.localStorage).getItem("fedistack:session"), null);
  assert.equal(app.readFeedCache(app.feedCacheKey("home")), undefined);
  assert.match(get("toast").textContent, /updated/);
  assert.doesNotMatch(get("app").innerHTML, /role="status">Updating/);
  await app.route();
  assert.equal(app.state.profile.account[kind], updated, "reopening cannot restore a stale cached profile");
});

test("invalid files and failed image uploads preserve the profile and allow retrying", async () => {
  let reject = true, writes = 0;
  const { app, context, get } = await profileFixture(async (url, options) => {
    if (options.method === "PATCH") {
      writes++;
      return reject ? Response.json({ error: "Image is too large" }, { status: 422 })
        : Response.json(profileAccount("me", { avatar: "https://example.org/retry.png" }));
    }
    return Response.json(url.includes("/statuses") ? [] : profileAccount());
  });
  context.location.hash = "#profile";
  await app.route();
  await assert.rejects(app.updateProfileImage("avatar", new File(["text"], "text.txt", { type: "text/plain" })), /Choose an image/);
  await assert.rejects(app.updateProfileImage("avatar", new File([], "empty.png", { type: "image/png" })), /empty/);
  assert.equal(writes, 0);
  const file = new File(["image"], "image.png", { type: "image/png" });
  await assert.rejects(app.updateProfileImage("avatar", file), /Image is too large/);
  assert.equal(app.state.profile.account.avatar, "https://example.org/avatar.png");
  assert.match(get("app").innerHTML, /role="alert">[^<]*Image is too large/);
  assert.doesNotMatch(get("app").innerHTML, /class="profile-image-button"[^>]* disabled/);
  reject = false;
  await app.updateProfileImage("avatar", file);
  assert.equal(app.state.profile.account.avatar, "https://example.org/retry.png");
  assert.doesNotMatch(get("app").innerHTML, /Image is too large/);
});

test("image uploads reject empty, malformed, and unusable successful responses", async () => {
  const file = new File(["image"], "image.png", { type: "image/png" });
  const responses = [
    [() => new Response(null, { status: 204 }), /valid account/],
    [() => Response.json(null), /valid account/],
    [() => Response.json({ error: "Upload ignored" }), /valid account/],
    [() => new Response("<html>Proxy page</html>"), /invalid JSON response/],
    ...["", "http://example.org/image.png", "/media/image.png", "javascript:alert(1)"].map((avatar) =>
      [() => Response.json(profileAccount("me", { avatar })), /usable HTTPS image URL/]),
  ];
  for (const [response, message] of responses) {
    const { app } = setup(response);
    await assert.rejects(new app.API("example.org", "token").updateProfileImage("avatar", file), message);
  }
});

test("an inaccessible uploaded image reports a persistent error and can be retried", async () => {
  let account = profileAccount(), probe;
  const { app, context, get } = await profileFixture(async (url, options) => {
    if (options.method === "PATCH") account = profileAccount("me", { avatar: "https://example.org/missing.png" });
    return Response.json(url.includes("/statuses") ? [] : account);
  });
  context.Image = class {
    constructor() { probe = this; }
    set src(url) { this.url = url; }
  };
  context.location.hash = "#profile";
  await app.route();
  const file = new File(["image"], "image.png", { type: "image/png" });
  const upload = app.updateProfileImage("avatar", file);
  await new Promise(setImmediate);
  assert.equal(probe.url, "https://example.org/missing.png");
  assert.equal(probe.referrerPolicy, "no-referrer");
  assert.doesNotMatch(get("toast").textContent, /updated/);
  const rejected = assert.rejects(upload, /saved your profile, but the image could not be loaded/);
  probe.onerror();
  await rejected;
  assert.equal(app.loadSession().account.avatar, probe.url, "keep the server's saved account even if its media is inaccessible");
  assert.match(get("app").innerHTML, /role="alert">[^<]*image could not be loaded/);
  assert.doesNotMatch(get("app").innerHTML, /class="profile-image-button"[^>]* disabled/);
  await app.refreshReading(Date.now() + 5100);
  assert.match(get("app").innerHTML, /image could not be loaded/);
  const retry = app.updateProfileImage("avatar", file);
  await new Promise(setImmediate);
  probe.naturalWidth = 32;
  probe.onload();
  await retry;
  assert.match(get("toast").textContent, /updated/);
  assert.doesNotMatch(get("app").innerHTML, /image could not be loaded/);
});

test("stalled image loading times out and releases the upload controls", async () => {
  const { app, context, get } = await profileFixture(async (url) =>
    Response.json(url.includes("/statuses") ? [] : profileAccount()));
  context.location.hash = "#profile";
  await app.route();
  let expire;
  context.Image = class { set src(_url) {} };
  const setTimer = context.setTimeout;
  context.setTimeout = (run, delay) => delay === 15000 ? (expire = run, 0) : setTimer(run, delay);
  const upload = app.updateProfileImage("header", new File(["image"], "image.png", { type: "image/png" }));
  await new Promise(setImmediate);
  const rejected = assert.rejects(upload, /image could not be loaded/);
  expire();
  await rejected;
  assert.equal(app.profileImageUpdating(), false);
  assert.match(get("app").innerHTML, /role="alert"/);
});

test("an image response after switching accounts cannot update or persist the new session", async () => {
  let finish;
  const { app, context } = await profileFixture(async (url, options) => {
    if (options.method === "PATCH") return new Promise((resolve) => { finish = resolve; });
    return Response.json(url.includes("/statuses") ? [] : profileAccount());
  });
  context.location.hash = "#profile";
  await app.route();
  const updating = app.updateProfileImage("header", new File(["image"], "image.png", { type: "image/png" }));
  app.clearSession();
  app.state.api = new app.API("other.example", "other-token");
  app.state.session = { ...app.state.session, server: "https://other.example", account: { ...app.state.session.account } };
  finish(Response.json(profileAccount("me", { header: "https://example.org/old-session.png" })));
  await updating;
  assert.equal(app.state.session.account.header, "https://example.org/header.png");
  assert.equal(app.loadSession(), null);
});

test("a profile read started before an upload completes cannot restore the previous image", async () => {
  let finishUpload, finishRead, delayRead = false;
  const { app, context } = await profileFixture(async (url, options) => {
    if (options.method === "PATCH") return new Promise((resolve) => { finishUpload = resolve; });
    if (url.includes("/statuses")) return Response.json([]);
    if (delayRead) return new Promise((resolve) => { finishRead = resolve; });
    return Response.json(profileAccount());
  });
  context.location.hash = "#profile";
  await app.route();
  const updating = app.updateProfileImage("avatar", new File(["image"], "image.png", { type: "image/png" }));
  delayRead = true;
  const reading = app.openProfile("me", "", true);
  finishUpload(Response.json(profileAccount("me", { avatar: "https://example.org/new.png" })));
  await updating;
  finishRead(Response.json(profileAccount()));
  await reading;
  assert.equal(app.state.profile.account.avatar, "https://example.org/new.png");
  assert.equal(app.loadSession().account.avatar, "https://example.org/new.png");
});

test("own profile refreshes header and counts, shows loaded engagement and settings, and pages posts", async () => {
  const calls = [];
  const { app, context, get } = await profileFixture(async (url) => {
    const u = new URL(url); calls.push(u);
    if (u.pathname.endsWith("/relationships")) return Response.json([]);
    if (u.pathname.endsWith("/statuses")) return Response.json([
      sharedStatus({ id: u.searchParams.has("max_id") ? "older" : "newer", account: profileAccount(), favourites_count: 6, reblogs_count: 3 }),
      sharedStatus({ id: "dm", visibility: "direct", account: profileAccount() }),
      sharedStatus({ id: "self-reply", in_reply_to_id: "parent", in_reply_to_account_id: "me", account: profileAccount() }),
      sharedStatus({ id: "orphan-reply", is_reply: true, account: profileAccount() }),
    ], { headers: u.searchParams.has("max_id") ? {} : { Link: '<https://example.org/api/v1/accounts/me/statuses?max_id=40>; rel="next"' } });
    return Response.json(profileAccount("me", { header: "https://example.org/fresh-header.png", followers_count: 124 }));
  });
  context.location.hash = "#profile";
  await app.route();
  assert.equal(app.state.profile.owner, true);
  assert.equal(app.state.session.account.followers, 124);
  assert.deepEqual(Array.from(app.state.profile.posts, (p) => p.id), ["newer"]);
  assert.match(get("app").innerHTML, /fresh-header.png/);
  const profileHTML = app.profileView();
  assert.match(profileHTML, /Totals for the 1 post shown below/);
  assert.ok(profileHTML.indexOf('class="profile-engagement"') < profileHTML.indexOf('class="profile-counts"'));
  assert.match(profileHTML, /data-metric="likes"[^]*?<strong>6<\/strong>[^]*?width:100%/);
  assert.match(profileHTML, /data-metric="reposts"[^]*?<strong>3<\/strong>[^]*?width:50%/);
  assert.doesNotMatch(profileHTML, /On these|loaded posts|received/);
  assert.match(get("app").innerHTML, /aria-current="page">Articles<\/a>/);
  assert.match(get("app").innerHTML, /<strong>77<\/strong><span>posts & replies<\/span>/);
  assert.match(app.profileView(), /class="profile-buttons">[^]*href="#messages"[^]*href="#drafts"[^]*href="#settings" class="button subtle"/);
  assert.doesNotMatch(app.profileView(), /class="page-top"|href="#home"|href="#bookmarks"|data-action="profile-refresh"/);
  assert.match(get("app").innerHTML, /aria-label="Your profile" aria-current="page"/);
  await app.loadProfilePage(true);
  assert.deepEqual(Array.from(app.state.profile.posts, (p) => p.id), ["newer", "older"]);
  assert.match(app.profileView(), /Totals for the 2 posts shown below/);
  app.state.profile.posts.forEach((post) => { post.likes = post.reposts = post.replies = 0; });
  assert.equal((app.profileView().match(/width:0%/g) || []).length, 3);
  assert.equal(app.state.profile.next, undefined);
  const pages = calls.filter((u) => u.pathname.endsWith("/statuses"));
  assert.equal(pages.length, 2);
  assert.equal(pages[0].searchParams.get("exclude_replies"), "true");
});

test("profiles default to articles and scan past notes and other languages", async () => {
  const status = (id, content, language) => sharedStatus({ id, content, language, account: profileAccount() });
  const pages = [];
  const { app, context, get } = await profileFixture(async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/relationships")) return Response.json([]);
    if (!u.pathname.endsWith("/statuses")) return Response.json(profileAccount());
    const cursor = u.searchParams.get("max_id");
    pages.push(cursor);
    return cursor ? Response.json([status("article", "# English article\n\nArticle body", "en-US")]) : Response.json([
      status("note", "English note", "en"),
      status("german", "# German article\n\nArticle body", "de"),
    ], { headers: { Link: '<https://example.org/api/v1/accounts/me/statuses?max_id=older>; rel="next"' } });
  });
  app.setDiscoveryLanguages(["en"]);
  context.location.hash = "#profile";
  await app.route();
  assert.deepEqual(pages, [null, "older"]);
  assert.match(get("app").innerHTML, /aria-current="page">Articles<\/a>/);
  assert.match(get("app").innerHTML, /English article/);
  assert.doesNotMatch(get("app").innerHTML, /English note|German article/);

  context.location.hash = "#profile?tab=posts";
  await app.route();
  assert.deepEqual(pages, [null, "older", null]);
  assert.match(get("app").innerHTML, /aria-current="page">Notes<\/a>/);
  assert.match(get("app").innerHTML, /English note/);
  assert.doesNotMatch(get("app").innerHTML, /English article|German article/);
});

for (const tab of ["likes", "saved"]) test(`another account cannot expose the private ${tab} tab or owner controls`, async () => {
  const paths = [];
  const { app, context, get } = await profileFixture(async (url) => {
    const path = new URL(url).pathname; paths.push(path);
    if (path.endsWith("/relationships")) return Response.json([{ id: "other", following: false, requested: false, followed_by: true }]);
    if (path.endsWith("/statuses")) return Response.json([]);
    return Response.json(profileAccount("other"));
  });
  context.location.hash = `#profile/other?tab=${tab}`;
  await app.route();
  assert.equal(app.state.profile.owner, false);
  assert.equal(app.state.profile.tab, "articles");
  assert.equal(paths.includes("/api/v1/favourites"), false);
  assert.equal(paths.includes("/api/v1/bookmarks"), false);
  await new Promise(setImmediate); // Optional metadata resolves after readable activity.
  assert.match(get("app").innerHTML, /Follows you/);
  assert.match(get("app").innerHTML, /data-action="message-account" data-id="other"/);
  assert.doesNotMatch(get("app").innerHTML, /tab=likes|tab=saved|profile-engagement|data-action="profile-image"/);
  assert.doesNotMatch(app.profileView(), /href="#messages"|href="#settings"|href="#bookmarks"|class="page-top"|data-action="profile-refresh"/);
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

test("private Saved paginates bookmarks and removes unsaved posts only after server confirmation", async () => {
  let fail = true, removed = false;
  const { app, context, click } = await profileFixture(async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/relationships")) return Response.json([]);
    if (u.pathname.endsWith("/unbookmark")) {
      if (fail) return Response.json({ error: "Try later" }, { status: 503 });
      removed = true;
      return Response.json(sharedStatus({ bookmarked: false }));
    }
    if (u.pathname === "/api/v1/bookmarks") {
      const older = u.searchParams.has("max_id");
      return Response.json(removed ? [] : [sharedStatus({ id: older ? "older" : "slow-web", bookmarked: undefined, account: profileAccount("other") })],
        { headers: older || removed ? {} : { Link: '<https://example.org/api/v1/bookmarks?max_id=40>; rel="next"' } });
    }
    assert.equal(u.pathname, "/api/v1/accounts/me");
    return Response.json(profileAccount());
  });
  context.location.hash = "#profile?tab=saved";
  await app.route();
  assert.equal(app.state.profile.tab, "saved");
  assert.equal(app.state.profile.posts[0].saved, true, "bookmark membership is authoritative without a status flag");
  const html = app.profileView();
  assert.match(html, /Saved for later · Only visible to you/);
  assert.match(html, /tab=likes[^]*?>Likes[^]*?tab=saved[^]*?>Saved/);
  assert.equal((html.match(/data-private="true"/g) || []).length, 2);
  assert.doesNotMatch(html, /profile-engagement/);
  await app.loadProfilePage(true);
  assert.deepEqual(Array.from(app.state.profile.posts, (post) => post.id), ["slow-web", "older"]);
  assert.equal(app.state.profile.next, undefined);
  app.state.posts = [{ ...app.state.profile.posts[0], saved: false }];
  click("slow-web", "save");
  await new Promise(setImmediate);
  assert.equal(app.state.profile.posts.length, 2);
  assert.equal(app.state.profile.posts[0].saved, true);
  fail = false;
  click("slow-web", "save");
  await new Promise(setImmediate);
  assert.deepEqual(Array.from(app.state.profile.posts, (post) => post.id), ["older"]);
  assert.equal(app.state.posts[0].saved, false);
  await app.route();
  assert.equal(app.state.profile.posts.length, 0, "reopening must not restore a stale bookmark cache");
  assert.match(app.profileView(), /Tap the bookmark on a post to keep it here for later/);
});

test("demo Saved includes other authors and unsaving persists without affecting Likes", async () => {
  const { app, context, click } = await postActionFixture();
  const saved = app.demoState.posts[0];
  saved.saved = saved.liked = true;
  app.demoState.posts.slice(1).forEach((post) => { post.saved = false; });
  context.location.hash = "#profile?tab=saved";
  await app.route();
  assert.deepEqual(Array.from(app.state.profile.posts, (post) => post.id), [saved.id]);
  click(saved.id, "save");
  await new Promise(setImmediate);
  assert.equal(app.state.profile.posts.length, 0);
  assert.equal(saved.liked, true);
  assert.equal(app.readStore("demo", {}).posts.find((post) => post.id === saved.id).saved, false);
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

for (const tab of ["likes", "saved"]) test(`public profiles reject private ${tab} even when their account ID matches the signed-in user`, async () => {
  const calls = [];
  const { app, context, get } = await profileFixture(async (url, options) => {
    calls.push({ url, options });
    return Response.json(new URL(url).pathname.endsWith("/statuses") ? [
      sharedStatus({ account: profileAccount(), id: "public-post" }),
      sharedStatus({ id: "private-post", visibility: "private" }),
    ] : profileAccount());
  });
  context.location.hash = `#profile/me?server=https%3A%2F%2Fremote.example&tab=${tab}`;
  await app.route();
  assert.equal(app.state.profile.owner, false);
  assert.equal(app.state.profile.tab, "articles");
  assert.equal(app.state.readerServer, "https://remote.example");
  assert.equal(app.state.profile.posts.length, 1);
  assert.ok(calls.every(({ url, options }) => url.startsWith("https://remote.example/") && !options.headers.Authorization));
  assert.match(get("app").innerHTML, /href="#profile\/me\?server=https%3A%2F%2Fremote.example"/);
  assert.doesNotMatch(get("app").innerHTML, /data-action="(?:follow|like|save|repost|delete-publication)"|tab=likes|tab=saved/);
  assert.ok(calls.every(({ url }) => !/bookmarks|favourites/.test(url)));
  assert.match(app.postReadLink("public-post"), /server=https%3A%2F%2Fremote.example/);
});

test("recommendations filter followed, requested, muted, blocked and own accounts, and appear inline only on Discover", async () => {
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
  assert.doesNotMatch(get("app").innerHTML, /class="feed-suggestions"/);
  app.state.view = "discover";
  app.state.exploring = true;
  app.render();
  assert.match(get("app").innerHTML, /class="feed-suggestions"/);
  app.state.view = "bookmarks";
  app.render();
  assert.doesNotMatch(get("app").innerHTML, /class="feed-suggestions"/);
  app.state.relationships.set("new", { id: "new", following: true, requested: false });
  assert.equal(app.suggestedAccounts().length, 0);
  context.location.hash = "#settings";
});

test("See all loads every eligible suggestion and following or dismissing updates the list", async () => {
  const ids = ["one", "two", "three", "four", "five"];
  const { app, context, get, click } = await profileFixture(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/suggestions")) return Response.json(ids.map((id) => ({ account: profileAccount(id) })));
    if (path.endsWith("/follow")) return Response.json({ id: "one", following: true });
    if (path.endsWith("/relationships")) return Response.json(ids.map((id) => ({ id, following: false })));
    throw new Error(`Unexpected request: ${path}`);
  });
  context.location.hash = "#people";
  await app.route();
  assert.equal(app.state.view, "people");
  assert.equal(app.state.loading, false);
  assert.equal(context.document.title, "People to follow — Fedistack");
  assert.deepEqual(Array.from(app.suggestedAccounts(), (a) => a.id), ids);
  assert.equal((get("app").innerHTML.match(/class="suggestion-row"/g) || []).length, 5);
  assert.doesNotMatch(get("app").innerHTML, /class="suggestion-card"/);
  assert.match(app.suggestionsView(true), /href="#people">See all/);
  assert.equal((app.suggestionsView(true).match(/class="suggestion-card"/g) || []).length, 5);
  assert.equal((app.suggestionsView().match(/class="recommended"/g) || []).length, 3);
  assert.doesNotMatch(app.suggestionsView(), /suggestion-card|suggestion-carousel/);
  assert.match(app.suggestionsView(), /href="#people">See all/);

  click("one", "follow");
  await new Promise(setImmediate);
  assert.deepEqual(Array.from(app.suggestedAccounts(), (a) => a.id), ids.slice(1));
  click("two", "dismiss-suggestion");
  await new Promise(setImmediate);
  assert.deepEqual(Array.from(app.suggestedAccounts(), (a) => a.id), ids.slice(2));
  assert.equal(app.state.view, "people");
  assert.doesNotMatch(app.peopleView(), /data-id="(?:one|two)"/);
});

test("suggestion dismissals survive reload and remain scoped to their server and account", () => {
  const localStorage = storage();
  const { app, context } = setup(undefined, { localStorage });
  elements(context);
  const account = { ...app.demoAuthors[1], id: "new" };
  app.state.session = { server: "https://one.example", account: { ...app.demoMe, id: "me" } };
  app.state.suggestions = [account];
  app.state.relationships.set(account.id, { id: account.id, following: false });
  app.dismissSuggestion(account.id);
  assert.equal(app.suggestedAccounts().length, 0);
  const { app: reloaded } = setup(undefined, { localStorage });
  reloaded.state.session = app.state.session;
  reloaded.state.suggestions = [account];
  reloaded.state.relationships.set(account.id, { id: account.id, following: false });
  assert.equal(reloaded.suggestedAccounts().length, 0);
  reloaded.state.session = { server: "https://two.example", account: { id: "me" } };
  assert.equal(reloaded.suggestedAccounts().length, 1);
  reloaded.state.session = { server: "https://one.example", account: { id: "other" } };
  assert.equal(reloaded.suggestedAccounts().length, 1);
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
  app.demoState.posts.push({ ...liked, id: "demo-post", author: app.demoMe, liked: false });
  app.demoState.comments[liked.id] = [{ ...liked, id: "demo-reply", author: app.demoMe, replyTo: liked.id, liked: false }];
  context.location.hash = "#profile";
  await app.route();
  assert.deepEqual(Array.from(app.state.profile.posts, (p) => p.id), ["demo-post"]);
  context.location.hash = "#profile?tab=replies";
  await app.route();
  assert.deepEqual(Array.from(app.state.profile.posts, (p) => p.id), ["demo-reply"]);
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

function cachedFeedFixture() {
  const fixture = feedFixture();
  const { app } = fixture;
  app.state.session = { server: "https://good.example", token: "access",
    account: { ...app.demoMe, id: "reader" }, ...longServer };
  app.state.api.server = app.state.session.server;
  app.writeStore("session", app.state.session, true);
  return fixture;
}

function captureFeedRenders(get) {
  const frames = [];
  let html = get("app").innerHTML;
  Object.defineProperty(get("app"), "innerHTML", {
    get: () => html,
    set(value) { html = value; frames.push(value); },
  });
  return frames;
}

test("timeline requests use forty posts for initial and older pages", async () => {
  const calls = [];
  const { app } = setup(async (url) => {
    calls.push(new URL(url));
    return new Response("[]", { headers: { "Content-Type": "application/json" } });
  });
  const api = new app.API("https://good.example", "access");
  await api.timeline("home");
  await api.timeline("home", "https://good.example/api/v1/timelines/home?limit=20&max_id=old");
  assert.deepEqual(calls.map((url) => url.searchParams.get("limit")), ["40", "40"]);
  assert.equal(calls[1].searchParams.get("max_id"), "old");
});

test("posts render immediately without waiting for optional relationships", async () => {
  const { app, get, post } = feedFixture();
  let finish;
  app.state.api.timeline = async () => ({ posts: [post("ready", { title: "Already readable" })] });
  app.state.api.relationships = () => new Promise((resolve) => { finish = resolve; });
  await app.loadFeed();
  assert.match(get("app").innerHTML, /Already readable/);
  assert.equal(app.state.loading, false);
  finish([]);
  await new Promise(setImmediate);
});

test("identical in-flight loads share a request and repeated authors share relationship lookups", async () => {
  const { app, post } = feedFixture();
  let finish, calls = 0, relationships = 0;
  app.state.api.timeline = () => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  };
  app.state.api.relationships = async () => { relationships++; return []; };
  const first = app.loadFeed();
  const second = app.loadFeed();
  assert.equal(first, second);
  assert.equal(calls, 1);
  finish({ posts: [post("ready")] });
  await first;
  calls = 0;
  relationships = 0;
  app.state.api.timeline = async () => ({ posts: [post(`post-${++calls}`)], next: `page-${calls}` });
  await app.loadFeed();
  assert.equal(calls, 3);
  assert.equal(relationships, 1);
});

test("fresh cached feeds return without requests and survive a tab reload", async () => {
  const { app, context, post } = cachedFeedFixture();
  let calls = 0;
  app.state.api.timeline = async () => { calls++; return { posts: [post("saved", { title: "Cached reading" })] }; };
  await app.loadFeed();
  await app.loadFeed(false, 10, false);
  assert.equal(calls, 1);
  const restored = setup(undefined, { sessionStorage: context.sessionStorage });
  const { get } = elements(restored.context);
  restored.app.state.api = new restored.app.API("https://good.example", "access");
  await restored.app.route();
  assert.match(get("app").innerHTML, /Cached reading/);
  assert.equal(restored.app.state.error, "");
  assert.equal(context.localStorage.getItem("fedistack:feed-cache"), null);
});

test("stale feeds remain visible during refresh and failed refreshes keep offline reading", async () => {
  const { app, context, get, post } = cachedFeedFixture();
  app.state.api.timeline = async () => ({ posts: [post("old", { title: "Previous reading" })], next: "older" });
  await app.loadFeed(false, 1);
  const saved = app.readStore("feed-cache", [], true);
  saved[0].updated -= 61000;
  app.writeStore("feed-cache", saved, true);
  let finish;
  app.state.api.timeline = () => new Promise((resolve) => { finish = resolve; });
  const loading = app.loadFeed(false, 1, false);
  assert.match(get("app").innerHTML, /Previous reading/);
  assert.match(get("app").innerHTML, /Updating your reading/);
  finish({ posts: [post("new", { title: "Current reading" })], next: "new-older" });
  await loading;
  assert.deepEqual(Array.from(app.state.posts, (p) => p.id), ["new"]);
  assert.equal(app.state.next, "new-older");
  app.state.api.timeline = async () => { throw new Error("Offline"); };
  await app.loadFeed();
  assert.match(get("app").innerHTML, /Current reading/);
  assert.equal(app.state.error, "Offline");
  assert.equal(app.state.next, "new-older");
  context.sessionStorage.setItem = () => { throw new Error("Quota exceeded"); };
  app.state.api.timeline = async () => ({ posts: [post("readable")] });
  await app.loadFeed();
  assert.equal(app.state.error, "");
  assert.equal(app.state.posts[0].id, "readable");
});

test("feed caches are isolated by account and timeline and are removed on logout", async () => {
  const { app, context, get, post } = cachedFeedFixture();
  app.state.api.timeline = async () => ({ posts: [post("private", { title: "Reader private feed", visibility: "private" })] });
  await app.loadFeed();
  let finish;
  app.state.api.timeline = () => new Promise((resolve) => { finish = resolve; });
  app.state.timeline = "local";
  const local = app.loadFeed();
  assert.doesNotMatch(get("app").innerHTML, /Reader private feed/);
  finish({ posts: [] });
  await local;
  app.state.timeline = "home";
  app.state.session = { ...app.state.session, account: { ...app.state.session.account, id: "someone-else" } };
  const other = app.loadFeed();
  assert.doesNotMatch(get("app").innerHTML, /Reader private feed/);
  finish({ posts: [] });
  await other;
  app.clearSession();
  assert.equal(context.sessionStorage.getItem("fedistack:feed-cache"), null);
});

test("feed mutations invalidate cached posts and late metadata cannot restore the old snapshot", async () => {
  const { app, context, post } = cachedFeedFixture();
  let finish;
  app.state.api.timeline = async () => ({ posts: [post("deleted")] });
  app.state.api.relationships = () => new Promise((resolve) => { finish = resolve; });
  await app.loadFeed();
  assert.ok(app.readFeedCache(app.feedCacheKey("home")));
  context.fetch = async () => new Response(null, { status: 204 });
  await new app.API("https://good.example", "access").deleteStatus("deleted");
  assert.equal(context.sessionStorage.getItem("fedistack:feed-cache"), null);
  finish([]);
  await new Promise(setImmediate);
  assert.equal(context.sessionStorage.getItem("fedistack:feed-cache"), null);
});

test("authorization failures clear cached private reading instead of redisplaying it", async () => {
  const { app, context, get, post } = cachedFeedFixture();
  app.state.api.timeline = async () => ({ posts: [post("private", { title: "Private cached reading", visibility: "private" })] });
  await app.loadFeed();
  app.state.api.timeline = async () => { throw new app.APIError("Sign in again", 401); };
  await app.loadFeed();
  assert.doesNotMatch(get("app").innerHTML, /Private cached reading/);
  assert.equal(app.state.posts.length, 0);
  assert.equal(context.sessionStorage.getItem("fedistack:feed-cache"), null);
});

test("malformed feed caches are ignored without preventing fresh loading", async () => {
  for (const bad of ["{broken", "{}", JSON.stringify([{ key: "bad", posts: [null], relationships: [], updated: Date.now() }])]) {
    const { app, context, post } = cachedFeedFixture();
    context.sessionStorage.setItem("fedistack:feed-cache", bad);
    app.state.api.timeline = async () => ({ posts: [post("fresh")] });
    await app.loadFeed();
    assert.equal(app.state.error, "");
    assert.equal(app.state.posts[0].id, "fresh");
  }
});


test("profile replies include unavailable parents and optional relationships do not delay posts", async () => {
  let finish;
  const { app, context, get } = await profileFixture(async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/relationships")) return new Promise((resolve) => { finish = resolve; });
    if (u.pathname.endsWith("/statuses")) {
      assert.equal(u.searchParams.get("exclude_replies"), "false");
      return Response.json([sharedStatus({ id: "orphan", is_reply: true, in_reply_to_id: null, account: profileAccount("other") })]);
    }
    return Response.json(profileAccount("other"));
  });
  context.location.hash = "#profile/other?tab=replies";
  await app.route();
  assert.equal(app.state.profile.loading, false);
  assert.deepEqual(Array.from(app.state.profile.posts, (p) => p.id), ["orphan"]);
  assert.match(get("app").innerHTML, /Writer other/);
  finish(Response.json([]));
  await new Promise(setImmediate);
});

test("profile caches reuse fresh activity and retain it through failed refreshes", async () => {
  let calls = 0, fail = false;
  const { app, context, get } = await profileFixture(async (url) => {
    calls++;
    if (fail) throw new Error("Offline");
    if (new URL(url).pathname.endsWith("/statuses")) return Response.json([sharedStatus({ id: "saved", content: "Profile cached content", account: profileAccount() })]);
    return Response.json(profileAccount());
  });
  context.location.hash = "#profile?tab=posts";
  await app.route();
  const initial = calls;
  await app.route();
  assert.equal(calls, initial);
  fail = true;
  await app.route(true);
  assert.equal(calls, initial + 1);
  assert.match(get("app").innerHTML, /Profile cached content/);
  assert.ok(app.state.profile.error);
  app.clearFeedCache();
  await app.route();
  assert.equal(app.state.profile.posts.length, 0);
});

test("followers and following have one navigation link and explicit directions", async () => {
  const calls = [];
  const { app, context, get } = await profileFixture(async (url) => {
    const path = new URL(url).pathname; calls.push(path);
    if (/\/(followers|following|relationships)$/.test(path)) return Response.json([]);
    return Response.json(profileAccount());
  });
  context.location.hash = "#profile?tab=followers";
  await app.route();
  assert.ok(calls.includes("/api/v1/accounts/me/followers"));
  assert.match(get("app").innerHTML, /People who follow you/);
  assert.equal((get("app").innerHTML.match(/href="#profile\/me\?tab=followers"/g) || []).length, 1);
  context.location.hash = "#profile?tab=following";
  await app.route();
  assert.ok(calls.includes("/api/v1/accounts/me/following"));
  assert.match(get("app").innerHTML, /People you follow/);
});

test("older pages preserve the head freshness timestamp", async () => {
  const { app, post } = cachedFeedFixture();
  app.state.api.timeline = async () => ({ posts: [post("head")], next: "older" });
  await app.loadFeed(false, 1);
  const saved = app.readStore("feed-cache", [], true);
  saved[0].updated -= 61000;
  const original = saved[0].updated;
  app.writeStore("feed-cache", saved, true);
  app.state.api.timeline = async () => ({ posts: [post("older")] });
  await app.loadFeed(true, 1);
  assert.equal(app.readFeedCache(app.feedCacheKey("home")).updated, original);
});

test("cached articles stay visible while fresh note pages are scanned", async () => {
  const { app, get, post } = cachedFeedFixture();
  app.state.filter = "article";
  app.state.api.timeline = async () => ({ posts: [post("old", { title: "Readable cached article" })] });
  await app.loadFeed(false, 1);
  let finish;
  app.state.api.timeline = async (_, cursor) => cursor
    ? new Promise((resolve) => { finish = resolve; })
    : { posts: [post("note", { kind: "post" })], next: "next" };
  const loading = app.loadFeed(false, 1);
  await new Promise(setImmediate);
  assert.match(get("app").innerHTML, /Readable cached article/);
  finish({ posts: [post("new", { title: "New readable article" })] });
  await loading;
  assert.match(get("app").innerHTML, /New readable article/);
  assert.doesNotMatch(get("app").innerHTML, /Readable cached article/);
});

test("relationship requests share in-flight IDs, cache results, and batch at eighty", async () => {
  const calls = []; let finish;
  const { app, context } = setup(async (url) => {
    const ids = new URL(url).searchParams.getAll("id[]"); calls.push(ids);
    if (ids.includes("pending")) return new Promise((resolve) => { finish = resolve; });
    return Response.json(ids.map((id) => ({ id, following: false })));
  });
  const api = new app.API("example.org");
  const first = api.relationships(["pending", "pending"]);
  const second = api.relationships(["pending"]);
  assert.equal(calls.length, 1);
  finish(Response.json([{ id: "pending", following: false }]));
  await Promise.all([first, second]);
  await api.relationships(["pending"]);
  assert.equal(calls.length, 1);
  await api.relationships(Array.from({ length: 161 }, (_, i) => String(i)));
  assert.deepEqual(calls.slice(1).map((ids) => ids.length), [80, 80, 1]);
  const now = Date.now(); context.Date = class extends Date { static now() { return now + 61000; } };
  const stale = api.relationships(["pending"]);
  assert.equal(calls.length, 5);
  finish(Response.json([])); await stale;
  await api.relationships(["pending"]);
  assert.equal(calls.length, 5, "missing IDs are cached too");
});

test("late relationship reads cannot undo a successful follow", async () => {
  let finish;
  const { app } = setup(async (url, options) => options.method === "POST"
    ? Response.json({ id: "friend", following: true })
    : new Promise((resolve) => { finish = resolve; }));
  const api = new app.API("example.org", "token");
  const pending = api.relationships(["friend"]);
  await api.follow("friend", false);
  finish(Response.json([{ id: "friend", following: false }]));
  assert.equal((await pending)[0].following, true);
  assert.equal((await api.relationships(["friend"]))[0].following, true);
});

test("superseded feed requests are cancelled and cannot replace the new timeline", async () => {
  const { app, context, get } = cachedFeedFixture();
  app.htmlToMarkdown = (text) => text;
  let oldSignal;
  context.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/home")) return new Promise((_, reject) => {
      oldSignal = options.signal;
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    if (path.endsWith("/public")) return Response.json([sharedStatus({ id: "new", content: "Fresh local note" })]);
    return Response.json([]);
  };
  app.state.api = new app.API("good.example", "token");
  app.state.filter = "all";
  const old = app.loadFeed();
  app.state.timeline = "local";
  await app.loadFeed(); await old;
  assert.equal(oldSignal.aborted, true);
  assert.equal(app.state.error, "");
  assert.deepEqual(Array.from(app.state.posts, (p) => p.id), ["new"]);
  assert.equal(app.state.error, "");
  assert.match(get("app").innerHTML, /Fresh local note/);
});

test("leaving a loading profile aborts its network read", async () => {
  let signal;
  const { app, context } = await profileFixture(async (url, options) => {
    if (new URL(url).pathname.endsWith("/statuses")) return new Promise((_, reject) => {
      signal = options.signal;
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    return Response.json(profileAccount());
  });
  context.location.hash = "#profile";
  const profile = app.route();
  await new Promise(setImmediate);
  context.location.hash = "#settings";
  await app.route(); await profile;
  assert.equal(signal.aborted, true);
  assert.equal(app.state.view, "settings");
  assert.equal(app.state.error, "");
});

test("failed suggestions retry after backoff and concurrent callers share one attempt", async () => {
  const { app, context } = cachedFeedFixture();
  let calls = 0, finish;
  app.state.api.suggestions = () => { calls++; return new Promise((resolve, reject) => { finish = { resolve, reject }; }); };
  const one = app.loadSuggestions(), two = app.loadSuggestions();
  assert.equal(one, two); assert.equal(calls, 1);
  finish.reject(new Error("Timeout")); await one;
  assert.equal(app.state.suggestionsLoaded, false);
  await app.loadSuggestions(); assert.equal(calls, 1);
  const now = Date.now(); context.Date = class extends Date { static now() { return now + 61000; } };
  const retry = app.loadSuggestions(); assert.equal(calls, 2);
  finish.resolve([app.demoAuthors[0]]); await retry;
  assert.equal(app.state.suggestionsLoaded, true);
  await app.loadSuggestions(); assert.equal(calls, 2);
});

test("automatic refresh checks visible reading, respects freshness and backs off errors", async () => {
  const { app, context, post } = cachedFeedFixture();
  let calls = 0, fail = false;
  app.state.api.timeline = async () => { calls++; if (fail) throw new Error("Offline"); return { posts: [post("head")] }; };
  const now = Date.now();
  await app.loadFeed();
  await app.refreshReading(now + 1000); assert.equal(calls, 1);
  context.document.hidden = true;
  await app.refreshReading(now + 31000); assert.equal(calls, 1);
  context.document.hidden = false;
  context.window = { scrollY: 300 };
  await app.refreshReading(now + 31000); assert.equal(calls, 1);
  context.window.scrollY = 0;
  context.document.activeElement = { matches: () => true };
  await app.refreshReading(now + 31000); assert.equal(calls, 1);
  context.document.activeElement = undefined;
  await app.refreshReading(now + 31000); assert.equal(calls, 2);
  fail = true;
  await app.refreshReading(now + 62000); assert.equal(calls, 3);
  await app.refreshReading(now + 93000); assert.equal(calls, 3);
  await app.refreshReading(now + 123000); assert.equal(calls, 4);
});

test("pull refresh keeps the feed intact, skips unchanged renders and shares work with polling", async () => {
  const { app, get, post } = cachedFeedFixture();
  const posts = [post("head")];
  app.state.api.timeline = async () => ({ posts, next: "older" });
  await app.loadFeed(false, 1);
  const html = get("app").innerHTML;
  let calls = 0, finish;
  const frames = captureFeedRenders(get);
  app.state.api.timeline = () => { calls++; return new Promise((resolve) => { finish = resolve; }); };
  const now = Date.now() + 6000;
  const refresh = app.refreshReading(now, true);
  await app.refreshReading(now, true);
  await app.refreshReading(now + 31000);
  assert.equal(calls, 1);
  assert.equal(get("app").innerHTML, html);
  assert.equal(frames.length, 0);
  finish({ posts, next: "older" });
  await refresh;
  await new Promise(setImmediate);
  assert.equal(frames.length, 0);
  await app.refreshReading(now + 1000, true);
  assert.equal(calls, 1, "repeated pulls within five seconds do not refetch");
});

test("pull refresh reads one head page, retains overlapping older pages and uses a fresh cursor across gaps", async () => {
  const { app, get, post } = cachedFeedFixture();
  const now = Date.now() + 6000;
  const head = post("head"), older = post("older");
  app.state.api.timeline = async () => ({ posts: [head, older], next: "old-cursor" });
  await app.loadFeed(false, 1);
  let calls = 0;
  const frames = captureFeedRenders(get);
  app.state.api.timeline = async () => { calls++; return { posts: [post("new"), head], next: "new-cursor" }; };
  await app.refreshReading(now, true);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(frames.length, 1);
  assert.doesNotMatch(frames[0], /class="loading"/);
  assert.deepEqual(Array.from(app.state.posts, (p) => p.id), ["new", "head", "older"]);
  assert.equal(app.state.next, "old-cursor");
  app.state.api.timeline = async () => ({ posts: [post("distant")], next: "gap-cursor" });
  await app.refreshReading(now + 6000, true);
  assert.deepEqual(Array.from(app.state.posts, (p) => p.id), ["distant"]);
  assert.equal(app.state.next, "gap-cursor");
});

test("pull refresh keeps readable content on failure, backs off, and clears unauthorized data", async () => {
  const { app, post } = cachedFeedFixture();
  const now = Date.now() + 6000;
  app.state.api.timeline = async () => ({ posts: [post("old")] });
  await app.loadFeed(false, 1);
  let calls = 0;
  app.state.api.timeline = async () => { calls++; throw new Error("Offline"); };
  await app.refreshReading(now, true);
  assert.equal(app.state.posts[0].id, "old");
  assert.equal(app.state.error, "Offline");
  await app.refreshReading(now + 6000, true);
  assert.equal(calls, 1);
  app.state.api.timeline = async () => { throw new app.APIError("Sign in again", 401); };
  await app.refreshReading(now + 61000, true);
  assert.equal(app.state.posts.length, 0);
});

test("pull refresh cannot commit an old feed after navigation", async () => {
  const { app, context, get, post } = cachedFeedFixture();
  let finish;
  app.state.api.timeline = () => new Promise((resolve) => { finish = resolve; });
  const refresh = app.refreshReading(Date.now(), true);
  context.location.hash = "#settings";
  await app.route();
  const html = get("app").innerHTML;
  finish({ posts: [post("stale")] });
  await refresh;
  assert.equal(get("app").innerHTML, html);
  assert.equal(app.state.view, "settings");
  assert.equal(app.state.posts.length, 0);
});

test("pull refresh replaces search results and supports Saved without automatic polling", async () => {
  const { app, post } = cachedFeedFixture();
  app.state.view = "discover";
  app.state.query = "words";
  app.state.accounts = [app.demoAuthors[0]];
  app.state.searchTags = ["old"];
  app.state.api.search = async () => ({ posts: [post("found")], accounts: [], hashtags: ["fresh"] });
  await app.refreshReading(Date.now(), true);
  assert.equal(app.state.posts[0].id, "found");
  assert.equal(app.state.accounts.length, 0);
  assert.deepEqual(Array.from(app.state.searchTags), ["fresh"]);
  app.state.query = "";
  app.state.view = "bookmarks";
  let calls = 0;
  app.state.api.timeline = async (timeline) => { calls++; assert.equal(timeline, "bookmarks"); return { posts: [] }; };
  await app.refreshReading();
  assert.equal(calls, 0);
  await app.refreshReading(Date.now(), true);
  assert.equal(calls, 1);
});

test("Discover pull refresh only reads two public heads and keeps the loaded mix stable", async () => {
  const { app, get, post } = cachedFeedFixture();
  const posts = [post("first"), post("second")];
  app.state.view = "discover";
  app.state.exploring = true;
  app.state.posts = posts;
  app.state.next = "discovery";
  Object.assign(app.discovery, {
    owner: JSON.stringify([app.state.session.server, app.state.session.account.id]),
    posts, cursors: { local: "local-next", federated: "federated-next" },
  });
  const calls = [];
  app.state.api.favourites = async () => ({ posts: [] });
  app.state.api.followedTags = async () => ({ tags: [] });
  app.state.api.get = async () => [];
  app.state.api.timeline = async (timeline, cursor) => {
    calls.push([timeline, cursor]);
    return { posts: [posts[0]], next: `${timeline}-next` };
  };
  app.render();
  const frames = captureFeedRenders(get);
  await app.refreshReading(Date.now(), true);
  await new Promise(setImmediate);
  assert.deepEqual(calls.sort(), [["federated", undefined], ["local", undefined]]);
  assert.deepEqual(Array.from(app.state.posts, (p) => p.id), ["first", "second"]);
  assert.equal(frames.length, 0);
  assert.equal(app.state.error, "");
});

function pullFixture(fetch) {
  const { app, context } = setup(fetch), { get } = elements(context);
  const events = {}, windowEvents = {};
  const indicator = get("pull-refresh"), label = get("pull-refresh-label");
  indicator.style = { setProperty() {} };
  context.document.addEventListener = (name, handler) => { events[name] = handler; };
  context.document.documentElement.classList = { toggle() {} };
  context.window = { scrollY: 0, addEventListener(name, handler) { windowEvents[name] = handler; } };
  context.navigator = { onLine: true };
  context.matchMedia = () => ({ matches: true });
  context.getComputedStyle = () => ({ overflowX: "visible", overflowY: "visible" });
  const target = { closest: () => null, parentElement: context.document.body };
  const touch = (x, y) => ({ identifier: 1, clientX: x, clientY: y });
  const start = (x = 100, y = 100) => events.touchstart({ target, touches: [touch(x, y)] });
  const move = (x, y, extra = {}) => {
    const event = { touches: [touch(x, y)], cancelable: true, preventDefault() { this.prevented = true; }, ...extra };
    events.touchmove(event);
    return event;
  };
  app.setupPullRefresh();
  return { app, context, get, events, windowEvents, indicator, label, target, start, move };
}

test("pulling an article or note reloads its body and thread in place", async () => {
  for (const article of [true, false]) {
    const requests = [];
    let finish;
    const { app, context, get, events, indicator, start, move } = pullFixture(async (url, options) => {
      requests.push([url, options.headers.Authorization]);
      const refreshed = requests.length > 2;
      if (url.endsWith("/new-reply/context")) return Response.json({ ancestors: [], descendants: [
        sharedStatus({ id: "nested", content: "A nested reply", in_reply_to_id: "new-reply", replies_count: 0 }),
      ] });
      if (url.endsWith("/context")) {
        if (!refreshed) return Response.json({ ancestors: [], descendants: [] });
        return new Promise((resolve) => { finish = resolve; });
      }
      return Response.json(sharedStatus({ id: "reader-refresh",
        content: `${article ? "# Shared article\n\n" : ""}${refreshed ? "Edited body" : "Original body"}` }));
    });
    app.htmlToMarkdown = (text) => text;
    const server = article ? "https://source.example" : "https://reader.example";
    if (!article) {
      app.state.session = { ...longServer, account: app.demoMe, server, token: "local-token" };
      app.state.api = new app.API(server, "local-token");
    }
    context.location.hash = article ? "#read/reader-refresh?server=https%3A%2F%2Fsource.example" : "#read/reader-refresh";
    await app.route();
    const cached = app.state.reading;
    assert.ok(cached, app.state.error);
    app.state.posts = [cached];
    app.state.focus = true;
    app.state.replyDrafts.set(cached.id, "Unsent reply");
    const frames = captureFeedRenders(get);
    start(); move(100, 260); events.touchend();
    assert.equal(indicator.dataset.state, "loading");
    await new Promise(setImmediate);
    assert.equal(frames.length, 0);
    assert.match(get("app").innerHTML, /Original body/);
    finish(Response.json({ ancestors: [], descendants: [
      sharedStatus({ id: "new-reply", content: "A new reply", in_reply_to_id: cached.id }),
    ] }));
    await new Promise(setImmediate);
    assert.deepEqual(requests.slice(2), [cached.id, `${cached.id}/context`, "new-reply/context"].map((path) => [
      `${server}/api/v1/statuses/${path}`, article ? undefined : "Bearer local-token",
    ]));
    assert.equal(frames.length, 1);
    assert.match(frames[0], /Edited body/);
    assert.match(frames[0], /A new reply/);
    assert.match(frames[0], /A nested reply/);
    assert.equal(app.state.focus, true);
    if (!article) {
      assert.match(frames[0], /Unsent reply/);
      assert.equal(app.findPost(cached.id).markdown, "Edited body");
    }
  }
});

test("reader refresh keeps content on a failed thread request and cancels on navigation", async () => {
  let mode = "open", finish, signal;
  const { app, context, get } = pullFixture(async (url, options) => {
    if (mode === "pending") {
      signal = options.signal;
      return new Promise((resolve) => { finish = resolve; });
    }
    if (url.endsWith("/context")) return mode === "failed"
      ? Response.json({ error: "Thread unavailable" }, { status: 503 })
      : Response.json({ ancestors: [], descendants: [] });
    return Response.json(sharedStatus());
  });
  app.htmlToMarkdown = (text) => text;
  context.location.hash = "#read/slow-web?server=https%3A%2F%2Fsource.example";
  await app.route();
  const html = get("app").innerHTML;
  mode = "failed";
  await assert.rejects(app.refreshReader(), /Thread unavailable/);
  assert.equal(get("app").innerHTML, html);
  mode = "pending";
  const refresh = app.refreshReader();
  context.location.hash = "#settings";
  await app.route();
  assert.equal(signal.aborted, true);
  finish(Response.json(sharedStatus()));
  await refresh;
  assert.equal(app.state.view, "settings");
  assert.equal(app.state.reading, null);
});

test("mobile pull gesture arms only at the top and refreshes once on release", async () => {
  const { app, context, events, indicator, label, start, move } = pullFixture();
  let calls = 0, finish;
  app.refreshReading = () => { calls++; return new Promise((resolve) => { finish = resolve; }); };
  context.window.scrollY = 50;
  start(); move(100, 300); events.touchend();
  assert.equal(calls, 0);
  context.window.scrollY = 0;
  start(); move(100, 160); events.touchend();
  assert.equal(calls, 0, "short pulls cancel");
  start();
  assert.equal(move(100, 260).prevented, true);
  assert.equal(indicator.dataset.state, "ready");
  assert.equal(label.textContent, "Release to refresh");
  assert.equal(calls, 0, "crossing the threshold alone does not refresh");
  events.touchend();
  assert.equal(calls, 1);
  assert.equal(indicator.dataset.state, "loading");
  start(); move(100, 300); events.touchend();
  assert.equal(calls, 1);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 420));
  assert.equal(indicator.dataset.state, "");
});

test("pulling Your writing reloads publications, replies, drafts and scheduled posts", async () => {
  const { app, context, get, events, indicator, start, move } = pullFixture();
  const publication = ownPublication(app);
  const scheduled = { id: "scheduled", scheduled_at: "2030-01-01T12:00:00Z", params: { text: "Later" } };
  const remoteDraft = { id: "remote", scheduled_at: app.serverDraftTime(article.id),
    params: { text: app.encodeServerDraft(article) } };
  let finish;
  app.state.api = {
    accountPosts: async () => ({ posts: [publication, { ...publication, id: "reply", replyTo: "parent" }] }),
    scheduledStatuses: () => new Promise((resolve) => { finish = resolve; }),
  };
  app.state.view = "drafts";
  app.state.libraryTab = "scheduled";
  context.location.hash = "#drafts";
  app.render();
  const frames = captureFeedRenders(get);
  start(); move(100, 260); events.touchend();
  assert.equal(indicator.dataset.state, "loading");
  await new Promise(setImmediate);
  assert.equal(frames.length, 0);
  finish([scheduled, remoteDraft]);
  await new Promise(setImmediate);
  assert.equal(frames.length, 1);
  assert.match(frames[0], /<h2>Later<\/h2>/);
  assert.equal(app.state.libraryTab, "scheduled");
  assert.deepEqual(Array.from(app.state.ownPosts, (p) => p.id), [publication.id, "reply"]);
  assert.equal(app.getDrafts()[0].id, article.id);
});

test("pulling Messages refreshes the inbox quietly and keeps conversations on failure", async () => {
  for (const failed of [false, true]) {
    const { app, context, get, events, indicator, start, move } = pullFixture();
    ownPublication(app);
    const conversation = { id: "inbox", accounts: [app.demoAuthors[0]], unread: true, messages: [] };
    const requests = [];
    app.state.api = { conversations: async (cursor) => {
      requests.push(cursor);
      if (failed) throw new Error("Could not fetch conversations");
      return { conversations: [{ ...conversation, id: "fresh" }], next: "fresh-cursor" };
    } };
    app.state.view = "messages";
    app.state.conversations = [conversation];
    app.state.conversationNext = "older";
    context.location.hash = "#messages";
    app.render();
    const frames = captureFeedRenders(get);
    start(); move(100, 260); events.touchend();
    assert.equal(indicator.dataset.state, "loading");
    assert.equal(frames.length, 0);
    await new Promise(setImmediate);
    assert.deepEqual(requests, [undefined]);
    assert.equal(frames.length, 1);
    assert.match(frames[0], failed ? /href="#messages\/inbox"/ : /href="#messages\/fresh"/);
    if (failed) assert.match(frames[0], /Could not fetch conversations/);
    assert.equal(app.state.conversationNext, failed ? "older" : "fresh-cursor");
  }
});

test("pull gesture ignores sideways, canceled, multi-touch, nested, editing and desktop gestures", () => {
  const { app, context, events, windowEvents, target, start, move } = pullFixture();
  let calls = 0;
  app.refreshReading = async () => { calls++; };
  start(); move(260, 110); move(260, 400); events.touchend();
  start(); move(100, 280); events.touchcancel(); events.touchend();
  start(); move(100, 280, { touches: [{}, {}] }); events.touchend();
  start(); move(100, 280); move(100, 120); events.touchend();
  start(); move(100, 280, { cancelable: false }); events.touchend();
  start(); move(100, 280); context.location.hash = "#discover"; windowEvents.hashchange(); events.touchend();
  target.scrollHeight = 100; target.clientHeight = 50;
  context.getComputedStyle = () => ({ overflowY: "auto" });
  start(); move(100, 280); events.touchend();
  target.scrollHeight = 0;
  app.state.view = "editor";
  start(); move(100, 280); events.touchend();
  app.state.view = "home";
  context.matchMedia = () => ({ matches: false });
  start(); move(100, 280); events.touchend();
  assert.equal(calls, 0);
});

test("empty profiles refresh automatically so a background import becomes visible", async () => {
  let pages = 0, accounts = 0;
  const { app, context } = await profileFixture(async (url) => {
    if (new URL(url).pathname.endsWith("/statuses")) return Response.json(++pages === 1 ? [] : [sharedStatus({ id: "imported", account: profileAccount() })]);
    return Response.json(profileAccount("me", { followers_count: ++accounts }));
  });
  context.location.hash = "#profile";
  await app.route();
  assert.equal(app.state.profile.posts.length, 0);
  await app.refreshReading(Date.now() + 5100);
  assert.deepEqual(Array.from(app.state.profile.posts, (p) => p.id), ["imported"]);
  assert.equal(app.state.profile.account.followers, 2);
});

test("unchanged background profile refreshes keep the visible DOM and never show a loader", async () => {
  let pages = 0, finish;
  const { app, context, get } = await profileFixture(async (url) => {
    if (url.includes("/statuses")) {
      if (++pages > 1) await new Promise((resolve) => { finish = resolve; });
      return Response.json([]);
    }
    return Response.json(profileAccount());
  });
  context.location.hash = "#profile";
  await app.route();
  const p = app.state.profile, html = get("app").innerHTML;
  let renders = 0;
  const render = app.render;
  app.render = () => { renders++; render(); };
  const refresh = app.refreshReading(Date.now() + 5100);
  await new Promise(setImmediate);
  assert.equal(app.state.profile, p);
  assert.equal(p.loading, false);
  assert.equal(get("app").innerHTML, html);
  assert.equal(renders, 0);
  finish();
  await refresh;
  await new Promise(setImmediate);
  assert.equal(pages, 2);
  assert.equal(renders, 0, "an unchanged response must not rebuild the page");
});

test("background profile refreshes commit changed account and posts in one render", async () => {
  let imported = false;
  const { app, context, get } = await profileFixture(async (url) => {
    const account = profileAccount("me", { followers_count: imported ? 124 : 123 });
    return Response.json(url.includes("/statuses") ? imported ? [sharedStatus({ account })] : [] : account);
  });
  context.location.hash = "#profile";
  await app.route();
  const frames = [], render = app.render;
  app.render = () => { render(); frames.push(get("app").innerHTML); };
  imported = true;
  await app.refreshReading(Date.now() + 5100);
  await new Promise(setImmediate);
  assert.equal(frames.length, 1);
  assert.doesNotMatch(frames[0], /class="loading"/);
  assert.equal(app.state.profile.account.followers, 124);
  assert.equal(app.state.profile.posts.length, 1);
});

test("automatic refresh pauses during uploads and ignores an older in-flight account read", async () => {
  let account = profileAccount(), delayRead = false, finishRead, finishUpload, reads = 0;
  const { app, context } = await profileFixture(async (url, options) => {
    if (options.method === "PATCH") {
      await new Promise((resolve) => { finishUpload = resolve; });
      account = profileAccount("me", { avatar: "https://example.org/new.png" });
      return Response.json(account);
    }
    if (url.includes("/statuses")) return Response.json([]);
    reads++;
    if (delayRead) return new Promise((resolve) => { finishRead = resolve; });
    return Response.json(account);
  });
  context.location.hash = "#profile";
  await app.route();
  delayRead = true;
  const refresh = app.refreshReading(Date.now() + 5100);
  const upload = app.updateProfileImage("avatar", new File(["image"], "image.png", { type: "image/png" }));
  finishUpload();
  await upload;
  finishRead(Response.json(profileAccount()));
  await refresh;
  assert.equal(app.state.profile.account.avatar, "https://example.org/new.png");
  const second = app.updateProfileImage("avatar", new File(["image"], "image.png", { type: "image/png" }));
  const before = reads;
  await app.refreshReading(Date.now() + 62000);
  assert.equal(reads, before);
  finishUpload();
  await second;
});

test("a late background profile response cannot replace the page after navigation", async () => {
  let finishRead, delayed = false;
  const { app, context, get } = await profileFixture(async (url) => {
    if (url.includes("/statuses")) return Response.json([]);
    if (delayed) return new Promise((resolve) => { finishRead = resolve; });
    return Response.json(profileAccount());
  });
  context.location.hash = "#profile";
  await app.route();
  delayed = true;
  const refresh = app.refreshReading(Date.now() + 5100);
  context.location.hash = "#settings";
  await app.route();
  const html = get("app").innerHTML;
  finishRead(Response.json(profileAccount("me", { avatar: "https://example.org/stale.png" })));
  await refresh;
  assert.equal(app.state.view, "settings");
  assert.equal(get("app").innerHTML, html);
  assert.notEqual(app.state.session.account.avatar, "https://example.org/stale.png");
});

const attachment = {
  id: "image-one", type: "image", url: "https://files.example/original.png",
  previewUrl: "https://files.example/preview.png", description: "A mountain at sunset",
};
const rawAttachment = {
  id: attachment.id, type: attachment.type, url: attachment.url,
  preview_url: attachment.previewUrl, description: attachment.description,
};
function editingClient(body = "First line\nSecond line") {
  const client = setup(), { app, context } = client, { get } = elements(context);
  app.state.draft = { ...article, body };
  app.state.view = "editor";
  const textarea = get("draft-body");
  Object.assign(textarea, {
    id: "draft-body", value: body, selectionStart: 0, selectionEnd: body.length,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.setSelectionRange(start + text.length, start + text.length);
    },
  });
  context.document.activeElement = textarea;
  get("modal").open = false;
  get("modal").close = () => {};
  return { ...client, get, textarea };
}

function vimClient(body = "First line\nSecond line") {
  const client = editingClient(body), { app, textarea, get } = client;
  const handlers = new Map();
  textarea.ownerDocument = {}; // This DOM stub has no focused layout surface.
  textarea.addEventListener = (name, handler) => handlers.set(name, handler);
  textarea.removeEventListener = (name, handler) => {
    if (handlers.get(name) === handler) handlers.delete(name);
  };
  textarea.setSelectionRange(0, 0);
  get("editor-vim-status");
  get("save-status");
  const key = (key, modifiers = {}) => {
    const event = { key, ...modifiers,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    handlers.get("keydown")?.(event);
    if (!event.stopped) app.editorKeydown(event);
    return event;
  };
  return { ...client, handlers, key };
}

test("Vim defaults off, persists its preference, and only attaches to an article body", () => {
  const { app, context, textarea, get, handlers } = vimClient();
  assert.equal(app.editorVimEnabled, false);
  assert.match(app.editorView(), /id="editor-vim" type="checkbox" >/);
  app.updateEditorVim();
  assert.equal(handlers.size, 0);
  app.setEditorVim(true);
  assert.equal(handlers.size, 3);
  assert.equal(get("editor-vim-status").textContent, "Vim · normal");
  assert.equal(get("editor-vim-status").hidden, false);
  assert.equal(setup(undefined, { localStorage: context.localStorage }).app.editorVimEnabled, true);
  app.state.draft.kind = "post";
  app.updateEditorVim();
  assert.equal(handlers.size, 0);
  assert.equal(textarea.dataset.vimMode, undefined);
  assert.doesNotMatch(app.editorView(), /editor-vim/);
  app.state.draft.kind = "article";
  app.state.preview = true;
  app.updateEditorVim();
  assert.equal(handlers.size, 0);
  app.state.preview = false;
  app.updateEditorVim();
  assert.equal(handlers.size, 3);
  app.setEditorVim(false);
  assert.equal(handlers.size, 0);
  assert.equal(get("editor-vim-status").hidden, true);
  assert.equal(setup(undefined, { localStorage: context.localStorage }).app.editorVimEnabled, false);
});

test("Vim edits use the existing draft autosave path and visual selections work with formatting", () => {
  const { app, textarea, key, get } = vimClient("hello world");
  app.setEditorVim(true);
  key("v"); key("l"); key("l"); key("l"); key("l");
  key("b", { ctrlKey: true });
  assert.equal(textarea.value, "**hello** world");
  assert.equal(app.state.draft.body, textarea.value);
  key("Escape"); key("0"); key("x");
  assert.equal(textarea.value, "*hello** world");
  assert.equal(get("save-status").dataset.state, "pending");
  app.flushDraft();
  assert.equal(app.getDrafts()[0].body, "*hello** world");
  assert.equal(get("save-status").textContent, "Saved");
  key("i");
  assert.equal(get("editor-vim-status").textContent, "Vim · insert");
  assert.equal(key("h").defaultPrevented, undefined);
  key("s", { metaKey: true });
  assert.equal(get("toast").textContent, "Draft saved.");
});

test("Vim Escape keeps Zen active and native Markdown keys only edit in Insert mode", () => {
  const { app, textarea, key } = vimClient("- item");
  app.setEditorVim(true);
  app.state.focus = true;
  key("i"); key("Escape");
  assert.equal(app.state.focus, true);
  assert.equal(key("Tab").defaultPrevented, undefined);
  assert.equal(textarea.value, "- item");
  key("Enter");
  assert.equal(textarea.value, "- item");
  key("A"); key("Enter");
  assert.equal(textarea.value, "- item\n- ");
  key("Tab");
  assert.equal(textarea.value, "- item\n-   ");
  app.state.view = "messages";
  app.updateEditorVim();
  assert.equal(textarea.dataset.vimMode, undefined);
});

test("image uploads use multipart, fall back only for unsupported v2, and poll processing without re-uploading", async () => {
  const requests = [];
  let polls = 0;
  const { app, context } = setup(async (url, options) => {
    requests.push({ path: new URL(url).pathname, ...options });
    if (url.endsWith("/api/v2/media")) return Response.json({}, { status: 404 });
    if (url.endsWith("/api/v1/media")) return Response.json({ ...rawAttachment, url: null });
    if (++polls === 1) return new Response(null, { status: 206 });
    return Response.json(rawAttachment);
  });
  context.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
  const api = new app.API("https://example.org", "token");
  const file = new File(["image"], "photo.png", { type: "image/png" });
  const pending = await api.uploadMedia(file);
  assert.equal(pending.url, "");
  const ready = await api.readyMedia(pending);
  assert.equal(ready.url, attachment.url);
  assert.equal(polls, 2);
  assert.equal(requests[0].body.get("file").name, "photo.png");
  assert.equal(requests[0].headers["Content-Type"], undefined);
  assert.equal(requests.filter((r) => r.method === "POST").length, 2);
  assert.equal(requests[0].headers.Authorization, "Bearer token");
});

test("failed media uploads do not retry a rejected or uncertain upload", async () => {
  for (const status of [401, 413, 422, 500]) {
    let requests = 0;
    const { app } = setup(async () => { requests++; return Response.json({ error: "Rejected" }, { status }); });
    await assert.rejects(new app.API("https://example.org").uploadMedia(new File(["x"], "photo.png", { type: "image/png" })), /Rejected/);
    assert.equal(requests, 1);
  }
});

test("server image limits validate formats, file size, count and image-only notes", () => {
  const { app } = setup();
  const cap = app.detectCapabilities({ configuration: {
    statuses: { max_characters: 500, max_media_attachments: 2 },
    media_attachments: { image_size_limit: 1000, supported_mime_types: ["image/png", "video/mp4"], description_limit: 20 },
  } });
  assert.equal(cap.maxMedia, 2);
  assert.equal(cap.imageSizeLimit, 1000);
  assert.deepEqual(Array.from(cap.imageTypes), ["image/png"]);
  assert.match(app.imageUploadProblem({ name: "x", type: "image/svg+xml", size: 100 }, cap, 0), /format/);
  assert.match(app.imageUploadProblem({ name: "x", type: "image/png", size: 1001 }, cap, 0), /under/);
  assert.match(app.imageUploadProblem({ name: "x", type: "image/png", size: 100 }, cap, 2), /2 attachments/);
  assert.equal(app.imageUploadProblem({ name: "x", type: "image/png", size: 100 }, cap, 0), "");
  const note = { ...app.newDraft("post"), media: [{ ...attachment, description: "Sunset" }] };
  assert.equal(app.publishProblem(note, cap), "");
  note.media[0].url = "";
  assert.match(app.publishProblem(note, cap), /processing/);
});

test("creating, updating and scheduling publications sends attachment IDs and edit descriptions", async () => {
  const requests = [];
  const { app } = setup(async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    if (body.scheduled_at) return Response.json({ id: "scheduled", scheduled_at: body.scheduled_at, params: { text: body.status } });
    return Response.json({ id: "post", content: "", account: { id: "me", username: "me", acct: "me", note: "" }, media_attachments: [rawAttachment] });
  });
  app.htmlToMarkdown = (html) => html;
  const api = new app.API("https://example.org");
  const created = await api.createStatus("", "public", undefined, "", "key", "text/plain", [attachment]);
  assert.equal(created.media[0].url, attachment.url);
  await api.editStatus("post", "Edited", "", "text/plain", [{ ...attachment, description: "New alt" }]);
  await api.editStatus("post", "Removed", "", "text/plain", []);
  await api.createScheduledStatus("Later", "public", "", "text/plain", new Date(Date.now() + 600000).toISOString(), "schedule-key", [attachment]);
  assert.deepEqual(requests[0].body.media_ids, [attachment.id]);
  assert.deepEqual(requests[1].body.media_attributes, [{ id: attachment.id, description: "New alt" }]);
  assert.deepEqual(requests[2].body.media_ids, []);
  assert.deepEqual(requests[3].body.media_ids, [attachment.id]);
});

test("image descriptions, inline placement, removal and galleries stay in sync", () => {
  const { app, textarea } = editingClient("A paragraph.");
  app.state.draft.media = [{ ...attachment }, { ...attachment, id: "second", url: "https://files.example/second.png" }];
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  app.insertDraftMedia(attachment.id);
  assert.match(textarea.value, /!\[A mountain at sunset\]/);
  app.updateMediaDescription(attachment.id, 'A [mountain] "sunset"');
  assert.match(app.markdown(app.state.draft.body), /alt="A \[mountain\] &quot;sunset&quot;"/);
  const gallery = app.attachmentGallery(app.state.draft.media, app.state.draft.body);
  assert.doesNotMatch(gallery, /original.png/);
  assert.match(gallery, /second.png/);
  app.flushDraft();
  assert.equal(app.getDrafts()[0].media[0].description, 'A [mountain] "sunset"');
  app.removeDraftMedia(attachment.id);
  assert.equal(app.state.draft.media.length, 1);
  assert.doesNotMatch(app.state.draft.body, /original.png/);
  assert.match(app.state.draft.body, /A paragraph/);
});

test("media survive edit drafts and server sync metadata, including alt-text conflicts", () => {
  const { app } = setup();
  const post = { ...app.demoPosts[0], media: [{ ...attachment }] };
  const draft = app.draftFromSource(post, { text: "# Article\n\nBody", spoiler_text: "" });
  assert.equal(draft.media[0].id, attachment.id);
  draft.media[0].description = "Changed";
  assert.equal(post.media[0].description, attachment.description);
  const encoded = app.encodeServerDraft(draft);
  const decoded = app.decodeServerDraft({ id: "s", scheduled_at: app.serverDraftTime(draft.id), params: { text: encoded }, media_attachments: [] });
  assert.equal(decoded.media[0].description, "Changed");
  assert.equal(app.draftContent(decoded), app.draftContent(draft));
  assert.notEqual(app.draftContent(draft), app.draftContent({ ...draft, media: [attachment] }));
  assert.equal(app.decodeServerDraft({ id: "s", scheduled_at: app.serverDraftTime(draft.id), params: { text: app.encodeServerDraft({ ...draft, media: [{ ...attachment, url: "javascript:alert(1)" }] }) }, media_attachments: [] }), null);
});

test("choosing images inserts them in order at the cursor saved before opening the picker", async () => {
  const { app, context, textarea } = editingClient("Before.\n\nAfter.");
  const second = { ...attachment, id: "second", url: "https://files.example/second.png" };
  const images = [attachment, second];
  app.state.session = { ...longServer, server: "https://example.org", account: { ...app.demoMe, id: "me" } };
  app.state.api = {
    capabilities: async () => longServer,
    uploadMedia: async () => ({ ...images.shift() }),
  };
  const file = new File(["image"], "photo.png", { type: "image/png" });
  let change;
  context.document.createElement = () => ({
    files: [file, file],
    addEventListener(type, handler) { if (type === "change") change = handler; },
    click() { textarea.setSelectionRange(0, 0); },
  });
  textarea.setSelectionRange(7, 7);
  app.rememberEditorSelection({ target: { closest: (selector) => selector.includes('[data-action="upload-media"]') } });
  textarea.setSelectionRange(0, 0); // Mobile toolbar blur can reset the selection.
  app.chooseDraftImages();
  change();
  await new Promise(setImmediate);
  const expected = `Before.\n\n${app.mediaMarkdown(attachment)}\n\n\n\n${app.mediaMarkdown(second)}\n\n\n\nAfter.`;
  assert.equal(textarea.value, expected);
  assert.equal(app.state.draft.body, expected);
  assert.equal(app.getDrafts()[0].body, expected);
  assert.equal(app.attachmentGallery(app.state.draft.media, expected), "");
  app.state.preview = true;
  const preview = app.editorView();
  assert.match(preview, /Before\.[\s\S]*<img[^>]+original\.png[\s\S]*<img[^>]+second\.png[\s\S]*After\./);
  app.updateMediaDescription(attachment.id, "Updated description");
  assert.match(textarea.value, /!\[Updated description\]/);
});

test("processing images retain their insertion point while the author types elsewhere", async () => {
  const { app, textarea } = editingClient("Before.\n\nAfter.");
  let finish, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const ready = new Promise((resolve) => { finish = resolve; });
  app.state.session = { ...longServer, server: "https://example.org", account: { id: "me" } };
  app.state.api = {
    capabilities: async () => longServer,
    uploadMedia: async () => ({ ...attachment, url: "" }),
    readyMedia: async () => { entered(); await ready; return { ...attachment }; },
  };
  textarea.setSelectionRange(7, 7);
  const upload = app.uploadDraftImages([new File(["image"], "photo.png", { type: "image/png" })]);
  await started;
  textarea.setRangeText("More text. ", 0, 0);
  app.captureDraft();
  app.updateMediaDescription(attachment.id, "Alt while processing");
  finish();
  await upload;
  const expected = `More text. Before.\n\n![Alt while processing](${attachment.url})\n\n\n\nAfter.`;
  assert.equal(textarea.value, expected);
  assert.equal(app.getDrafts()[0].body, expected);
  assert.equal(app.attachmentGallery(app.state.draft.media, expected), "");
});

test("plain-text notes keep uploaded images as attachments", async () => {
  const { app, textarea } = editingClient("A note.");
  app.state.draft.kind = "post";
  app.state.session = { ...longServer, format: "text/plain", server: "https://example.org", account: { id: "me" } };
  app.state.api = {
    capabilities: async () => ({ ...longServer, format: "text/plain" }),
    uploadMedia: async () => ({ ...attachment }),
  };
  textarea.setSelectionRange(2, 2);
  await app.uploadDraftImages([new File(["image"], "photo.png", { type: "image/png" })]);
  assert.equal(textarea.value, "A note.");
  assert.equal(app.getDrafts()[0].body, "A note.");
  assert.match(app.attachmentGallery(app.state.draft.media, app.state.draft.body), /original\.png/);
});

test("upload completion preserves typing and alt edits, and never restores deleted or foreign drafts", async () => {
  for (const mode of ["typing", "deleted", "switched"]) {
    const { app, textarea } = editingClient("Before upload");
    let finish, entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const ready = new Promise((resolve) => { finish = resolve; });
    app.state.session = { ...longServer, server: "https://example.org", account: { id: "me" } };
    app.state.api = {
      capabilities: async () => longServer,
      uploadMedia: async () => ({ ...attachment, url: "" }),
      readyMedia: async () => { entered(); await ready; return { ...attachment }; },
    };
    const originalKey = app.draftKey(), originalId = app.state.draft.id;
    const upload = app.uploadDraftImages([new File(["image"], "photo.png", { type: "image/png" })]);
    await started;
    assert.match(app.publishProblem(app.state.draft, longServer), /uploading/);
    if (mode === "typing") {
      textarea.value = "Written while uploading";
      app.captureDraft();
      app.updateMediaDescription(attachment.id, "Alt while processing");
    } else if (mode === "deleted") {
      app.removeDraft(originalId);
      app.state.draft = null;
    } else {
      app.state.session = { ...longServer, server: "https://other.example", account: { id: "other" } };
      app.state.api = null;
      app.state.draft = { ...article, id: "other-draft", body: "Other account" };
    }
    finish();
    await upload;
    const originals = app.readStore(originalKey, []);
    if (mode === "deleted") assert.equal(originals.length, 0);
    else assert.equal(originals[0].media[0].url, attachment.url);
    if (mode === "typing") {
      assert.equal(app.state.draft.body, "Written while uploading");
      assert.equal(app.state.draft.media[0].description, "Alt while processing");
    }
    if (mode === "switched") {
      assert.equal(app.state.draft.body, "Other account");
      assert.equal(app.state.draft.media, undefined);
    }
  }
});

test("formatting applies to each selected line and renders nested lists and checklists", () => {
  const { app, textarea } = editingClient();
  app.formatSelection("ordered");
  assert.equal(textarea.value, "1. First line\n2. Second line");
  app.formatSelection("task");
  assert.equal(textarea.value, "- [ ] First line\n- [ ] Second line");
  const rendered = app.markdown("- [x] Done\n  - Nested\n- [ ] Next\n\n3. Third");
  assert.match(rendered, /disabled checked/);
  assert.match(rendered, /<ul><li>Nested<\/li><\/ul>/);
  assert.match(rendered, /<ol start="3">/);
  assert.doesNotMatch(app.markdown("- [x] <script>alert(1)</script>"), /<script>/);
});

test("Enter continues ordered lists and tasks, ends empty items, and leaves code blocks alone", () => {
  for (const [source, expected, handled] of [
    ["2. Second", "2. Second\n3. ", true],
    ["- [x] Done", "- [x] Done\n- [ ] ", true],
    ["> Quote", "> Quote\n> ", true],
    ["- ", "", true],
    ["```\n- Code", "```\n- Code", false],
  ]) {
    const { app, textarea } = editingClient(source);
    textarea.setSelectionRange(source.length, source.length);
    let prevented = false;
    app.editorKeydown({ key: "Enter", preventDefault() { prevented = true; } });
    assert.equal(prevented, handled);
    assert.equal(textarea.value, expected);
  }
});

test("toolbar edits use native editing when available, preserving the browser undo history", () => {
  const { app, context, textarea } = editingClient("hello");
  const calls = [];
  context.document.execCommand = (command, ui, text) => {
    calls.push(command);
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd);
    return true;
  };
  app.formatSelection("bold");
  assert.deepEqual(calls, ["insertText"]);
  assert.equal(textarea.value, "**hello**");
  app.formatSelection("bold");
  assert.equal(textarea.value, "hello");
});

test("publication retries retain media descriptions and replay the same idempotency key", async () => {
  for (const scheduled of [false, true]) {
    const { app, get } = editingClient();
    get("modal").close = () => {};
    app.state.draft.media = [{ ...attachment }];
    app.state.session = { ...longServer, server: "https://example.org", account: { id: "me" } };
    let descriptions = 0, attempts = 0;
    const keys = [];
    const publish = async (...args) => {
      keys.push(args[scheduled ? 5 : 4]);
      assert.equal(args[6][0].id, attachment.id);
      if (++attempts === 1) throw new Error("Response lost");
      return { ...app.demoPosts[0], id: "published", media: [{ ...attachment }] };
    };
    app.state.api = {
      capabilities: async () => longServer,
      describeMedia: async () => { descriptions++; if (descriptions > 1) throw new Error("Already attached"); },
      createStatus: publish,
      createScheduledStatus: publish,
    };
    const date = new Date(Date.now() + 600000).toISOString();
    const attempt = () => scheduled ? app.scheduleDraft(date) : app.publishDraft();
    await assert.rejects(attempt(), /Response lost/);
    assert.equal(app.getDrafts()[0].media[0].id, attachment.id);
    await attempt();
    assert.equal(descriptions, 1);
    assert.equal(keys[0], keys[1]);
    assert.equal(app.state.draft, null);
  }
});

test("a failed upload leaves the text and earlier images saved with an actionable error", async () => {
  const { app, textarea } = editingClient("Keep this writing");
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  app.state.session = { ...longServer, server: "https://example.org", account: { id: "me" } };
  let uploads = 0;
  app.state.api = {
    capabilities: async () => longServer,
    uploadMedia: async () => {
      if (++uploads === 2) throw new Error("Upload interrupted. Try again.");
      return { ...attachment };
    },
  };
  const file = new File(["image"], "photo.png", { type: "image/png" });
  await app.uploadDraftImages([file, file]);
  assert.equal(app.state.draft.body, `Keep this writing\n\n${app.mediaMarkdown(attachment)}\n\n`);
  assert.equal(app.getDrafts()[0].body, app.state.draft.body);
  assert.equal(app.getDrafts()[0].media.length, 1);
  assert.equal(app.mediaBusy(app.state.draft), false);
  assert.match(app.draftMediaView(app.state.draft), /Upload interrupted\. Try again\./);
});

test("URL dialogs insert safe links and images at the remembered selection", () => {
  const { app, get, textarea } = editingClient("Selected text");
  get("modal").querySelector = () => null;
  get("modal").showModal = () => {};
  app.formatSelection("link");
  assert.throws(() => app.insertEditorLink("javascript:alert(1)", "unsafe"), /HTTP/);
  app.insertEditorLink("https://example.org/page(one)", "Read [this]");
  assert.equal(textarea.value, "[Read \\[this\\]](https://example.org/page%28one%29)");
  assert.match(app.markdown(textarea.value), />Read \[this\]<\/a>/);
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  app.formatSelection("image");
  assert.throws(() => app.insertEditorLink("http://example.org/photo.png", "image"), /HTTPS/);
  app.insertEditorLink("https://example.org/photo.png", 'Photo "caption"');
  assert.match(app.markdown(textarea.value), /alt="Photo &quot;caption&quot;"/);
});

test("link dialogs distinguish URLs, labels and existing links, even when a toolbar tap blurs the selection", () => {
  const url = "https://www.prux.org/posts/goodbye-swift-hello-rust/";
  const { app, get, textarea } = editingClient(url);
  get("modal").querySelector = () => null;
  get("modal").showModal = () => {};
  app.rememberEditorSelection({ target: { closest: () => true } });
  textarea.setSelectionRange(0, 0);
  app.formatSelection("link");
  assert.match(get("modal").innerHTML, new RegExp(`name="url"[^>]*value="${url}"`));
  assert.match(get("modal").innerHTML, /name="label" value=""[^>]*autofocus/);
  app.insertEditorLink(url, "The article");
  assert.equal(textarea.value, `[The article](${url})`);
  textarea.setSelectionRange(0, textarea.value.length);
  app.formatSelection("link");
  assert.match(get("modal").innerHTML, /name="label" value="The article"/);
  app.insertEditorLink(url, "Read it");
  assert.equal(textarea.value, `[Read it](${url})`);

  textarea.value = "Words to link";
  textarea.setSelectionRange(0, textarea.value.length);
  app.formatSelection("link");
  assert.match(get("modal").innerHTML, /name="url"[^>]*value=""[^>]*autofocus/);
  assert.match(get("modal").innerHTML, /name="label" value="Words to link"/);
});

test("mobile article focus follows the keyboard, survives link dialogs and restores normal navigation", () => {
  const { app, context, get, textarea } = editingClient();
  const classes = new Map(), styles = new Map();
  context.document.body.classList.toggle = (name, value) => classes.set(name, value);
  context.document.documentElement.style = { setProperty: (name, value) => styles.set(name, value) };
  context.window = { innerWidth: 393, innerHeight: 850, visualViewport: { height: 850, offsetTop: 0, scale: 1 } };
  textarea.matches = () => true;
  textarea.blur = () => { context.document.activeElement = null; };
  app.updateEditorViewport();
  assert.equal(classes.get("mobile-editor-focus"), true);
  assert.equal(classes.get("editor-keyboard-open"), false);
  Object.assign(context.window.visualViewport, { height: 480, offsetTop: 35 });
  // Android can shrink both viewports; retain the height from before the keyboard.
  context.window.innerHeight = 480;
  app.updateEditorViewport();
  assert.equal(classes.get("editor-keyboard-open"), true);
  assert.equal(styles.get("--editor-height"), "480px");
  assert.equal(styles.get("--editor-top"), "35px");
  get("modal").open = true;
  context.document.activeElement = { id: "url", matches: () => true };
  app.updateEditorViewport();
  assert.equal(classes.get("mobile-editor-focus"), true);
  get("modal").open = false;
  context.document.activeElement = textarea;
  context.window.innerHeight = 850;
  Object.assign(context.window.visualViewport, { height: 850, offsetTop: 0 });
  app.updateEditorViewport();
  assert.equal(classes.get("editor-keyboard-open"), false);
  assert.equal(classes.get("mobile-editor-focus"), false);
  assert.equal(context.document.activeElement, null);

  context.document.activeElement = textarea;
  app.updateEditorViewport();
  app.finishMobileEditing();
  assert.equal(classes.get("mobile-editor-focus"), false);
  assert.equal(app.getDrafts()[0].body, textarea.value);
  context.document.activeElement = textarea;
  app.state.draft.kind = "post";
  context.window.visualViewport.height = 480;
  app.updateEditorViewport();
  assert.equal(classes.get("editor-keyboard-open"), true);
  assert.equal(classes.get("mobile-editor-focus"), false);
  app.state.view = "home";
  app.updateEditorViewport();
  assert.equal(classes.get("editor-keyboard-open"), false);
  context.window.innerWidth = 1100;
  app.state.view = "editor";
  app.state.draft.kind = "article";
  context.document.activeElement = textarea;
  app.updateEditorViewport();
  assert.equal(classes.get("mobile-editor-focus"), false);
  context.window.innerWidth = 850;
  context.matchMedia = () => ({ matches: true });
  app.state.focus = true;
  app.updateEditorViewport();
  assert.equal(classes.get("mobile-editor-focus"), true);
  assert.equal(app.state.focus, false);
  assert.equal(classes.get("zen-mode"), false);
});

test("smart punctuation is optional and stays off in fenced, indented and inline code", () => {
  const { app, context, textarea } = editingClient("A sentence");
  app.updateEditorTyping();
  assert.equal(textarea.attributes.autocorrect, "off");
  app.setEditorSmartPunctuation(true);
  assert.equal(textarea.attributes.spellcheck, "true");
  const examples = [
    ["```c\nint foo() {", true], ["```c\nx\n```\nProse", false],
    ["~~~~js\n```\ncode", true], ["~~~~\ncode\n~~~\nmore code", true],
    ["~~~~\ncode\n~~~~\nProse", false], ["~~~\n`code\n~~~\nProse", false], ["> ```c\n> code", true],
    ["Use `printf(", true], ["Use `code` in prose", false],
    ["Use ``a ` nested tick", true], ["Use \\`literal tick", false],
    ["    indented code", true], ["\tcode", true],
  ];
  for (const [text, code] of examples) {
    textarea.value = text;
    textarea.setSelectionRange(text.length, text.length);
    assert.equal(app.editorCodeAt(text, text.length), code, text);
    app.updateEditorTyping();
    assert.equal(textarea.attributes.spellcheck, String(!code), text);
    assert.equal(textarea.attributes.autocapitalize, code ? "off" : "sentences", text);
  }
  const restored = setup(undefined, { localStorage: context.localStorage });
  assert.equal(restored.app.editorSmartPunctuation, true);
});

test("keyboard punctuation normalization preserves existing quotes, paste, composition and the cursor", () => {
  const { app, textarea } = editingClient('Keep “existing quotes”\n');
  const original = textarea.value;
  textarea.setSelectionRange(original.length, original.length);
  let prevented = false;
  app.editorBeforeInput({ target: textarea, inputType: "insertText", data: "“", cancelable: true,
    preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(textarea.value, original + '"');
  const type = (text, inputType, isComposing = false) => {
    app.editorBeforeInput({ target: textarea, inputType, data: text, isComposing, cancelable: false });
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd);
    app.editorInput({ target: textarea, inputType, isComposing });
  };
  type("’—", "insertReplacementText");
  assert.equal(textarea.value, original + '"\'--');
  assert.equal(textarea.selectionStart, textarea.value.length);
  type("“pasted”", "insertFromPaste");
  assert.ok(textarea.value.endsWith("“pasted”"));
  type("“composition”", "insertCompositionText", true);
  assert.ok(textarea.value.endsWith("“composition”"));
  app.setEditorSmartPunctuation(true);
  type("’", "insertText");
  assert.ok(textarea.value.endsWith("’"));
  textarea.value = "```c\n";
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  type("“code”", "insertText");
  assert.equal(textarea.value, '```c\n"code"');
});

test("search keeps hashtags and paginates each raw result category with type and offset", async () => {
  const calls = [];
  const { app } = setup(async (input) => {
    const url = new URL(input); calls.push(url);
    assert.equal(url.searchParams.get("q"), "rust & tools");
    const type = url.searchParams.get("type");
    if (!type) return Response.json({
      accounts: Array.from({ length: 20 }, (_, i) => sharedStatus().account),
      statuses: Array.from({ length: 20 }, (_, i) => sharedStatus({ id: `hidden-${i}`, visibility: "direct" })),
      hashtags: [{ name: "rust" }, { name: "rustlang" }],
    });
    assert.equal(url.searchParams.get("offset"), "20");
    assert.equal(url.searchParams.get("resolve"), "false");
    return Response.json({ accounts: [], statuses: type === "statuses" ? [sharedStatus({ id: "older" })] : [], hashtags: [] });
  });
  app.htmlToMarkdown = (text) => text;
  const api = new app.API("https://example.org", "token");
  const first = await api.search("rust & tools");
  assert.equal(first.posts.length, 0);
  assert.deepEqual(Array.from(first.hashtags), ["rust", "rustlang"]);
  assert.deepEqual(JSON.parse(first.next), { accounts: 20, statuses: 20 });
  const second = await api.search("rust & tools", undefined, first.next);
  assert.equal(second.posts[0].id, "older");
  assert.equal(second.next, undefined);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].searchParams.has("offset"), false);
  assert.equal(calls[0].searchParams.get("resolve"), "true");
  assert.deepEqual(calls.slice(1).map((url) => url.searchParams.get("type")).sort(), ["accounts", "statuses"]);
});

test("anonymous search omits authenticated resolution and pagination parameters", async () => {
  const { app } = setup(async (input) => {
    const params = new URL(input).searchParams;
    assert.equal(params.has("resolve"), false);
    assert.equal(params.has("offset"), false);
    return Response.json({ accounts: [], statuses: [], hashtags: Array.from({ length: 20 }, (_, i) => ({ name: `tag${i}` })) });
  });
  const result = await new app.API("https://example.org").search("tag");
  assert.equal(result.hashtags.length, 20);
  assert.equal(result.next, undefined);
});

test("reader hashtags open a prefilled search and paginate the exact tag timeline", async () => {
  const { app, context, post, get, requests } = feedFixture();
  app.state.session = { account: app.demoMe, server: "https://example.org", token: "token" };
  const markdown = "[#Café](https://remote.example/tags/caf%C3%A9) #cafe_tools `#code` [#docs](https://example.org/docs)";
  const note = post("note", { kind: "post", markdown });
  app.state.view = "reader";
  app.state.reading = note;
  app.render();
  const card = get("app").innerHTML;
  const [, href] = /href="([^"]+)">#Café<\/a>/.exec(card);
  assert.equal(href, "#discover?q=%23Caf%C3%A9");
  assert.match(card, /href="#discover\?q=%23cafe_tools">#cafe_tools<\/a>/);
  assert.match(card, /<code>#code<\/code>/);
  assert.match(card, /href="https:\/\/example\.org\/docs" target="_blank"[^>]*>#docs<\/a>/);
  assert.match(app.markdown(markdown), /href="https:\/\/remote\.example\/tags\/caf%C3%A9"/);
  app.state.api.search = async () => { throw new Error("Hashtags must not depend on full-text search"); };
  app.state.api.timeline = async (timeline, next) => {
    requests.push({ timeline, next });
    return { posts: Array.from({ length: 10 }, (_, i) => post(`${next ? "old" : "new"}-${i}`)), next: next ? undefined : "older" };
  };
  context.location.hash = href;
  await app.route();
  assert.equal(app.state.view, "discover");
  assert.equal(app.state.filter, "all");
  assert.equal(app.state.error, "");
  assert.deepEqual(requests, [{ timeline: "tag:Café", next: undefined }]);
  assert.match(get("app").innerHTML, /id="discover-search"[^\n]*value="#Café"/);
  assert.match(get("app").innerHTML, /Load more results/);
  await app.loadFeed(true);
  assert.equal(app.state.posts.length, 20);
  assert.equal(requests[1].next, "older");
  assert.equal(app.state.next, undefined);
});

test("search renders clickable tags and appends deduplicated people and posts", async () => {
  const { app, post, get } = feedFixture();
  app.state.session = { account: app.demoMe, server: "https://example.org", token: "token" };
  app.state.view = "discover";
  app.state.query = "rust";
  app.state.filter = "all";
  const cursors = [];
  app.state.api.search = async (_query, _signal, next) => {
    cursors.push(next);
    return { accounts: [app.demoAuthors[0]], posts: [post("one"), ...(next ? [post("two")] : [])],
      hashtags: next ? ["rust", "rustlang"] : ["rust"], next: next ? undefined : "search-page-2" };
  };
  await app.loadFeed();
  assert.match(get("app").innerHTML, /href="#discover\?q=%23rust"[^>]*>#rust<\/a>/);
  assert.match(get("app").innerHTML, /Load more results/);
  await app.loadFeed(true);
  assert.deepEqual(cursors, [undefined, "search-page-2"]);
  assert.equal(app.state.posts.length, 2);
  assert.equal(app.state.accounts.length, 1);
  assert.deepEqual(Array.from(app.state.searchTags), ["rust", "rustlang"]);
  app.state.query = "";
  await app.loadFeed();
  assert.equal(app.state.searchTags.length, 0);
  assert.doesNotMatch(get("app").innerHTML, /Matching hashtags/);
});

test("Home Replies combines received and following replies and paginates each source", async () => {
  const makeNotification = (id, type, status) => ({
    id, type, status, created_at: "2026-11-12T10:00:00Z", account: sharedStatus().account,
  });
  const reply = sharedStatus({ id: "nested", in_reply_to_id: "my-reply", title: null, content: "A reply to my reply", replies_count: 0, language: "en" });
  const hidden = sharedStatus({ id: "hidden", in_reply_to_id: "my-reply", content: "Filtered content",
    filtered: [{ filter: { filter_action: "hide" } }] });
  const replies = [
    makeNotification("6", "mention", reply),
    makeNotification("5", "mention", sharedStatus({ content: "A plain mention", title: null })),
    makeNotification("4", "mention", { ...reply, visibility: "direct", content: "Private DM" }),
    makeNotification("3", "mention", hidden),
  ];
  const homeOnly = sharedStatus({ id: "following-only", is_reply: true, title: null,
    content: "A reply from someone I follow", language: "de", created_at: "2026-11-12T11:00:00Z" });
  const requests = [];
  const homeRequests = [];
  const { app, context, get, click } = await postActionFixture(async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/context")) return Response.json({ ancestors: [], descendants: [] });
    if (u.pathname.endsWith("/nested")) return Response.json(reply);
    if (u.pathname.endsWith("/timelines/home")) {
      const max = u.searchParams.get("max_id");
      homeRequests.push(max);
      if (max === "older-following") return Response.json([{ ...homeOnly, id: "oldest-following", content: "Oldest following reply" }]);
      return Response.json(max ? [homeOnly] : [
        reply, homeOnly, sharedStatus({ id: "root", title: null, content: "A top-level post" }),
        { ...homeOnly, id: "private", visibility: "direct", content: "Private timeline reply" },
      ], {
        headers: { Link: `<https://account.example/api/v1/timelines/home?max_id=${max ? "older-following" : "following"}>; rel="next"` },
      });
    }
    requests.push(u);
    if (u.searchParams.has("max_id")) {
      return Response.json([replies[0], makeNotification("1", "mention", { ...reply, id: "older", content: "Older reply" })]);
    }
    if (u.searchParams.has("types[]")) {
      return Response.json(replies, {
        headers: { Link: '<https://account.example/api/v1/notifications?types%5B%5D=mention&max_id=3>; rel="next"' },
      });
    }
    return Response.json([makeNotification("7", "follow"), ...replies]);
  });
  app.state.session = { ...longServer, server: "https://account.example", account: app.demoMe, remember: true };
  app.state.api = new app.API(app.state.session.server, "token");
  context.location.hash = "#home?tab=replies";
  await app.route();
  assert.equal(app.state.view, "replies");
  assert.equal(requests[0].searchParams.get("types[]"), "mention");
  let html = get("app").innerHTML;
  assert.match(html, /data-id="replies" class="active" aria-pressed="true">Replies/);
  assert.match(html, /href="#read\/following-only">A reply from someone I follow/);
  assert.match(html, /href="#read\/nested">A reply to my reply/);
  assert.ok(html.indexOf("A reply from someone I follow") < html.indexOf("A reply to my reply"));
  assert.match(html, /data-action="more-notifications"[^>]*>Load older replies/);
  assert.doesNotMatch(html, /A plain mention|Private DM|Filtered content|A top-level post|Private timeline reply/);

  click("", "more-notifications");
  await new Promise(setImmediate);
  html = get("app").innerHTML;
  assert.equal(requests[1].searchParams.get("max_id"), "3");
  assert.equal(html.match(/A reply to my reply/g).length, 1);
  assert.equal(html.match(/A reply from someone I follow/g).length, 1);
  assert.match(html, /href="#read\/older">Older reply/);

  click("", "more-notifications");
  await new Promise(setImmediate);
  html = get("app").innerHTML;
  assert.deepEqual(homeRequests, [null, "following", "older-following"]);
  assert.equal(requests.length, 2);
  assert.match(html, /href="#read\/oldest-following">Oldest following reply/);
  assert.doesNotMatch(html, /Load older replies/);
  app.setDiscoveryLanguages(["en"]);
  assert.match(get("app").innerHTML, /A reply to my reply/);
  assert.doesNotMatch(get("app").innerHTML, /A reply from someone I follow|Oldest following reply/);
  app.setFeedFilter("article");
  assert.doesNotMatch(get("app").innerHTML, /A reply to my reply/);

  context.location.hash = "#read/nested";
  await app.route();
  assert.match(get("app").innerHTML, /href="#home\?tab=replies" aria-label="Back to reading"/);
  context.location.hash = "#notifications";
  await app.route();
  html = get("app").innerHTML;
  assert.match(html, /<h1>Notifications<\/h1>/);
  assert.equal(html.match(/href="#notifications"[^>]+aria-current="page"/g).length, 2);
  assert.match(html, /followed you/);
  assert.match(html, /A reply to my reply/);
  assert.doesNotMatch(html, /A plain mention/);
  assert.doesNotMatch(html, /Private DM|Filtered content|A reply from someone I follow/);
  assert.equal(JSON.parse(context.localStorage.getItem("fedistack:notifications-seen:https://account.example:you")).id, "7");
});

test("the bell badge detects new activity without rerendering and clears when opened", async () => {
  const { app, context } = setup();
  const { get } = elements(context);
  const dot = { hidden: true };
  const link = get("bell");
  link.querySelector = () => dot;
  context.document.querySelectorAll = (selector) => selector === '[data-nav-badge="notifications"]' ? [link] : [];
  context.navigator = { onLine: true };
  app.state.session = { ...longServer, server: "https://account.example", account: app.demoMe, remember: true };
  const newest = { id: "9007199254740994", type: "follow", account: app.demoMe, created: "2026-11-12T10:00:00Z" };
  let calls = 0;
  app.state.api = { notifications: async () => { calls++; return { items: [newest] }; } };
  app.writeStore("notifications-seen:https://account.example:you", { ...newest, id: "9007199254740993" });
  get("app").innerHTML = "Keep the editor mounted";

  await app.refreshActivityBadges(1000);
  assert.equal(app.hasNewNotifications(), true);
  assert.equal(dot.hidden, false);
  assert.equal(link.getAttribute("aria-label"), "Notifications, new activity");
  assert.equal(get("app").innerHTML, "Keep the editor mounted");
  await app.refreshActivityBadges(2000);
  assert.equal(calls, 1);

  context.location.hash = "#notifications";
  await app.route();
  assert.equal(app.hasNewNotifications(), false);
  assert.doesNotMatch(get("app").innerHTML, /Notifications, new activity/);
  await app.refreshActivityBadges(61000);
  assert.equal(dot.hidden, true);
  assert.equal(link.getAttribute("aria-label"), "Notifications");
});

test("the Messages badge uses server unread flags before the inbox opens and clears on read", async () => {
  const account = sharedStatus().account;
  const messages = [{ id: "inbox", accounts: [account], unread: true, last_status: null }];
  const calls = [];
  const { app, context, get } = await postActionFixture(async (url, { method }) => {
    const { pathname } = new URL(url);
    calls.push([method, pathname]);
    if (pathname === "/api/v1/notifications") return Response.json({ error: "Unsupported" }, { status: 404 });
    if (pathname === "/api/v1/conversations") return Response.json(messages);
    assert.equal(pathname, "/api/v1/conversations/inbox/read");
    messages[0].unread = false;
    return Response.json(messages[0]);
  });
  context.navigator = { onLine: true };
  app.state.session = { ...longServer, server: "https://account.example", account: app.demoMe };
  app.state.api = new app.API(app.state.session.server, "token");
  const dot = { hidden: true };
  const link = get("profile-link");
  link.querySelector = () => dot;
  context.document.querySelectorAll = (selector) => selector === '[data-nav-badge="profile"]' ? [link] : [];
  get("app").innerHTML = "Keep the editor mounted";
  await app.refreshActivityBadges(1000);
  assert.equal(dot.hidden, false);
  assert.equal(app.state.conversations.length, 0);
  assert.equal(get("app").innerHTML, "Keep the editor mounted");
  app.render();
  const html = get("app").innerHTML;
  assert.match(html, /class="mobile-nav"[^>]+--nav-items: 5/);
  assert.match(html, /aria-label="Your profile, unread conversations"/);
  assert.match(html, /aria-label="Account, unread conversations"/);
  assert.doesNotMatch(html, /href="#messages"/);

  context.location.hash = "#messages/inbox";
  await app.route();
  assert.equal(app.hasUnreadMessages(), false);
  assert.doesNotMatch(get("app").innerHTML, /unread conversations/);
  assert.deepEqual(calls, [
    ["GET", "/api/v1/notifications"], ["GET", "/api/v1/conversations"],
    ["GET", "/api/v1/conversations"], ["POST", "/api/v1/conversations/inbox/read"],
  ]);
});

test("a pending badge check cannot restore another account's unread activity", async () => {
  const { app, context } = setup();
  elements(context);
  context.navigator = { onLine: true };
  const session = { ...longServer, server: "https://account.example", account: app.demoMe };
  let releaseMessages, releaseNotifications;
  app.state.session = session;
  app.state.api = {
    conversationUnread: () => new Promise((resolve) => { releaseMessages = resolve; }),
    notifications: () => new Promise((resolve) => { releaseNotifications = resolve; }),
  };
  const pending = app.refreshActivityBadges(1000);
  app.state.session = { ...session, account: app.demoAuthors[0] };
  app.state.api = {};
  app.clearMessageDrafts();
  app.resetNotifications();
  releaseMessages(new Map([["old-conversation", true]]));
  releaseNotifications({ items: [{ id: "10", type: "follow", account: app.demoMe, created: "2026-11-12T10:00:00Z" }] });
  await pending;
  assert.equal(app.hasUnreadMessages(), false);
  assert.equal(app.hasNewNotifications(), false);
});
