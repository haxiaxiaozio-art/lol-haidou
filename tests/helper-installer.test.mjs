import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop installer is user-scoped and registers launch integration", async () => {
  const install = await readFile(new URL("../installer/install-helper.ps1", import.meta.url), "utf8");
  const uninstall = await readFile(new URL("../installer/uninstall-helper.ps1", import.meta.url), "utf8");
  const builder = await readFile(new URL("../scripts/build-helper-exe.mjs", import.meta.url), "utf8");
  const installerBuilder = await readFile(new URL("../scripts/build-helper-installer.mjs", import.meta.url), "utf8");
  const installCommand = await readFile(new URL("../installer/install.cmd", import.meta.url), "utf8");
  const client = await readFile(new URL("../lib/local-client.ts", import.meta.url), "utf8");

  assert.match(install, /FolderBrowserDialog/);
  assert.match(install, /InstallLocation/);
  assert.match(install, /\.haidou-helper-install/);
  assert.doesNotMatch(install, /\$installDirectory\s*=\s*Join-Path\s+\$env:LOCALAPPDATA/);
  assert.match(install, /legacyInstallDirectory/);
  assert.match(install, /HKCU:\\Software\\Classes\\haidou-helper/);
  assert.match(install, /CurrentVersion\\Run/);
  assert.match(install, /CurrentVersion\\Uninstall\\HaiDouHelper/);
  assert.doesNotMatch(install, /HKLM:/);
  assert.match(uninstall, /Software\\Classes\\haidou-helper/);
  assert.match(uninstall, /InstallLocation/);
  assert.match(uninstall, /\.haidou-helper-install/);
  assert.doesNotMatch(uninstall, /rmdir \/s \/q/i);
  assert.doesNotMatch(installCommand, /ExecutionPolicy\s+Bypass/i);
  assert.match(builder, /experimental-sea-config/);
  assert.match(builder, /NODE_SEA_BLOB/);
  assert.match(builder, /stripEmbeddedSignature/);
  assert.match(installerBuilder, /signWindowsArtifact/);
  assert.match(client, /releases\/latest\/download\/HaiDouHelperSetup\.exe/);
  assert.match(client, /haidou-helper:\/\/start/);
  assert.match(client, /MIN_HELPER_VERSION = 17/);
});
