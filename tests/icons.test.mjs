import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

function iconLinks(html) {
  return Array.from(html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g),
    (match) => match[1]);
}

test("icon builds keep stable URLs until their contents change", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "fedistack-icons-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "public");
  const output = join(directory, "dist");
  cpSync(new URL("public/", root), source, { recursive: true });
  const build = () => {
    execFileSync(process.execPath, [fileURLToPath(new URL("scripts/build-icons.mjs", root)), source, output]);
    return iconLinks(readFileSync(join(output, "index.html"), "utf8"));
  };

  const original = build();
  assert.equal(original.length, 5);
  for (const path of original) {
    assert.match(path, /\.[a-f0-9]{16}\.(?:ico|png|svg|webmanifest)$/);
    assert.ok(readFileSync(join(output, path)).length > 0);
    for (const base of ["https://example.com/", "https://example.com/fedistack/"]) {
      assert.equal(new URL(path, base).href, base + path);
    }
  }
  assert.deepEqual(build(), original);
  assert.deepEqual(readFileSync(join(output, "favicon.ico")), readFileSync(join(source, "assets/favicon.ico")));

  appendFileSync(join(source, "assets/favicon.svg"), "\n<!-- updated artwork -->\n");
  const changedSVG = build();
  const svgIndex = original.findIndex((path) => path.endsWith(".svg"));
  assert.notEqual(changedSVG[svgIndex], original[svgIndex]);
  assert.deepEqual(readFileSync(join(output, changedSVG[svgIndex])), readFileSync(join(source, "assets/favicon.svg")));
  assert.deepEqual(changedSVG.filter((_, i) => i !== svgIndex), original.filter((_, i) => i !== svgIndex));

  const manifestIndex = original.findIndex((path) => path.endsWith(".webmanifest"));
  const previousManifest = JSON.parse(readFileSync(join(output, changedSVG[manifestIndex]), "utf8"));
  // Simulate new raster bytes to check that both icon and manifest URLs change.
  appendFileSync(join(source, "assets/icon-192.png"), Buffer.from([0]));
  const changedPNG = build();
  assert.notEqual(changedPNG[manifestIndex], changedSVG[manifestIndex]);
  const manifest = JSON.parse(readFileSync(join(output, changedPNG[manifestIndex]), "utf8"));
  assert.equal(manifest.id, "./");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.notEqual(manifest.icons[0].src, previousManifest.icons[0].src);
  assert.equal(manifest.icons[1].src, previousManifest.icons[1].src);
  assert.deepEqual(readFileSync(join(output, manifest.icons[0].src)), readFileSync(join(source, "assets/icon-192.png")));
  assert.deepEqual(JSON.parse(readFileSync(join(output, "manifest.webmanifest"), "utf8")), manifest);
});
