// The locally bundled Highlight.js classic script exposes this browser API.
declare const hljs: {
  getLanguage(name: string): unknown;
  highlight(code: string, options: { language: string; ignoreIllegals: boolean }): { value: string };
  highlightAuto(code: string): { value: string; language?: string };
};

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

  const shortcode = /:[\w+-]+(?:@[\w.-]+)?:/;
  const exactShortcode = new RegExp("^" + shortcode.source + "$");
  const emojiPattern = `(?<emoji>${shortcode.source})`;
  const emojiToken = new RegExp(shortcode.source, "g");
  export function emojiImages(entries?: MastodonEmoji[], picker = false): EmojiImages | undefined {
    if (!Array.isArray(entries)) return;
    const images: Record<string, string> = {};
    for (const emoji of entries) {
      if (typeof emoji?.shortcode !== "string" || (picker && (emoji.visible_in_picker === false || emoji.shortcode.includes("@")))) continue;
      const token = ":" + emoji.shortcode + ":";
      if (!exactShortcode.test(token)) continue;
      const staticUrl = safeURL(emoji.static_url || "", true);
      const url = staticUrl.startsWith("https:") ? staticUrl : safeURL(emoji.url || "", true);
      if (url.startsWith("https:")) images[token] = url;
    }
    if (Object.keys(images).length) return images;
  }

  function emojiHTML(token: string, emojis?: EmojiImages): string {
    const url = emojis?.[token];
    return url
      ? `<img class="custom-emoji" src="${escapeHTML(url)}" alt="${escapeHTML(token)}" title="${escapeHTML(token)}" loading="lazy" referrerpolicy="no-referrer">`
      : escapeHTML(token);
  }

  export function emojiText(text: string, emojis?: EmojiImages): string {
    if (!emojis) return escapeHTML(text);
    let result = "", cursor = 0;
    for (const match of text.matchAll(emojiToken)) {
      result += escapeHTML(text.slice(cursor, match.index)) + emojiHTML(match[0], emojis);
      cursor = match.index! + match[0].length;
    }
    return result + escapeHTML(text.slice(cursor));
  }

  const hashtag = /#([\p{L}\p{M}\p{N}_-]+)/u;
  const exactHashtag = new RegExp(`^${hashtag.source}$`, "u");

  export function hashtagName(query: string): string | undefined {
    return exactHashtag.exec(query)?.[1];
  }

  export function hashtagLink(tag: string, classes = ""): string {
    return `<a href="#${searchPath(`#${tag}`)}"${classes ? ` class="${classes}"` : ""}>#${escapeHTML(tag)}</a>`;
  }

  const username = /[\p{L}\p{M}\p{N}_-]+(?:\.[\p{L}\p{M}\p{N}_-]+)*/u;
  const hostname = /[a-z\d-]+(?:\.[a-z\d-]+)*/i;
  const handle = String.raw`@(?<mention>${username.source}(?:@${hostname.source})?)`;
  const exactMention = new RegExp(`^${handle}$`, "iu");
  const rawMention = String.raw`(?<![\p{L}\p{M}\p{N}_.@/\\#-])${handle}(?![\p{L}\p{M}\p{N}_@-]|\.[\p{L}\p{M}\p{N}_-])`;
  // An underscore inside a shortcode cannot end an emphasis span.
  const underscoreText = `(?:${shortcode.source}|(?!${shortcode.source})[^_\\n])+?`;
  const inlineToken = new RegExp(
    /`([^`\n]+)`|(!?)\[((?:\\.|[^\]\\\n])*)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*/.source +
    `|__(${underscoreText})__|` + /~~([^~\n]+)~~|\*([^*\n]+)\*/.source +
    `|_(${underscoreText})_|` + /(https?:\/\/[^\s<>]+)|\\([\\\[\]*_`~])/.source +
    `|${emojiPattern}`, "g",
  );
  const publicationToken = new RegExp(
    String.raw`${inlineToken.source}|(^|[^\p{L}\p{M}\p{N}_#/@\\])${hashtag.source}|${rawMention}`, "giu",
  );
  const mentionTextToken = new RegExp(String.raw`https?://[^\s<>]+|${emojiPattern}|${rawMention}`, "giu");

  interface PublicationMarkdown {
    mentions?: Mention[];
    server?: string;
    replyTo?: Account;
  }

  export function mentionHandle(label: string): string | undefined {
    return exactMention.exec(label)?.groups?.mention;
  }

  function matchesHandle(account: Mention, handle: string): boolean {
    const acct = account.acct.toLowerCase();
    if (acct === handle) return true;
    const url = safeURL(account.url || "");
    return !!url && !acct.includes("@") && `${acct}@${new URL(url).hostname}` === handle;
  }

  function mentionLink(handle: string, publication: PublicationMarkdown, href = ""): string {
    const [name, host] = handle.split("@");
    const key = handle.toLowerCase();
    const origin = host ? safeURL(`https://${host}`) : publication.server;
    const scopedKey = !host && origin ? `${key}@${new URL(origin).hostname}` : key;
    const mention = !href && publication.mentions?.find((m) => matchesHandle(m, key) || matchesHandle(m, scopedKey));
    const url = href || (mention && safeURL(mention.url || "")) ||
      (origin ? safeURL(`${new URL(origin).origin}/@${encodeURIComponent(name)}`) : "");
    return url
      ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(name)}</a>`
      : escapeHTML(`@${handle}`);
  }

  export function mentionText(source: string, publication: PublicationMarkdown, emojis?: EmojiImages): string {
    let result = "", cursor = 0;
    for (const match of source.matchAll(mentionTextToken)) {
      const { mention, emoji } = match.groups!;
      if (!mention && !emoji) continue;
      result += escapeHTML(source.slice(cursor, match.index)) +
        (mention ? mentionLink(mention, publication) : emojiHTML(emoji, emojis));
      cursor = match.index! + match[0].length;
    }
    return result + escapeHTML(source.slice(cursor));
  }

  function withoutReplyMention(source: string, parent: Account): string {
    const text = source.trimStart();
    if (!text.startsWith("@") && !text.startsWith("[")) return source;
    const first = text.matchAll(publicationToken).next().value;
    if (!first || first.index !== 0) return source;
    const rest = text.slice(first[0].length);
    if (!/^\s+\S/.test(rest)) return source;
    const raw = first.groups?.mention;
    const url = first[3] && mentionHandle(first[3]) && safeURL(first[4]);
    const parentURL = safeURL(parent.url || "");
    if (raw ? matchesHandle(parent, raw.toLowerCase())
      : url && parentURL && url.replace(/\/$/, "") === parentURL.replace(/\/$/, ""))
      return rest.trimStart();
    return source;
  }

  export function markdownLinks(source: string, depth = 0): string[] {
    if (depth > 8) return [];
    const links = new Set<string>();
    let fenced = false;
    const text = source.split("\n").filter((line) => {
      if (line.startsWith("```")) { fenced = !fenced; return false; }
      return !fenced;
    }).join("\n");
    for (const match of text.matchAll(inlineToken)) {
      if (match[1] || match[2] || match.groups?.emoji || /^@/.test(match[3] || "")) continue;
      const emphasis = match[5] || match[6] || match[7] || match[8] || match[9];
      if (emphasis) { markdownLinks(emphasis, depth + 1).forEach((url) => links.add(url)); continue; }
      let value = match[4] || match[10] || "";
      if (match[10]) {
        value = value.replace(/[.,!?:;]+$/, "");
        while (value.endsWith(")") && value.split(")").length > value.split("(").length) value = value.slice(0, -1);
      }
      const url = safeURL(value);
      if (url && !(hashtagName(match[3] || "") && /\/(?:tags?|hashtags)\/[^/]+\/?$/.test(new URL(url).pathname))) links.add(url);
    }
    return [...links];
  }

  function inline(source: string, publication?: PublicationMarkdown, emojis?: EmojiImages, depth = 0): string {
    if (depth > 8) return escapeHTML(source);
    // Parse from source, then escape each text node. Generated HTML is never parsed again.
    let result = "",
      cursor = 0;
    for (const match of source.matchAll(publication ? publicationToken : inlineToken)) {
      result += escapeHTML(source.slice(cursor, match.index));
      if (match[1]) result += `<code>${escapeHTML(match[1])}</code>`;
      else if (match[3] !== undefined) {
        const url = safeURL(match[4], !!match[2]);
        const tag = publication && url && !match[2] && hashtagName(match[3]);
        const mention = publication && url && !match[2] && mentionHandle(match[3]);
        if (mention && publication) result += mentionLink(mention, publication, url);
        else if (tag && /\/(?:tags?|hashtags)\/[^/]+\/?$/.test(new URL(url).pathname))
          result += hashtagLink(tag);
        else
          result += !url
            ? emojiText(match[3], emojis)
            : match[2]
              ? `<img src="${escapeHTML(url)}" alt="${escapeHTML(match[3].replace(/\\([\\\[\]])/g, "$1"))}" loading="lazy" referrerpolicy="no-referrer">`
              : `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${inline(match[3], undefined, emojis, depth + 1)}</a>`;
      } else if (match[5] || match[6])
        result += `<strong>${inline(match[5] || match[6], publication, emojis, depth + 1)}</strong>`;
      else if (match[7]) result += `<del>${inline(match[7], publication, emojis, depth + 1)}</del>`;
      else if (match[8] || match[9])
        result += `<em>${inline(match[8] || match[9], publication, emojis, depth + 1)}</em>`;
      else if (match[11]) result += escapeHTML(match[11]);
      else if (match.groups?.mention && publication) result += mentionLink(match.groups.mention, publication);
      else if (match.groups?.emoji) result += emojiHTML(match.groups.emoji, emojis);
      else if (match[14]) result += escapeHTML(match[13]) + hashtagLink(match[14]);
      else {
        const url = safeURL(match[10]);
        result += `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(match[10])}</a>`;
      }
      cursor = match.index! + match[0].length;
    }
    return result + escapeHTML(source.slice(cursor));
  }

  function codeBlock(source: string, info: string): string {
    let language = info.trim().split(/\s+/)[0].toLowerCase();
    let content = escapeHTML(source);
    // Unknown languages (and a missing optional script) remain readable plain code.
    if (typeof hljs !== "undefined" && (!language || hljs.getLanguage(language))) {
      if (language) content = hljs.highlight(source, { language, ignoreIllegals: true }).value;
      else {
        const result = hljs.highlightAuto(source);
        content = result.value;
        language = result.language || "";
      }
    }
    const classes = /^[\w+-]+$/.test(language) ? ` class="hljs language-${language}"` : "";
    return `<pre><code${classes}>${content}</code></pre>`;
  }

  export function markdown(source: string, publication?: PublicationMarkdown, emojis?: EmojiImages, depth = 0): string {
    if (depth > 32) return escapeHTML(source);
    if (!depth && publication?.replyTo) source = withoutReplyMention(source, publication.replyTo);
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
        output.push(codeBlock(code.join("\n"), line.slice(3)));
        i++;
        continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        const n = heading[1].length;
        output.push(`<h${n}>${inline(heading[2], publication, emojis)}</h${n}>`);
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
          `<blockquote>${inline(quote.join("\n"), publication, emojis).replace(/\n/g, "<br>")}</blockquote>`,
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
          items.push(`<li${task ? ' class="task-item"' : ""}>${task ? `<input type="checkbox" disabled${task[1] !== " " ? " checked" : ""} aria-label="${task[1] !== " " ? "Completed task" : "Incomplete task"}"> ` : ""}${inline(task ? task[2] : text, publication, emojis)}${nested.length ? markdown(nested.join("\n"), publication, emojis, depth + 1) : ""}</li>`);
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
        `<p>${inline(paragraph.join("\n"), publication, emojis).replace(/\n/g, "<br>")}</p>`,
      );
    }
    return output.join("\n");
  }

  export function htmlToMarkdown(html: string, emojis?: EmojiImages): string {
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
        if (emojis?.[alt] && /(?:^|\s)emoji(?:\s|$)/.test(node.getAttribute("class") || "")) return alt;
        return src ? `![${alt}](${src.replace(/\)/g, "%29")})` : alt;
      }
      if (tag === "strong" || tag === "b") return `**${text}**`;
      if (tag === "em" || tag === "i") return `*${text}*`;
      if (tag === "blockquote")
        return `\n\n> ${text.trim().replace(/\n/g, "\n> ")}\n\n`;
      if (tag === "pre") {
        const classes = `${node.querySelector("code")?.getAttribute("class") || ""} ${node.getAttribute("class") || ""}`;
        const language = /(?:^|\s)(?:language|lang)-([\w+-]+)(?=\s|$)/i.exec(classes)?.[1] || "";
        return `\n\n\`\`\`${language}\n${node.textContent}\n\`\`\`\n\n`;
      }
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

  export function articleContent(post: Pick<Post, "title" | "subtitle" | "markdown">): { subtitle: string; body: string } {
    let body = post.markdown, subtitle = post.subtitle;
    const removeTitle = (): boolean => {
      const heading = post.title && leadingHeading(body);
      if (!heading || plainText(heading[1]) !== plainText(post.title)) return false;
      body = body.slice(heading[0].length).trimStart();
      return true;
    };
    const hadTitle = removeTitle();
    while (removeTitle()) { /* Pasted articles can repeat their title. */ }
    const opening = /^([^\r\n]+)\r?\n[ \t]*\r?\n/.exec(body);
    // Published articles serialize the subtitle as a short paragraph after H1.
    // Only infer it when there is more body text, never from a list or heading.
    if (opening && (subtitle
      ? plainText(opening[1]) === subtitle
      : hadTitle && opening[1].length <= 500 && body.slice(opening[0].length).trim() &&
        markdown(opening[1]) === `<p>${escapeHTML(opening[1])}</p>`)) {
      subtitle ||= opening[1];
      body = body.slice(opening[0].length).trimStart();
      while (removeTitle()) { /* Remove a body title repeated after the subtitle. */ }
    }
    return { subtitle, body };
  }

  const plainBold = new RegExp(`\\*\\*([^*]+)\\*\\*|__(${underscoreText})__|(${shortcode.source})`, "g");
  const plainEmphasis = new RegExp(`([*\\x60~])([^\\n]*?)\\1|_(${underscoreText})_|(${shortcode.source})`, "g");
  export function plainText(source: string): string {
    return source
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^```[^\n]*\n?/gm, "")
      .replace(plainBold, (_m, a, b, emoji) => a || b || emoji)
      .replace(plainEmphasis, (_m, _marker, a, b, emoji) => a ?? b ?? emoji)
      .trim();
  }
}
