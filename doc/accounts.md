# Connecting an account

[Documentation](README.md) · [Fedistack](../README.md)

Click **Connect your account**, enter your instance domain, and optionally check compatibility. OAuth registers Fedistack with the instance and redirects to the instance's sign-in page. Your password never enters Fedistack. OAuth uses a state parameter and an S256 PKCE challenge; registration and token exchange use form encoding.

The additional sign-in options support a manual authorization code or an existing application access token with `read` and `write` permissions. Tokens and OAuth credentials are held in this tab's session storage, not embedded in the website or stored in local storage. Disconnect removes the active token from this client; revoke the application in your server's settings to revoke server-side access as well.

**If you see 429 on `/api/v1/apps`, stop retrying.** Mastodon's upstream default is five application registrations per ten-minute window; your instance can differ. Fedistack honors `Retry-After` / `X-RateLimit-Reset` when exposed, otherwise waits ten minutes for registration. Successful app registrations are reused within the session. It never automatically retries a rejected registration.

Moving between `file://`, localhost, and a hosted URL changes browser storage. Export important drafts before switching, then paste their Markdown into the editor at the new location.

See [publishing and server compatibility](publishing.md) for article requirements.
