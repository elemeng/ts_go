<script lang="ts">
	import type { SelectionState } from '$lib/types';
	import {
		tiltSeries,
		stats,
		unsavedTs,
		currentCacheSize,
		indexedDbCacheSize,
		selections,
		getFrameSelection,
		setFrameSelection,
		setBatchSelection,
		clearTsSelections,
		batchSave,
		clearCache,
		getPng,
		putPng,
		cacheWarning,
		scanProject,
		loadPersistedTiltSeries,
		userHome,
		fetchUserHome,
		cacheAll,
		refreshCache,
		deleteCache
	} from '$lib/store';
	import { toastStore } from '$lib/stores/toastStore';
	import type { TiltSeries, Frame } from '$lib/types';
	import FileBrowser from './FileBrowser.svelte';

	let expandedTs = $state(new Set<string>());
	let visibleFrames = $state(new Set<string>());
	let loadedPngFrames = $state(new Set<string>()); // Track frames with loaded real PNGs
	let isSavingAll = $state(false);
	let saveAllError = $state<string | null>(null);
	let unsavedTsList = $state<TiltSeries[]>([]);
	let cacheWarningState = $state({
		memoryExceeded: false,
		indexedDbExceeded: false,
		evictionNeeded: false
	});
	let selectedTsIds = $state(new Set<string>()); // For batch operations
	let selectionsStore = $state<SelectionState>(new Map());
	let thumbSize = $state(128); // 缩略图宽度（像素）

	// Cache management state
	let isCachingAll = $state(false);
	let isRefreshingCache = $state(false);
	let isDeletingCache = $state(false);

	// Cache progress state
	let cacheProgress = $state({
		cached: 0,
		total: 0,
		currentTs: '',
		currentFrame: 0
	});

	// Scan Project state
	// API 基础 URL - from .env file
	const API_BASE = import.meta.env.VITE_API_BASE;

	let isScanning = $state(false);
	let scanError = $state<string | null>(null);
	let showScanDialog = $state(false);
	let showFileBrowser = $state(false);
	let fileBrowserTarget = $state<'mdoc' | 'image' | 'png' | 'config'>('mdoc');
	let saveLoadMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);

	// 扫描配置
	let scanConfig = $state({
		mdoc_dir: '',
		image_dir: '',
		png_dir: '',
		mdoc_prefix_cut: 0,
		mdoc_suffix_cut: 0,
		image_prefix_cut: 0,
		image_suffix_cut: 0
	});

	// Initialize scanConfig with userHome when available
	$effect(() => {
		if ($userHome && !scanConfig.mdoc_dir) {
			scanConfig.mdoc_dir = $userHome;
			scanConfig.image_dir = $userHome;
			scanConfig.png_dir = $userHome;
		}
	});

	// Config directory for storing saved configurations
	let configDir = $derived(`${$userHome}/.ts_sv`);

	// 从 localStorage 加载 thumbSize
	function loadThumbSize() {
		if (typeof localStorage === 'undefined') return;
		const saved = localStorage.getItem('gallery_thumbSize');
		if (saved) {
			try {
				thumbSize = parseInt(saved, 10);
			} catch (e) {
				console.error('Failed to load thumbSize:', e);
			}
		}
	}

	// 保存 thumbSize 到 localStorage
	function saveThumbSize() {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem('gallery_thumbSize', thumbSize.toString());
	}

	// 从 localStorage 加载 expandedTs
	function loadExpandedTs() {
		if (typeof localStorage === 'undefined') return;
		const saved = localStorage.getItem('gallery_expandedTs');
		if (saved) {
			try {
				const parsed = JSON.parse(saved) as string[];
				hasPersistedExpanded = true;
				expandedTs = new Set(parsed);
			} catch (e) {
				console.error('Failed to load expandedTs:', e);
			}
		}
	}

	// 初始化时展开所有 TS
	function expandAllTs() {
		expandedTs = new Set($tiltSeries.map((ts) => ts.id));
		saveExpandedTs();
	}

	// 保存 expandedTs 到 localStorage
	function saveExpandedTs() {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem('gallery_expandedTs', JSON.stringify(Array.from(expandedTs)));
	}

	// 订阅 store 更新
	let initialized = false;
	let hasPersistedExpanded = false;

	$effect(() => {
		if (initialized) return;
		initialized = true;

		// Load persisted state first
		loadExpandedTs();
		loadThumbSize();
		fetchUserHome();
		loadPersistedTiltSeries();

		// Subscribe to stores (only for those not used via $ syntax in template)
		const unsubscribeUnsavedTs = unsavedTs.subscribe((list) => (unsavedTsList = list));
		const unsubscribeCacheWarning = cacheWarning.subscribe((w) => (cacheWarningState = w));
		const unsubscribeSelections = selections.subscribe((s) => (selectionsStore = s));

		return () => {
			unsubscribeUnsavedTs();
			unsubscribeCacheWarning();
			unsubscribeSelections();
		};
	});

	// 当 tiltSeriesList 加载时，展开所有 TS（仅当没有持久化状态时）
	$effect(() => {
		if ($tiltSeries.length > 0 && expandedTs.size === 0 && !hasPersistedExpanded) {
			expandAllTs();
		}
		// Select all TS by default
		if ($tiltSeries.length > 0 && selectedTsIds.size === 0) {
			selectedTsIds = new Set($tiltSeries.map((ts) => ts.id));
		}
	});

	// 展开/折叠 TS
	function toggleTs(tsId: string) {
		const newSet = new Set(expandedTs);
		if (newSet.has(tsId)) {
			newSet.delete(tsId);
		} else {
			newSet.add(tsId);
		}
		expandedTs = newSet;
		saveExpandedTs();
	}

	// 展开所有 TS
	function expandAll() {
		expandedTs = new Set($tiltSeries.map((ts) => ts.id));
		saveExpandedTs();
	}

	// 折叠所有 TS
	function collapseAll() {
		expandedTs = new Set();
		saveExpandedTs();
	}

	// Batch selection
	function toggleTsSelection(tsId: string) {
		const newSet = new Set(selectedTsIds);
		if (newSet.has(tsId)) {
			newSet.delete(tsId);
		} else {
			newSet.add(tsId);
		}
		selectedTsIds = newSet;
	}

	function selectAllTs(select: boolean) {
		if (select) {
			selectedTsIds = new Set($tiltSeries.map((ts) => ts.id));
		} else {
			selectedTsIds = new Set();
		}
	}

	function applyBatchFilter(preset: 'center' | 'edges' | 'alternate' | 'all' | 'none') {
		if (selectedTsIds.size === 0) {
			toastStore.warning('No tilt series selected', 'Select one or more TS first');
			return;
		}

		let appliedCount = 0;
		for (const ts of $tiltSeries) {
			if (selectedTsIds.has(ts.id)) {
				applyQuickFilter(ts, preset);
				appliedCount++;
			}
		}

		toastStore.success(`Applied ${preset} filter to ${appliedCount} tilt series`);
	}

	// 帧选择
	const isSelected = (ts: TiltSeries, frame: Frame): boolean => {
		return getFrameSelection(ts.mdocPath, frame.zIndex, frame.selected, selectionsStore);
	};

	function toggleFrame(ts: TiltSeries, frame: Frame) {
		const selected = isSelected(ts, frame);
		setFrameSelection(ts.mdocPath, frame.zIndex, !selected);
	}

	// 全选/反选
	function selectAll(ts: TiltSeries, select: boolean) {
		console.log('selectAll called for', ts.id, 'select:', select);
		const selectionsMap = new Map<number, boolean>();
		for (const frame of ts.frames) {
			selectionsMap.set(frame.zIndex, select);
		}
		setBatchSelection(ts.mdocPath, selectionsMap);
	}

	// 反选
	function invertSelection(ts: TiltSeries) {
		console.log('invertSelection called for', ts.id);
		const selectionsMap = new Map<number, boolean>();
		// Cache selections once to avoid repeated lookups
		const tsSelections = selectionsStore.get(ts.mdocPath);
		for (const frame of ts.frames) {
			const current = tsSelections?.get(frame.zIndex) ?? frame.selected;
			selectionsMap.set(frame.zIndex, !current);
		}
		setBatchSelection(ts.mdocPath, selectionsMap);
	}

	// Quick filter presets
	function applyQuickFilter(
		ts: TiltSeries,
		preset: 'center' | 'edges' | 'alternate' | 'all' | 'none'
	) {
		const selectionsMap = new Map<number, boolean>();
		const totalFrames = ts.frames.length;

		switch (preset) {
			case 'center':
				// Keep center 60% of frames
				const startCenter = Math.floor(totalFrames * 0.2);
				const endCenter = Math.ceil(totalFrames * 0.8);
				for (const frame of ts.frames) {
					const keep = frame.zIndex >= startCenter && frame.zIndex <= endCenter;
					selectionsMap.set(frame.zIndex, keep);
				}
				break;
			case 'edges':
				// Keep first and last 20% of frames
				const edgeSize = Math.floor(totalFrames * 0.2);
				for (const frame of ts.frames) {
					const keep = frame.zIndex < edgeSize || frame.zIndex >= totalFrames - edgeSize;
					selectionsMap.set(frame.zIndex, keep);
				}
				break;
			case 'alternate':
				// Keep every other frame
				for (const frame of ts.frames) {
					const keep = frame.zIndex % 2 === 0;
					selectionsMap.set(frame.zIndex, keep);
				}
				break;
			case 'all':
				// Keep all frames
				for (const frame of ts.frames) {
					selectionsMap.set(frame.zIndex, true);
				}
				break;
			case 'none':
				// Drop all frames
				for (const frame of ts.frames) {
					selectionsMap.set(frame.zIndex, false);
				}
				break;
		}

		setBatchSelection(ts.mdocPath, selectionsMap);
		toastStore.success(`Applied ${preset} filter`, `${ts.id}`, 1500);
	}

	// 应用更改
	function applyChanges(ts: TiltSeries) {
		console.log('applyChanges called for', ts.id);
		const tsSelections = new Map<number, boolean>();
		// Send ALL selections, not just changes
		for (const frame of ts.frames) {
			const selected = isSelected(ts, frame);
			tsSelections.set(frame.zIndex, selected);
		}
		if (tsSelections.size > 0) {
			batchSave(ts.mdocPath, tsSelections);
		}
	}

	// 重置 TS
	function resetTs(ts: TiltSeries) {
		console.log('resetTs called for', ts.id);
		clearTsSelections(ts.mdocPath);
	}

	// 检查 TS 是否有未保存更改
	function hasUnsaved(ts: TiltSeries): boolean {
		return unsavedTsList.some((uts) => uts.id === ts.id);
	}

	// 获取选中数量
	function getSelectedCount(ts: TiltSeries): number {
		let count = 0;
		for (const frame of ts.frames) {
			if (isSelected(ts, frame)) {
				count++;
			}
		}
		return count;
	}

	// 检查帧是否可见
	function isFrameVisible(tsId: string, zIndex: number): boolean {
		return visibleFrames.has(`${tsId}_${zIndex}`);
	}

	// 设置帧可见
	function setFrameVisible(tsId: string, zIndex: number) {
		const newSet = new Set(visibleFrames);
		newSet.add(`${tsId}_${zIndex}`);
		visibleFrames = newSet;
	}

	// Clean up all state after save
	async function cleanupAfterSave() {
		// Clear localStorage
		if (typeof localStorage !== 'undefined') {
			localStorage.removeItem('ts_selections');
			localStorage.removeItem('ts_tiltSeries');
			localStorage.removeItem('gallery_expandedTs');
			localStorage.removeItem('gallery_thumbSize');
		}

		// Clear memory cache
		await clearCache();

		// Clear frontend state
		selections.set(new Map());
		expandedTs = new Set();
		visibleFrames = new Set();
		loadedPngFrames = new Set();
	}

	// Save All 功能
	async function handleSaveAll() {
		isSavingAll = true;
		saveAllError = null;

		try {
			if ($tiltSeries.length === 0) {
				toastStore.info('No tilt series loaded');
				return;
			}

			let savedCount = 0;
			let deletedCount = 0;
			const updatedTiltSeriesList: TiltSeries[] = [];
			const deletedTsIds: Set<string> = new Set();

			for (const ts of $tiltSeries) {
				const isSelectedTs = selectedTsIds.has(ts.id);

				if (isSelectedTs) {
					// TS is selected: save with frame selections
					const tsSelections = new Map<number, boolean>();
					for (const frame of ts.frames) {
						const selected = isSelected(ts, frame);
						tsSelections.set(frame.zIndex, selected);
					}
					if (tsSelections.size > 0) {
						try {
							const updatedTs = await batchSave(ts.mdocPath, tsSelections);
							if (updatedTs) {
								updatedTiltSeriesList.push(updatedTs);
							}
							savedCount++;
						} catch (e) {
							console.error(`Failed to save ${ts.mdocPath}:`, e);
							toastStore.error(
								`Failed to save ${ts.id}: ${e instanceof Error ? e.message : 'Unknown error'}`
							);
						}
					}
				} else {
					// TS is NOT selected: backup and delete original
					try {
						const response = await fetch(`${API_BASE}/api/mdoc/backup-delete`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ mdocPath: ts.mdocPath })
						});

						if (response.ok) {
							await response.json();
							deletedCount++;
							deletedTsIds.add(ts.id);
						} else {
							const error = await response.text();
							console.error(`Failed to backup-delete ${ts.mdocPath}: ${error}`);
							toastStore.error(`Failed to delete ${ts.id}: ${error}`);
						}
					} catch (e) {
						console.error(`Error processing ${ts.mdocPath}:`, e);
						toastStore.error(
							`Error processing ${ts.id}: ${e instanceof Error ? e.message : 'Unknown error'}`
						);
					}
				}
			}

			// Update tiltSeries store with updated data and remove deleted TS
			tiltSeries.update((current) => {
				const updated = current
					.filter((ts) => !deletedTsIds.has(ts.id))
					.map((ts) => {
						const updatedTs = updatedTiltSeriesList.find((uts) => uts.id === ts.id);
						return updatedTs || ts;
					});
				return updated;
			});

			toastStore.success(`Saved ${savedCount} tilt series, deleted ${deletedCount} mdocs`);

			// After successful save, discard localStorage and rescan with same project setup
			if (savedCount > 0 || deletedCount > 0) {
				toastStore.info('Refreshing project data...');

				// Clean up all state
				await cleanupAfterSave();

				// Reset selection to all TS
				selectedTsIds = new Set($tiltSeries.map((ts) => ts.id));

				// Rescan with same configuration
				if (scanConfig.mdoc_dir) {
					try {
						await handleScan();
						toastStore.success('Project refreshed successfully');
					} catch (scanError) {
						console.error('Failed to rescan:', scanError);
						toastStore.error('Failed to refresh project data');
					}
				}
			}
		} catch (e) {
			saveAllError = e instanceof Error ? e.message : 'Save failed';
			toastStore.error(`Save all failed: ${saveAllError}`);
		} finally {
			isSavingAll = false;
		}
	}

	// 加载 PNG action
	function loadFramePng(node: HTMLImageElement, params: { tsId: string; zIndex: number }) {
		let currentUrl: string | null = null;
		const frameKey = `${params.tsId}_${params.zIndex}`;

		// Set frame to unselected when using mock SVG (before real PNG loads)
		// Only do this if not already in selections store
		if (!selectionsStore.get(params.tsId)?.has(params.zIndex)) {
			setFrameSelection(params.tsId, params.zIndex, false);
		}

		(async () => {
			try {
				console.log(`[loadFramePng] Loading PNG for ${params.tsId}/${params.zIndex}`);

				// 先尝试从缓存获取
				const cached = await getPng(params.tsId, params.zIndex, 8, 90);
				if (cached) {
					console.log(`[loadFramePng] Cache hit for ${params.tsId}/${params.zIndex}`);
					const url = URL.createObjectURL(cached);
					currentUrl = url;
					node.src = url;
					// Mark as loaded
					loadedPngFrames = new Set(loadedPngFrames).add(frameKey);
					return;
				}

				console.log(`[loadFramePng] Cache miss for ${params.tsId}/${params.zIndex}, fetching from backend`);

				// 从后端加载
				const response = await fetch(
					`${API_BASE}/api/preview/${params.tsId}/${params.zIndex}?bin=8&quality=90`
				);

				console.log(`[loadFramePng] Backend response status: ${response.status}`);

				if (response.ok) {
					const blob = await response.blob();
					console.log(`[loadFramePng] Received blob size: ${blob.size} bytes for ${params.tsId}/${params.zIndex}`);

					// 缓存到存储
					await putPng(params.tsId, params.zIndex, blob, 8, 90);
					const url = URL.createObjectURL(blob);
					currentUrl = url;
					node.src = url;
					// Mark as loaded
					loadedPngFrames = new Set(loadedPngFrames).add(frameKey);
					console.log(`[loadFramePng] Successfully loaded PNG for ${params.tsId}/${params.zIndex}`);
				} else {
					const errorText = await response.text();
					console.error(`[loadFramePng] Backend error ${response.status}: ${errorText} for ${params.tsId}/${params.zIndex}`);
					toastStore.warning(`Failed to load PNG: ${response.status}`, `${params.tsId}/${params.zIndex}`);
				}
			} catch (e) {
				console.error(`[loadFramePng] Exception loading PNG for ${params.tsId}/${params.zIndex}:`, e);
				toastStore.error(`Failed to load PNG`, `${params.tsId}/${params.zIndex}: ${e instanceof Error ? e.message : 'Unknown error'}`);
			}
		})();

		return {
			destroy() {
				if (currentUrl) {
					URL.revokeObjectURL(currentUrl);
					currentUrl = null;
				}
			}
		};
	}

	// Scan Project functions
	// Note: fetchUserHome is now imported from store.ts

	async function handleScan() {
		console.log('handleScan called with config:', $state.snapshot(scanConfig));
		isScanning = true;
		scanError = null;

		try {
			await scanProject(scanConfig);
			showScanDialog = false;
		} catch (e) {
			console.error('Scan error:', e);
			scanError = e instanceof Error ? e.message : 'Scan failed';
		} finally {
			isScanning = false;
		}
	}

	function openFileBrowser(target: 'mdoc' | 'image' | 'png') {
		fileBrowserTarget = target;
		showFileBrowser = true;
	}

	function handleFileBrowserSelect(event: CustomEvent) {
		const { path } = event.detail;
		if (fileBrowserTarget === 'mdoc') {
			scanConfig.mdoc_dir = path;
		} else if (fileBrowserTarget === 'image') {
			scanConfig.image_dir = path;
		} else if (fileBrowserTarget === 'png') {
			scanConfig.png_dir = path;
		} else if (fileBrowserTarget === 'config') {
			loadConfigFromFile(path);
			return;
		}
		showFileBrowser = false;
	}

	function handleFileBrowserCancel() {
		showFileBrowser = false;
	}

	async function saveConfig() {
		try {
			console.log('Saving config:', scanConfig);
			const response = await fetch(`${API_BASE}/api/files/save-config`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(scanConfig)
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Failed to save configuration: ${response.status} ${errorText}`);
			}

			const result = await response.json();
			saveLoadMessage = { type: 'success', text: `Configuration saved: ${result.path}` };
			setTimeout(() => (saveLoadMessage = null), 3000);
		} catch (e) {
			saveLoadMessage = {
				type: 'error',
				text: `Failed to save configuration: ${e instanceof Error ? e.message : 'Unknown error'}`
			};
			setTimeout(() => (saveLoadMessage = null), 3000);
		}
	}

	function openConfigFileBrowser() {
		fileBrowserTarget = 'config';
		showFileBrowser = true;
	}

	async function loadConfigFromFile(filepath: string) {
		try {
			const filename = filepath.split('/').pop() || filepath;
			console.log('Loading config from file:', filename);

			const response = await fetch(`${API_BASE}/api/files/load-config?filename=${filename}`);
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Failed to load configuration: ${response.status} ${errorText}`);
			}

			const loadedConfig = await response.json();
			console.log('Loaded config:', loadedConfig);

			// Update scanConfig with loaded values
			scanConfig = {
				mdoc_dir: loadedConfig.mdoc_dir || $userHome,
				image_dir: loadedConfig.image_dir || $userHome,
				png_dir: loadedConfig.png_dir || $userHome,
				mdoc_prefix_cut: loadedConfig.mdoc_prefix_cut ?? 0,
				mdoc_suffix_cut: loadedConfig.mdoc_suffix_cut ?? 0,
				image_prefix_cut: loadedConfig.image_prefix_cut ?? 0,
				image_suffix_cut: loadedConfig.image_suffix_cut ?? 0
			};

			saveLoadMessage = { type: 'success', text: `Configuration loaded: ${filename}` };
			showFileBrowser = false;
			setTimeout(() => (saveLoadMessage = null), 3000);
		} catch (e) {
			saveLoadMessage = {
				type: 'error',
				text: `Failed to load configuration: ${e instanceof Error ? e.message : 'Unknown error'}`
			};
			setTimeout(() => (saveLoadMessage = null), 3000);
		}
	}

	// Cache management handlers
	async function handleCacheAll() {
		if ($tiltSeries.length === 0) {
			toastStore.warning('No tilt series loaded', 'Scan a project first');
			return;
		}

		isCachingAll = true;
		cacheProgress = { cached: 0, total: 0, currentTs: '', currentFrame: 0 };

		try {
			const result = await cacheAll((progress) => {
				// 更新进度状态
				cacheProgress = progress;
			});
			toastStore.success(
				`Cache complete: ${result.success}/${result.total} PNGs cached`,
				`${result.failed} failed`
			);
		} catch (e) {
			toastStore.error(`Cache failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
		} finally {
			isCachingAll = false;
			cacheProgress = { cached: 0, total: 0, currentTs: '', currentFrame: 0 };
		}
	}

	async function handleRefreshCache() {
		if ($tiltSeries.length === 0) {
			toastStore.warning('No tilt series loaded', 'Scan a project first');
			return;
		}

		isRefreshingCache = true;
		try {
			const result = await refreshCache();
			toastStore.success(
				`Cache refreshed: ${result.success}/${result.total} PNGs synced`,
				`${result.failed} failed`
			);
		} catch (e) {
			toastStore.error(`Refresh failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
		} finally {
			isRefreshingCache = false;
		}
	}

	async function handleDeleteCache() {
		isDeletingCache = true;
		try {
			await deleteCache();
			toastStore.success('All cached PNGs deleted');
		} catch (e) {
			toastStore.error(`Delete failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
		} finally {
			isDeletingCache = false;
		}
	}

	// Intersection Observer for lazy loading
	function intersectionObserver(node: HTMLDivElement, params: { tsId: string; zIndex: number }) {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						// 标记帧为可见，触发重新渲染
						setFrameVisible(params.tsId, params.zIndex);
						observer.unobserve(node);
					}
				});
			},
			{ rootMargin: '50px' }
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			}
		};
	}
</script>

<!-- Full-width background wrapper -->
<div class="bg-base-100 shadow-lg">
	<!-- Navbar -->
	<div class="navbar rounded-t-box">
		<!-- Full-width content with responsive padding -->
		<div class="flex w-full flex-wrap items-center gap-2 px-2 sm:px-3 md:px-4">
			<!-- ================= Left / Primary actions ================= -->
			<div class="navbar-start flex items-center gap-3">
				<h1 class="text-lg font-bold md:text-xl">CryoET Gallery</h1>

				<button class="btn btn-sm btn-primary" onclick={() => (showScanDialog = true)}>
					📂 Scan Project
				</button>

				<div class="join hidden sm:inline-flex">
					<button class="btn join-item btn-sm" title="Filter tilt series">🔍</button>
					<button class="btn join-item btn-sm" title="Sort tilt series">↕</button>
				</div>
			</div>

			<!-- ================= Center / TS operations ================= -->
			<div class="navbar-center flex flex-wrap items-center gap-2">
				<div class="join">
					<button
						class="btn join-item btn-sm"
						onclick={() => expandAll()}
						title="Expand all tilt series"
					>
						▼ Expand
					</button>
					<button
						class="btn join-item btn-sm"
						onclick={() => collapseAll()}
						title="Collapse all tilt series"
					>
						▶ Collapse
					</button>
				</div>

				<div class="join">
					<button
						class="btn join-item btn-sm"
						onclick={() => selectAllTs(true)}
						title="Select all tilt series"
					>
						☑ All
					</button>
					<button
						class="btn join-item btn-sm"
						onclick={() => selectAllTs(false)}
						title="Clear selection"
					>
						☐ Clear
					</button>
					<button
						class="btn join-item btn-sm"
						onclick={() => $tiltSeries.forEach((ts) => invertSelection(ts))}
						title="Invert selection"
					>
						↻ Invert
					</button>
				</div>
			</div>

			<!-- ================= Right / Status & save ================= -->
			<div class="navbar-end flex items-center gap-2">
				<div class="badge badge-neutral">
					📁 {$stats.totalSeries} TS
				</div>
				<div
					class="badge whitespace-nowrap
						{cacheWarningState.evictionNeeded ? 'badge-warning' : 'badge-accent'}"
					title="PNG cache usage"
				>
					⚡ {Math.round($currentCacheSize / 1024 / 1024)} MB
					{#if $indexedDbCacheSize > 0}
						/ {Math.round($indexedDbCacheSize / 1024 / 1024)} MB
					{/if}
					{#if cacheWarningState.evictionNeeded}
						&nbsp;⚠ LRU
					{/if}
				</div>

				<!-- Cache management dropdown -->
				<div class="dropdown dropdown-end">
					<div tabindex="0" role="button" class="btn btn-ghost btn-sm" title="Cache management">
						💾 Cache
					</div>
					<ul class="dropdown-content menu z-[1] w-52 rounded-box bg-base-100 p-2 shadow-lg">
						<li>
							<button onclick={handleCacheAll} disabled={isCachingAll} class="flex justify-between">
								<span>📦 Cache All</span>
								{#if isCachingAll}
									<span class="loading loading-xs loading-spinner"></span>
								{/if}
							</button>
						</li>
						<li>
							<button
								onclick={handleRefreshCache}
								disabled={isRefreshingCache}
								class="flex justify-between"
							>
								<span>🔄 Refresh Cache</span>
								{#if isRefreshingCache}
									<span class="loading loading-xs loading-spinner"></span>
								{/if}
							</button>
						</li>
						<li>
							<button
								onclick={handleDeleteCache}
								disabled={isDeletingCache}
								class="flex justify-between"
							>
								<span>🗑 Delete Cache</span>
								{#if isDeletingCache}
									<span class="loading loading-xs loading-spinner"></span>
								{/if}
							</button>
						</li>
					</ul>
				</div>

				<button class="btn btn-sm btn-primary" onclick={handleSaveAll} disabled={isSavingAll}>
					{#if isSavingAll}
						<span class="loading loading-xs loading-spinner"></span>
						Saving…
					{:else}
						💾 Save All
					{/if}
				</button>
			</div>
		</div>
	</div>

	<!-- Content wrapper with padding -->
	<div class="w-full px-2 sm:px-3 md:px-4">
		<!-- 批量操作工具栏 -->
		{#if selectedTsIds.size > 0}
			<div class="mb-4 flex items-center gap-2">
				<span class="text-sm font-medium">{selectedTsIds.size} TS selected</span>
				<div class="join">
					<button
						class="btn join-item btn-sm"
						onclick={() => applyBatchFilter('all')}
						title="Select all frames in selected TS">☑ All</button
					>
					<button
						class="btn join-item btn-sm"
						onclick={() => applyBatchFilter('none')}
						title="Deselect all frames in selected TS">☐ None</button
					>
					<button
						class="btn join-item btn-sm"
						onclick={() =>
							$tiltSeries
								.filter((ts) => selectedTsIds.has(ts.id))
								.forEach((ts) => invertSelection(ts))}
						title="Invert frame selection in selected TS">↻ Invert Frames</button
					>
				</div>
			</div>
		{/if}

		<!-- 缓存进度指示器 -->
		{#if isCachingAll && cacheProgress.total > 0}
			<div class="mb-4 alert alert-info">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					class="h-6 w-6 shrink-0 stroke-current"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					></path>
				</svg>
				<div class="flex-1">
					<h3 class="font-bold">Caching PNGs...</h3>
					<div class="text-xs">
						{cacheProgress.cached} / {cacheProgress.total} cached
						{#if cacheProgress.currentTs}
							- Current: {cacheProgress.currentTs} frame {cacheProgress.currentFrame}
						{/if}
					</div>
					<progress
						class="progress progress-primary w-full"
						value={cacheProgress.cached}
						max={cacheProgress.total}
					></progress>
				</div>
				<span class="loading loading-xs loading-spinner"></span>
			</div>
		{/if}

		<!-- Tilt Series 列表 -->
		<div class="space-y-4">
			{#each $tiltSeries as ts (ts.id)}
				<div class="card bg-base-100 shadow-md">
					<!-- TS Header -->
					<div class="card-body p-4">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-4">
								<input
									type="checkbox"
									class="checkbox checkbox-sm"
									checked={selectedTsIds.has(ts.id)}
									onclick={() => toggleTsSelection(ts.id)}
									title="Select for batch operations"
								/>
								<button class="btn btn-ghost btn-sm" onclick={() => toggleTs(ts.id)}>
									{expandedTs.has(ts.id) ? '▼' : '▶'}
								</button>
								<div>
									<h2 class="card-title text-lg">{ts.id}</h2>
									<div class="text-sm opacity-70">
										{ts.frames.length} frames | {ts.angleRange[0]}° → {ts.angleRange[1]}°
									</div>
								</div>
							</div>
							<div>&nbsp &nbsp</div>
							<div class="flex items-center gap-2">
								{#if hasUnsaved(ts)}
									<span class="badge badge-warning">● Unsaved</span>
								{/if}
								<div>&nbsp &nbsp</div>
								<div class="badge badge-outline">☑ {getSelectedCount(ts)} / {ts.frames.length}</div>
							</div>
						</div>

						<!-- TS 操作按钮 -->
						{#if expandedTs.has(ts.id)}
							<div class="mt-2 flex items-center justify-between gap-4">
								<div class="flex items-center gap-4">
									<span class="text-xs opacity-70">Width:</span>
									<input
										type="range"
										min="64"
										max="1024"
										step="8"
										bind:value={thumbSize}
										oninput={saveThumbSize}
										class="range w-32 range-primary range-xs"
										title="Adjust thumbnail width"
									/>
									<span class="text-xs opacity-70">{thumbSize}px</span>
								</div>
								<div class="join">
									<button
										class="btn join-item btn-xs"
										onclick={() => {
											console.log('All button clicked');
											selectAll(ts, true);
										}}
										title="Select all frames">☑ All</button
									>
									<button
										class="btn join-item btn-xs"
										onclick={() => {
											console.log('Invert button clicked');
											invertSelection(ts);
										}}
										title="Invert selection">↻ Invert</button
									>
									<button
										class="btn join-item btn-ghost btn-xs"
										onclick={() => {
											console.log('Reset button clicked');
											resetTs(ts);
										}}
										title="Reset to original">↺ Reset</button
									>
									<button
										class="btn join-item btn-xs btn-primary"
										onclick={() => {
											console.log('Apply button clicked');
											applyChanges(ts);
										}}
										title="Apply changes">✓ Apply</button
									>
								</div>
							</div>
						{/if}
					</div>

					<!-- Frames Grid -->
					{#if expandedTs.has(ts.id)}
						<div class="p-4 pt-0">
							<div
								class="grid gap-2"
								style="grid-template-columns: repeat(auto-fill, minmax({thumbSize}px, 1fr));"
							>
								{#each ts.frames as frame (frame.zIndex)}
									<div
										class="inline-flex cursor-pointer flex-col items-center"
										role="button"
										tabindex="0"
										onclick={() => toggleFrame(ts, frame)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												toggleFrame(ts, frame);
											}
										}}
									>
										<figure class="p-1" style="width: {thumbSize}px; height: {thumbSize}px;">
											{#if visibleFrames.has(`${ts.id}_${frame.zIndex}`)}
												<img
													src={`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23e5e7eb'/%3E%3Ctext x='50' y='50' text-anchor='middle' dominant-baseline='middle' font-size='12'%3E{frame.angle}°%3C/text%3E%3C/svg%3E`}
													alt={frame.angle.toFixed(1)}
													class="h-full w-full object-contain"
													use:loadFramePng={{ tsId: ts.id, zIndex: frame.zIndex }}
												/>
											{:else}
												<div
													class="flex h-full w-full items-center justify-center bg-base-300"
													use:intersectionObserver={{ tsId: ts.id, zIndex: frame.zIndex }}
												>
													<span class="loading loading-xs loading-spinner"></span>
												</div>
											{/if}
										</figure>
										<div class="flex items-center gap-2 px-2 py-1">
											<span class="text-xs font-medium">{frame.angle.toFixed(1)}°</span>
											<input
												type="checkbox"
												class="checkbox checkbox-xs"
												checked={isSelected(ts, frame)}
												onclick={(e) => e.stopPropagation()}
												onchange={() => toggleFrame(ts, frame)}
											/>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if $tiltSeries.length === 0}
			<div class="alert alert-info">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					class="h-6 w-6 shrink-0 stroke-current"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					></path>
				</svg>
				<span>No tilt series loaded. Configure and scan a project directory.</span>
			</div>
		{/if}
	</div>

	<!-- 扫描对话框 -->
	{#if showScanDialog}
		<div class="modal-open modal">
			<div class="modal-box">
				<div class="mb-4 flex items-center justify-between">
					<h3 class="text-lg font-bold">Scan Project</h3>
					<!-- Save/Load buttons -->
					<div class="flex gap-2">
						<button class="btn btn-outline btn-sm" onclick={saveConfig}>💾 Save Config</button>
						<button class="btn btn-outline btn-sm" onclick={openConfigFileBrowser}
							>📂 Load Config</button
						>
					</div>
				</div>

				{#if saveLoadMessage}
					<div
						class="mb-4 alert {saveLoadMessage.type === 'success'
							? 'alert-success'
							: 'alert-error'}"
					>
						<span>{saveLoadMessage.text}</span>
					</div>
				{/if}

				{#if scanError}
					<div class="mb-4 alert alert-error">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-6 w-6 shrink-0 stroke-current"
							fill="none"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span>{scanError}</span>
					</div>
				{/if}

				<div class="form-control mb-4 w-full">
					<label class="label" for="mdoc_dir">
						<span class="label-text">Mdoc Directory</span>
					</label>
					<div class="join w-full">
						<input
							id="mdoc_dir"
							type="text"
							class="input-bordered input join-item flex-1"
							bind:value={scanConfig.mdoc_dir}
						/>
						<button class="btn join-item btn-secondary" onclick={() => openFileBrowser('mdoc')}
							>📁</button
						>
					</div>
				</div>

				<div class="form-control mb-4 w-full">
					<label class="label" for="image_dir">
						<span class="label-text">Image Directory</span>
					</label>
					<div class="join w-full">
						<input
							id="image_dir"
							type="text"
							class="input-bordered input join-item flex-1"
							bind:value={scanConfig.image_dir}
						/>
						<button class="btn join-item btn-secondary" onclick={() => openFileBrowser('image')}
							>📁</button
						>
					</div>
				</div>

				<div class="form-control mb-4 w-full">
					<label class="label" for="png_dir">
						<span class="label-text">PNG Cache Directory</span>
					</label>
					<div class="join w-full">
						<input
							id="png_dir"
							type="text"
							class="input-bordered input join-item flex-1"
							bind:value={scanConfig.png_dir}
						/>
						<button class="btn join-item btn-secondary" onclick={() => openFileBrowser('png')}
							>📁</button
						>
					</div>
				</div>
				<!-- Cut 参数 -->
				<div class="divider">Filename Matching (Cut Parameters)</div>

				<div class="mb-4 grid grid-cols-2 gap-4">
					<div class="form-control">
						<label class="label" for="mdoc_prefix_cut">
							<span class="label-text">Mdoc Prefix Cut</span>
						</label>
						<input
							id="mdoc_prefix_cut"
							type="number"
							class="input-bordered input"
							bind:value={scanConfig.mdoc_prefix_cut}
							min="0"
						/>
					</div>
					<div class="form-control">
						<label class="label" for="mdoc_suffix_cut">
							<span class="label-text">Mdoc Suffix Cut</span>
						</label>
						<input
							id="mdoc_suffix_cut"
							type="number"
							class="input-bordered input"
							bind:value={scanConfig.mdoc_suffix_cut}
							min="0"
						/>
					</div>
					<div class="form-control">
						<label class="label" for="image_prefix_cut">
							<span class="label-text">Image Prefix Cut</span>
						</label>
						<input
							id="image_prefix_cut"
							type="number"
							class="input-bordered input"
							bind:value={scanConfig.image_prefix_cut}
							min="0"
						/>
					</div>
					<div class="form-control">
						<label class="label" for="image_suffix_cut">
							<span class="label-text">Image Suffix Cut</span>
						</label>
						<input
							id="image_suffix_cut"
							type="number"
							class="input-bordered input"
							bind:value={scanConfig.image_suffix_cut}
							min="0"
						/>
					</div>
				</div>

				<div class="modal-action">
					<button class="btn" onclick={() => (showScanDialog = false)}>Cancel</button>
					<button class="btn btn-primary" onclick={handleScan} disabled={isScanning}>
						{#if isScanning}
							<span class="loading loading-spinner"></span>
							Scanning...
						{:else}
							Scan
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- 文件浏览器对话框 -->
{#if showFileBrowser}
	<div class="modal-open modal">
		<FileBrowser
			initialPath={fileBrowserTarget === 'config'
				? configDir
				: fileBrowserTarget === 'mdoc'
					? scanConfig.mdoc_dir
					: fileBrowserTarget === 'image'
						? scanConfig.image_dir
						: scanConfig.png_dir}
			mode={fileBrowserTarget === 'config' ? 'file' : 'directory'}
			onselect={handleFileBrowserSelect}
			oncancel={handleFileBrowserCancel}
		/>
	</div>
{/if}
