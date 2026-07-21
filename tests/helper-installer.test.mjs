import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop installer is user-scoped and registers launch integration", async () => {
  const install = await readFile(new URL("../installer/install-helper.ps1", import.meta.url), "utf8");
  const uninstall = await readFile(new URL("../installer/uninstall-helper.ps1", import.meta.url), "utf8");
  const builder = await readFile(new URL("../scripts/build-helper-exe.mjs", import.meta.url), "utf8");
  const client = await readFile(new URL("../lib/local-client.ts", import.meta.url), "utf8");

  assert.match(install, /LOCALAPPDATA.*HaiDouHelper/s);
  assert.match(install, /HKCU:\\Software\\Classes\\haidou-helper/);
  assert.match(install, /CurrentVersion\\Run/);
  assert.match(install, /CurrentVersion\\Uninstall\\HaiDouHelper/);
  assert.doesNotMatch(install, /HKLM:/);
  assert.match(uninstall, /Software\\Classes\\haidou-helper/);
  assert.match(builder, /experimental-sea-config/);
  assert.match(builder, /NODE_SEA_BLOB/);
  assert.match(client, /releases\/latest\/download\/HaiDouHelperSetup\.exe/);
  assert.match(client, /haidou-helper:\/\/start/);
  assert.match(client, /MIN_HELPER_VERSION = 12/);
});
