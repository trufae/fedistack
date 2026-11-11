namespace Fedi {
  const siteTitle = "Fedistack — independent voices, connected.";
  const siteDescription = "Your corner of the fediverse. Read independent voices, share your writing, and keep the conversation going.";

  export function openSharedPublication(): void {
    const params = new URLSearchParams(location.search);
    const id = params.get("p");
    if (!id) return;
    const server = params.get("server") || location.origin;
    // Consume the query once, preserving normal hash navigation and OAuth URLs.
    const hash = location.hash || `#p/${encodeURIComponent(id).replace(/^~/, "%7E")}?${new URLSearchParams({ server })}`;
    history.replaceState(null, "", location.pathname + hash);
  }

  export function publicationMetadata(post?: Post | null): {
    title: string; description: string; image: string; imageAlt: string; type: string;
  } {
    if (!post || !["public", "unlisted"].includes(post.visibility))
      return { title: siteTitle, description: siteDescription, image: "", imageAlt: "", type: "website" };
    if (post.warning)
      return { title: "Publication with a content warning", description: post.warning, image: "", imageAlt: "", type: "article" };
    const preview = postPreview(post);
    const candidates = [
      ...(post.media || []).filter((media) => media.type === "image")
        .flatMap((media) => [[media.url, media.description], [media.previewUrl, media.description]]),
      [post.image || "", post.imageAlt || ""],
    ];
    let cover = candidates.find(([url]) => safeURL(url, true));
    if (!cover) {
      // Use the reader's Markdown rules, without highlighting irrelevant code.
      let fenced = false;
      const source = post.markdown.split("\n").filter((line) => {
        if (line.startsWith("```")) { fenced = !fenced; return false; }
        return !fenced;
      }).join("\n");
      const match = /<img src="([^"]*)" alt="([^"]*)"/.exec(markdown(source));
      if (match) {
        const decode = (value: string) => value.replace(/&(?:amp|lt|gt|quot|#39);/g,
          (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity]!);
        cover = [decode(match[1]), decode(match[2])];
      }
    }
    return {
      title: plainText(preview.title), description: plainText(articleContent(post).subtitle || preview.excerpt),
      image: cover ? safeURL(cover[0], true) : "", imageAlt: cover?.[1] || "", type: "article",
    };
  }

  export function updateSharingMetadata(): void {
    const head = document.head;
    if (!head) return;
    const post = state.view === "reader" ? state.reading : null;
    const metadata = publicationMetadata(post);
    const base = new URL(location.href);
    base.search = "";
    base.hash = "";
    const url = metadata.type === "article" && post ? publicationLink(post) : base.href;
    const image = metadata.image ? new URL(metadata.image, base).href : "";
    const values: Record<string, string> = {
      description: metadata.description,
      "og:site_name": "Fedistack", "og:type": metadata.type, "og:title": metadata.title,
      "og:description": metadata.description, "og:url": url, "og:image": image, "og:image:alt": image ? metadata.imageAlt : "",
      "twitter:card": image ? "summary_large_image" : "summary", "twitter:title": metadata.title,
      "twitter:description": metadata.description, "twitter:image": image, "twitter:image:alt": image ? metadata.imageAlt : "",
    };
    for (const [key, value] of Object.entries(values)) {
      const attribute = key.startsWith("og:") ? "property" : "name";
      let tag = head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
      if (!value) { tag?.remove(); continue; }
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attribute, key);
        head.appendChild(tag);
      }
      tag.content = value;
    }
  }
}
