namespace Fedi {
  export function escapeHTML(value: unknown): string {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  }

  export function safeURL(value: string, image = false): string {
    try {
      const url = new URL(value);
      if (url.username || url.password) return "";
      if (url.protocol === "https:" || (!image && url.protocol === "http:"))
        return url.href;
    } catch {
      /* Relative URLs are only allowed for our bundled artwork. */
    }
    return image && /^assets\/[a-z-]+\.svg$/.test(value) ? value : "";
  }

  function inline(source: string, depth = 0): string {
    if (depth > 8) return escapeHTML(source);
    // Parse from source, then escape each text node. Generated HTML is never parsed again.
    const token =
      /`([^`\n]+)`|(!?)\[([^\]\n]*)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_|(https?:\/\/[^\s<>]+)/g;
    let result = "",
      cursor = 0;
    for (const match of source.matchAll(token)) {
      result += escapeHTML(source.slice(cursor, match.index));
      if (match[1]) result += `<code>${escapeHTML(match[1])}</code>`;
      else if (match[3] !== undefined) {
        const url = safeURL(match[4], !!match[2]);
        result += !url
          ? escapeHTML(match[3])
          : match[2]
            ? `<img src="${escapeHTML(url)}" alt="${escapeHTML(match[3])}" loading="lazy" referrerpolicy="no-referrer">`
            : `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${inline(match[3], depth + 1)}</a>`;
      } else if (match[5] || match[6])
        result += `<strong>${inline(match[5] || match[6], depth + 1)}</strong>`;
      else if (match[7]) result += `<del>${inline(match[7], depth + 1)}</del>`;
      else if (match[8] || match[9])
        result += `<em>${inline(match[8] || match[9], depth + 1)}</em>`;
      else {
        const url = safeURL(match[10]);
        result += `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(match[10])}</a>`;
      }
      cursor = match.index! + match[0].length;
    }
    return result + escapeHTML(source.slice(cursor));
  }

  export function markdown(source: string): string {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const output: string[] = [];
    let i = 0;
    const boundary = (line: string) =>
      /^(#{1,6}\s|```|>\s?|[-*+]\s|\d+\.\s|---+$)/.test(line);
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      if (line.startsWith("```")) {
        const code: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```"))
          code.push(lines[i++]);
        output.push(`<pre><code>${escapeHTML(code.join("\n"))}</code></pre>`);
        i++;
        continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        const n = heading[1].length;
        output.push(`<h${n}>${inline(heading[2])}</h${n}>`);
        i++;
        continue;
      }
      if (/^\s*---+\s*$/.test(line)) {
        output.push("<hr>");
        i++;
        continue;
      }
      if (/^>/.test(line)) {
        const quote: string[] = [];
        while (i < lines.length && /^>/.test(lines[i]))
          quote.push(lines[i++].replace(/^>\s?/, ""));
        output.push(
          `<blockquote>${inline(quote.join("\n")).replace(/\n/g, "<br>")}</blockquote>`,
        );
        continue;
      }
      if (/^([-*+]\s|\d+\.\s)/.test(line)) {
        const ordered = /^\d+\./.test(line),
          tag = ordered ? "ol" : "ul";
        const pattern = ordered ? /^\d+\.\s/ : /^[-*+]\s/;
        const items: string[] = [];
        while (i < lines.length && pattern.test(lines[i]))
          items.push(`<li>${inline(lines[i++].replace(pattern, ""))}</li>`);
        output.push(`<${tag}>${items.join("")}</${tag}>`);
        continue;
      }
      const paragraph = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !boundary(lines[i]))
        paragraph.push(lines[i++]);
      output.push(
        `<p>${inline(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`,
      );
    }
    return output.join("\n");
  }

  export function htmlToMarkdown(html: string): string {
    // Remote HTML is parsed inertly and reconstructed as our small Markdown subset.
    const doc = new DOMParser().parseFromString(html, "text/html");
    const walk = (node: Node): string => {
      if (node.nodeType === 3) return node.textContent || "";
      if (!(node instanceof Element)) return "";
      const tag = node.tagName.toLowerCase();
      if (
        [
          "script",
          "style",
          "iframe",
          "object",
          "svg",
          "math",
          "template",
        ].includes(tag)
      )
        return "";
      const text = Array.from(node.childNodes).map(walk).join("");
      if (/^h[1-6]$/.test(tag))
        return `\n\n${"#".repeat(Number(tag[1]))} ${text}\n\n`;
      if (tag === "a") {
        const href = safeURL(node.getAttribute("href") || "");
        return href
          ? `[${text.replace(/[\[\]]/g, "")}](${href.replace(/\)/g, "%29")})`
          : text;
      }
      if (tag === "img") {
        const src = safeURL(node.getAttribute("src") || "", true);
        const alt = (node.getAttribute("alt") || "").replace(/[\[\]]/g, "");
        return src ? `![${alt}](${src.replace(/\)/g, "%29")})` : alt;
      }
      if (tag === "strong" || tag === "b") return `**${text}**`;
      if (tag === "em" || tag === "i") return `*${text}*`;
      if (tag === "blockquote")
        return `\n\n> ${text.trim().replace(/\n/g, "\n> ")}\n\n`;
      if (tag === "pre") return `\n\n\`\`\`\n${node.textContent}\n\`\`\`\n\n`;
      if (tag === "code") return `\`${text}\``;
      if (tag === "li") return `- ${text}\n`;
      if (tag === "br") return "\n";
      if (["p", "div", "ul", "ol"].includes(tag)) return `\n\n${text}\n\n`;
      return text;
    };
    return Array.from(doc.body.childNodes)
      .map(walk)
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  export function plainText(source: string): string {
    return source
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^```[^\n]*\n?/gm, "")
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => a || b)
      .replace(/([*_`~])([^\n]*?)\1/g, "$2")
      .trim();
  }
}
