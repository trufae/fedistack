import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export function publicAddress(address) {
  if (isIP(address) === 6) {
    const [a, b] = address.split(":").map((part) => parseInt(part || "0", 16));
    return a >= 0x2000 && a < 0x4000 && a !== 0x2002 && a !== 0x3fff &&
      !(a === 0x2001 && (b < 0x200 || b === 0xdb8));
  }
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
    a === 203 && b === 0 && c === 113);
}

export function statusURL(server, id) {
  const url = new URL(server);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash || url.port || !id || id === "." || id === ".." || id.length > 512 || /[\x00-\x1f\x7f]/.test(id))
    throw new Error("Invalid publication address");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !publicAddress(host)) throw new Error("Private server address");
  url.pathname = `/api/v1/statuses/${encodeURIComponent(id)}`;
  return url;
}

export function fetchPublicStatus(url) {
  return new Promise((resolve, reject) => {
    // Validate the addresses used by the connection, preventing DNS rebinding.
    const req = request(url, {
      agent: false,
      headers: { Accept: "application/json", "User-Agent": "Fedistack-Link-Preview" },
      lookup(host, options, callback) {
        lookup(host, { all: true, verbatim: true }).then((addresses) => {
          if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
            throw new Error("Private server address");
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        }).catch(callback);
      },
    }, (res) => {
      // Never follow redirects or forward the reader's credentials/cookies.
      if (res.statusCode !== 200) { req.destroy(new Error("Publication unavailable")); return; }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) req.destroy(new Error("Publication too large"));
        else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error("Publication timed out")), 6000);
    req.on("error", reject);
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}

const escapeHTML = (value) => String(value).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const decode = (value) => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
  if (code.startsWith("#")) {
    const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "�";
  }
  return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[code.toLowerCase()] || entity;
});
const text = (value) => decode(value.replace(/<\/(?:p|div|h[1-6]|li|blockquote)\s*>|<br\b[^>]*>/gi, " ").replace(/<[^>]*>/g, ""))
  .replace(/!?\[([^\]]*)\]\([^)]+\)/g, "$1")
  .replace(/^#{1,6}\s+/gm, "").replace(/([*_`~])([^\n]*?)\1/g, "$2").replace(/\s+/g, " ").trim();
function imageURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return decode(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

export function statusMetadata(status) {
  if (!status || !["public", "unlisted"].includes(status.visibility)) return null;
  if (status.spoiler_text || status.sensitive)
    return { title: "Publication with a content warning", description: status.spoiler_text || "Sensitive content", image: "", imageAlt: "" };
  const content = String(status.content || "").replace(/<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, "");
  const heading = /^\s*(?:<h1\b[^>]*>([\s\S]*?)<\/h1>|#\s+([^\n]+))\s*/i.exec(content);
  const title = text(String(status.title || heading?.[1] || heading?.[2] || ""));
  const body = heading ? content.slice(heading[0].length).trim() : content.trim();
  const opening = /^(?:<p\b[^>]*>([\s\S]*?)<\/p>|([^\n]+)\n\s*\n)\s*/i.exec(body);
  const subtitle = opening && heading && body.slice(opening[0].length).trim() && text(opening[1] || opening[2]);
  const description = subtitle && subtitle.length <= 500 ? subtitle : text(body).slice(0, 180);
  const images = (Array.isArray(status.media_attachments) ? status.media_attachments : [])
    .filter((media) => media?.type === "image")
    .flatMap((media) => [[media.url, media.description], [media.preview_url, media.description]]);
  for (const [tag] of content.matchAll(/<img\b[^>]*>/gi)) images.push([attribute(tag, "src"), attribute(tag, "alt")]);
  for (const match of content.matchAll(/!\[((?:\\.|[^\]\\\n])*)\]\(([^\s)]+)\)/g))
    images.push([match[2], match[1].replace(/\\([\\\[\]])/g, "$1")]);
  const cover = images.find(([url]) => imageURL(url));
  return { title: title || text(body).slice(0, 100) || "Publication", description,
    image: cover ? imageURL(cover[0]) : "", imageAlt: String(cover?.[1] || "") };
}

export async function shareDocument(html, url, getStatus = fetchPublicStatus) {
  const id = url.searchParams.get("p");
  if (!id) return html;
  try {
    const api = statusURL(url.searchParams.get("server") || url.origin, id);
    const status = await getStatus(api);
    if (status.id !== id) return html;
    const meta = statusMetadata(status);
    if (!meta) return html;
    const canonical = new URL(url.pathname, url.origin);
    canonical.search = new URLSearchParams({ p: id, ...(api.origin !== url.origin ? { server: api.origin } : {}) }).toString();
    const properties = { "og:site_name": "Fedistack", "og:type": "article", "og:title": meta.title,
      "og:description": meta.description, "og:url": canonical.href,
      ...(meta.image ? { "og:image": meta.image, "og:image:alt": meta.imageAlt } : {}) };
    const names = { description: meta.description, "twitter:card": meta.image ? "summary_large_image" : "summary",
      "twitter:title": meta.title, "twitter:description": meta.description,
      ...(meta.image ? { "twitter:image": meta.image, "twitter:image:alt": meta.imageAlt } : {}) };
    const tags = Object.entries(properties).map(([key, value]) => `<meta property="${key}" content="${escapeHTML(value)}" />`)
      .concat(Object.entries(names).map(([key, value]) => `<meta name="${key}" content="${escapeHTML(value)}" />`));
    return html.replace(/\s*<meta\b[^>]*(?:property="og:[^"]+"|name="(?:twitter:[^"]+|description)")[^>]*>/g, "")
      .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHTML(meta.title)} — Fedistack</title>`)
      .replace("</head>", () => `${tags.join("\n    ")}\n  </head>`);
  } catch {
    // Keep the reader available when anonymous access or the source server fails.
    return html;
  }
}
