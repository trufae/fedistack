namespace Fedi {
  export function basicLinkPreview(value: string): LinkPreview {
    const url = safeURL(value);
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const youtube = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host);
    const id = host === "youtu.be" ? parsed.pathname.slice(1).split("/")[0]
      : youtube && parsed.pathname === "/watch" ? parsed.searchParams.get("v")
      : youtube ? /^\/(?:shorts|embed|live)\/([^/]+)/.exec(parsed.pathname)?.[1] : "";
    const video = !!id && /^[\w-]{11}$/.test(id);
    return {
      url, title: video ? "Watch on YouTube" : host,
      description: "", imageAlt: "", siteName: video ? "YouTube" : host,
      image: video ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "",
      type: video ? "video" : "link",
    };
  }

  export function parseLinkPreview(html: string, url: string): LinkPreview | null {
    if (!safeURL(url)) return null;
    // A template is inert: scripts, frames and images in fetched HTML never load.
    const template = document.createElement("template");
    template.innerHTML = html;
    const metadata = new Map<string, string>();
    template.content.querySelectorAll("meta[property], meta[name]").forEach((meta) => {
      const key = (meta.getAttribute("property") || meta.getAttribute("name") || "").toLowerCase();
      const value = meta.getAttribute("content")?.trim();
      if (value && !metadata.has(key)) metadata.set(key, value);
    });
    const value = (...keys: string[]) => keys.map((key) => metadata.get(key)).find(Boolean) || "";
    const title = value("og:title", "twitter:title") || template.content.querySelector("title")?.textContent?.trim() || "";
    const image = value("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src");
    let imageURL = "";
    try { if (image) imageURL = safeURL(new URL(image, url).href, true); } catch { /* Invalid metadata. */ }
    if (!title && !imageURL) return null;
    const preview = basicLinkPreview(url);
    return {
      ...preview, title: (title || preview.title).slice(0, 300),
      description: value("og:description", "twitter:description", "description").slice(0, 600),
      image: imageURL || preview.image,
      imageAlt: value("og:image:alt", "twitter:image:alt").slice(0, 300),
      siteName: (value("og:site_name") || preview.siteName).slice(0, 100),
      type: value("og:type").startsWith("video") ? "video" : preview.type,
    };
  }

  const previewCache = new Map<string, Promise<LinkPreview | null>>();
  const previewResults = new Map<string, LinkPreview | null>();
  const previewQueue: (() => Promise<void>)[] = [];
  const previewControllers = new Set<AbortController>();
  let previewGeneration = 0;
  let activePreviews = 0;

  export function setLinkPreviews(enabled: boolean): void {
    state.linkPreviews = enabled;
    if (!enabled) {
      previewGeneration++;
      previewObserver?.disconnect();
      previewControllers.forEach((controller) => controller.abort());
      previewCache.clear();
      previewResults.clear();
    }
    if (!writeStore("link-previews", enabled)) toast("This preference could only be saved for this tab.");
    render();
  }

  function nextPreview(): void {
    while (activePreviews < 3 && previewQueue.length) {
      const job = previewQueue.shift()!;
      activePreviews++;
      void job().finally(() => { activePreviews--; nextPreview(); });
    }
  }

  async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
    const controller = new AbortController();
    previewControllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
        mode: "cors", credentials: "omit", referrerPolicy: "no-referrer",
        signal: controller.signal, headers: { Accept: "text/html, application/xhtml+xml" },
      });
      if (!response.ok || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get("Content-Type") || "") || !response.body) {
        await response.body?.cancel();
        return null;
      }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let html = "", bytes = 0;
      try {
        while (bytes < 512 * 1024) {
          const chunk = await reader.read();
          if (chunk.done) { html += decoder.decode(); break; }
          const part = chunk.value.subarray(0, 512 * 1024 - bytes);
          bytes += part.byteLength;
          html += decoder.decode(part, { stream: true });
          if (/<\/head\s*>/i.test(html)) break;
        }
      } finally { await reader.cancel(); }
      const preview = parseLinkPreview(html, response.url || url);
      // Keep navigation on the actual shared link, including timestamps and anchors.
      return preview ? { ...preview, url } : null;
    } catch {
      // CORS, offline, unavailable pages and timeouts leave a usable link.
      return null;
    } finally { clearTimeout(timer); previewControllers.delete(controller); }
  }

  export function loadLinkPreview(value: string): Promise<LinkPreview | null> {
    const url = safeURL(value);
    if (!state.linkPreviews || !url || new URL(url).protocol !== "https:") return Promise.resolve(null);
    const cached = previewCache.get(url);
    if (cached) return cached;
    const generation = previewGeneration;
    const job = new Promise<LinkPreview | null>((resolve) => {
      previewQueue.push(async () => {
        if (generation !== previewGeneration || !state.linkPreviews) { resolve(null); return; }
        const preview = await fetchLinkPreview(url);
        if (generation !== previewGeneration) { resolve(null); return; }
        previewResults.set(url, preview);
        // Cache failures too, so polling never repeatedly probes blocked sites.
        if (previewResults.size > 128) {
          const oldest = previewResults.keys().next().value!;
          previewResults.delete(oldest);
          previewCache.delete(oldest);
        }
        resolve(preview);
      });
    });
    previewCache.set(url, job);
    nextPreview();
    return job;
  }

  export function linkPreviewCard(preview: LinkPreview): string {
    const url = safeURL(preview.url);
    if (!url) return "";
    const image = safeURL(preview.image, true), host = new URL(url).hostname.replace(/^www\./, "");
    return `<a class="link-preview${preview.type === "video" ? " link-preview-video" : ""}" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">
      ${image ? `<span class="link-preview-media"><img src="${escapeHTML(image)}" alt="${escapeHTML(preview.imageAlt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">${preview.type === "video" ? '<span class="link-preview-play" aria-hidden="true">▶</span>' : ""}</span>` : ""}
      <span class="link-preview-text"><span class="link-preview-site">${escapeHTML(preview.siteName || host)}${preview.siteName && preview.siteName.toLowerCase() !== host ? ` <span>· ${escapeHTML(host)}</span>` : ""}${icon("external")}</span><strong>${escapeHTML(preview.title || host)}</strong>${preview.description ? `<span class="link-preview-description">${escapeHTML(preview.description)}</span>` : ""}${preview.type === "video" ? '<span class="link-preview-watch">Watch video ↗</span>' : ""}</span></a>`;
  }

  export function postLinkPreview(post: Post): string {
    if (!state.linkPreviews || post.warning && !state.revealed.has(post.id)) return "";
    if (post.linkPreview) return linkPreviewCard(post.linkPreview);
    const url = safeURL(post.source || "") || markdownLinks(post.markdown).find((link) => link !== post.url);
    if (!url) return "";
    const preview = previewResults.get(url) || basicLinkPreview(url);
    return `<div data-link-preview="${escapeHTML(url)}">${linkPreviewCard(preview)}</div>`;
  }

  let previewObserver: IntersectionObserver | undefined;
  export function setupLinkPreviews(root: HTMLElement): void {
    previewObserver?.disconnect();
    previewObserver = undefined;
    if (!state.linkPreviews) return;
    const load = (element: HTMLElement) => {
      if (!state.linkPreviews || !element.isConnected) return;
      const url = element.dataset.linkPreview!;
      void loadLinkPreview(url).then((preview) => {
        if (state.linkPreviews && preview && element.isConnected && element.dataset.linkPreview === url)
          renderHTML(element, linkPreviewCard(preview));
      });
    };
    const elements = root.querySelectorAll<HTMLElement>("[data-link-preview]");
    if (!elements.length) return;
    if (typeof IntersectionObserver === "undefined") { elements.forEach(load); return; }
    const observer = new IntersectionObserver((entries) => {
      if (previewObserver !== observer) return;
      for (const entry of entries) if (entry.isIntersecting) {
        observer.unobserve(entry.target);
        load(entry.target as HTMLElement);
      }
    }, { rootMargin: "200px" });
    previewObserver = observer;
    elements.forEach((element) => observer.observe(element));
  }
}
