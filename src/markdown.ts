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

  const hashtag = /#([\p{L}\p{M}\p{N}_-]+)/u;
  const exactHashtag = new RegExp(`^${hashtag.source}$`, "u");

  export function hashtagName(query: string): string | undefined {
    return exactHashtag.exec(query)?.[1];
  }

  export function hashtagLink(tag: string, classes = ""): string {
    return `<a href="#${searchPath(`#${tag}`)}"${classes ? ` class="${classes}"` : ""}>#${escapeHTML(tag)}</a>`;
  }

  const inlineToken =
    /`([^`\n]+)`|(!?)\[((?:\\.|[^\]\\\n])*)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_|(https?:\/\/[^\s<>]+)|\\([\\\[\]*_`~])/g;
  const publicationToken = new RegExp(
    String.raw`${inlineToken.source}|(^|[^\p{L}\p{M}\p{N}_#/@\\])${hashtag.source}`, "gu",
  );

  function inline(source: string, linkHashtags: boolean, depth = 0): string {
    if (depth > 8) return escapeHTML(source);
    // Parse from source, then escape each text node. Generated HTML is never parsed again.
    let result = "",
      cursor = 0;
    for (const match of source.matchAll(linkHashtags ? publicationToken : inlineToken)) {
      result += escapeHTML(source.slice(cursor, match.index));
      if (match[1]) result += `<code>${escapeHTML(match[1])}</code>`;
      else if (match[3] !== undefined) {
        const url = safeURL(match[4], !!match[2]);
        const tag = linkHashtags && url && !match[2] && hashtagName(match[3]);
        if (tag && /\/(?:tags?|hashtags)\/[^/]+\/?$/.test(new URL(url).pathname))
          result += hashtagLink(tag);
        else
          result += !url
            ? escapeHTML(match[3])
            : match[2]
              ? `<img src="${escapeHTML(url)}" alt="${escapeHTML(match[3].replace(/\\([\\\[\]])/g, "$1"))}" loading="lazy" referrerpolicy="no-referrer">`
              : `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${inline(match[3], false, depth + 1)}</a>`;
      } else if (match[5] || match[6])
        result += `<strong>${inline(match[5] || match[6], linkHashtags, depth + 1)}</strong>`;
      else if (match[7]) result += `<del>${inline(match[7], linkHashtags, depth + 1)}</del>`;
      else if (match[8] || match[9])
        result += `<em>${inline(match[8] || match[9], linkHashtags, depth + 1)}</em>`;
      else if (match[11]) result += escapeHTML(match[11]);
      else if (match[13]) result += escapeHTML(match[12]) + hashtagLink(match[13]);
      else {
        const url = safeURL(match[10]);
        result += `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(match[10])}</a>`;
      }
      cursor = match.index! + match[0].length;
    }
    return result + escapeHTML(source.slice(cursor));
  }

  export function markdown(source: string, linkHashtags = false, depth = 0): string {
    if (depth > 32) return escapeHTML(source);
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
        output.push(`<h${n}>${inline(heading[2], linkHashtags)}</h${n}>`);
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
          `<blockquote>${inline(quote.join("\n"), linkHashtags).replace(/\n/g, "<br>")}</blockquote>`,
        );
        continue;
      }
      if (/^([-*+]\s|\d+\.\s)/.test(line)) {
        const ordered = /^\d+\./.test(line),
          tag = ordered ? "ol" : "ul";
        const pattern = ordered ? /^\d+\.\s/ : /^[-*+]\s/;
        const items: string[] = [];
        while (i < lines.length && pattern.test(lines[i])) {
          const text = lines[i++].replace(pattern, "");
          const task = !ordered && /^\[([ xX])\]\s+(.*)$/.exec(text);
          const nested: string[] = [];
          while (i < lines.length && /^( {2,}|\t)/.test(lines[i]))
            nested.push(lines[i++].replace(/^( {2}|\t)/, ""));
          items.push(`<li${task ? ' class="task-item"' : ""}>${task ? `<input type="checkbox" disabled${task[1] !== " " ? " checked" : ""} aria-label="${task[1] !== " " ? "Completed task" : "Incomplete task"}"> ` : ""}${inline(task ? task[2] : text, linkHashtags)}${nested.length ? markdown(nested.join("\n"), linkHashtags, depth + 1) : ""}</li>`);
        }
        const first = ordered ? parseInt(line, 10) : 1;
        output.push(`<${tag}${ordered && first !== 1 ? ` start="${first}"` : ""}>${items.join("")}</${tag}>`);
        continue;
      }
      const paragraph = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !boundary(lines[i]))
        paragraph.push(lines[i++]);
      output.push(
        `<p>${inline(paragraph.join("\n"), linkHashtags).replace(/\n/g, "<br>")}</p>`,
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
      if (tag === "del" || tag === "s") return `~~${text}~~`;
      if (tag === "li") {
        const ordered = node.parentElement?.tagName.toLowerCase() === "ol";
        const index = ordered ? Array.from(node.parentElement!.children).indexOf(node) + Number(node.parentElement!.getAttribute("start") || 1) : 0;
        return `${ordered ? `${index}.` : "-"} ${text}\n`;
      }
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

  export function leadingHeading(source: string): RegExpExecArray | null {
    return /^(?:[ \t]*\r?\n)*#[ \t]+([^\r\n]+)(?:\r?\n|$)/.exec(source);
  }

  export function articleBody(post: Post): string {
    const heading = post.title && leadingHeading(post.markdown);
    return heading && plainText(heading[1]) === post.title
      ? post.markdown.slice(heading[0].length)
      : post.markdown;
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
