import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { AppError } from "@/lib/errors";

const root = () => path.resolve(/* turbopackIgnore: true */ process.env.VSLA_PRIVATE_UPLOAD_ROOT || path.join(os.tmpdir(), "cccrn-vsla-private"));
const resolveKey = (key) => {
  const target = path.resolve(root(), key);
  if (!target.startsWith(`${root()}${path.sep}`)) throw new AppError("Invalid private storage key", "INVALID_STORAGE_KEY", 400);
  return target;
};

export async function stagePng(dataUrl, folder = "reconciliation-signatures") {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!match) throw new AppError("A valid PNG signature is required", "RECONCILIATION_SIGNATURE_REQUIRED", 422);
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 200 || bytes.length > 1048576 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new AppError("A meaningful PNG signature is required", "RECONCILIATION_SIGNATURE_REQUIRED", 422);
  const name = `${crypto.randomUUID()}.png`, temporaryKey = `${folder}/.tmp-${name}`, storageKey = `${folder}/${name}`;
  const temporaryPath = resolveKey(temporaryKey);
  await mkdir(path.dirname(temporaryPath), { recursive: true });
  await writeFile(temporaryPath, bytes, { flag: "wx" });
  return { temporaryKey, storageKey, mimeType: "image/png", size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

export async function stagePdf(file) {
  if (!(file instanceof Blob) || file.type !== "application/pdf") throw new AppError("Select a PDF document", "CONSTITUTION_DOCUMENT_INVALID_TYPE", 422);
  const originalFilename = String(file.name || "constitution.pdf").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
  if (!/\.pdf$/i.test(originalFilename)) throw new AppError("The document filename must end in .pdf", "CONSTITUTION_DOCUMENT_INVALID_TYPE", 422);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length || bytes.length > 10485760) throw new AppError("The PDF must not exceed 10 MB", "CONSTITUTION_DOCUMENT_TOO_LARGE", 422);
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-" || !bytes.subarray(Math.max(0, bytes.length - 2048)).includes(Buffer.from("%%EOF")))
    throw new AppError("The uploaded file is not a valid PDF", "CONSTITUTION_DOCUMENT_INVALID_TYPE", 422);
  const name = `${crypto.randomUUID()}.pdf`, temporaryKey = `constitutions/.tmp-${name}`, storageKey = `constitutions/${name}`, temporaryPath = resolveKey(temporaryKey);
  await mkdir(path.dirname(temporaryPath), { recursive: true });
  await writeFile(temporaryPath, bytes, { flag: "wx" });
  return { temporaryKey, storageKey, originalFilename, mimeType: "application/pdf", size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

export async function finalizePrivateFile(staged) {
  const category = staged.storageKey.split("/", 1)[0];
  if (process.env.NODE_ENV !== "production") {
    const marker = path.join(root(), `.force-${category}-finalization-failure`);
    try { await readFile(marker); throw new Error(`Forced ${category} finalization failure`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  await rename(resolveKey(staged.temporaryKey), resolveKey(staged.storageKey));
}
export async function removePrivateFile(key) { if (key) await rm(resolveKey(key), { force: true }); }
export async function readPrivateFile(key) { return readFile(resolveKey(key)); }
