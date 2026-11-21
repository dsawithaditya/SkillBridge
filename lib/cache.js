/**
 * Deterministic SHA-256 disk cache storing JSON payloads under data/cache/.
 * Supports atomic concurrent temp writes, TTL expiration, cache stats, size capping,
 * and automatic /tmp fallback for read-only serverless filesystems (Vercel).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEEDED_CACHE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "cache"
);

const SERVERLESS_TMP_CACHE_DIR = path.join(os.tmpdir(), "skillbridge-cache");

const DEFAULT_MAX_FILES = 250;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

let activeCacheDir = process.env.VERCEL ? SERVERLESS_TMP_CACHE_DIR : SEEDED_CACHE_DIR;

export function getCacheDir() {
  return activeCacheDir;
}

export function setCacheDir(dirPath) {
  activeCacheDir = path.resolve(dirPath);
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortObjectKeys(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function computeDigest(namespace, params) {
  const filtered = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k !== "api_key") filtered[k] = v;
  }
  const canonicalParams = JSON.stringify(sortObjectKeys(filtered));
  return crypto
    .createHash("sha256")
    .update(`${namespace}:${canonicalParams}`, "utf8")
    .digest("hex");
}

export function buildCachePath(namespace, params, baseDir = activeCacheDir) {
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch {
    // Read-only filesystem (e.g., Vercel /var/task); reads still work without mkdir
  }
  const digest = computeDigest(namespace, params);
  return path.join(baseDir, `${digest}.json`);
}

function readCacheFile(cachePath, ttlMs) {
  if (!fs.existsSync(cachePath)) return null;
  try {
    if (typeof ttlMs === "number" && ttlMs > 0) {
      const stat = fs.statSync(cachePath);
      if (Date.now() - stat.mtimeMs > ttlMs) {
        return null;
      }
    }
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function getCached(namespace, params, options = {}) {
  const { ttlMs = null } = options || {};
  const primaryPath = buildCachePath(namespace, params, activeCacheDir);
  const hit = readCacheFile(primaryPath, ttlMs);
  if (hit !== null) return hit;

  // On Vercel, if activeCacheDir is /tmp, also check bundled read-only data/cache/
  if (activeCacheDir === SERVERLESS_TMP_CACHE_DIR && SEEDED_CACHE_DIR !== activeCacheDir) {
    const seededPath = path.join(SEEDED_CACHE_DIR, `${computeDigest(namespace, params)}.json`);
    return readCacheFile(seededPath, ttlMs);
  }
  return null;
}

function enforceCacheCap(
  targetDir,
  protectedPath,
  maxFiles = DEFAULT_MAX_FILES,
  maxBytes = DEFAULT_MAX_BYTES
) {
  try {
    if (!fs.existsSync(targetDir)) return;
    const files = fs
      .readdirSync(targetDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const fullPath = path.join(targetDir, name);
        const stat = fs.statSync(fullPath);
        return { fullPath, size: stat.size, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);

    let totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    let count = files.length;

    for (const file of files) {
      if (count <= maxFiles && totalBytes <= maxBytes) break;
      if (file.fullPath === protectedPath) continue;
      fs.rmSync(file.fullPath, { force: true });
      count -= 1;
      totalBytes -= file.size;
    }
  } catch {
    // Non-fatal cleanup
  }
}

function writeAtomicCache(baseDir, namespace, params, payload, options = {}) {
  const cachePath = buildCachePath(namespace, params, baseDir);
  const uniqueSuffix = `${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 8)}.tmp`;
  const tmpPath = `${cachePath}.${uniqueSuffix}`;
  const serialized = JSON.stringify(payload, null, 2);

  fs.writeFileSync(tmpPath, serialized, "utf8");
  try {
    fs.renameSync(tmpPath, cachePath);
  } catch {
    try {
      fs.copyFileSync(tmpPath, cachePath);
    } finally {
      if (fs.existsSync(tmpPath)) {
        fs.rmSync(tmpPath, { force: true });
      }
    }
  }

  enforceCacheCap(baseDir, cachePath, options.maxFiles, options.maxBytes);
}

export function setCached(namespace, params, payload, options = {}) {
  try {
    writeAtomicCache(activeCacheDir, namespace, params, payload, options);
  } catch {
    // Fallback to os.tmpdir() if activeCacheDir is on a read-only mount
    try {
      writeAtomicCache(SERVERLESS_TMP_CACHE_DIR, namespace, params, payload, options);
    } catch {
      // Non-fatal in serverless if disk is completely unavailable
    }
  }
}

export function getCacheStats() {
  try {
    const dirsToScan = [activeCacheDir];
    if (
      activeCacheDir === SERVERLESS_TMP_CACHE_DIR &&
      SEEDED_CACHE_DIR !== activeCacheDir &&
      fs.existsSync(SEEDED_CACHE_DIR)
    ) {
      dirsToScan.push(SEEDED_CACHE_DIR);
    }

    const seenNames = new Set();
    let totalBytes = 0;
    let latestMtime = 0;

    for (const dir of dirsToScan) {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
      for (const name of entries) {
        if (seenNames.has(name)) continue;
        seenNames.add(name);
        const stat = fs.statSync(path.join(dir, name));
        totalBytes += stat.size;
        if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
      }
    }

    return {
      totalFiles: seenNames.size,
      totalBytes,
      lastUpdatedIso: latestMtime > 0 ? new Date(latestMtime).toISOString() : null,
    };
  } catch {
    return { totalFiles: 0, totalBytes: 0, lastUpdatedIso: null };
  }
}
