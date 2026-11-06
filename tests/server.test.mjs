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
    ["/styles.css", "text/css"],
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
  assert.equal((await fetch(origin + "/..%2fpackage.json")).status, 404);
  assert.equal((await fetch(origin + "/missing")).status, 404);
});
