import { writable, derived } from 'svelte/store';
import type { TiltSeries, Frame, SelectionState, PngCacheItem, ScanConfig } from './types';

// API 基础 URL - from .env file
const API_BASE = import.meta.env.VITE_API_BASE;

// ==================== 全局状态 ====================

// User home directory
export const userHome = writable<string>('');

// Get user home directory from environment
export function getUserHome(): string {
	if (typeof window !== 'undefined' && window.process?.env?.HOME) {
		return window.process.env.HOME;
	}
	const user = (typeof window !== 'undefined' && window.process?.env?.USER) || 'user';
	return `/home/${user}`;
}

// Fetch user home from backend
export async function fetchUserHome(): Promise<void> {
	try {
		const response = await fetch(`${API_BASE}/api/files/user-home`);
		if (!response.ok) throw new Error('Failed to fetch user home');
		const data = await response.json();
		userHome.set(data.home);
	} catch (e) {
		console.error('Failed to fetch user home:', e);
		// Fallback to environment-based home
		userHome.set(getUserHome());
	}
}

// Tilt Series 列表
export const tiltSeries = writable<TiltSeries[]>([]);

// 从 localStorage 恢复 tiltSeries
export function loadPersistedTiltSeries(): void {
	if (typeof localStorage === 'undefined') return;

	const saved = localStorage.getItem('ts_tiltSeries');
	console.log('Loading tiltSeries from localStorage:', saved ? `${saved.length} chars` : 'no data');
	if (saved) {
		try {
			const parsed = JSON.parse(saved) as TiltSeries[];
			console.log('Parsed tiltSeries:', parsed.length, 'items');
			tiltSeries.set(parsed);
		} catch (e) {
			console.error('Failed to load tiltSeries:', e);
		}
	}
}

// 监听 tiltSeries 变化并保存到 localStorage
if (typeof localStorage !== 'undefined') {
	tiltSeries.subscribe((value) => {
		// 只在有数据时保存
		if (value && value.length > 0) {
			console.log('Saving tiltSeries to localStorage:', value.length, 'items');
			localStorage.setItem('ts_tiltSeries', JSON.stringify(value));
		}
	});
}

// 选择状态 (Single Source of Truth for selections)
export const selections = writable<SelectionState>(new Map());
export const selectionsStore = derived(selections, ($selections) => $selections);

// PNG 缓存 (内存 LRU)
const MAX_MEMORY_CACHE = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_INDEXEDDB_CACHE = 10 * 1024 * 1024 * 1024; // 10GB
const memoryCache = new Map<string, PngCacheItem>();

// 导出缓存大小供组件使用
export const currentCacheSize = writable(0);
export const indexedDbCacheSize = writable(0);
export const cacheWarning = derived(
	[currentCacheSize, indexedDbCacheSize],
	([$currentCacheSize, $indexedDbCacheSize]) => ({
		memoryExceeded: $currentCacheSize > MAX_MEMORY_CACHE * 0.9,
		indexedDbExceeded: $indexedDbCacheSize > MAX_INDEXEDDB_CACHE * 0.9,
		evictionNeeded: $currentCacheSize > MAX_MEMORY_CACHE
	})
);

// IndexedDB 缓存
const DB_NAME = 'TsSvCache';
const DB_VERSION = 1;
const STORE_NAME = 'pngs';

let db: IDBDatabase | null = null;

// 初始化 IndexedDB
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

// 生成缓存键
function cacheKey(tsId: string, zIndex: number, bin = 8, quality = 90): string {
	return `${tsId}_${zIndex}_bin${bin}_q${quality}`;
}

// ==================== PNG 缓存操作 (Simplified) ====================

