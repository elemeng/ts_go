# Cache System Documentation

## Overview

This document describes the caching architecture for PNG images, MDOC files, and application state in the CryoET Gallery application.

## Table of Contents

1. [PNG Cache System](#png-cache-system)
2. [MDOC Cache System](#mdoc-cache-system)
3. [Status/State Management](#statusstate-management)
4. [Cache Coordination](#cache-coordination)
5. [Performance Considerations](#performance-considerations)
6. [API Reference](#api-reference)

---

## PNG Cache System

### Frontend Architecture (src/lib/store.ts)

#### Two-Tier Caching

The PNG cache uses a hierarchical two-tier design:

```
Request → Memory Cache → IndexedDB → Backend API
         (hit: update timestamp)
         (miss: check IndexedDB, promote to memory)
         (miss: fetch from backend, cache both)
```

#### 1. Memory Cache (LRU)

- **Maximum Size:** 2GB
- **Data Structure:** `Map<string, PngCacheItem>`
- **Cache Key Format:** `{tsId}_{zIndex}_bin{bin}_q{quality}`
- **Eviction Policy:** LRU when exceeding 90% capacity
- **Tracked Properties:**
  - `data`: Blob (PNG image data)
  - `size`: number (bytes)
  - `timestamp`: number (last access time)

**Key Functions:**

```typescript
// Get PNG with automatic promotion
async function getPng(tsId: string, zIndex: number, bin = 8, quality = 90): Promise<Blob | null>

// Store in memory with LRU eviction
function putPngToMemory(key: string, data: Blob): void

// Clear all memory cache
async function clearCache(): Promise<void>

// Clear specific tilt series
async function clearCacheForTs(tsId: string): Promise<void>
```

#### 2. IndexedDB Cache

- **Maximum Size:** 10GB
- **Database Name:** `TsSvCache`
- **Version:** 1
- **Store Name:** `pngs`
- **Persistence:** Survives browser restarts
- **Operations:** Async with Promise-based API

**Initialization:**

```typescript
async function initDB(): Promise<IDBDatabase>
```

**Key Functions:**

```typescript
// Store in both memory and IndexedDB
async function putPng(tsId: string, zIndex: number, data: Blob, bin = 8, quality = 90): Promise<void>

// Retrieve from IndexedDB and promote to memory
async function getPng(tsId: string, zIndex: number, bin = 8, quality = 90): Promise<Blob | null>
```

#### Cache Management Functions

```typescript
// Pre-cache all PNGs for offline use
async function cacheAll(): Promise<{ success: number; failed: number; total: number }>

// Force re-fetch from backend (sync after external changes)
async function refreshCache(): Promise<{ success: number; failed: number; total: number }>

// Delete all cached PNGs
async function deleteCache(): Promise<void>
```

#### Cache Monitoring

```typescript
// Writable stores for cache size
export const currentCacheSize = writable(0)  // Memory cache size in bytes
export const indexedDbCacheSize = writable(0)  // IndexedDB cache size in bytes

// Derived store for cache warnings
export const cacheWarning = derived(
  [currentCacheSize, indexedDbCacheSize],
  ([$currentCacheSize, $indexedDbCacheSize]) => ({
    memoryExceeded: $currentCacheSize > MAX_MEMORY_CACHE * 0.9,
    indexedDbExceeded: $indexedDbCacheSize > MAX_INDEXEDDB_CACHE * 0.9,
    evictionNeeded: $currentCacheSize > MAX_MEMORY_CACHE
  })
)
```

### Backend Architecture (backend/app/cache/lru.py)

#### LRU Cache

- **Maximum Size:** 2048MB (2GB)
- **Data Structure:** `OrderedDict`
- **Cache Key:** MD5 hash of `{tsId}_{frameId}_bin{bin}_q{quality}`
- **Eviction Policy:** Automatic when exceeding capacity
- **Instance:** Global singleton `png_cache`

**Key Functions:**

```python
def get(ts_id: str, frame_id: int, bin: int, quality: int) -> Optional[bytes]
def put(ts_id: str, frame_id: int, bin: int, quality: int, data: bytes)
def clear()
```

### Backend Disk Cache (backend/app/api/preview.py)

#### File System Cache

- **Path Pattern:** `{png_dir}/{ts_id}/bin{bin}/frame_{frame_id:04d}_q{quality}.png`
- **Checked After:** Memory cache check
- **Updated On:** PNG generation

**Cache Hierarchy:**

```
Request → Memory Cache → Disk Cache → PNG Generation
         (hit: update timestamp)
         (miss: check disk, update memory)
         (miss: generate, update both)
```

### Concurrent Task Deduplication

The backend prevents duplicate PNG generation:

```python
_inflight_tasks: dict[tuple[str, int, int, int], asyncio.Future] = {}
_inflight_lock: Lock
```

If multiple requests for the same PNG arrive simultaneously, they wait for the first request to complete.

---

## MDOC Cache System

### Backend State Management (backend/app/state/project_state.py)

#### Project State Class

```python
class ProjectState:
    config: Optional[ScanConfig]              # Scan configuration
    tilt_series: Dict[str, TiltSeries]        # id → TiltSeries
    frame_overrides: Dict[str, Dict[int, bool]]  # mdocPath → zIndex → selected
```

**Key Operations:**

```python
def set_config(config: ScanConfig)          # Reset state on new scan
def add_tilt_series(ts: TiltSeries)         # Store parsed tilt series
def get_tilt_series(ts_id: str) → Optional[TiltSeries]
def remove_tilt_series_by_mdoc_path(mdoc_path: str)
def set_frame_override(mdoc_path: str, overrides: Dict[int, bool])
def get_frame_override(mdoc_path: str, z_index: int, original: bool) → bool
def clear_overrides(mdoc_path: str)
def has_unsaved_changes(mdoc_path: str) → bool
```

**Global Instance:** `project_state` (singleton)

### Frontend Persistence (src/lib/store.ts)

#### TiltSeries Storage

- **localStorage Key:** `ts_tiltSeries`
- **Auto-save:** On changes (when data exists)
- **Load:** On app init via `loadPersistedTiltSeries()`
- **Clear:** After successful save

```typescript
export const tiltSeries = writable<TiltSeries[]>([])
```

#### Selection State

**Type Definition:**

```typescript
export type SelectionState = Map<mdocPath, Map<zIndex, boolean>>
```

- **localStorage Key:** `ts_selections`
- **Debounce:** 1 second to avoid excessive writes
- **Load:** On app init via `loadPersistedSelections()`
- **Clear:** After successful save

**Key Functions:**

```typescript
function getFrameSelection(mdocPath: string, zIndex: number, original: boolean, selectionsState?: Map) → boolean
function setFrameSelection(mdocPath: string, zIndex: number, selected: boolean): void
function setBatchSelection(mdocPath: string, selectionsMap: Map<number, boolean>): void
function clearTsSelections(mdocPath: string): void
function debouncePersist(): void  // Throttled localStorage writes
```

### MDOC File Operations

#### Parser (backend/app/mdoc/parser.py)

**Format:** SerialEM mdoc

**Sections:**
- `[TiltSeries]`: Header with ImageFile
- `[ZValue = X]`: Individual frame sections

**Extracted Fields:**
- `TiltAngle`: Frame angle
- `SubFramePath`: Image path (matched to actual files)
- `mrcPath`: Resolved image path via ImageMatcher

**Returns:** `TiltSeries` with parsed frames

#### Writer (backend/app/mdoc/writer.py)

**Operations:**
1. Create backup: `{mdocPath}.bak`
2. Remove unselected frames from file
3. Reassign ZValues sequentially for kept frames
4. Preserve header section
5. Return backup path

**Signature:**

```python
def write_mdoc_with_selections(
    mdoc_path: str,
    selections: Dict[int, bool],
    backup_path: str | None = None
) → str
```

### API Endpoints (backend/app/api/mdoc.py)

```python
POST /api/mdoc/scan           # Scan directory, parse all mdoc files
GET  /api/mdoc/list           # List all tilt series
GET  /api/mdoc/{ts_id}        # Get specific tilt series
POST /api/mdoc/batch-save     # Save selections, backup, re-parse
POST /api/mdoc/backup-delete  # Backup and delete mdoc file
```

---

## Status/State Management

### Frontend State Architecture

#### Svelte 5 Runes

**$state:** Reactive local state (17 instances in Gallery.svelte)

```typescript
// UI State
let expandedTs = $state(new Set<string>())          // Expanded tilt series
let visibleFrames = $state(new Set<string>())       // Lazy-loaded frames
let loadedPngFrames = $state(new Set<string>())     // Frames with real PNGs
let thumbSize = $state(128)                         // Thumbnail width

// Operation State
let isSavingAll = $state(false)                     // Save operation
let isCachingAll = $state(false)                    // Cache all operation
let isRefreshingCache = $state(false)               // Refresh cache operation
let isDeletingCache = $state(false)                 // Delete cache operation
let isScanning = $state(false)                      // Scan operation

// Error/Message State
let saveAllError = $state<string | null>(null)
let scanError = $state<string | null>(null)
let saveLoadMessage = $state<{type, text} | null>(null)

// Selection State
let selectedTsIds = $state(new Set<string>())       // Selected tilt series
let selectionsStore = $state<SelectionState>(new Map())
let unsavedTsList = $state<TiltSeries[]>([])

// Cache State
let cacheWarningState = $state({
  memoryExceeded: false,
  indexedDbExceeded: false,
  evictionNeeded: false
})

// Dialog State
let showScanDialog = $state(false)
let showFileBrowser = $state(false)
let fileBrowserTarget = $state<'mdoc' | 'image' | 'png' | 'config'>('mdoc')

// Configuration State
let scanConfig = $state({
  mdoc_dir: '',
  image_dir: '',
  png_dir: '',
  mdoc_prefix_cut: 0,
  mdoc_suffix_cut: 0,
  image_prefix_cut: 0,
  image_suffix_cut: 0
})
```

**$derived:** Computed values

```typescript
let configDir = $derived(`${$userHome}/.ts_sv`)
```

**$effect:** Side effects (3 instances)

```typescript
$effect(() => {
  // Initialize scanConfig with userHome when available
})

$effect(() => {
  // Subscribe to stores and manage cleanup
})

$effect(() => {
  // Expand all TS when loaded (if no persisted state)
})
```

#### Svelte Stores (src/lib/store.ts)

**Writable Stores:**

```typescript
export const userHome = writable<string>('')                    // User home directory
export const tiltSeries = writable<TiltSeries[]>([])            // All tilt series
export const selections = writable<SelectionState>(new Map())   // Frame selections
export const currentCacheSize = writable(0)                     // Memory cache size
export const indexedDbCacheSize = writable(0)                   // IndexedDB cache size
```

**Derived Stores:**

```typescript
export const selectionsStore = derived(selections, ($selections) => $selections)

export const cacheWarning = derived(
  [currentCacheSize, indexedDbCacheSize],
  ([$currentCacheSize, $indexedDbCacheSize]) => ({
    memoryExceeded: $currentCacheSize > MAX_MEMORY_CACHE * 0.9,
    indexedDbExceeded: $indexedDbCacheSize > MAX_INDEXEDDB_CACHE * 0.9,
    evictionNeeded: $currentCacheSize > MAX_MEMORY_CACHE
  })
)

export const unsavedTs = derived([tiltSeries, selections], ([$tiltSeries, $selections]) => {
  return $tiltSeries.filter((ts) => {
    const tsSelections = $selections.get(ts.mdocPath)
    return tsSelections && tsSelections.size > 0
  })
})

export const stats = derived([tiltSeries, selections], ([$tiltSeries, $selections]) => {
  let totalFrames = 0
  let selectedFrames = 0
  for (const ts of $tiltSeries) {
    for (const frame of ts.frames) {
      totalFrames++
      if (getFrameSelection(ts.mdocPath, frame.zIndex, frame.selected)) {
        selectedFrames++
      }
    }
  }
  return {
    totalSeries: $tiltSeries.length,
    totalFrames,
    selectedFrames,
    unsavedCount: $selections.size
  }
})
```

#### Toast Store (src/lib/stores/toastStore.ts)

**Type Definition:**

```typescript
export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title?: string
  description: string
  duration: number  // 0 for persistent
}
```

**Convenience Methods:**

```typescript
toastStore.success(description: string, title?: string, duration = 3000)
toastStore.error(description: string, title?: string, duration = 5000)
toastStore.warning(description: string, title?: string, duration = 4000)
toastStore.info(description: string, title?: string, duration = 3000)
```

### Frontend Persistence

**localStorage Keys:**

```typescript
'ts_tiltSeries'           // Tilt series data
'ts_selections'           // Frame selections
'gallery_expandedTs'      // Expanded tilt series
'gallery_thumbSize'       // Thumbnail size
```

### Backend State Flow

```
Scan → Parse MDOC → Store in project_state → Return to frontend
Save → Write MDOC → Backup → Re-parse → Update project_state → Clear overrides
Delete → Backup → Delete file → Remove from project_state
```

---

## Cache Coordination

### PNG Cache Lifecycle

1. **Initial Load:** Check memory → IndexedDB → Backend
2. **On Display:** Lazy load via intersection observer
3. **After Save:** Clear cache for affected tilt series
4. **Manual Operations:** Cache all / Refresh / Delete

### MDOC Cache Lifecycle

1. **Scan:** Parse all mdoc files, store in project_state
2. **Load:** Restore from localStorage
3. **Edit:** Track overrides in selections store
4. **Save:** Write to file, backup, re-parse, clear overrides
5. **Delete:** Backup, remove file, clear from state

### Cache Invalidation

**PNG Cache Cleared On:**
- Manual delete operation
- Refresh cache operation
- Save operation (per tilt series)

**MDOC Cache Cleared On:**
- New scan
- Save operation
- Delete operation

**Selections Cleared On:**
- Save operation
- Manual reset

---

## Performance Considerations

### PNG Cache

**Strengths:**
- Two-tier design balances speed and capacity
- LRU eviction prevents memory overflow
- IndexedDB provides persistence
- Lazy loading reduces initial load time
- Concurrent task deduplication (backend)

**Optimizations:**
- Memory cache for frequently accessed PNGs
- IndexedDB for long-term storage
- Automatic promotion from IndexedDB to memory
- LRU eviction with size tracking
- Concurrent request deduplication

### MDOC Cache

**Strengths:**
- In-memory backend state for fast access
- localStorage persistence for frontend
- Debounced writes to reduce I/O
- ImageMatcher cache for file lookups

**Optimizations:**
- In-memory project_state for fast access
- Debounced localStorage writes (1 second)
- ImageMatcher cache for file path resolution
- Selective cache invalidation

### Potential Issues

1. **IndexedDB Size Tracking:**
   - `indexedDbCacheSize` store is defined but not updated
   - No actual IndexedDB size tracking implemented
   - No IndexedDB eviction policy

2. **localStorage Capacity:**
   - localStorage has 5-10MB limit
   - May overflow with large tiltSeries data
   - No compression or chunking strategy

3. **Cache Versioning:**
   - No cache versioning strategy
   - No migration path for cache format changes
   - Potential for stale data after updates

4. **Memory Usage:**
   - Multiple state stores may consume significant memory
   - No memory cleanup on component unmount
   - Potential memory leaks with long-running sessions

---

## API Reference

### Frontend Cache API (src/lib/store.ts)

#### PNG Cache Functions

```typescript
// Get PNG from cache hierarchy
async function getPng(tsId: string, zIndex: number, bin?: number, quality?: number): Promise<Blob | null>

// Store PNG in cache
async function putPng(tsId: string, zIndex: number, data: Blob, bin?: number, quality?: number): Promise<void>

// Clear all PNG cache
async function clearCache(): Promise<void>

// Clear PNG cache for specific tilt series
async function clearCacheForTs(tsId: string): Promise<void>

// Cache all PNGs
async function cacheAll(): Promise<{ success: number; failed: number; total: number }>

// Refresh cache from backend
async function refreshCache(): Promise<{ success: number; failed: number; total: number }>

// Delete all cached PNGs
async function deleteCache(): Promise<void>
```

#### Selection State Functions

```typescript
// Get frame selection state
function getFrameSelection(mdocPath: string, zIndex: number, original: boolean, selectionsState?: Map): boolean

// Set frame selection
function setFrameSelection(mdocPath: string, zIndex: number, selected: boolean): void

// Batch set selections
function setBatchSelection(mdocPath: string, selectionsMap: Map<number, boolean>): void

// Clear tilt series selections
function clearTsSelections(mdocPath: string): void

// Load persisted selections
function loadPersistedSelections(): void
```

#### Project Functions

```typescript
// Scan project directory
async function scanProject(config: ScanConfig): Promise<TiltSeries[]>

// Fetch PNG from backend
async function fetchPng(tsId: string, zIndex: number, bin?: number, quality?: number): Promise<Blob>

// Batch save selections
async function batchSave(mdocPath: string, selectionsMap: Map<number, boolean>): Promise<TiltSeries | null>

// Load persisted tilt series
function loadPersistedTiltSeries(): void
```

### Backend Cache API (backend/app/cache/lru.py)

```python
# Get from LRU cache
def get(ts_id: str, frame_id: int, bin: int, quality: int) -> Optional[bytes]

# Put in LRU cache
def put(ts_id: str, frame_id: int, bin: int, quality: int, data: bytes)

# Clear LRU cache
def clear()
```

### Backend State API (backend/app/state/project_state.py)

```python
# Set project configuration
def set_config(config: ScanConfig)

# Add tilt series
def add_tilt_series(ts: TiltSeries)

# Get tilt series
def get_tilt_series(ts_id: str) -> Optional[TiltSeries]

# Remove tilt series by mdoc path
def remove_tilt_series_by_mdoc_path(mdoc_path: str)

# Set frame overrides
def set_frame_override(mdoc_path: str, overrides: Dict[int, bool])

# Get frame override
def get_frame_override(mdoc_path: str, z_index: int, original: bool) -> bool

# Clear overrides
def clear_overrides(mdoc_path: str)

# Check for unsaved changes
def has_unsaved_changes(mdoc_path: str) -> bool

# List all tilt series
def list_tilt_series() -> List[TiltSeries]
```

### Backend MDOC API (backend/app/api/mdoc.py)

```python
# Scan project
POST /api/mdoc/scan
Request: ScanConfig
Response: MdocScanResponse

# List tilt series
GET /api/mdoc/list
Response: List[TiltSeries]

# Get tilt series
GET /api/mdoc/{ts_id}
Response: TiltSeries

# Batch save
POST /api/mdoc/batch-save
Request: BatchSaveRequest
Response: BatchSaveResponse

# Backup and delete
POST /api/mdoc/backup-delete
Request: BackupDeleteRequest
Response: BackupDeleteResponse
```

### Backend PNG API (backend/app/api/preview.py)

```python
# Get PNG preview
GET /api/preview/{ts_id}/{frame_id}
Query: bin (1,2,4,8), quality (1-100)
Response: PNG image

# Get capabilities
GET /api/preview/capabilities
Response: {supported_bins, default_bin, quality_range, default_quality, format}
```

---

## Data Structures

### Type Definitions (src/lib/types.ts)

```typescript
// Frame in mdoc
interface Frame {
  zIndex: number
  angle: number
  mrcPath: string
  selected: boolean
}

// Tilt Series from mdoc file
interface TiltSeries {
  id: string
  mdocPath: string
  frames: Frame[]
  angleRange: [number, number]
}

// Scan configuration
interface ScanConfig {
  mdoc_dir: string
  image_dir: string
  png_dir: string
  mdoc_prefix_cut?: number
  mdoc_suffix_cut?: number
  image_prefix_cut?: number
  image_suffix_cut?: number
}

// Selection state
type SelectionState = Map<string, Map<number, boolean>>

// PNG cache item
interface PngCacheItem {
  data: Blob
  timestamp: number
  size: number
}
```

---

## Best Practices

### When Using PNG Cache

1. **Use `getPng()` for all PNG access** - It handles the cache hierarchy automatically
2. **Let LRU manage memory** - Don't manually clear unless necessary
3. **Use `cacheAll()` for offline preparation** - Pre-cache before going offline
4. **Use `refreshCache()` after external changes** - Sync after regenerating PNGs with external tools
5. **Use `deleteCache()` to free space** - Clear when cache is too large

### When Using MDOC Cache

1. **Let selections persist automatically** - Debounced writes optimize performance
2. **Clear selections after save** - Prevents stale data
3. **Use overrides for unsaved changes** - Keeps original data intact
4. **Re-parse after save** - Ensures consistency between file and state

### State Management

1. **Use derived stores for computed values** - Automatic updates
2. **Use $state for component-local state** - Reactive and efficient
3. **Use $effect for side effects** - Proper cleanup and reactivity
4. **Persist critical state to localStorage** - Survives page refreshes
5. **Clear stale state appropriately** - Prevents memory leaks

---

## Troubleshooting

### PNG Cache Issues

**Problem:** PNGs not loading
- Check: IndexedDB is accessible
- Check: Backend API is running
- Check: Cache key format matches
- Solution: Clear cache and retry

**Problem:** Memory usage too high
- Check: Cache size in UI badge
- Check: LRU eviction is working
- Solution: Reduce MAX_MEMORY_CACHE or clear cache

**Problem:** Stale PNGs after regeneration
- Check: External tool regenerated files
- Solution: Use `refreshCache()` to sync

### MDOC Cache Issues

**Problem:** Selections not persisting
- Check: localStorage is accessible
- Check: Debounce timer is working
- Solution: Check browser console for errors

**Problem:** Unsaved changes lost
- Check: Save operation completed successfully
- Check: Backup file was created
- Solution: Restore from backup

**Problem:** TiltSeries not loading
- Check: localStorage has data
- Check: Scan was successful
- Solution: Re-scan project

### State Issues

**Problem:** UI not updating
- Check: Using $state or stores correctly
- Check: Derived stores have correct dependencies
- Solution: Verify reactivity chain

**Problem:** Memory leaks
- Check: Component cleanup
- Check: Store subscriptions
- Solution: Unsubscribe from stores in cleanup

---

## Future Improvements

1. **IndexedDB Size Tracking**
   - Implement actual size calculation
   - Add IndexedDB eviction policy
   - Monitor and alert on quota usage

2. **localStorage Capacity Management**
   - Implement compression for large data
   - Add chunking for oversized data
   - Fallback to IndexedDB for large datasets

3. **Cache Versioning**
   - Add version metadata to cache
   - Implement migration strategies
   - Automatic cache invalidation on version changes

4. **Memory Management**
   - Implement cleanup on component unmount
   - Add memory usage monitoring
   - Automatic cleanup for stale data

5. **Performance Monitoring**
   - Add cache hit/miss metrics
   - Track operation timings
   - Performance dashboard for developers

---

## References

- **Frontend Store:** `src/lib/store.ts`
- **Frontend Types:** `src/lib/types.ts`
- **Frontend Components:** `src/lib/components/Gallery.svelte`
- **Backend Cache:** `backend/app/cache/lru.py`
- **Backend State:** `backend/app/state/project_state.py`
- **Backend MDOC API:** `backend/app/api/mdoc.py`
- **Backend PNG API:** `backend/app/api/preview.py`
- **MDOC Parser:** `backend/app/mdoc/parser.py`
- **MDOC Writer:** `backend/app/mdoc/writer.py`