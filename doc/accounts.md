# Connecting an account

[Documentation](README.md) · [Fedistack](../README.md)

Click **Connect your account**, enter your instance domain, and optionally check compatibility. OAuth registers Fedistack with the instance and redirects to the instance's sign-in page. Your password never enters Fedistack. OAuth uses a state parameter and an S256 PKCE challenge; registration and token exchange use form encoding.

The additional sign-in options support a manual authorization code or an existing application access token with `read` and `write` permissions. For a token, enter the instance domain first, then choose **Other sign-in options → Connect with token** to open a separate token entry dialog.

Check **Keep me signed in on this device** before connecting to retain the access token in local storage across app launches. Leave it unchecked for temporary tab storage. The choice applies to OAuth and manual tokens; OAuth registration credentials and pending authorization data always remain in tab storage. After installing the Home Screen app, sign in and enable this option inside the app.

Tap your avatar, then choose **Settings → Your connection → Log out** to remove the saved access token and pending authorization data. Your drafts remain on the device. Revoke the application in your server's settings to revoke server-side access as well.

Fedistack stores an access token, never your account password. Browser storage is accessible to scripts on the same origin, including other applications hosted under that origin; it is not Apple Passwords or Keychain storage. Use persistent sign-in only on a trusted device and deployment. A dedicated HTTPS origin isolates Fedistack from other sites you host. See [OWASP's browser-storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage). Clearing website data, private browsing, or browser storage eviction can require signing in again.

**If you see 429 on `/api/v1/apps`, stop retrying.** Mastodon's upstream default is five application registrations per ten-minute window; your instance can differ. Fedistack honors `Retry-After` / `X-RateLimit-Reset` when exposed, otherwise waits ten minutes for registration. Successful app registrations are reused within the session. It never automatically retries a rejected registration.

Moving between `file://`, localhost, and a hosted URL changes browser storage. Export important drafts before switching, then paste their Markdown into the editor at the new location.

See [publishing and server compatibility](publishing.md) for article requirements.
