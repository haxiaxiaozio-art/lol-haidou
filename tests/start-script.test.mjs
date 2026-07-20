import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
test("website launcher opens the public site and avoids dev-server ports", async () => {
  const content = await readFile(new URL("../start-site.cmd", import.meta.url), "utf8");
  assert.doesNotMatch(content, /[^\x00-\x7F]/, "batch contents must remain ASCII-only");
  assert.match(content, /where node/);
  assert.match(content, /127\.0\.0\.1:3212\/v1\/health/);
  assert.match(content, /haxiaxiaozio-art\.github\.io\/lol-haidou/);
  assert.match(content, /\?v=4/);
  assert.match(content, /version -ge 10/);
  assert.match(content, /start-helper\.cmd/);
  assert.doesNotMatch(content, /npm run dev|:3000/);
});

test("Chinese website launcher delegates to the maintained launcher", async () => {
  const content = await readFile(new URL("../启动网站.cmd", import.meta.url), "utf8");
  assert.doesNotMatch(content, /[^\x00-\x7F]/);
  assert.match(content, /call "%~dp0start-site\.cmd"/);
});

test("launcher parses and reaches the start branch in cmd.exe", { skip: process.platform !== "win32" }, async () => {
  const content = await readFile(new URL("../start-site.cmd", import.meta.url), "utf8");
  const fixture = content
    .replace(/^powershell\.exe .*$/m, "cmd.exe /d /c exit 1")
    .replace(/^  start "HaiDou Data Helper" .*$/m, "  echo HAIDOU_HELPER_START")
    .replace(/^start "" "%HAIDOU_SITE%"$/m, "echo HAIDOU_LAUNCHER_OK")
    .replaceAll("pause", "rem pause");
  const directory = await mkdtemp(join(tmpdir(), "haidou-launcher-"));
  try {
    await mkdir(join(directory, "node_modules"));
    const fixturePath = join(directory, "launcher.cmd");
    await writeFile(fixturePath, fixture, "ascii");
    const { stdout, stderr } = await execFileAsync("cmd.exe", ["/d", "/c", fixturePath], { cwd: directory });
    assert.match(stdout, /HAIDOU_LAUNCHER_OK/);
    assert.doesNotMatch(stderr, /not recognized|不是内部或外部命令/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("helper launcher reports existing service and starts only the loopback helper", async () => {
  const content = await readFile(new URL("../start-helper.cmd", import.meta.url), "utf8");
  assert.doesNotMatch(content, /[^\x00-\x7F]/);
  assert.match(content, /where node/);
  assert.match(content, /127\.0\.0\.1:3212\/v1\/health/);
  assert.match(content, /already running/);
  assert.match(content, /node helper\\server\.mjs/);
  assert.match(content, /version -ge 10/);
});

test("Chinese helper launcher delegates to the maintained launcher", async () => {
  const content = await readFile(new URL("../启动数据助手.cmd", import.meta.url), "utf8");
  assert.doesNotMatch(content, /[^\x00-\x7F]/);
  assert.match(content, /call "%~dp0start-helper\.cmd"/);
});
