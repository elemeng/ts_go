<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	interface FileEntry {
		name: string;
		type: 'dir' | 'file';
		hidden: boolean;
	}

	interface Props {
		initialPath?: string;
		onselect?: (event: CustomEvent) => void;
		oncancel?: () => void;
		mode?: 'directory' | 'file';
	}

	let { initialPath, onselect, oncancel, mode = 'directory' }: Props = $props();

	const dispatch = createEventDispatcher();

	let selectedEntry = $state<FileEntry | null>(null);

	// 获取用户 home 目录
	let getDefaultPath = () => {
		if (initialPath) return initialPath;
		return '/home/meng';
	};

	let currentPath = $state(getDefaultPath());
	let entries = $state<FileEntry[]>([]);
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let showHidden = $state(false);
	let showDirectories = $state(true);
	let showFiles = $state(true);
	let searchTerm = $state('');
	let sortBy = $state<'name' | 'type'>('name');
	let sortOrder = $state<'asc' | 'desc'>('asc');

	async function loadDirectory(path: string) {
		isLoading = true;
		error = null;

		try {
			const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
			const response = await fetch(`${apiBase}/api/files/list?path=${encodeURIComponent(path)}`);
			if (!response.ok) {
				throw new Error(`Failed to load directory: ${response.statusText}`);
			}
			const data = await response.json();
			console.log('FileBrowser: API response', data);
			console.log('FileBrowser: data.entries', data.entries);
			entries = (data.entries || []).map((entry: { name: string; type: 'dir' | 'file' }) => ({
				...entry,
				hidden: entry.name.startsWith('.')
			}));
			console.log('FileBrowser: Processed entries', entries.length, entries);
			currentPath = path;
		} catch (e) {
			console.error('FileBrowser: Error loading directory', e);
			error = e instanceof Error ? e.message : 'Failed to load directory';
			entries = [];
		} finally {
			isLoading = false;
		}
	}

	// 面包屑导航
	let breadcrumbs = $derived(currentPath === '/' ? [] : currentPath.split('/').filter(Boolean));

	let isRoot = $derived(currentPath === '/' || currentPath === '');

	// 过滤和排序
	let filteredEntries = $derived.by(() => {
		console.log('FileBrowser: Filtering - entries.length:', entries.length);
		console.log(
			'FileBrowser: Filtering - showHidden:',
			showHidden,
			'showDirectories:',
			showDirectories,
			'showFiles:',
			showFiles,
			'searchTerm:',
			searchTerm
		);

		let result = entries.filter((entry) => {
			// 检查是否显示隐藏文件
			if (!showHidden && entry.hidden) return false;
			// 检查是否显示目录
			if (entry.type === 'dir' && !showDirectories) return false;
			// 检查是否显示文件
			if (entry.type === 'file' && !showFiles) return false;
			// 搜索过滤
			if (searchTerm && !entry.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
			return true;
		});

		console.log('FileBrowser: Filtered result.length:', result.length);

		// 排序
		result.sort((a, b) => {
			// 目录优先
			if (a.type === 'dir' && b.type === 'file') return -1;
			if (a.type === 'file' && b.type === 'dir') return 1;

			let comparison = 0;
			if (sortBy === 'name') {
				comparison = a.name.localeCompare(b.name);
			}
			return sortOrder === 'asc' ? comparison : -comparison;
		});

		return result;
	});

	function navigateTo(name: string) {
		const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
		loadDirectory(newPath);
	}

	function navigateUp() {
		const parts = currentPath.split('/').filter(Boolean);
		if (parts.length > 0) {
			parts.pop();
			const newPath = parts.length === 0 ? '/' : `/${parts.join('/')}`;
			loadDirectory(newPath);
		}
	}

	function navigateToBreadcrumb(index: number) {
		if (index === -1) {
			loadDirectory('/');
		} else {
			const path = '/' + breadcrumbs.slice(0, index + 1).join('/');
			loadDirectory(path);
		}
	}

	function selectPath() {
		const pathToSelect =
			mode === 'file' && selectedEntry
				? currentPath === '/'
					? `/${selectedEntry.name}`
					: `${currentPath}/${selectedEntry.name}`
				: currentPath;

		if (onselect) {
			onselect(new CustomEvent('select', { detail: { path: pathToSelect } }));
		} else {
			dispatch('select', { path: pathToSelect });
		}
	}

	function selectFile(entry: FileEntry) {
		if (mode === 'file' && entry.type === 'file') {
			selectedEntry = entry;
		}
	}

	function cancel() {
		if (oncancel) {
			oncancel();
		} else {
			dispatch('cancel');
		}
	}

	// 初始加载 - 只在组件挂载时执行一次
	let hasLoaded = $state(false);
	$effect(() => {
		if (!hasLoaded) {
			loadDirectory(getDefaultPath());
			hasLoaded = true;
		}
	});
</script>

<div class="modal-box max-w-4xl p-0">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-base-300 p-4">
		<h3 class="text-lg font-bold">{mode === 'file' ? '📄 Select File' : '📁 Select Directory'}</h3>
		<button class="btn btn-circle btn-ghost btn-sm" onclick={cancel} aria-label="Close"> ✕ </button>
	</div>

	<!-- Content -->
	<div class="p-4">
		{#if error}
			<div role="alert" class="mb-4 alert alert-error">
				<span>{error}</span>
			</div>
		{/if}

		<!-- Path Navigation -->
		<div class="mb-4 flex flex-col gap-3">
			<!-- Search -->
			<div class="flex items-center gap-2">
				<label class="input-bordered input input-sm flex flex-1 items-center gap-2">
					<span>🔍</span>
					<input type="text" class="grow" placeholder="Search files..." bind:value={searchTerm} />
				</label>
				<button
					class="btn btn-sm {showHidden ? 'btn-primary' : 'btn-outline'}"
					onclick={() => (showHidden = !showHidden)}
				>
					{showHidden ? '👁️' : '👁️‍🗨️'}
				</button>
			</div>

			<!-- Filter Controls -->
			<div class="flex gap-2">
				<button
					class="btn btn-sm {showDirectories ? 'btn-primary' : 'btn-outline'}"
					onclick={() => (showDirectories = !showDirectories)}
				>
					{showDirectories ? '📂 Show Directories' : '📂 Hide Directories'}
				</button>
				<button
					class="btn btn-sm {showFiles ? 'btn-primary' : 'btn-outline'}"
					onclick={() => (showFiles = !showFiles)}
				>
					{showFiles ? '📄 Show Files' : '📄 Hide Files'}
				</button>
			</div>
		</div>

		<!-- Path Info & Navigation -->
		<div class="mb-2 flex items-center justify-between text-xs text-base-content/70">
			<span>Current: {currentPath || 'Root'}</span>
			<div class="join">
				{#if !isRoot}
					<button class="btn join-item btn-ghost btn-sm" onclick={navigateUp}> ⬆️ </button>
				{/if}
				<button class="btn join-item btn-ghost btn-sm" onclick={() => loadDirectory('/')}>
					🏠
				</button>
			</div>
		</div>

		<!-- Breadcrumbs -->
		<div class="breadcrumbs mb-4 text-sm">
			<ul>
				<li>
					<button class="btn btn-ghost btn-xs" onclick={() => navigateToBreadcrumb(-1)}>
						🏠
					</button>
				</li>
				{#each breadcrumbs as crumb, i}
					<li>
						<button
							class="btn btn-ghost btn-xs"
							class:btn-active={i === breadcrumbs.length - 1}
							onclick={() => navigateToBreadcrumb(i)}
						>
							{crumb}
						</button>
					</li>
				{/each}
			</ul>
		</div>

		<!-- File Table -->
		<div
			class="overflow-x-auto rounded-lg bg-base-200/30"
			style="max-height: 400px; overflow-y: auto;"
		>
			<table class="table table-sm">
				<thead>
					<tr>
						<th class="w-12">Type</th>
						<th>
							<button
								class="btn btn-ghost btn-xs"
								onclick={() => {
									sortBy = 'name';
									sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
								}}
							>
								Name
								{#if sortBy === 'name'}
									{sortOrder === 'asc' ? '↑' : '↓'}
								{/if}
							</button>
						</th>
					</tr>
				</thead>
				<tbody>
					{#if isLoading}
						<tr>
							<td colspan="2" class="py-8 text-center">
								<span class="loading loading-spinner"></span>
								Loading...
							</td>
						</tr>
					{:else if filteredEntries.length === 0}
						<tr>
							<td colspan="2" class="py-8 text-center text-base-content/50">
								{searchTerm ? `No files match "${searchTerm}"` : 'Directory is empty'}
							</td>
						</tr>
					{:else}
						{#each filteredEntries as entry (entry.name)}
							<tr
								class="cursor-pointer hover:bg-base-200 {selectedEntry?.name === entry.name &&
								mode === 'file'
									? 'bg-primary/20'
									: ''}"
								onclick={() => {
									if (entry.type === 'dir') {
										navigateTo(entry.name);
									} else if (mode === 'file') {
										selectFile(entry);
									}
								}}
							>
								<td>
									{#if entry.type === 'dir'}
										<span class="text-xl">📁</span>
									{:else}
										<span class="text-xl">📄</span>
									{/if}
								</td>
								<td class="font-mono">{entry.name}</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>

		<!-- Action Buttons -->
		<div class="modal-action">
			<button class="btn" onclick={cancel}>Cancel</button>
			<button
				class="btn btn-primary"
				disabled={mode === 'file' && !selectedEntry}
				onclick={selectPath}
			>
				{mode === 'file' ? 'Select File' : 'Select This Directory'}
			</button>
		</div>
	</div>
</div>
