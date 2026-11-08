TSC ?= $(shell if test -x node_modules/.bin/tsc; then echo node_modules/.bin/tsc; else echo tsc; fi)
PORT ?= 8080

.PHONY: all dist version icons check test serve clean
all: dist

version:
	node scripts/version.mjs

dist: version
	mkdir -p dist/assets
	$(TSC) --project tsconfig.json
	cp public/index.html public/styles.css public/manifest.webmanifest public/.htaccess dist/
	cp public/assets/*.svg public/assets/*.png public/assets/*.ico dist/assets/
	node scripts/build-icons.mjs

icons:
	./scripts/generate-icons.sh

check: version
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
