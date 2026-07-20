import assert from "node:assert/strict";
import test from "node:test";
import { assertPagesRuntimeBase, rewriteForPages } from "../scripts/export-pages.mjs";

test("GitHub Pages export keeps assets inside the repository path", () => {
  const source = [
    '<link href="/assets/site.css">',
    '<link rel="icon" href="/favicon.svg">',
    '<script>import("/assets/site.js")</script>',
    '<link href="/lol-haidou/assets/already-based.css">',
    '<meta property="og:url" content="http://localhost:3000">',
    '<meta property="og:image" content="http://localhost:3000/og.png">',
  ].join("");
  const html = rewriteForPages(source);
  assert.match(html, /\/lol-haidou\/assets\/site\.css/);
  assert.match(html, /\/lol-haidou\/assets\/site\.js/);
  assert.match(html, /\/lol-haidou\/assets\/already-based\.css/);
  assert.doesNotMatch(html, /\/lol-haidou\/lol-haidou\//);
  assert.match(html, /\/lol-haidou\/favicon\.svg/);
  assert.match(html, /content="https:\/\/haxiaxiaozio-art\.github\.io\/lol-haidou\/"/);
  assert.match(html, /https:\/\/haxiaxiaozio-art\.github\.io\/lol-haidou\/og\.png/);
  assert.doesNotMatch(html, /="\/assets\//);
  assert.doesNotMatch(html, /import\("\/assets\//);
  assert.doesNotMatch(html, /http:\/\/localhost:3000/);
});

test("GitHub Pages runtime uses the repository base for lazy CSS", () => {
  assert.throws(
    () => assertPagesRuntimeBase('throw Error(`Unable to preload CSS for ${t}`); return "/" + e'),
    /runtime is missing/,
  );
  assert.doesNotThrow(() => assertPagesRuntimeBase(
    'throw Error(`Unable to preload CSS for ${t}`); return "/lol-haidou/" + e',
  ));
});
