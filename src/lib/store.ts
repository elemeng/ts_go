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

// 选择状态
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
const MAX_DB_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

let db: IDBDatabase | null = null;

// ==================== 辅助函数 ====================

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

// ==================== PNG 缓存操作 ====================

// 获取 PNG
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
		// 更新访问时间
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

			request.onsuccess = () => {
				if (request.result) {
					const data = request.result as Blob;
					// 存入内存缓存
					putPngToMemory(key, data);
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
function putPngToMemory(key: string, data: Blob): void {
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
}

// 存入 IndexedDB
export async function putPng(
	tsId: string,
	zIndex: number,
	data: Blob,
	bin = 8,
	quality = 90
): Promise<void> {
	const key = cacheKey(tsId, zIndex, bin, quality);

	// 存入内存
	putPngToMemory(key, data);

	// 存入 IndexedDB
	try {
		const database = await initDB();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.put(data, key);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to cache PNG:', e);
	}
}

// 清除缓存
export async function clearCache(): Promise<void> {
	// 清除内存缓存
	memoryCache.clear();
	currentCacheSize.set(0);

	// 清除 IndexedDB
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

// 清除特定 tilt series 的缓存
export async function clearCacheForTs(tsId: string): Promise<void> {
	// 清除内存缓存中该 TS 的所有帧
	const keysToDelete: string[] = [];
	for (const key of memoryCache.keys()) {
		if (key.startsWith(tsId + '_')) {
			const item = memoryCache.get(key);
			if (item) {
				currentCacheSize.update((n) => n - item.size);
			}
			keysToDelete.push(key);
		}
	}
	keysToDelete.forEach((key) => memoryCache.delete(key));

	// 清除 IndexedDB 中该 TS 的所有帧
	try {
		const database = await initDB();
		const transaction = database.transaction([STORE_NAME], 'readwrite');
		const store = transaction.objectStore(STORE_NAME);

		// Get all keys and delete ones for this TS
		const getAllKeys = store.getAllKeys();
		getAllKeys.onsuccess = () => {
			const keys = getAllKeys.result as string[];
			keys.forEach((key) => {
				if (key.startsWith(tsId + '_')) {
					store.delete(key);
				}
			});
		};
	} catch (e) {
		console.error('Failed to clear cache for TS:', e);
	}
}

// ==================== 缓存管理功能 ====================

// 缓存所有 PNG：为所有 tilt series 的所有帧生成并缓存 PNG
export async function cacheAll(): Promise<{ success: number; failed: number; total: number }> {
	let success = 0;
	let failed = 0;
	let total = 0;

	// 获取所有 tilt series
	let allSeries: TiltSeries[] = [];
	const unsubscribe = tiltSeries.subscribe((series) => {
		allSeries = series;
	});
	unsubscribe();

	for (const ts of allSeries) {
		for (const frame of ts.frames) {
			total++;
			try {
				// 尝试获取 PNG，如果不存在则会从后端获取
				const png = await getPng(ts.id, frame.zIndex, 8, 90);
				if (!png) {
					// 如果缓存中没有，从后端获取
					const blob = await fetchPng(ts.id, frame.zIndex, 8, 90);
					await putPng(ts.id, frame.zIndex, blob, 8, 90);
				}
				success++;
			} catch (e) {
				console.error(`Failed to cache PNG for ${ts.id}/${frame.zIndex}:`, e);
				failed++;
			}
		}
	}

	return { success, failed, total };
}

// 刷新缓存：与后端同步，重新获取所有 PNG（用于外部工具重新生成 PNG 后同步）
export async function refreshCache(): Promise<{ success: number; failed: number; total: number }> {
	let success = 0;
	let failed = 0;
	let total = 0;

	// 获取所有 tilt series
	let allSeries: TiltSeries[] = [];
	const unsubscribe = tiltSeries.subscribe((series) => {
		allSeries = series;
	});
	unsubscribe();

	// 先清除缓存
	await clearCache();

	// 重新获取所有 PNG
	for (const ts of allSeries) {
		for (const frame of ts.frames) {
			total++;
			try {
				// 强制从后端获取新的 PNG
				const blob = await fetchPng(ts.id, frame.zIndex, 8, 90);
				await putPng(ts.id, frame.zIndex, blob, 8, 90);
				success++;
			} catch (e) {
				console.error(`Failed to refresh PNG for ${ts.id}/${frame.zIndex}:`, e);
				failed++;
			}
		}
	}

	return { success, failed, total };
}

// 删除所有缓存：清除所有 PNG 缓存
export async function deleteCache(): Promise<void> {
	await clearCache();
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

	// Fallback to store if selectionsState not provided
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

// ==================== API 调用 ====================

// 扫描项目
export async function scanProject(config: ScanConfig): Promise<TiltSeries[]> {
	const response = await fetch(`${API_BASE}/api/mdoc/scan`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(config)
	});

	if (!response.ok) throw new Error('Scan failed');

	const data = await response.json();
	tiltSeries.set(data.tiltSeries);
	return data.tiltSeries;
}

// 获取 PNG 预览
export async function fetchPng(tsId: string, zIndex: number, bin = 8, quality = 90): Promise<Blob> {
	const response = await fetch(
		`${API_BASE}/api/preview/${tsId}/${zIndex}?bin=${bin}&quality=${quality}`
	);

	if (!response.ok) throw new Error('Failed to fetch PNG');

	const blob = await response.blob();
	await putPng(tsId, zIndex, blob, bin, quality);
	return blob;
}

// 批量保存
export async function batchSave(
	mdocPath: string,
	selectionsMap: Map<number, boolean>
): Promise<TiltSeries | null> {
	const response = await fetch(`${API_BASE}/api/mdoc/batch-save`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			mdocPath,
			selections: Object.fromEntries(selectionsMap)
		})
	});

	if (!response.ok) throw new Error('Save failed');

	const data = await response.json();

	// Only clear selections AFTER successful save
	if (data.success) {
		// Clear PNG cache for this tilt series
		await clearCacheForTs(mdocPath);
		// Clear memory state
		clearTsSelections(mdocPath);
	}

	// 返回更新后的 tiltSeries 数据
	return data.updatedTiltSeries || null;
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
