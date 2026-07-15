import type { Frame, PngCacheItem, TiltSeries } from "./types";
import { fetchMtimes, fetchPng } from "./api";

// Cache limits
const MAX_MEMORY_CACHE = 2 * 1024 * 1024 * 1024; // 2GB
const memoryCache = new Map<string, PngCacheItem>();

// IndexedDB setup
const DB_NAME = "TsSvCache";
const DB_VERSION = 2;
const STORE_NAME = "pngs";

let db: IDBDatabase | null = null;

async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;
      // Bump version to purge stale cache entries from previous key formats
      // (old format: {tsId}_{zIndex}_bin{bin}_q{quality}, new format: {tsId}_{zIndex}_bin{bin})
      if (oldVersion < 2 && database.objectStoreNames.contains(STORE_NAME)) {
        database.deleteObjectStore(STORE_NAME);
      }
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });
}

function cacheKey(tsId: string, zIndex: number, bin = 8): string {
  return `${tsId}_${zIndex}_bin${bin}`;
}

// ── Read path ─────────────────────────────────────────────────

/** Get PNG from cache hierarchy: Memory → IndexedDB → Backend.
 *
 *  Cache validity is determined by mrcPath: since MRC files are immutable,
 *  the same mrcPath guarantees the same source data. The PNG disk mtime
 *  (x-png-mtime) is stored alongside to allow skipping unchanged entries
 *  during "Cache All" without re-downloading. */
