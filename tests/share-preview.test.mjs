import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequestHandler } from "../scripts/serve.mjs";
import { publicAddress, statusURL, statusMetadata, shareDocument } from "../scripts/share-preview.mjs";

const status = {
  id: "01a1b21a-0895-7011-a0ba-ae115d92861f", visibility: "public", spoiler_text: "",
  content: '<h1>A title &amp; a thought</h1><p>The subtitle &#x1f431;</p><p>The body.</p>',
  media_attachments: [{ type: "image", url: "https://images.example/full.jpg?a=1&b=2", preview_url: "https://images.example/thumb.jpg", description: 'A "picture"' }],
};

test("server previews extract title, subtitle and attached or inline images", () => {
  assert.deepEqual(statusMetadata(status), {
    title: "A title & a thought", description: "The subtitle 🐱", image: status.media_attachments[0].url, imageAlt: 'A "picture"',
  });
  const inline = statusMetadata({ ...status, media_attachments: [], content: status.content + '<img src="https://images.example/inline.jpg?a=1&amp;b=2" alt="Inline &amp; image">' });
  assert.equal(inline.image, "https://images.example/inline.jpg?a=1&b=2");
  assert.equal(inline.imageAlt, "Inline & image");
  assert.deepEqual(statusMetadata({ ...status, media_attachments: [], content: "# Title\n\nSubtitle\n\nArticle **body**.\n\n![Alt](https://images.example/photo.jpg)" }), {
    title: "Title", description: "Subtitle", image: "https://images.example/photo.jpg", imageAlt: "Alt",
  });
  const noImage = statusMetadata({ ...status, title: "Title", media_attachments: [],
    content: '<p>Body without subtitle.</p><pre><img src="https://images.example/code.jpg"></pre><img src="javascript:alert(1)">',
    card: { title: "Unrelated", image: "https://images.example/unrelated.jpg" } });
  assert.equal(noImage.image, "");
  assert.equal(noImage.description, "Body without subtitle.");
  for (const visibility of ["private", "direct", undefined]) assert.equal(statusMetadata({ ...status, visibility }), null);
  const warning = statusMetadata({ ...status, spoiler_text: "Sensitive topic" });
  assert.equal(warning.description, "Sensitive topic");
  assert.equal(warning.image, "");
  assert.doesNotMatch(warning.title, /thought/);
});

test("preview sources reject local addresses, credentials and non-HTTPS endpoints", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2001:0:1234::1", "2002:7f00:1::1"])
    assert.equal(publicAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"])
    assert.equal(publicAddress(address), true, address);
  for (const source of ["http://source.example", "https://127.0.0.1", "https://2130706433", "https://[::1]", "https://user:pass@source.example", "https://source.example/path", "https://source.example?x=1", "https://source.example#x", "https://source.example:8080"])
    assert.throws(() => statusURL(source, status.id), source);
  assert.throws(() => statusURL("https://source.example", ".."));
  assert.equal(statusURL("https://source.example", "opaque/id").href, "https://source.example/api/v1/statuses/opaque%2Fid");
});

test("crawler responses contain escaped article tags before any JavaScript executes", async (t) => {
  const requests = [];
  const server = createServer(createRequestHandler({
    publicURL: "https://reader.example/fedistack/",
    getStatus: async (url) => { requests.push(url.href); return status; },
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const query = new URLSearchParams({ p: status.id, server: "https://source.example" });
  const response = await fetch(`${base}/?${query}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<meta property="og:title" content="A title &amp; a thought"/);
  assert.match(html, /<meta property="og:description" content="The subtitle 🐱"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/images.example\/full.jpg\?a=1&amp;b=2"/);
  assert.match(html, /<meta property="og:image:alt" content="A &quot;picture&quot;"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.ok(html.includes(`content="https://reader.example/fedistack/?${query.toString().replaceAll("&", "&amp;")}"`));
  assert.equal((html.match(/property="og:title"/g) || []).length, 1);
  assert.equal((html.match(/name="description"/g) || []).length, 1);
  assert.ok(html.indexOf('property="og:title"') < html.indexOf("</head>"));
  assert.deepEqual(requests, [`https://source.example/api/v1/statuses/${status.id}`]);
  assert.match(await (await fetch(base + "/config.js")).text(), /sharePreviews = true/);
  const template = await readFile("dist/index.html", "utf8");
  const url = new URL(`https://reader.example/fedistack/?${query}`);
  for (const result of [{ ...status, visibility: "private" }, { ...status, visibility: "direct" }, { ...status, id: "wrong" }])
    assert.equal(await shareDocument(template, url, async () => result), template);
  assert.equal(await shareDocument(template, url, async () => { throw new Error("Offline"); }), template);
  const hostile = await shareDocument(template, url, async () => ({ ...status, title: '"><script>alert(1)</script>' }));
  assert.doesNotMatch(hostile, /<script>alert\(1\)/);
  const plain = await shareDocument(template, url, async () => ({ ...status, media_attachments: [] }));
  assert.doesNotMatch(plain, /property="og:image"/);
  assert.match(plain, /name="twitter:card" content="summary"/);
});
