import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("the local server serves the complete static distribution and blocks traversal", async (t) => {
  const server = spawn(process.execPath, ["scripts/serve.mjs", "0"], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
  });
  const output = await Promise.race([
    once(server.stdout, "data").then(([data]) => data.toString()),
    once(server, "error").then(([error]) => {
      throw error;
    }),
    once(server.stderr, "data").then(([data]) => {
      throw new Error(data.toString());
    }),
  ]);
  const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];
  assert.ok(origin);
  for (const [path, type] of [
    ["/", "text/html"],
    ["/app.js", "text/javascript"],
    ["/config.js", "text/javascript"],
    ["/highlight.min.js", "text/javascript"],
    ["/editor-vim.js", "text/javascript"],
    ["/styles.css", "text/css"],
    ["/favicon.ico", "image/x-icon"],
    ["/manifest.webmanifest", "application/manifest+json"],
    ["/assets/slow-web.svg", "image/svg+xml"],
    ["/assets/favicon.svg", "image/svg+xml"],
    ["/assets/icon-32.png", "image/png"],
    ["/assets/icon-180.png", "image/png"],
    ["/assets/apple-touch-icon.png", "image/png"],
    ["/assets/icon-192.png", "image/png"],
    ["/assets/icon-512.png", "image/png"],
    ["/assets/favicon.ico", "image/x-icon"],
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), type);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  const html = await (await fetch(origin + "/")).text();
  assert.match(html, /<script src="config\.js"><\/script>/);
  assert.ok(html.indexOf('src="config.js"') < html.indexOf('src="app.js"'));
  const config = await fetch(origin + "/config.js");
  assert.equal(config.headers.get("cache-control"), "no-cache");
  assert.match(await config.text(), /globalThis.FEDISTACK_CONFIG/);
  const links = Array.from(html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g),
    (match) => match[1]);
  assert.equal(links.length, 5);
  const iconTypes = { svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", webmanifest: "application/manifest+json" };
  for (const path of links) {
    assert.match(path, /\.[a-f0-9]{16}\./);
    const response = await fetch(new URL(path, origin));
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("content-type"), iconTypes[path.split(".").at(-1)]);
    if (path.endsWith(".webmanifest")) {
      const manifest = await response.json();
      for (const icon of manifest.icons) {
        const iconResponse = await fetch(new URL(icon.src, response.url));
        assert.equal(iconResponse.status, 200, icon.src);
        assert.equal(iconResponse.headers.get("content-type"), icon.type);
        assert.ok((await iconResponse.arrayBuffer()).byteLength > 0);
      }
    } else {
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
  }
  assert.equal((await fetch(origin + "/..%2fpackage.json")).status, 404);
  assert.equal((await fetch(origin + "/missing")).status, 404);
});
