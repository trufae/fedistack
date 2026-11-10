TSC ?= node_modules/.bin/tsc
NPM ?= npm
PORT ?= 8080

.PHONY: all deps dist version icons check test serve clean zip
all: dist

# TypeScript is required to build, even when npm is configured to omit dev dependencies.
deps:
	@if test ! -f node_modules/.fedistack-deps \
		|| test package.json -nt node_modules/.fedistack-deps \
		|| test package-lock.json -nt node_modules/.fedistack-deps \
		|| test ! -x node_modules/.bin/tsc \
		|| test ! -f node_modules/@highlightjs/cdn-assets/highlight.min.js \
		|| test ! -f node_modules/@highlightjs/cdn-assets/LICENSE; then \
		$(NPM) ci --include=dev && touch node_modules/.fedistack-deps; \
	fi

version:
	node scripts/version.mjs

dist: deps version
	mkdir -p dist/assets
	$(TSC) --project tsconfig.json
	cp public/index.html public/styles.css public/editor-vim.js public/manifest.webmanifest public/.htaccess dist/
	cp node_modules/@highlightjs/cdn-assets/highlight.min.js dist/
	cp node_modules/@highlightjs/cdn-assets/LICENSE dist/highlight-LICENSE.txt
	cp public/assets/*.svg public/assets/*.png public/assets/*.ico dist/assets/
	node scripts/build-icons.mjs

icons:
	./scripts/generate-icons.sh

check: deps version
	$(TSC) --project tsconfig.json --noEmit

test: dist
	node --test tests/*.test.mjs

serve: dist
	node scripts/serve.mjs $(PORT)

clean:
	rm -rf dist

zip: dist
	rm -f fedistack.zip
	mv dist fedistack
	zip -r fedistack.zip fedistack
	mv fedistack dist
