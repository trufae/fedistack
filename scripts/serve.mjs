import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { shareDocument } from "./share-preview.mjs";

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
export function createRequestHandler({ root = resolve("dist"), publicURL, getStatus } = {}) {
  return async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const pathname = decodeURIComponent(url.pathname);
      const file = resolve(
        root,
        `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`,
      );
      if (!file.startsWith(root + sep)) throw new Error("Invalid path");
      let data = await readFile(file);
      if (file === resolve(root, "index.html")) {
        const sharedURL = publicURL ? new URL(publicURL) : url;
        sharedURL.search = url.search;
        data = await shareDocument(data.toString("utf8"), sharedURL, getStatus);
      } else if (file === resolve(root, "config.js")) {
        data = `${data.toString("utf8")}\nglobalThis.FEDISTACK_CONFIG.sharePreviews = true;\n`;
      }
      response.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      response.end(data);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8080);
  const server = createServer(createRequestHandler({ publicURL: process.env.FEDISTACK_PUBLIC_URL }));
  server.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `Port ${port} is already in use. Try make serve PORT=8081.`
        : error.message,
    );
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Fedistack: http://127.0.0.1:${server.address().port}`),
  );
}
