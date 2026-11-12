// TypeScript 7 removed `outFile` and `module: none`, so the compiler can no
// longer emit one classic script. It emits one JavaScript file per input
// instead, each still a plain script that shares the global `Fedi` namespace.
// Concatenating them in `files` order restores the single `dist/app.js` bundle
// that `index.html` loads, without any ES-module loading at runtime.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const { compilerOptions, files } = JSON.parse(readFileSync(new URL("tsconfig.json", root), "utf8"));

const outDir = compilerOptions.outDir ?? "dist";
const parts = files.map((file) => {
  const compiled = new URL(`${outDir}/${file.replace(/\.ts$/, ".js")}`, root);
  return readFileSync(compiled, "utf8").trimEnd();
});

const bundle = new URL(`${outDir}/../app.js`, root);
writeFileSync(bundle, `${parts.join("\n")}\n`);
