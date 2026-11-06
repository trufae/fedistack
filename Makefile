TSC ?= $(shell if test -x node_modules/.bin/tsc; then echo node_modules/.bin/tsc; else echo tsc; fi)
PORT ?= 8080

.PHONY: all dist check test serve clean
all: dist

dist:
	mkdir -p dist/assets
	$(TSC) --project tsconfig.json
	cp public/index.html public/styles.css dist/
	cp public/assets/*.svg dist/assets/

check:
	$(TSC) --project tsconfig.json --noEmit

test: dist
	node --test tests/*.test.mjs

serve: dist
	node scripts/serve.mjs $(PORT)

clean:
	rm -rf dist
