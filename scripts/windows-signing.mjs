import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

function certificateDirectoryOffset(buffer) {
  if (buffer.length < 256 || buffer.toString("ascii", 0, 2) !== "MZ") return -1;
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") return -1;
  const optionalOffset = peOffset + 24;
  const magic = buffer.readUInt16LE(optionalOffset);
  const dataDirectoryOffset = optionalOffset + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : 0);
  return dataDirectoryOffset ? dataDirectoryOffset + 8 * 4 : -1;
}

export async function stripEmbeddedSignature(path) {
  const buffer = await readFile(path);
  const directoryOffset = certificateDirectoryOffset(buffer);
  if (directoryOffset < 0 || directoryOffset + 8 > buffer.length) return false;
  const certificateOffset = buffer.readUInt32LE(directoryOffset);
  const certificateSize = buffer.readUInt32LE(directoryOffset + 4);
  if (!certificateOffset || !certificateSize || certificateOffset + certificateSize > buffer.length) return false;
  buffer.writeUInt32LE(0, directoryOffset);
  buffer.writeUInt32LE(0, directoryOffset + 4);
  const unsigned = certificateOffset + certificateSize === buffer.length
    ? buffer.subarray(0, certificateOffset)
    : Buffer.concat([buffer.subarray(0, certificateOffset), Buffer.alloc(certificateSize), buffer.subarray(certificateOffset + certificateSize)]);
  await writeFile(path, unsigned);
  return true;
}

function findSignTool() {
  if (process.env.SIGNTOOL_PATH) return process.env.SIGNTOOL_PATH;
  try {
    return execFileSync("where.exe", ["signtool.exe"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/)[0];
  } catch {
    return "";
  }
}

export function signWindowsArtifact(path) {
  const thumbprint = String(process.env.HAIDOU_SIGN_CERT_SHA1 ?? "").replace(/\s/g, "");
  const signTool = findSignTool();
  if (!thumbprint || !signTool) {
    if (process.env.HAIDOU_REQUIRE_SIGNING === "1") throw new Error("Trusted Windows signing is required, but HAIDOU_SIGN_CERT_SHA1 or signtool.exe is unavailable.");
    console.warn(`UNSIGNED: ${path}. Configure HAIDOU_SIGN_CERT_SHA1 and signtool.exe before a trusted public release.`);
    return false;
  }
  execFileSync(signTool, ["sign", "/fd", "SHA256", "/sha1", thumbprint, "/tr", "http://timestamp.digicert.com", "/td", "SHA256", path], { stdio: "inherit" });
  execFileSync(signTool, ["verify", "/pa", "/v", path], { stdio: "inherit" });
  return true;
}
