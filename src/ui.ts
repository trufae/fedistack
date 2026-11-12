namespace Fedi {
  export const discoveryLanguages: [string, string][] = [
    ["en", "English"],
    ["es", "Español"],
    ["ca", "Català"],
    ["fr", "Français"],
    ["de", "Deutsch"],
    ["it", "Italiano"],
    ["pt", "Português"],
    ["nl", "Nederlands"],
    ["gl", "Galego"],
    ["eu", "Euskara"],
    ["sv", "Svenska"],
    ["da", "Dansk"],
    ["nb", "Norsk bokmål"],
    ["fi", "Suomi"],
    ["pl", "Polski"],
    ["cs", "Čeština"],
    ["el", "Ελληνικά"],
    ["ro", "Română"],
    ["hu", "Magyar"],
    ["tr", "Türkçe"],
    ["uk", "Українська"],
    ["ru", "Русский"],
    ["ar", "العربية"],
    ["he", "עברית"],
    ["fa", "فارسی"],
    ["hi", "हिन्दी"],
    ["bn", "বাংলা"],
    ["zh", "中文"],
    ["ja", "日本語"],
    ["ko", "한국어"],
    ["id", "Bahasa Indonesia"],
    ["vi", "Tiếng Việt"],
    ["th", "ไทย"],
    ["eo", "Esperanto"],
  ];
  export function languageSelector(id: string): string {
    const selected = state.discoveryLanguages;
    const available = discoveryLanguages.filter(([code]) => !selected.includes(code));
    return `<div class="language-picker" role="group" aria-labelledby="${id}-label">
      <div class="language-picker-heading"><span id="${id}-label">Languages</span>${selected.length ? `<button type="button" id="${id}-clear" class="text-button language-clear" data-action="clear-languages">Show all languages</button>` : ""}</div>
      <div class="language-picker-controls">${selected.length ? selected.map((code) => {
        const label = discoveryLanguages.find(([value]) => value === code)![1];
        return `<button type="button" id="${id}-${code}" class="language-chip" data-action="remove-language" data-id="${code}" aria-label="Remove ${label} language filter"><bdi>${label}</bdi>${icon("close")}</button>`;
      }).join("") : '<span class="language-all">All languages</span>'}
      <label class="language-add" for="${id}"><span class="sr-only">Add language</span><select id="${id}"${available.length ? "" : " disabled"}><option value="" selected disabled>${available.length ? "Add language…" : "All languages added"}</option>${available.map(([code, label]) => `<option value="${code}">${label}</option>`).join("")}</select></label></div>
    </div>`;
  }
  const paths: Record<string, string> = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5z"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9M10 21h4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    settings:
      '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    moon: '<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    heart:
      '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
    comment:
      '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 10 10 0 0 1-4-.8L3 21l1.8-5.5a10 10 0 0 1-.8-4A8.5 8.5 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8v.5z"/>',
    repost: '<path d="m2 7 4-4 4 4M6 3v12a3 3 0 0 0 3 3h3m10-1-4 4-4-4m4 4V9a3 3 0 0 0-3-3h-3"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    users:
      '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5v2"/>',
    book: '<path d="M12 5C8 2 3 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1zm0 0v16"/>',
    refresh:
      '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
    external:
      '<path d="M14 3h7v7m0-7L10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6"/>',
    link: '<path d="m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(2 -1)"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    image:
      '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 8"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
    send: '<path d="m22 2-7 20-4-9-9-4zm0 0L11 13"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14a4.5 4.5 0 0 0 8 0M9 9h.01M15 9h.01"/>',
    leaf: '<path d="M20 3C5 1 1 12 7 17s15-1 13-14ZM5 21 16 8"/>',
  };
  export function icon(name: string): string {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
  }
  export function avatar(account: Account, small = false, key = account.id): string {
    const initials = account.name
      .split(/\s/)
      .map((w) => w[0] || "")
      .slice(0, 2)
      .join("");
    return `<span class="avatar ${small ? "small" : ""} ${escapeHTML(account.color || "sage")}">${account.avatar ? `<img data-avatar-key="${escapeHTML(key)}" src="${escapeHTML(safeURL(account.avatar, true))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<span class="avatar-initials">${escapeHTML(initials)}</span></span>`;
  }
  export function imageLoadError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (image?.matches?.("img.custom-emoji")) image.replaceWith(image.alt);
    if (image?.matches?.("img[data-avatar-key]")) image.hidden = true;
    if (image?.matches?.(".link-preview-media img")) image.closest(".link-preview-media")?.remove();
  }
  export function renderHTML(element: HTMLElement, html: string): void {
    const images = new Map<string, HTMLImageElement[]>();
    const key = (image: HTMLImageElement): string => JSON.stringify([
      "data-avatar-key", "data-image-key", "src", "srcset", "sizes",
      "crossorigin", "referrerpolicy",
    ].map((name) => image.getAttribute(name)));
    element.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      // A failed image must get another load attempt on the next render.
      if (image.complete && image.naturalWidth === 0) return;
      const id = key(image);
      const matches = images.get(id) || [];
      matches.push(image);
      images.set(id, matches);
    });
    if (!images.size) {
      element.innerHTML = html;
      return;
    }
    // Parse inertly so replacement images cannot start duplicate requests.
    const template = document.createElement("template");
    template.innerHTML = html;
    const retained: [HTMLImageElement, HTMLImageElement][] = [];
    template.content.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      const previous = images.get(key(image))?.shift();
      if (previous) {
        // Covers can move between thumbnail, featured, and reader layouts.
        // Update their presentation without reassigning unchanged sources.
        for (const { name } of Array.from(previous.attributes)) {
          if (!image.hasAttribute(name)) previous.removeAttribute(name);
        }
        for (const { name, value } of Array.from(image.attributes)) {
          if (previous.getAttribute(name) !== value)
            previous.setAttribute(name, value);
        }
        image.removeAttribute("src");
        image.removeAttribute("srcset");
        retained.push([image, previous]);
      }
    });
    element.replaceChildren(template.content);
    // Reuse only after insertion: moving images into the template's separate
    // document would reset their loading state. Keep their src untouched.
    retained.forEach(([placeholder, image]) => placeholder.replaceWith(image));
  }
  export function relativeDate(date: string): string {
    const hours = Math.max(
      0,
      (Date.now() - new Date(date).getTime()) / 3600000,
    );
    if (hours < 1) return "Just now";
    if (hours < 24) return `${Math.floor(hours)}h ago`;
    if (hours < 168) return `${Math.floor(hours / 24)}d ago`;
    return new Date(date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  export function readingTime(text: string): number {
    return Math.max(1, Math.ceil(text.trim().split(/\s+/).length / 220));
  }
  export function action(
    name: string,
    label: string,
    id = "",
    classes = "button",
  ): string {
    const accessible = /^<svg[^]*<\/svg>$/.test(label)
      ? ` aria-label="${escapeHTML(name.replace(/-/g, " "))}"`
      : "";
    return `<button type="button" class="${classes}" data-action="${name}" data-id="${escapeHTML(id)}"${accessible}>${label}</button>`;
  }
  export function followButton(account: Account, compact = true): string {
    if (state.readerServer || account.id === (state.session?.account.id || "you")) return "";
    const r = state.relationships.get(account.id);
    const label = r?.following
      ? compact
        ? "Following"
        : "Unfollow"
      : r?.requested
        ? compact
          ? "Requested"
          : "Cancel request"
        : "Follow";
    return action(
      "follow",
      label,
      account.id,
      compact
        ? `button follow ${r?.following || r?.requested ? "is-following" : ""}`
        : "button subtle",
    );
  }

  export function canRepost(post: Post): boolean {
    return post.visibility === "public" || post.visibility === "unlisted";
  }

  export function canManagePublication(post: Post): boolean {
    return !state.readerServer && post.author.id === (state.session?.account.id || "you") &&
      post.visibility !== "direct";
  }

  export function editPublicationButton(post: Post): string {
    return canManagePublication(post)
      ? action("edit-publication", `${icon("edit")} Edit`, post.id, "text-button post-edit")
      : "";
  }

  export function postActions(post: Post): string {
    const share = `<button class="icon-button" data-action="share" data-id="${escapeHTML(post.id)}" aria-label="Share publication" title="Share in Fedistack">${icon("link")}</button>`;
    const original = post.url ? `<a class="icon-button" href="${escapeHTML(post.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open original post" title="Open original post">${icon("external")}</a>` : "";
    const links = `<div class="post-action-links">${share}${original}</div>`;
    if (state.readerServer)
      return `<div class="post-actions">${links}</div>`;
    return `<div class="post-actions">
      <button class="icon-button ${post.liked ? "liked" : ""}" data-action="like" data-id="${escapeHTML(post.id)}" aria-label="${post.liked ? "Unlike" : "Like"}" aria-pressed="${post.liked}">${icon("heart")}<span>${post.likes || ""}</span></button>
      <a class="icon-button" href="${escapeHTML(postReadLink(post.id))}" aria-label="Read ${post.replies} comments">${icon("comment")}<span>${post.replies || ""}</span></a>
      <button class="icon-button ${post.reposted ? "reposted" : ""}" data-action="repost" data-id="${escapeHTML(post.id)}" aria-label="${post.reposted ? "Undo repost" : "Repost"}" aria-pressed="${!!post.reposted}" title="${!canRepost(post) ? "Only public and unlisted posts can be reposted" : post.reposted ? "Undo repost" : "Repost"}"${canRepost(post) ? "" : " disabled"}>${icon("repost")}<span>${post.reposts || ""}</span></button>
      <button class="icon-button ${post.saved ? "saved" : ""}" data-action="save" data-id="${escapeHTML(post.id)}" aria-label="${post.saved ? "Remove bookmark" : "Save for later"}" aria-pressed="${post.saved}">${icon("bookmark")}</button>
      ${links}</div>`;
  }

  function previewExcerpt(text: string, limit: number): string {
    text = text.replace(/\s+/g, " ").trim();
    const characters = Array.from(text);
    if (characters.length <= limit) return text;
    let excerpt = characters.slice(0, limit).join("");
    const space = excerpt.lastIndexOf(" ");
    if (space > excerpt.length / 2) excerpt = excerpt.slice(0, space);
    return `${excerpt.trimEnd()}…`;
  }

  export function postMentionContext(post: Post) {
    return { mentions: post.mentions, server: safeURL(post.author.url || "") || state.readerServer || state.session?.server };
  }

  function postPreview(post: Post): { title: string; excerpt: string } {
    // Preview headings are display-only; the reader keeps the original post.
    const content = articleContent(post);
    const authoredTitle = post.title.trim();
    const mentions = [...(post.mentions || [])];
    const text = content.body.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, (_link, image, label, url) => {
      const acct = !image && mentionHandle(label);
      if (acct) mentions.unshift({ acct, url });
      return label;
    }).trimStart();
    const openingMentions: string[] = [];
    let start = 0;
    if (!authoredTitle) {
      const openingToken = /[*_`~]*(?:<?https?:\/\/\S+|(@[\p{L}\p{M}\p{N}_-]+(?:\.[\p{L}\p{M}\p{N}_-]+)*(?:@[\w-]+(?:\.[\w-]+)*)?)[*_`~]*[,.:;!?]*)(?:\s+|$)/iyu;
      for (let token; (token = openingToken.exec(text)); ) {
        if (token[1]) openingMentions.push(token[1]);
        start = openingToken.lastIndex;
      }
    }
    const body = plainText(text.slice(start))
      .replace(/^[ \t]*(?:>\s*|[-+*]\s+|\d+[.)]\s+)/gm, "")
      .replace(/[^\S\r\n]+/g, " ").trim();
    const opening = body.split(/\r?\n/, 1)[0].match(/^.*?(?:[.!?](?=\s|$)|[。！？]|$)/)?.[0] || "";
    const headline = previewExcerpt(opening, 100);
    const consumed = Array.from(opening).length > 100 ? headline.slice(0, -1) : headline;
    const title = authoredTitle || headline || "Untitled article";
    const excerpt = content.subtitle.trim() || (authoredTitle ? body : body.slice(consumed.length));
    const summary = previewExcerpt([...openingMentions, excerpt].join(" "), 180);
    return { title, excerpt: mentionText(summary, { ...postMentionContext(post), mentions }, post.emojis) };
  }

  function articleCardContent(post: Post, href: string, featured: boolean): string {
    const preview = postPreview(post);
    return `${featured && post.image ? `<a href="${href}" class="cover-link"><img class="feature-cover" data-image-key="cover:${escapeHTML(post.id)}" src="${escapeHTML(post.image)}" alt="${escapeHTML(post.imageAlt || "")}"></a>` : ""}
      <div class="post-content ${!featured && post.image ? "with-thumbnail" : ""}"><div>
      <a href="${href}" class="article-link"><h2>${emojiText(preview.title, post.emojis)}</h2></a>${preview.excerpt ? `<p class="excerpt">${preview.excerpt}</p>` : ""}<a href="${href}" class="continue-reading">Continue reading ${icon("arrow")}</a>
      <div class="article-meta"><span>Article</span>${post.tags[0] ? `<span>·</span><span>${hashtagLink(post.tags[0])}</span>` : ""}<span>·</span><span>${readingTime(post.markdown)} min read</span></div>
      </div>${!featured && post.image ? `<a href="${href}"><img class="thumbnail" data-image-key="cover:${escapeHTML(post.id)}" src="${escapeHTML(post.image)}" alt="${escapeHTML(post.imageAlt || "")}" loading="lazy"></a>` : ""}</div>`;
  }

  export function noteContent(post: Post, reading = false): string {
    const media = post.media?.length ? post.media : post.image
      ? [{ id: post.id, type: "image", url: post.image, previewUrl: post.image, description: post.imageAlt || "" }]
      : [];
    const body = post.markdown.trim() ? `<div class="prose note-body${reading ? " reading-prose" : ""}"${reading ? ` style="--reader-font-size: ${state.readerFontSize}px"` : ""}>${markdown(post.markdown, postMentionContext(post), post.emojis)}</div>` : "";
    return body + attachmentGallery(media, post.markdown, !reading) + postLinkPreview(post);
  }

  export function postCard(post: Post, featured = false): string {
    const hidden = post.warning && !state.revealed.has(post.id);
    const href = escapeHTML(postReadLink(post.id));
    const date = relativeDate(post.created);
    return `<article class="post-card ${featured ? "featured" : ""} ${post.kind}">
      ${post.boostedBy ? `<p class="boost-label">${icon("refresh")} Shared by ${emojiText(post.boostedBy, post.boostedByEmojis)}</p>` : ""}
      ${post.replyTo ? `<p class="reply-context"><a href="${escapeHTML(postReadLink(post.replyTo))}">${icon("comment")} View conversation ${icon("arrow")}</a></p>` : ""}
      <div class="post-byline">${profileAvatar(post.author, false, `post:${post.id}`)}<div><a class="author-link" href="#${escapeHTML(profilePath(post.author.id))}">${emojiText(post.author.name, post.author.emojis)}</a><div class="byline-sub">${escapeHTML(post.author.publication || post.author.acct)} <span>· ${post.kind === "post" ? `<a class="note-permalink" href="${href}" aria-label="Open note · ${date}">${date}</a>` : date}</span></div></div>${followButton(post.author)}${editPublicationButton(post)}</div>
      ${
        hidden
          ? `<div class="content-warning">${icon("eye")}<strong>${emojiText(post.warning, post.emojis)}</strong>${action("reveal", "Show content", post.id, "button subtle")}</div>`
          : post.kind === "article" ? articleCardContent(post, href, featured) + postLinkPreview(post) : noteContent(post)
      }
      ${postActions(post)}</article>`;
  }

  export function commentCard(post: Post, parent?: Post, depth = 0): string {
    const replyTo = parent && post.replyTo === parent.id && post.author.id !== parent.author.id ? parent.author : undefined;
    const body = `<div class="prose">${markdown(post.markdown, {
      ...postMentionContext(post), replyTo,
    }, post.emojis)}</div>`;
    return `<div class="comment"${depth ? ` style="--reply-depth: ${Math.min(depth, 3)}"` : ""}>${profileAvatar(post.author, true, `post:${post.id}`)}<div><div class="comment-header"><div><a class="author-link" href="#${escapeHTML(profilePath(post.author.id))}">${emojiText(post.author.name, post.author.emojis)}</a><span class="byline-sub"> · <a href="${escapeHTML(postReadLink(post.id))}" aria-label="Open reply thread">${relativeDate(post.created)}</a></span></div>${canManagePublication(post) ? action("delete-publication", "Delete comment", post.id, "text-button delete-link") : ""}</div>${post.warning ? `<details><summary>${emojiText(post.warning, post.emojis)}</summary>${body}</details>` : body}</div></div>`;
  }

  export function emptyState(
    title: string,
    description: string,
    button = "",
  ): string {
    return `<div class="empty-state">${icon("book")}<h2>${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p>${button}</div>`;
  }
  let toastTimer: ReturnType<typeof setTimeout>;
  export function toast(message: string): void {
    const el = document.getElementById("toast")!;
    el.textContent = message;
    el.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visible"), 5000);
  }
  let modalFocus: HTMLElement | null = null;
  export let modalVersion = 0;
  export function showModal(title: string, body: string): void {
    modalVersion++;
    const dialog = document.getElementById("modal") as HTMLDialogElement;
    if (!dialog.open) modalFocus = document.activeElement as HTMLElement;
    renderHTML(
      dialog,
      `<div class="modal-header"><h2 id="modal-title">${escapeHTML(title)}</h2>${action("close-modal", icon("close"), "", "icon-button")}</div>${body}<p class="form-error" role="alert"></p>`,
    );
    dialog
      .querySelector('[data-action="close-modal"]')
      ?.setAttribute("aria-label", "Close dialog");
    if (!dialog.open) dialog.showModal();
  }
  export function closeModal(): void {
    modalVersion++;
    (document.getElementById("modal") as HTMLDialogElement).close();
    modalFocus?.focus();
  }
  export function formError(error: unknown): void {
    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong. Please try again.";
    const modal = document.querySelector<HTMLDialogElement>("#modal");
    if (modal?.open) modal.querySelector(".form-error")!.textContent = message;
    else toast(message);
  }
  export function download(
    name: string,
    contents: string,
    type = "text/markdown",
  ): void {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
