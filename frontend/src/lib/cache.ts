import type { TiltSeries, PngCacheItem } from './types';
import { fetchPng } from './api';

// Cache limits
const MAX_MEMORY_CACHE = 2 * 1024 * 1024 * 1024; // 2GB
const memoryCache = new Map<string, PngCacheItem>();

// IndexedDB setup
const DB_NAME = 'TsSvCache';
const DB_VERSION = 1;
const STORE_NAME = 'pngs';

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
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });
}

function cacheKey(tsId: string, zIndex: number, bin = 8, quality = 90): string {
  return `${tsId}_${zIndex}_bin${bin}_q${quality}`;
}

/** Get PNG from cache (memory -> IndexedDB) */
export async function getPng(
  tsId: string,
  zIndex: number,
  bin = 8,
  quality = 90
): Promise<Blob | null> {
  const key = cacheKey(tsId, zIndex, bin, quality);

  // 1. Check memory cache
  const memCached = memoryCache.get(key);
  if (memCached) {
    memCached.timestamp = Date.now();
    return memCached.data;
  }

  // 2. Check IndexedDB
  try {
    const database = await initDB();
    return new Promise((resolve) => {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = async () => {
        if (request.result) {
          const data = request.result as Blob;
          await putPngToMemory(key, data);
          resolve(data);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function putPngToMemory(key: string, data: Blob): Promise<void> {
  const size = data.size;

  // LRU eviction
  while (getMemoryCacheSize() + size > MAX_MEMORY_CACHE && memoryCache.size > 0) {
    const oldestKey = memoryCache.keys().next().value;
    if (!oldestKey) break;
    memoryCache.delete(oldestKey);
  }

  memoryCache.set(key, { data, size, timestamp: Date.now() });

  // Sync to IndexedDB
  await putToIndexedDB(key, data);
}

function getMemoryCacheSize(): number {
  let total = 0;
  for (const item of memoryCache.values()) {
    total += item.size;
  }
  return total;
}

async function putToIndexedDB(key: string, data: Blob): Promise<void> {
  try {
    const database = await initDB();
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(data, key);
  } catch (e) {
    console.error('Failed to cache PNG in IndexedDB:', e);
  }
}

/** Store PNG in cache (memory + IndexedDB) */
export async function putPng(
  tsId: string,
  zIndex: number,
  data: Blob,
  bin = 8,
  quality = 90
): Promise<void> {
  const key = cacheKey(tsId, zIndex, bin, quality);
  await putPngToMemory(key, data);
}

/** Clear all cached PNGs */
export async function clearCache(): Promise<void> {
  memoryCache.clear();

  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('Failed to clear cache:', e);
  }
}

/** Cache all frames of a single mdoc (only matched frames, with concurrency limit) */
export async function cacheMdoc(
  ts: TiltSeries,
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Only cache frames that have a matching mrc file on disk
  const cacheable = ts.frames.filter((f) => f.selected);
  const total = cacheable.length;

  if (total === 0) return { success: 0, failed: 0 };

  // Process with limited concurrency (6 parallel = browser connection limit)
  const CONCURRENCY = 6;
  const results: ('success' | 'failed')[] = new Array(total);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < total) {
      const idx = nextIndex++;
      const frame = cacheable[idx];
      try {
        const cached = await getPng(ts.id, frame.zIndex, 8, 90);
        if (!cached) {
          const blob = await fetchPng(ts.id, frame.zIndex, 8, 90);
          await putPng(ts.id, frame.zIndex, blob, 8, 90);
        }
        results[idx] = 'success';
      } catch (e) {
        console.error(`[cache] FAILED ${ts.id}/${frame.zIndex}:`, e);
        results[idx] = 'failed';
      }
      if (onProgress) {
        onProgress(results.filter((r) => r === 'success').length + results.filter((r) => r === 'failed').length, total);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  success = results.filter((r) => r === 'success').length;
  failed = results.filter((r) => r === 'failed').length;
  return { success, failed };
}

/** Cache all mdocs sequentially */
export async function cacheAllMdocs(
  tiltSeries: TiltSeries[],
  onProgress?: (progress: {
    currentTs: string;
    current: number;
    total: number;
    completedTs: number;
    totalTs: number;
  }) => void
): Promise<{ success: number; failed: number; total: number }> {
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalFrames = 0;
  for (const ts of tiltSeries) {
    totalFrames += ts.frames.filter((f) => f.selected).length;
  }

  let completedTs = 0;

  for (const ts of tiltSeries) {
    const result = await cacheMdoc(ts, (current, total) => {
      if (onProgress) {
        onProgress({
          currentTs: ts.id,
          current,
          total,
          completedTs,
          totalTs: tiltSeries.length,
        });
      }
    });
    totalSuccess += result.success;
    totalFailed += result.failed;
    completedTs++;
  }

  return { success: totalSuccess, failed: totalFailed, total: totalFrames };
}
