# Publishing and server compatibility

[Documentation](README.md) · [Fedistack](../README.md)

The article editor targets servers that advertise **at least 5,000 characters and rich-text input** through the Mastodon-compatible API. Capability detection reads both v1 and v2 instance metadata, including Akkoma/Pleroma `post_formats` and glitch-soc `supported_mime_types`.

For example, infosec.exchange advertised **11,000 characters, Markdown, and HTML** when checked on November 6, 2026. The client checks the actual instance configuration rather than assuming defaults.

- Articles are **one publication**, never truncated or automatically turned into threads.
- Markdown is sent as `content_type=text/markdown` when supported; otherwise the client sends the rendered HTML if the server advertises HTML input.
- Plain-text instances remain usable for reading and short posts. They cannot publish articles from this editor.
- The length check includes title, subtitle, source formatting, and content warning. It is conservative: some servers count rendered text or normalized links differently. The server remains authoritative.
- The reader converts incoming HTML into the supported Markdown subset before rendering. Raw HTML and unsafe URL schemes are not inserted into the page.
- The Articles filter includes publications with an H1 heading, an `article` tag (case-insensitive), or a body longer than 900 characters after conversion to plain text. All other publications appear under Notes. A link-preview title alone does not make a short post an article. This reading cutoff is separate from the 5,000-character server capability required by the article editor.
- The Mastodon API has no universal article type, so this classification is a reading filter, not a claim about the underlying ActivityPub object.
- Linked articles show the text provided by the instance plus a link to the original; Fedistack does not scrape paywalled or external article bodies.

See the [user guide](user-guide.md) for drafts, editing, unpublishing, and keyboard shortcuts.
