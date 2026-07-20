import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(projectRoot, "pages-dist");
const clientDirectory = join(projectRoot, "dist", "client");
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "lol-haidou";
const ownerName = process.env.GITHUB_REPOSITORY?.split("/")[0] ?? "haxiaxiaozio-art";
const basePath = `/${repositoryName}`;
const origin = `https://${ownerName}.github.io`;

async function buildForPages() {
  const isWindows = process.platform === "win32";
  const npmCommand = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const npmArguments = isWindows ? ["/d", "/s", "/c", "npm.cmd run build"] : ["run", "build"];
  await new Promise((resolve, reject) => {
    const child = spawn(npmCommand, npmArguments, {
      cwd: projectRoot,
      stdio: "inherit",
      env: { ...process.env, HAIDOU_PAGES_REPOSITORY: repositoryName },
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Pages build failed with code ${code}`)));
  });
}

export function rewriteForPages(html) {
  const assetMarker = "__HAIDOU_PAGES_ASSET__";
  const faviconMarker = "__HAIDOU_PAGES_FAVICON__";
  return html
    .replaceAll(`${basePath}/assets/`, assetMarker)
    .replaceAll(`${basePath}/favicon.svg`, faviconMarker)
    .replaceAll("http://localhost:3000/og.png", `${origin}${basePath}/og.png`)
    .replaceAll("http://localhost:3000", `${origin}${basePath}/`)
    .replaceAll("/assets/", `${basePath}/assets/`)
    .replaceAll("/favicon.svg", `${basePath}/favicon.svg`)
    .replaceAll(`${origin}/og.png`, `${origin}${basePath}/og.png`)
    .replaceAll(`content="${origin}"`, `content="${origin}${basePath}/"`)
    .replaceAll(assetMarker, `${basePath}/assets/`)
    .replaceAll(faviconMarker, `${basePath}/favicon.svg`);
}

export function assertPagesRuntimeBase(source) {
  if (source.includes("Unable to preload CSS for") && !source.includes(`${basePath}/`)) {
    throw new Error(`GitHub Pages runtime is missing the ${basePath}/ asset base`);
  }
}

async function render(worker, route, expectedStatus = 200) {
  const response = await worker.fetch(new Request(`${origin}${route}`, { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
  if (response.status !== expectedStatus) throw new Error(`Static render failed for ${route}: ${response.status}`);
  return rewriteForPages(await response.text());
}

export async function exportPages() {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await cp(clientDirectory, outputDirectory, { recursive: true });

  const workerUrl = pathToFileURL(join(projectRoot, "dist", "server", "index.js"));
  workerUrl.searchParams.set("static-export", String(Date.now()));
  const { default: worker } = await import(workerUrl.href);
  const routes = [
    ["/", join(outputDirectory, "index.html")],
    ["/privacy", join(outputDirectory, "privacy", "index.html")],
    ["/terms", join(outputDirectory, "terms", "index.html")],
  ];
  for (const [route, destination] of routes) {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await render(worker, route), "utf8");
  }
  await writeFile(join(outputDirectory, ".nojekyll"), "", "utf8");
  await writeFile(join(outputDirectory, "404.html"), await render(worker, "/missing-page", 404), "utf8");
  const assetNames = await readdir(join(outputDirectory, "assets"));
  const entryName = assetNames.find((name) => /^index-.*\.js$/.test(name));
  if (!entryName) throw new Error("GitHub Pages entry bundle was not generated");
  assertPagesRuntimeBase(await readFile(join(outputDirectory, "assets", entryName), "utf8"));
  console.log(`GitHub Pages export ready: ${outputDirectory}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildForPages();
  await exportPages();
}
