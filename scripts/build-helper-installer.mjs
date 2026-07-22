import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signWindowsArtifact } from "./windows-signing.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const helperDirectory = join(projectRoot, "helper-dist");
const installerSourceDirectory = join(projectRoot, "installer");
const releaseDirectory = join(projectRoot, "release");
const outputPath = join(releaseDirectory, "HaiDouHelperSetup.exe");
const stagingDirectory = await mkdtemp(join(tmpdir(), "haidou-helper-installer-"));
const payloadDirectory = join(stagingDirectory, "payload");
const stagedOutputPath = join(stagingDirectory, "HaiDouHelperSetup.exe");
const sedPath = join(stagingDirectory, "haidou-helper.sed");

const files = [
  [join(helperDirectory, "HaiDouHelper.exe"), "HaiDouHelper.exe"],
  [join(installerSourceDirectory, "install.cmd"), "install.cmd"],
  [join(installerSourceDirectory, "install-helper.ps1"), "install-helper.ps1"],
  [join(installerSourceDirectory, "uninstall-helper.ps1"), "uninstall-helper.ps1"],
  [join(installerSourceDirectory, "start-hidden.vbs"), "start-hidden.vbs"],
  [join(installerSourceDirectory, "README.txt"), "README.txt"],
];

await mkdir(payloadDirectory, { recursive: true });
await mkdir(releaseDirectory, { recursive: true });
for (const [source, name] of files) {
  const destination = join(payloadDirectory, name);
  await copyFile(source, destination);
  if (name.endsWith(".ps1")) {
    const content = await readFile(destination, "utf8");
    await writeFile(destination, content.startsWith("\uFEFF") ? content : `\uFEFF${content}`, "utf8");
  }
}

const fileStrings = files.map(([, name], index) => `FILE${index}="${name}"`).join("\r\n");
const fileEntries = files.map((_, index) => `%FILE${index}%=\r\n`).join("");
const sed = `[Version]\r\nClass=IEXPRESS\r\nSEDVersion=3\r\n[Options]\r\nPackagePurpose=InstallApp\r\nShowInstallProgramWindow=1\r\nHideExtractAnimation=1\r\nUseLongFileName=1\r\nInsideCompressed=0\r\nCAB_FixedSize=0\r\nCAB_ResvCodeSigning=0\r\nRebootMode=N\r\nInstallPrompt=%InstallPrompt%\r\nDisplayLicense=%DisplayLicense%\r\nFinishMessage=%FinishMessage%\r\nTargetName=${stagedOutputPath}\r\nFriendlyName=%FriendlyName%\r\nAppLaunched=%AppLaunched%\r\nPostInstallCmd=<None>\r\nAdminQuietInstCmd=%AppLaunched%\r\nUserQuietInstCmd=%AppLaunched%\r\nSourceFiles=SourceFiles\r\n[Strings]\r\nInstallPrompt=Install HaiDou Data Helper for the current Windows user?\r\nDisplayLicense=\r\nFinishMessage=HaiDou Data Helper is installed and running. Return to the website to continue.\r\nFriendlyName=HaiDou Data Helper\r\nAppLaunched=cmd.exe /d /c install.cmd\r\n${fileStrings}\r\n[SourceFiles]\r\nSourceFiles0=${payloadDirectory}\\\r\n[SourceFiles0]\r\n${fileEntries}`;

await writeFile(sedPath, sed, "utf8");
try {
  execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "iexpress.exe"), ["/N", "/Q", sedPath], {
    cwd: stagingDirectory,
    stdio: "inherit",
  });
  await copyFile(stagedOutputPath, outputPath);
  signWindowsArtifact(outputPath);
  const size = (await readFile(outputPath)).byteLength;
  if (size < 1024 * 1024) throw new Error("安装器体积异常，未包含数据助手程序");
  console.log(outputPath);
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
