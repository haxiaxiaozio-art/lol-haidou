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
const stagedInstallerPath = join(stagingDirectory, "HaiDouInstaller.exe");
const sedPath = join(stagingDirectory, "haidou-helper.sed");

const cscPath = join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
execFileSync(cscPath, [
  "/nologo",
  "/target:winexe",
  "/optimize+",
  "/platform:anycpu",
  "/codepage:65001",
  `/out:${stagedInstallerPath}`,
  "/reference:System.dll",
  "/reference:System.Core.dll",
  "/reference:System.Drawing.dll",
  "/reference:System.Windows.Forms.dll",
  join(installerSourceDirectory, "HaiDouInstaller.cs"),
], { cwd: stagingDirectory, stdio: "inherit" });
signWindowsArtifact(stagedInstallerPath);

const files = [
  [stagedInstallerPath, "HaiDouInstaller.exe"],
  [join(helperDirectory, "HaiDouHelper.exe"), "HaiDouHelper.exe"],
  [join(installerSourceDirectory, "start-hidden.vbs"), "start-hidden.vbs"],
  [join(installerSourceDirectory, "README.txt"), "README.txt"],
];

await mkdir(payloadDirectory, { recursive: true });
await mkdir(releaseDirectory, { recursive: true });
for (const [source, name] of files) {
  const destination = join(payloadDirectory, name);
  await copyFile(source, destination);
}

const fileStrings = files.map(([, name], index) => `FILE${index}="${name}"`).join("\r\n");
const fileEntries = files.map((_, index) => `%FILE${index}%=\r\n`).join("");
const sed = `[Version]\r\nClass=IEXPRESS\r\nSEDVersion=3\r\n[Options]\r\nPackagePurpose=InstallApp\r\nShowInstallProgramWindow=0\r\nHideExtractAnimation=1\r\nUseLongFileName=1\r\nInsideCompressed=0\r\nCAB_FixedSize=0\r\nCAB_ResvCodeSigning=0\r\nRebootMode=N\r\nInstallPrompt=%InstallPrompt%\r\nDisplayLicense=%DisplayLicense%\r\nFinishMessage=%FinishMessage%\r\nTargetName=${stagedOutputPath}\r\nFriendlyName=%FriendlyName%\r\nAppLaunched=%AppLaunched%\r\nPostInstallCmd=<None>\r\nAdminQuietInstCmd=%AppLaunched%\r\nUserQuietInstCmd=%AppLaunched%\r\nSourceFiles=SourceFiles\r\n[Strings]\r\nInstallPrompt=\r\nDisplayLicense=\r\nFinishMessage=\r\nFriendlyName=HaiDou Data Helper\r\nAppLaunched=HaiDouInstaller.exe\r\n${fileStrings}\r\n[SourceFiles]\r\nSourceFiles0=${payloadDirectory}\\\r\n[SourceFiles0]\r\n${fileEntries}`;

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
