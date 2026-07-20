import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const scripts = ["启动网站.cmd", "start-site.cmd"];

for (const script of scripts) {
  test(`${script} stays safe for Windows cmd.exe`, async () => {
    const content = await readFile(new URL(`../${script}`, import.meta.url), "utf8");
    assert.doesNotMatch(content, /[^\x00-\x7F]/, "batch contents must remain ASCII-only");
    assert.match(content, /where node/);
    assert.match(content, /call npm install/);
    assert.match(content, /call npm run dev/);
    assert.match(content, /helper\/server\.mjs/);
    assert.doesNotMatch(content, /^chcp /m, "changing code pages inside a batch file is fragile");
  });
}

test("launcher parses and reaches the start branch in cmd.exe", async () => {
  const content = await readFile(new URL("../start-site.cmd", import.meta.url), "utf8");
  const fixture = content
    .replace(/^powershell\.exe .*helper\/server\.mjs.*$/m, "rem helper disabled in launcher fixture")
    .replace("call npm run dev", "echo HAIDOU_LAUNCHER_OK")
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

for (const script of ["启动数据助手.cmd", "start-helper.cmd"]) {
  test(`${script} starts only the loopback helper`, async () => {
    const content = await readFile(new URL(`../${script}`, import.meta.url), "utf8");
    assert.doesNotMatch(content, /[^\x00-\x7F]/);
    assert.match(content, /where node/);
    assert.match(content, /node helper\\server\.mjs/);
  });
}
