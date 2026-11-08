# Icons and exports

[Documentation](README.md) · [Fedistack](../README.md)

<img src="../public/assets/favicon.svg" width="96" height="96" alt="Fedistack icon">

The [SVG source](../public/assets/favicon.svg) is the Fedistack mark: stacked lines and a bookmark on a warm orange tile. It is used in the app and README and is the source for every raster export. Edit this file, then regenerate the assets.

## Generate PNGs and ICO

Install [librsvg](https://gnome.pages.gitlab.gnome.org/librsvg/) (`rsvg-convert`) and [ImageMagick](https://imagemagick.org/). The generator supports ImageMagick 7 (`magick`) and 6 (`convert`). These tools are only needed when changing the icon.

```sh
# macOS with Homebrew
brew install librsvg imagemagick

# Debian / Ubuntu
sudo apt-get install librsvg2-bin imagemagick
```

From the repository root:

```sh
make icons
# Equivalent:
./scripts/generate-icons.sh
```

To export elsewhere, pass an output directory; relative paths are resolved from your current directory:

```sh
./scripts/generate-icons.sh /tmp/fedistack-icons
```

The script renders each PNG directly from the SVG, preserving transparent corners in the general exports. The Apple touch icon fills those corners with orange so iOS can apply its own rounded mask. The script also packs the small PNGs into a multi-resolution ICO.

| Output in `public/assets/` | Size / purpose |
| --- | --- |
| `icon-16.png`, `icon-32.png`, `icon-48.png` | Browser and desktop icons |
| `icon-64.png`, `icon-128.png`, `icon-256.png`, `icon-512.png` | General app and project artwork |
| `icon-180.png` | 180-pixel export with transparent corners |
| `apple-touch-icon.png` | Opaque 180-pixel Apple Home Screen icon |
| `icon-192.png` | Mobile icon export |
| `favicon.ico` | 16, 32, and 48 pixel images in one file |

Commit the regenerated files with SVG changes. `make` copies them into `dist/assets/`; it does not need the image tools. The page declares the SVG, ICO fallback, 32-pixel PNG, and Apple touch icon. The web app manifest declares the 192- and 512-pixel PNGs and standalone launch mode. CI also runs the generator before building and testing.

The build also creates content-hashed filenames for every declared icon and the manifest, then writes those relative URLs into `dist/index.html` and the built manifest. Changing an icon changes its URL automatically, so browsers can fetch it even when an older favicon is cached. The manifest keeps its relative ID, scope, and start URL, so hosting under a subdirectory still works. `dist/favicon.ico` provides the conventional fallback when hosted at a domain root.

Deploy the complete contents of `dist/`, including `.htaccess` on Apache. The Apache configuration makes the HTML, stable manifest URL, and fallback ICO revalidate instead of remaining stale. Other hosts should also serve `index.html` with `Cache-Control: no-cache`. Reload the site after deployment to load the new icon URLs; existing Home Screen shortcuts may need to be added again. Old ZIP or tar archives must be rebuilt before uploading.
