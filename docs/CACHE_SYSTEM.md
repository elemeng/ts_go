# Cache System Documentation

## Overview

This document describes the caching architecture for PNG images, MDOC files, and application state in the CryoET Tilt Series Curator.

## Table of Contents

1. [PNG Cache System](#png-cache-system)
2. [MDOC Cache System](#mdoc-cache-system)
3. [Status/State Management](#statusstate-management)
4. [Cache Coordination](#cache-coordination)
5. [Performance Considerations](#performance-considerations)
6. [API Reference](#api-reference)

---

## PNG Cache System

### Frontend Architecture (src/lib/cache.ts)

#### Two-Tier Caching

The PNG cache uses a hierarchical two-tier design with independent eviction policies:

```
Request → Memory Cache → IndexedDB → Backend API
         (hit: update timestamp)
         (miss: check IndexedDB, promote to memory)
         (miss: fetch from backend, cache both)
```

**Key Design Principle:** Memory cache and IndexedDB operate independently. Items evicted from memory remain in IndexedDB until the IndexedDB quota is exceeded or the user explicitly deletes them.

#### 1. Memory Cache (LRU)

- **Maximum Size:** 2GB
- **Data Structure:** `Map<string, PngCacheItem>`
- **Cache Key Format:** `{tsId}_{zIndex}_bin{bin}_q{quality}`
- **Eviction Policy:** LRU when exceeding 90% capacity (memory only, does NOT delete from IndexedDB)
- **Tracked Properties:**
  - `data`: Blob (PNG image data)
  - `size`: number (bytes)
  - `timestamp`: number (last access time)

**Key Functions:**

```typescript
// Get PNG with automatic promotion
async function getPng(tsId: string, zIndex: number, bin = 8, quality = 90): Promise<Blob | null>

// Store in memory with LRU eviction (syncs to IndexedDB)
async function putPngToMemory(key: string, data: Blob): Promise<void>

// Clear all memory cache
async function clearCache(): Promise<void>

// Clear specific tilt series (user action, deletes from both tiers)
async function clearCacheForTs(tsId: string): Promise<void>
```

#### 2. IndexedDB Cache

- **Maximum Size:** 10GB
- **Database Name:** `TsSvCache`
- **Version:** 1
- **Store Name:** `pngs`
- **Persistence:** Survives browser restarts
- **Operations:** Async with Promise-based API
- **Size Tracking:** Real-time calculation and monitoring
- **Eviction Policy:** Quota-based when exceeding 10GB (independent of memory eviction)

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

// Check and enforce IndexedDB quota (evicts if needed)
async function checkIndexedDbQuota(newItemSize: number): Promise<void>

// Update IndexedDB size tracking
async function updateIndexedDbSize(): Promise<void>

// Delete from IndexedDB (user action or quota eviction)
async function deleteFromIndexedDB(key: string, reason: 'user' | 'quota'): Promise<void>
```

**IndexedDB Eviction Strategy:**

When the 10GB quota is exceeded, items are evicted in this order:
1. **Priority 1:** Items not in memory cache (least recently accessed)
2. **Priority 2:** Oldest items in memory cache (by timestamp)

This ensures that frequently accessed items are preserved while freeing space for new items.

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

### Backend Architecture (backend/src/cache/lru.rs)

#### LRU Cache

- **Maximum Size:** 2048MB (2GB)
- **Data Structure:** `OrderedDict`
- **Cache Key:** MD5 hash of `{tsId}_{frameId}_bin{bin}_q{quality}`
- **Eviction Policy:** Automatic when exceeding capacity
- **Instance:** Global singleton `png_cache`

**Key Functions:**

```rust
pub fn get(ts_id: &str, frame_id: i32, bin: i32, quality: i32) -> Option<Vec<u8>>
pub fn put(ts_id: &str, frame_id: i32, bin: i32, quality: i32, data: Vec<u8>)
pub fn clear()
```

### Backend Disk Cache (backend/src/routes/preview.rs)

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

```rust
static INFLIGHT: LazyLock<Mutex<HashMap<String, oneshot::Receiver<Vec<u8>>>>>;
```

If multiple requests for the same PNG arrive simultaneously, they wait for the first request to complete.

---

## MDOC Cache System

### Backend State Management (backend/src/state/project_state.rs)

#### Project State Class

```rust
pub struct ProjectState {
    pub config: RwLock<Option<ScanConfig>>,
    pub tilt_series: RwLock<HashMap<String, TiltSeries>>,
}
```

**Key Operations:**

```rust
pub async fn set_config(config: ScanConfig)          // Reset state on new scan
pub async fn add_tilt_series(ts: TiltSeries)         // Store parsed tilt series
pub async fn get_tilt_series(ts_id: &str) -> Option<TiltSeries>
pub async fn list_tilt_series() -> Vec<TiltSeries>
pub async fn remove_tilt_series_by_mdoc_path(mdoc_path: &str)
pub async fn update_tilt_series_frames(mdoc_path: &str, selections: &HashMap<i32, bool>) -> bool
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

#### Parser (backend/src/mdoc/parser.rs)

**Format:** SerialEM mdoc

**Sections:**
- `[TiltSeries]`: Header with ImageFile
- `[ZValue = X]`: Individual frame sections

**Extracted Fields:**
- `TiltAngle`: Frame angle
- `SubFramePath`: Image path (matched to actual files)
- `mrcPath`: Resolved image path via ImageMatcher

**Returns:** `TiltSeries` with parsed frames

#### Writer (backend/src/mdoc/writer.rs)

**Operations:**
1. Create backup: `{mdocPath}.bak`
2. Parse the mdoc file via `emdoc`
3. Remove unselected frame blocks (by ZValue)
4. Write to `.mdoc.tmp` → atomic rename to `.mdoc`
5. Return backup path

**Signature:**

```rust
pub fn write_mdoc_with_selections(
    mdoc_path: &str,
    selections: &HashMap<i32, bool>,
) -> Result<String, String>
```

### API Endpoints (backend/src/routes/mdoc.rs)

```
POST /api/mdoc/scan           # Scan directory, parse all mdoc files
GET  /api/mdoc/list           # List all tilt series
GET  /api/mdoc/{ts_id}        # Get specific tilt series
POST /api/mdoc/batch-save     # Save selections, backup, re-parse
POST /api/mdoc/backup-delete  # Backup and delete mdoc file
```

---

## Status/State Management

### Frontend State Architecture

### Frontend State Architecture

#### React useState (Gallery.tsx)

**UI State (via `useState`):**

```typescript
const [expandedTs, setExpandedTs] = useState<Set<string>>(new Set());
const [selectedTsIds, setSelectedTsIds] = useState<Set<string>>(new Set());
const [thumbSize, setThumbSize] = useState(128);

// Operation State
const [isSaving, setIsSaving] = useState(false);
const [isCaching, setIsCaching] = useState(false);
const [cacheProgress, setCacheProgress] = useState({ cached: 0, total: 0, currentTs: '' });
const [showScanDialog, setShowScanDialog] = useState(false);
```

#### React Context (src/lib/store.tsx)

Global state shared across components via `createContext` + `useContext`:

```typescript
interface AppState {
  tiltSeries: TiltSeries[];                          // All tilt series
  setTiltSeries: (series: TiltSeries[]) => void;     // Update on scan/save
  selections: SelectionState;                         // Map<mdocPath, Map<zIndex, boolean>>
  setFrameSelection: (mdocPath, zIndex, selected) => void;
  setBatchSelection: (mdocPath, selectionsMap) => void;
  clearTsSelections: (mdocPath) => void;
  clearAllSelections: () => void;
  getFrameSelection: (mdocPath, zIndex, original) => boolean;
}
```

**Persistence:** Both `tiltSeries` and `selections` are persisted to `localStorage` on change. On app mount, they are restored from `localStorage` via lazy `useState` initializers.

**Key behavior:**
- `selections` act as **overrides** — if a frame has no selection override, the original `frame.selected` value from the scan is used
- Selections are debounced (1s) before writing to `localStorage` to reduce I/O
- On successful save, selections are cleared entirely

#### Toast Notifications (sonner)

Notifications use the `sonner` library's `toast()` function directly, not a dedicated store:

```typescript
import { toast } from 'sonner';

toast.success('Scanned 12 tilt series');
toast.error('Save failed', { description: '...' });
toast.warning('No tilt series selected');
toast.info('No changes to save');
```

### Frontend Persistence

**localStorage Keys:**

```typescript
'ts_tiltSeries'           // Tilt series data
'ts_selections'           // Frame selections (debounced 1s)
'gallery_thumbSize'       // Thumbnail width in pixels
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

**PNG Memory Cache Cleared On:**
- LRU eviction (when exceeding 2GB limit)
- Manual delete operation
- Refresh cache operation
- Save operation (per tilt series)

**PNG IndexedDB Cache Cleared On:**
- User explicit delete operations (deleteCache, clearCacheForTs)
- Refresh cache operation
- Quota eviction (when exceeding 10GB limit)
- Save operation (per tilt series)

**Note:** Items evicted from memory cache remain in IndexedDB until quota is exceeded or user explicitly deletes them.

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
- Memory cache for frequently accessed PNGs (fast access layer)
- IndexedDB for persistent storage (independent of memory eviction)
- Automatic promotion from IndexedDB to memory on access
- LRU eviction for memory (2GB limit)
- Quota-based eviction for IndexedDB (10GB limit)
- Real-time IndexedDB size tracking
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

1. **localStorage Capacity:**
   - localStorage has 5-10MB limit
   - May overflow with large tiltSeries data
   - No compression or chunking strategy

2. **Cache Versioning:**
   - No cache versioning strategy
   - No migration path for cache format changes
   - Potential for stale data after updates

3. **Memory Usage:**
   - Multiple state stores may consume significant memory
   - No memory cleanup on component unmount
   - Potential memory leaks with long-running sessions

4. **IndexedDB Quota Management:**
   - Quota eviction is triggered on each put operation
   - May cause performance impact with large datasets
   - No manual quota management controls for users

---

## API Reference

### Frontend Cache API (src/lib/store.ts)

#### PNG Cache Functions

```typescript
// Get PNG from cache hierarchy
async function getPng(tsId: string, zIndex: number, bin?: number, quality?: number): Promise<Blob | null>

// Store PNG in cache (syncs to both memory and IndexedDB)
async function putPng(tsId: string, zIndex: number, data: Blob, bin?: number, quality?: number): Promise<void>

// Store in memory with LRU eviction (syncs to IndexedDB)
async function putPngToMemory(key: string, data: Blob): Promise<void>

// Clear all PNG cache (both memory and IndexedDB)
async function clearCache(): Promise<void>

// Clear PNG cache for specific tilt series (user action, deletes from both tiers)
async function clearCacheForTs(tsId: string): Promise<void>

// Cache all PNGs
async function cacheAll(): Promise<{ success: number; failed: number; total: number }>

// Refresh cache from backend (clears and re-fetches)
async function refreshCache(): Promise<{ success: number; failed: number; total: number }>

// Delete all cached PNGs
async function deleteCache(): Promise<void>
```

#### IndexedDB Helper Functions

```typescript
// Initialize IndexedDB database
async function initDB(): Promise<IDBDatabase>

// Check and enforce IndexedDB quota (evicts if needed)
async function checkIndexedDbQuota(newItemSize: number): Promise<void>

// Update IndexedDB size tracking
async function updateIndexedDbSize(): Promise<void>

// Store in IndexedDB with quota checking
async function putToIndexedDB(key: string, data: Blob): Promise<void>

// Delete from IndexedDB (user action or quota eviction)
async function deleteFromIndexedDB(key: string, reason: 'user' | 'quota'): Promise<void>
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

### Backend Cache API (backend/src/cache/lru.rs)

```rust
// Get from LRU cache
pub fn get(ts_id: &str, frame_id: i32, bin: i32, quality: i32) -> Option<Vec<u8>>

// Put in LRU cache
pub fn put(ts_id: &str, frame_id: i32, bin: i32, quality: i32, data: Vec<u8>)

// Clear LRU cache
pub fn clear()
```

### Backend State API (backend/src/state/project_state.rs)

```rust
// Set project configuration (also clears all tilt series)
pub async fn set_config(config: ScanConfig)

// Add tilt series
pub async fn add_tilt_series(ts: TiltSeries)

// Get tilt series by id
pub async fn get_tilt_series(ts_id: &str) -> Option<TiltSeries>

// List all tilt series
pub async fn list_tilt_series() -> Vec<TiltSeries>

// Remove tilt series by mdoc path
pub async fn remove_tilt_series_by_mdoc_path(mdoc_path: &str)

// Update frames after save (removes deselected frames, recalculates angle range)
pub async fn update_tilt_series_frames(mdoc_path: &str, selections: &HashMap<i32, bool>) -> bool
```

### Backend MDOC API (backend/src/routes/mdoc.rs)

```
# Scan project
POST /api/mdoc/scan
Request: ScanConfig
Response: { tiltSeries: TiltSeries[], total: number }

# List tilt series
GET /api/mdoc/list
Response: TiltSeries[]

# Get tilt series
GET /api/mdoc/{ts_id}
Response: TiltSeries

# Save all selections
POST /api/mdoc/save-all
Request: { selections: Record<mdocPath, Record<zIndex, bool>> }
Response: { success, saved, failed, deleted, message }

# Delete all
POST /api/mdoc/delete-all
Request: { mdoc_paths: string[] }
Response: { success, deleted, failed, message }

# Batch save single mdoc
POST /api/mdoc/batch-save
Request: BatchSaveRequest
Response: BatchSaveResponse

# Backup and delete
POST /api/mdoc/backup-delete
Request: BackupDeleteRequest
Response: BackupDeleteResponse
```

### Backend PNG API (backend/src/routes/preview.rs)

```
# Get PNG preview
GET /api/preview/{ts_id}/{frame_id}
Query: bin (1,2,4,8), quality (1-100)
Response: image/png

# Get capabilities
GET /api/preview/capabilities
Response: { supported_bins, default_bin, quality_range, default_quality, format }
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
2. **Let LRU manage memory** - Don't manually clear unless necessary; items stay in IndexedDB
3. **Use `cacheAll()` for offline preparation** - Pre-cache before going offline
4. **Use `refreshCache()` after external changes** - Sync after regenerating PNGs with external tools
5. **Use `deleteCache()` to free space** - Clears both memory and IndexedDB caches
6. **Understand cache independence** - Memory eviction doesn't delete from IndexedDB; IndexedDB has its own quota
7. **Monitor cache sizes** - Check the UI badge for memory and IndexedDB usage
8. **Plan for IndexedDB quota** - 10GB limit with automatic eviction; plan usage accordingly

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

**Problem:** IndexedDB quota exceeded
- Check: IndexedDB size in UI badge
- Check: Quota eviction is working
- Solution: Use `deleteCache()` to free space, or let quota eviction handle it

**Problem:** Items disappearing from IndexedDB
- Check: If disappearing without user action, check quota eviction logs
- Check: IndexedDB size is approaching 10GB limit
- Solution: Monitor quota usage, use `deleteCache()` if needed

**Problem:** Stale PNGs after regeneration
- Check: External tool regenerated files
- Solution: Use `refreshCache()` to sync (clears IndexedDB and re-fetches)

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

1. **localStorage Capacity Management**
   - Implement compression for large data
   - Add chunking for oversized data
   - Fallback to IndexedDB for large datasets

2. **Cache Versioning**
   - Add version metadata to cache
   - Implement migration strategies
   - Automatic cache invalidation on version changes

3. **Memory Management**
   - Implement cleanup on component unmount
   - Add memory usage monitoring
   - Automatic cleanup for stale data

4. **Performance Monitoring**
   - Add cache hit/miss metrics
   - Track operation timings
   - Performance dashboard for developers

5. **IndexedDB Optimization**
   - Implement lazy quota checking (batch operations)
   - Add manual quota management controls
   - Implement cache warming strategies
   - Add cache compression for large PNGs

6. **Advanced Cache Strategies**
   - Implement predictive caching based on usage patterns
   - Add cache priority levels (critical vs optional)
   - Implement cache preloading for likely-to-be-accessed items
   - Add cache sharing across browser tabs

---

## References

- **Frontend Store:** `src/lib/store.tsx`
- **Frontend Types:** `src/lib/types.ts`
- **Frontend Cache:** `src/lib/cache.ts`
- **Frontend Components:** `src/components/gallery/`
- **Backend Cache:** `backend/src/cache/lru.rs`
- **Backend State:** `backend/src/state/project_state.rs`
- **Backend MDOC API:** `backend/src/routes/mdoc.rs`
- **Backend PNG API:** `backend/src/routes/preview.rs`
- **MDOC Parser:** `backend/src/mdoc/parser.rs`
- **MDOC Writer:** `backend/src/mdoc/writer.rs`