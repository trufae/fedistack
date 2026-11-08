import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error("Invalid package version");
mkdirSync(new URL("dist/", root), { recursive: true });
writeFileSync(new URL("dist/version.ts", root), `// Generated from package.json by scripts/version.mjs.\nnamespace Fedi { export const version = ${JSON.stringify(version)}; }\n`);
