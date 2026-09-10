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
