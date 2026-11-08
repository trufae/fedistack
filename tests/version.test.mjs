import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("Settings displays the package version embedded in the static build", () => {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const context = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(readFileSync(new URL("../dist/app.js", import.meta.url), "utf8"), context);
  assert.equal(context.Fedi.version, version);
  const root = { innerHTML: "", querySelectorAll: () => [] };
  context.document = {
    documentElement: { dataset: { theme: "light" } },
    body: { classList: { toggle() {} } },
    getElementById: () => root,
  };
  context.Fedi.state.view = "settings";
  context.Fedi.render();
  assert.ok(root.innerHTML.includes(`Fedistack <span class="version-badge">${version}</span>`));
});
