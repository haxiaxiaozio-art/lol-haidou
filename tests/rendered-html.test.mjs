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
  assert.match(html, /检索玩家/);
  assert.match(html, /查询当前客户端所在大区/);
  assert.match(html, /我的战绩/);
  assert.match(html, /正在检测助手/);
  assert.match(html, /07\/19 22:20/);
  assert.match(html, /按 Riot ID 检索同区玩家/);
  assert.match(html, /生成演示战报/);
  assert.match(html, /20 场/);
  assert.match(html, /40 场/);
  assert.match(html, /100 场/);
  assert.match(html, /200 场/);
  assert.match(html, /辅助 \/ 法师/);
  assert.match(html, /职业评分/);
  assert.match(html, /加权后/);
  assert.match(html, /数据质量与真实样本校准/);
  assert.match(html, /质量只说明数据是否足够完整/);
  assert.match(html, /副职业奖励/);
  assert.match(html, /模型版本治理状态/);
  assert.match(html, /异常隔离/);
  assert.match(html, /灰度范围/);
  assert.match(html, /历史重放/);
  assert.match(html, /导出可重放报告/);
  assert.match(html, /战绩扫描上限/);
  assert.match(html, /前 10 名覆盖/);
  assert.match(html, /最爱出装/);
  assert.match(html, /海斗锐评/);
  assert.match(html, /海斗估算分/);
  assert.match(html, /第三方估算|同步真实海斗战绩/);
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