// 获取 PNG (simple version, no dedup)
export async function getPng(
	tsId: string,
	zIndex: number,
	bin = 8,
	quality = 90
): Promise<Blob | null> {
	const key = cacheKey(tsId, zIndex, bin, quality);

	// 1. 检查内存缓存
	const memCached = memoryCache.get(key);
	if (memCached) {
		memCached.timestamp = Date.now();
		return memCached.data;
	}

	// 2. 检查 IndexedDB
	try {
		const database = await initDB();
		return new Promise((resolve, reject) => {
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
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('IndexedDB error:', e);
	}

	return null;
}

// 存入内存缓存
async function putPngToMemory(key: string, data: Blob): Promise<void> {
	const size = data.size;
	const item: PngCacheItem = { data, size: size, timestamp: Date.now() };
	let cacheSize = 0;
	currentCacheSize.subscribe((n) => {
		cacheSize = n;
	})();

	// 检查是否已存在
	if (memoryCache.has(key)) {
		const existingSize = memoryCache.get(key)!.size;
		currentCacheSize.update((n) => n - existingSize);
		memoryCache.delete(key);
		cacheSize -= existingSize;
	}

	// LRU 淘汰
	while (cacheSize + size > MAX_MEMORY_CACHE && memoryCache.size > 0) {
		const oldestKey = memoryCache.keys().next().value;
		if (!oldestKey) break;
		const oldest = memoryCache.get(oldestKey)!;
		currentCacheSize.update((n) => n - oldest.size);
		memoryCache.delete(oldestKey);
		cacheSize -= oldest.size;
	}

	memoryCache.set(key, item);
	currentCacheSize.update((n) => n + size);

	// 同步到 IndexedDB
	await putToIndexedDB(key, data);
}

// 存入 IndexedDB
async function putToIndexedDB(key: string, data: Blob): Promise<void> {
	try {
		const database = await initDB();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.put(data, key);

			request.onsuccess = () => {
				updateIndexedDbSize().catch(() => {});
				resolve();
			};
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to cache PNG in IndexedDB:', e);
	}
}

// 更新 IndexedDB 大小
async function updateIndexedDbSize(): Promise<void> {
	try {
		const database = await initDB();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.getAll();

			request.onsuccess = () => {
				const blobs = request.result as Blob[];
				const totalSize = blobs.reduce((sum, blob) => sum + blob.size, 0);
				indexedDbCacheSize.set(totalSize);
				resolve();
			};
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to update IndexedDB size:', e);
	}
}

// 存入缓存 (PNG -> Memory + IndexedDB)
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

// 清除缓存
export async function clearCache(): Promise<void> {
	memoryCache.clear();
	currentCacheSize.set(0);

	try {
		const database = await initDB();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.clear();

			request.onsuccess = () => {
				indexedDbCacheSize.set(0);
				resolve();
			};
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to clear cache:', e);
	}
}

// 删除所有缓存 (alias for clearCache)
export async function deleteCache(): Promise<void> {
	await clearCache();
}

// 刷新缓存：与后端同步，重新获取所有 PNG
export async function refreshCache(): Promise<{ success: number; failed: number; total: number }> {
	// Clear cache first
	await clearCache();
	// Then re-cache all
	return cacheAllMdocs();
}

// ==================== MDOC-BY-MDOC CACHING ====================

/**
 * Cache all frames of a single mdoc in parallel.
 * This is the primary caching unit - process one mdoc at a time, all frames in parallel.
 */
export async function cacheMdoc(
	ts: TiltSeries,
	onProgress?: (current: number, total: number) => void
): Promise<{ success: number; failed: number }> {
	let success = 0;
	let failed = 0;
	const total = ts.frames.length;

	// Process all frames of this mdoc in parallel
	await Promise.all(
		ts.frames.map(async (frame, index) => {
			try {
				const cached = await getPng(ts.id, frame.zIndex, 8, 90);
				if (!cached) {
					// Not in cache, fetch from backend
					const blob = await fetchPng(ts.id, frame.zIndex, 8, 90);
					await putPng(ts.id, frame.zIndex, blob, 8, 90);
				}
				success++;
			} catch (e) {
				console.error(`Failed to cache ${ts.id}/${frame.zIndex}:`, e);
				failed++;
			}
			if (onProgress) {
				onProgress(success + failed, total);
			}
		})
	);

	return { success, failed };
}

/**
 * Cache all mdocs sequentially, processing frames within each mdoc in parallel.
 * This prevents overwhelming the system while maximizing throughput per mdoc.
 */
export async function cacheAllMdocs(
	onProgress?: (progress: { currentTs: string; current: number; total: number; completedTs: number; totalTs: number }) => void
): Promise<{ success: number; failed: number; total: number }> {
	let allSeries: TiltSeries[] = [];
	const unsubscribe = tiltSeries.subscribe((series) => {
		allSeries = series;
	});
	unsubscribe();

	let totalSuccess = 0;
	let totalFailed = 0;
	let totalFrames = 0;
	for (const ts of allSeries) {
		totalFrames += ts.frames.length;
	}

	let completedTs = 0;

	// Process mdocs sequentially
	for (const ts of allSeries) {
		const result = await cacheMdoc(ts, (current, total) => {
			if (onProgress) {
				onProgress({
					currentTs: ts.id,
					current,
					total,
					completedTs,
					totalTs: allSeries.length
				});
			}
		});
		totalSuccess += result.success;
		totalFailed += result.failed;
		completedTs++;
	}

	return { success: totalSuccess, failed: totalFailed, total: totalFrames };
}

// Legacy alias for compatibility
export async function cacheAll(
	onProgress?: (progress: { cached: number; total: number; currentTs: string; currentFrame: number }) => void
): Promise<{ success: number; failed: number; total: number }> {
	let cached = 0;
	let total = 0;
	
	return cacheAllMdocs((p) => {
		cached = p.current;
		total = p.total;
		if (onProgress) {
			onProgress({
				cached,
				total,
				currentTs: p.currentTs,
				currentFrame: 0
			});
		}
	});
}

// ==================== API 调用 ====================

// 扫描项目
export async function scanProject(config: ScanConfig): Promise<TiltSeries[]> {
	console.log('[scanProject] Starting scan with config:', config);
	const response = await fetch(`${API_BASE}/api/mdoc/scan`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(config)
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error('[scanProject] Scan failed:', response.status, errorText);
		throw new Error(`Scan failed: ${response.status} - ${errorText}`);
	}

	const data = await response.json();
	console.log('[scanProject] Scan completed, found', data.tiltSeries.length, 'tilt series');
	tiltSeries.set(data.tiltSeries);
	return data.tiltSeries;
}

// 获取 PNG 预览 (simple version, fetch directly)
export async function fetchPng(tsId: string, zIndex: number, bin = 8, quality = 90): Promise<Blob> {
	const response = await fetch(
		`${API_BASE}/api/preview/${tsId}/${zIndex}?bin=${bin}&quality=${quality}`
	);

	if (!response.ok) throw new Error('Failed to fetch PNG');

	const blob = await response.blob();
	await putPng(tsId, zIndex, blob, bin, quality);
	return blob;
}

// ==================== SAVE ALL (UNIFIED) ====================

export interface SaveAllResult {
	success: boolean;
	saved: string[];
	failed: string[];
	deleted: string[];
	message: string;
}

/**
 * Save all mdoc changes in one request.
 * Sends all selections from frontend (single source of truth) to backend.
 * Backend writes directly to disk.
 */
export async function saveAll(
	selectionsState: SelectionState,
	deletePaths?: string[]
): Promise<SaveAllResult> {
	// Convert selections Map to plain object for JSON serialization
	const selectionsPayload: Record<string, Record<number, boolean>> = {};
	
	for (const [mdocPath, tsSelections] of selectionsState) {
		if (tsSelections.size > 0) {
			selectionsPayload[mdocPath] = Object.fromEntries(tsSelections);
		}
	}

	// Send save request
	const response = await fetch(`${API_BASE}/api/mdoc/save-all`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ selections: selectionsPayload })
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Save all failed: ${errorText}`);
	}

	const saveResult = await response.json();

	// Handle deletions if any
	let deleteResult = { deleted: [] as string[], failed: [] as string[] };
	if (deletePaths && deletePaths.length > 0) {
		const deleteResponse = await fetch(`${API_BASE}/api/mdoc/delete-all`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mdocPaths: deletePaths })
		});
		
		if (deleteResponse.ok) {
			deleteResult = await deleteResponse.json();
		}
	}

	return {
		success: saveResult.success && deleteResult.failed?.length === 0,
		saved: saveResult.saved || [],
		failed: [...(saveResult.failed || []), ...(deleteResult.failed || [])],
		deleted: deleteResult.deleted || [],
		message: saveResult.message
	};
}

// ==================== 选择状态操作 ====================

// 获取帧的选择状态
export function getFrameSelection(
	mdocPath: string,
	zIndex: number,
	original: boolean,
	selectionsState?: Map<string, Map<number, boolean>>
): boolean {
	if (selectionsState) {
		const tsSelections = selectionsState.get(mdocPath);
		if (!tsSelections) return original;
		return tsSelections.get(zIndex) ?? original;
	}

	let tsSelections: Map<number, boolean> | undefined;
	const unsubscribe = selections.subscribe((state) => {
		tsSelections = state.get(mdocPath);
	});
	unsubscribe();
	if (!tsSelections) return original;
	return tsSelections.get(zIndex) ?? original;
}

// 设置帧的选择状态
export function setFrameSelection(mdocPath: string, zIndex: number, selected: boolean): void {
	selections.update((state) => {
		const newState = new Map(state);
		if (!newState.has(mdocPath)) {
			newState.set(mdocPath, new Map());
		}
		const tsSelections = newState.get(mdocPath)!;
		tsSelections.set(zIndex, selected);
		return newState;
	});

	// 防抖保存到 localStorage
	debouncePersist();
}

// 批量设置
export function setBatchSelection(mdocPath: string, selectionsMap: Map<number, boolean>): void {
	selections.update((state) => {
		const newState = new Map(state);
		if (!newState.has(mdocPath)) {
			newState.set(mdocPath, new Map());
		}
		const tsSelections = newState.get(mdocPath)!;
		for (const [zIndex, selected] of selectionsMap) {
			tsSelections.set(zIndex, selected);
		}
		return newState;
	});

	debouncePersist();
}

// 清除 TS 的选择状态
export function clearTsSelections(mdocPath: string): void {
	selections.update((state) => {
		const newState = new Map(state);
		newState.delete(mdocPath);
		return newState;
	});

	debouncePersist();
}

// 持久化到 localStorage
let persistTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncePersist(): void {
	if (persistTimeout) clearTimeout(persistTimeout);
	persistTimeout = setTimeout(() => {
		let state: SelectionState = new Map();
		const unsubscribe = selections.subscribe((s) => {
			state = s;
		});
		unsubscribe();
		const serializable: Record<string, Record<number, boolean>> = {};
		for (const [mdocPath, tsSelections] of state) {
			serializable[mdocPath] = Object.fromEntries(tsSelections);
		}
		// 只在浏览器环境中访问 localStorage
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('ts_selections', JSON.stringify(serializable));
		}
	}, 1000);
}

// 从 localStorage 恢复
export function loadPersistedSelections(): void {
	// 只在浏览器环境中访问 localStorage
	if (typeof localStorage === 'undefined') return;

	const saved = localStorage.getItem('ts_selections');
	if (saved) {
		try {
			const parsed = JSON.parse(saved) as Record<string, Record<number, boolean>>;
			const state: SelectionState = new Map();
			for (const [mdocPath, tsSelections] of Object.entries(parsed)) {
				state.set(mdocPath, new Map(Object.entries(tsSelections).map(([k, v]) => [Number(k), v])));
			}
			selections.set(state);
		} catch (e) {
			console.error('Failed to load selections:', e);
		}
	}
}

// ==================== 派生状态 ====================

// 未保存的 TS 列表
export const unsavedTs = derived([tiltSeries, selections], ([$tiltSeries, $selections]) => {
	return $tiltSeries.filter((ts) => {
		const tsSelections = $selections.get(ts.mdocPath);
		return tsSelections && tsSelections.size > 0;
	});
});

// 统计信息
export const stats = derived([tiltSeries, selections], ([$tiltSeries, $selections]) => {
	let totalFrames = 0;
	let selectedFrames = 0;

	for (const ts of $tiltSeries) {
		for (const frame of ts.frames) {
			totalFrames++;
			if (getFrameSelection(ts.mdocPath, frame.zIndex, frame.selected)) {
				selectedFrames++;
			}
		}
	}

	return {
		totalSeries: $tiltSeries.length,
		totalFrames,
		selectedFrames,
		unsavedCount: $selections.size
	};
});

// 初始化
loadPersistedSelections();

// 初始化 IndexedDB 大小跟踪
updateIndexedDbSize().catch((e) => {
	console.error('Failed to initialize IndexedDB size tracking:', e);
});
