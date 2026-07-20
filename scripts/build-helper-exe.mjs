import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { inject } = require("postject");
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const outputDirectory = join(projectRoot, "helper-dist");
const bundlePath = join(outputDirectory, "helper-bundle.cjs");
const blobPath = join(outputDirectory, "helper-sea.blob");
const configPath = join(outputDirectory, "sea-config.json");
const executablePath = join(outputDirectory, "HaiDouHelper.exe");
const sentinelFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

if (process.platform !== "win32") {
  throw new Error("海斗数据助手安装版只能在 Windows 上构建");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: [join(projectRoot, "helper", "server.mjs")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

await writeFile(configPath, JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
}, null, 2));

execFileSync(process.execPath, ["--experimental-sea-config", configPath], {
  cwd: projectRoot,
  stdio: "inherit",
});
await copyFile(process.execPath, executablePath);
await inject(executablePath, "NODE_SEA_BLOB", await readFile(blobPath), {
  sentinelFuse,
});

console.log(executablePath);