export async function getPng(
  tsId: string,
  zIndex: number,
  mrcPath: string,
  bin = 8,
): Promise<{ blob: Blob; pngMtime: number } | null> {
  const key = cacheKey(tsId, zIndex, bin);

  // 1. Memory cache (hot, per-session)
  const memCached = memoryCache.get(key);
  if (memCached && memCached.mrcPath === mrcPath) {
    memCached.timestamp = Date.now();
    return { blob: memCached.data, pngMtime: memCached.pngMtime };
  }

  // 2. IndexedDB (persistent, survives reload)
  try {
    const database = await initDB();
    return new Promise((resolve) => {
      const tx = database.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = async () => {
        if (!req.result) {
          resolve(null);
          return;
        }

        const entry = req.result as {
          blob: Blob;
          mrcPath: string;
          pngMtime?: number;
        };
        if (entry.mrcPath !== mrcPath) {
          resolve(null); // stale — different source file
          return;
        }

        // Promote to memory
        const size = entry.blob.size;
        const pngMtime = entry.pngMtime || 0;
        memoryCache.set(key, {
          data: entry.blob,
          size,
          timestamp: Date.now(),
          mrcPath,
          pngMtime,
        });
        resolve({ blob: entry.blob, pngMtime });
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// ── Write path ────────────────────────────────────────────────

async function evictIfNeeded(size: number): Promise<void> {
  if (size > MAX_MEMORY_CACHE) return; // single item too large, skip cache

  let total = 0;
  for (const item of memoryCache.values()) total += item.size;

  if (total + size <= MAX_MEMORY_CACHE) return;

  // LRU eviction: repeatedly drop the entry with the oldest timestamp.
  // O(n) per eviction but avoids the O(n log n) cost of a full sort.
  while (total + size > MAX_MEMORY_CACHE && memoryCache.size > 0) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, item] of memoryCache.entries()) {
      if (item.timestamp < oldestTime) {
        oldestTime = item.timestamp;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    const item = memoryCache.get(oldestKey);
    if (item) {
      memoryCache.delete(oldestKey);
      total -= item.size;
    }
  }
}

export async function putPng(
  tsId: string,
  zIndex: number,
  data: Blob,
  mrcPath: string,
  pngMtime: number,
  bin = 8,
): Promise<void> {
  const key = cacheKey(tsId, zIndex, bin);
  const size = data.size;

  // Memory
  await evictIfNeeded(size);
  memoryCache.set(key, {
    data,
    size,
    timestamp: Date.now(),
    mrcPath,
    pngMtime,
  });

  // IndexedDB (fire-and-forget)
  try {
    const database = await initDB();
    const tx = database.transaction([STORE_NAME], "readwrite");
    tx.objectStore(STORE_NAME).put({ blob: data, mrcPath, pngMtime }, key);
  } catch (e) {
    console.error("Failed to cache PNG in IndexedDB:", e);
  }
}

// ── Management ────────────────────────────────────────────────

/** Delete a single PNG entry from memory and IndexedDB caches. */
async function deletePng(
  tsId: string,
  zIndex: number,
  bin = 8,
): Promise<void> {
  const key = cacheKey(tsId, zIndex, bin);
  memoryCache.delete(key);

  try {
    const database = await initDB();
    const tx = database.transaction([STORE_NAME], "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
  } catch (e) {
    console.error("Failed to delete PNG from IndexedDB:", e);
  }
}

/** Validate cached PNGs for a tilt series against current backend mtimes.
 *  Evicts entries whose stored mtime differs from the disk PNG mtime.
 *  Entries with no disk PNG yet (mtime missing) are kept. */
export async function validateTsCache(
  ts: TiltSeries,
  bin = 8,
): Promise<void> {
  try {
    const mtimes = await fetchMtimes(ts.id, bin);
    for (const frame of ts.frames) {
      const backendMtime = mtimes.get(frame.zIndex);
      if (backendMtime === undefined) continue; // no disk PNG yet, keep cache

      const cached = await getPng(
        ts.id,
        frame.zIndex,
        frame.mrcPath,
        bin,
      );
      if (cached && cached.pngMtime !== backendMtime) {
        await deletePng(ts.id, frame.zIndex, bin);
      }
    }
  } catch (e) {
    console.error(`[cache] Failed to validate ${ts.id}:`, e);
  }
}

/** Clear both memory and IndexedDB caches. */
export async function clearCache(): Promise<void> {
  memoryCache.clear();

  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction([STORE_NAME], "readwrite");
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error("Failed to clear IndexedDB cache:", e);
  }
}

// ── Bulk caching ──────────────────────────────────────────────

/** Cache all matched frames of a single tilt series (concurrency = 6). */
export async function cacheMdoc(
  ts: TiltSeries,
  onProgress?: (current: number, total: number) => void,
): Promise<{ success: number; failed: number }> {
  const cacheable = ts.frames.filter((f) => f.selected);
  const total = cacheable.length;
  if (total === 0) return { success: 0, failed: 0 };

  const CONCURRENCY = 6;
  const results: ("success" | "failed")[] = new Array(total);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < total) {
      const idx = nextIndex++;
      const frame = cacheable[idx];
      try {
        const cached = await getPng(ts.id, frame.zIndex, frame.mrcPath, 8);
        if (!cached) {
          const result = await fetchPng(ts.id, frame.zIndex, 8);
          await putPng(
            ts.id,
            frame.zIndex,
            result.blob,
            frame.mrcPath,
            result.pngMtime,
            8,
          );
        }
        results[idx] = "success";
      } catch (e) {
        console.error(`[cache] FAILED ${ts.id}/${frame.zIndex}:`, e);
        results[idx] = "failed";
      }
      if (onProgress) {
        onProgress(
          results.filter((r) => r === "success").length +
            results.filter((r) => r === "failed").length,
          total,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return {
    success: results.filter((r) => r === "success").length,
    failed: results.filter((r) => r === "failed").length,
  };
}

/** Cache all tilt series sequentially. */
export async function cacheAllMdocs(
  tiltSeries: TiltSeries[],
  onProgress?: (progress: {
    currentTs: string;
    current: number;
    total: number;
    completedTs: number;
    totalTs: number;
  }) => void,
): Promise<{ success: number; failed: number; total: number }> {
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalFrames = 0;
  for (const ts of tiltSeries) {
    totalFrames += ts.frames.filter((f) => f.selected).length;
  }

  let completedTs = 0;

  for (const ts of tiltSeries) {
    // Evict stale entries before re-caching so we don't keep out-of-date PNGs.
    await validateTsCache(ts, 8);
    const result = await cacheMdoc(ts, (current, total) => {
      onProgress?.({
        currentTs: ts.id,
        current,
        total,
        completedTs,
        totalTs: tiltSeries.length,
      });
    });
    totalSuccess += result.success;
    totalFailed += result.failed;
    completedTs++;
  }

  return { success: totalSuccess, failed: totalFailed, total: totalFrames };
}
