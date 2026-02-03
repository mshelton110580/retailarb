import fs from "fs/promises";
import path from "path";

const basePath = process.env.STORAGE_PATH ?? path.join(process.cwd(), "storage");

export async function ensureStorage() {
  await fs.mkdir(basePath, { recursive: true });
}

export async function saveFile(relativePath: string, data: Buffer) {
  await ensureStorage();
  const fullPath = path.join(basePath, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, data);
  return relativePath;
}

export function getPublicPath(relativePath: string) {
  return `/api/storage/${relativePath}`;
}

export function getBasePath() {
  return basePath;
}
