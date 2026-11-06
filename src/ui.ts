namespace Fedi {
  export const discoveryLanguages: [string, string][] = [
    ["", "All languages"],
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
    return `<label class="language-picker" for="${id}"><span>Language</span><select id="${id}">${discoveryLanguages.map(([code, label]) => `<option value="${code}" ${state.discoveryLanguage === code ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
  }
  const paths: Record<string, string> = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5z"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
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
    leaf: '<path d="M20 3C5 1 1 12 7 17s15-1 13-14ZM5 21 16 8"/>',
  };
  export function icon(name: string): string {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
  }
  export function avatar(account: Account, small = false): string {
    const initials = account.name
      .split(/\s/)
      .map((w) => w[0] || "")
      .slice(0, 2)
      .join("");
    return `<span class="avatar ${small ? "small" : ""} ${escapeHTML(account.color || "sage")}">${account.avatar ? `<img src="${escapeHTML(safeURL(account.avatar, true))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : escapeHTML(initials)}</span>`;
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
    if (account.id === (state.session?.account.id || "you")) return "";
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

  export function postActions(post: Post): string {
    const owned =
      post.author.id === (state.session?.account.id || "you") &&
      post.visibility !== "direct";
    return `<div class="post-actions"><div>
      <button class="icon-button ${post.liked ? "liked" : ""}" data-action="like" data-id="${escapeHTML(post.id)}" aria-label="${post.liked ? "Unlike" : "Like"}" aria-pressed="${post.liked}">${icon("heart")}<span>${post.likes || ""}</span></button>
      <a class="icon-button" href="#read/${encodeURIComponent(post.id)}" aria-label="Read ${post.replies} comments">${icon("comment")}<span>${post.replies || ""}</span></a>
      <button class="icon-button" data-action="share" data-id="${escapeHTML(post.id)}" aria-label="Share publication">${icon("external")}</button>
      </div><div class="post-owner-actions">${owned ? `${action("edit-publication", `${icon("edit")} Edit`, post.id, "text-button")}${action("unpublish-publication", "Unpublish", post.id, "text-button")}${action("delete-publication", post.replyTo ? "Delete comment" : "Delete", post.id, "text-button delete-link")}` : ""}<button class="icon-button ${post.saved ? "saved" : ""}" data-action="save" data-id="${escapeHTML(post.id)}" aria-label="${post.saved ? "Remove bookmark" : "Save for later"}" aria-pressed="${post.saved}">${icon("bookmark")}</button></div></div>`;
  }

  export function postCard(post: Post, featured = false): string {
    const hidden = post.warning && !state.revealed.has(post.id);
    const href = `#read/${encodeURIComponent(post.id)}`;
    return `<article class="post-card ${featured ? "featured" : ""} ${post.kind}">
      ${post.boostedBy ? `<p class="boost-label">${icon("refresh")} Shared by ${escapeHTML(post.boostedBy)}</p>` : ""}
      ${post.replyTo ? `<p class="reply-context"><a href="#read/${encodeURIComponent(post.replyTo)}">${icon("comment")} View conversation ${icon("arrow")}</a></p>` : ""}
      <div class="post-byline">${avatar(post.author)}<div><button class="author-link" data-action="profile" data-id="${escapeHTML(post.author.id)}">${escapeHTML(post.author.name)}</button><div class="byline-sub">${escapeHTML(post.author.publication || post.author.acct)} <span>· ${relativeDate(post.created)}</span></div></div>${followButton(post.author)}</div>
      ${
        hidden
          ? `<div class="content-warning">${icon("eye")}<strong>${escapeHTML(post.warning)}</strong>${action("reveal", "Show content", post.id, "button subtle")}</div>`
          : `
      ${featured && post.image ? `<a href="${href}" class="cover-link"><img class="feature-cover" src="${escapeHTML(post.image)}" alt="${escapeHTML(post.imageAlt || "")}"></a>` : ""}
      <div class="post-content ${!featured && post.image ? "with-thumbnail" : ""}"><div>
      ${post.kind === "article" ? `<a href="${href}" class="article-link"><h2>${escapeHTML(post.title)}</h2><p class="excerpt">${escapeHTML((post.subtitle || plainText(post.markdown)).slice(0, featured ? 210 : 160))}</p></a><div class="article-meta"><span>${escapeHTML(post.tags[0] || "Article")}</span><span>·</span><span>${readingTime(post.markdown)} min read</span></div>` : `<div class="prose note-body">${markdown(post.markdown)}</div>`}
      </div>${!featured && post.image ? `<a href="${href}"><img class="thumbnail" src="${escapeHTML(post.image)}" alt="${escapeHTML(post.imageAlt || "")}" loading="lazy"></a>` : ""}</div>`
      }
      ${postActions(post)}</article>`;
  }

  export function commentCard(post: Post): string {
    const owned =
      post.author.id === (state.session?.account.id || "you") &&
      post.visibility !== "direct";
    return `<div class="comment">${avatar(post.author, true)}<div><div class="comment-header"><div><strong>${escapeHTML(post.author.name)}</strong><span class="byline-sub"> · ${relativeDate(post.created)}</span></div>${owned ? action("delete-publication", "Delete comment", post.id, "text-button delete-link") : ""}</div>${post.warning ? `<details><summary>${escapeHTML(post.warning)}</summary><div class="prose">${markdown(post.markdown)}</div></details>` : `<div class="prose">${markdown(post.markdown)}</div>`}</div></div>`;
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
  export function showModal(title: string, body: string): void {
    const dialog = document.getElementById("modal") as HTMLDialogElement;
    if (!dialog.open) modalFocus = document.activeElement as HTMLElement;
    dialog.innerHTML = `<div class="modal-header"><h2 id="modal-title">${escapeHTML(title)}</h2>${action("close-modal", icon("close"), "", "icon-button")}</div>${body}<p class="form-error" role="alert"></p>`;
    dialog
      .querySelector('[data-action="close-modal"]')
      ?.setAttribute("aria-label", "Close dialog");
    if (!dialog.open) dialog.showModal();
  }
  export function closeModal(): void {
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
