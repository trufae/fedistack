import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = resolve(process.argv[2] || fileURLToPath(new URL("../public/", import.meta.url)));
const output = resolve(process.argv[3] || fileURLToPath(new URL("../dist/", import.meta.url)));

// A changed filename makes browsers fetch updated icons, including favicon caches.
function writeVersioned(path, data) {
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 16);
  const extension = extname(path);
  const versioned = `${path.slice(0, -extension.length)}.${hash}${extension}`;
  const destination = resolve(output, versioned);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, data);
  return versioned;
}

function copyIcon(path) {
  return writeVersioned(path, readFileSync(resolve(source, path)));
}

const manifest = JSON.parse(readFileSync(resolve(source, "manifest.webmanifest"), "utf8"));
for (const icon of manifest.icons) icon.src = copyIcon(icon.src);
const manifestData = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestPath = writeVersioned("manifest.webmanifest", manifestData);
// Keep the original URL working for existing installations.
writeFileSync(resolve(output, "manifest.webmanifest"), manifestData);

const html = readFileSync(resolve(source, "index.html"), "utf8")
  .replace(/(<link rel="(?:icon|apple-touch-icon)" href=")([^"]+)(")/g,
    (_, before, path, after) => before + copyIcon(path) + after)
  .replace('href="manifest.webmanifest"', `href="${manifestPath}"`);
writeFileSync(resolve(output, "index.html"), html);
copyFileSync(resolve(source, "assets/favicon.ico"), resolve(output, "favicon.ico"));
