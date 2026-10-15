import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the HaiDou dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /海斗战报/);
  assert.doesNotMatch(html, /夜航船|生成演示战报|下载 CSV 模板/);
  assert.ok(!html.includes("CSV / JSON"));
  assert.match(html, /从玩家身份开始生成海斗战报/);
  assert.match(html, /检索玩家/);
  assert.match(html, /我的战报库/);
  assert.match(html, /我的战绩/);
  assert.match(html, /同步失败诊断中心/);
  assert.match(html, /先找到玩家，再聊这局打得怎么样/);
  assert.match(html, /常驻查询尚未开放/);
  assert.doesNotMatch(html, /id="player-name"|id="preferences-title"|id="quality-title"/);
  assert.match(html, /白天|深夜/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("renders local privacy guidance", async () => {
  const response = await render("/privacy");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /不会上传到服务器/);
  assert.match(html, /单向哈希处理/);
  assert.match(html, /默认关闭/);
  assert.match(html, /检索其他玩家时不会提交校准样本/);
  assert.match(html, /异常样本/);
  assert.match(html, /保留 365 天/);
  assert.match(html, /服务健康记录/);
});

test("renders public helper download and installation guidance before connecting", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /href="#helper-install-guide"/);
  assert.match(html, /id="helper-install-guide"/);
  assert.match(html, /下载 Windows 助手/);
  assert.match(html, /href="https:\/\/github\.com\/haxiaxiaozio-art\/lol-haidou\/releases\/latest\/download\/HaiDouHelperSetup\.exe"/);
  assert.match(html, /安装步骤与常见问题/);
  assert.match(html, /选择安装位置/);
  assert.match(html, /同一台 Windows 电脑/);
  assert.match(html, /href="haidou-helper:\/\/start"/);
  assert.match(html, /本地网络权限/);
  assert.match(html, /不要关闭安全防护/);
  assert.doesNotMatch(html, /HaiDouSetup\.exe/);
  assert.ok(html.indexOf('id="helper-install-guide"') < html.indexOf('role="tablist"'));
});

test("helper guide keeps downloads available but prevents launch during an active sync", async () => {
  const result = await build({
    stdin: { contents: 'export { default as Guide } from "./app/HelperInstallGuide.tsx"; export { renderToStaticMarkup as render } from "react-dom/server";', resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", loader: { ".module.css": "empty" }, jsx: "automatic",
  });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  const { Guide, render } = compiled.exports;
  const onLaunch = () => {};
  const links = (element) => !element || typeof element !== "object" ? [] : Array.isArray(element) ? element.flatMap(links) : [...(element.type === "a" ? [element.props] : []), ...links(element.props?.children)];
  for (const isBusy of [false, true]) {
    const tree = Guide({ isBusy, onLaunch });
    const html = render(tree);
    assert.ok(html.includes("HaiDouHelperSetup.exe"));
    assert.ok(html.includes("安装步骤与常见问题"));
    const launch = links(tree).find((link) => link.href === "haidou-helper://start");
    if (isBusy) {
      assert.equal(launch, undefined, "busy guide must not navigate to the launch protocol");
      assert.ok(links(tree).every((link) => !link.onClick), "busy guide must not change sync state");
    } else {
      assert.equal(launch.onClick, onLaunch);
    }
  }
});
