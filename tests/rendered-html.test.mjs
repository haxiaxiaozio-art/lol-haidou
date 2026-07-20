import assert from "node:assert/strict";
import test from "node:test";

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
  assert.match(html, /夜航船/);
  assert.match(html, /从玩家身份开始生成海斗战报/);
  assert.match(html, /CSV \/ JSON/);
  assert.match(html, /本地 LOL 客户端/);
  assert.match(html, /正在检测助手/);
  assert.match(html, /07\/19 22:20/);
  assert.match(html, /登录 LOL 后可直接读取当前玩家与最近战绩/);
  assert.match(html, /生成演示战报/);
  assert.match(html, /20 场/);
  assert.match(html, /40 场/);
  assert.match(html, /100 场/);
  assert.match(html, /200 场/);
  assert.match(html, /辅助 \/ 法师/);
  assert.match(html, /职业评分/);
  assert.match(html, /加权后/);
  assert.match(html, /主职业完整计分 \+ 副职业 40% 奖励/);
  assert.match(html, /白天|深夜/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("renders local privacy guidance", async () => {
  const response = await render("/privacy");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /导入文件上传到服务器/);
});
