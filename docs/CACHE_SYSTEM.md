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

### Frontend Architecture (`src/lib/cache.ts`)

#### Two-Tier Cache Hierarchy

The PNG cache uses a hierarchical design:

```
Request → Memory Cache → IndexedDB → Backend API
         (hit: update timestamp)
         (miss: check IndexedDB, promote to memory)
         (miss: fetch from backend, cache both)
```

**Key Design Principle:** Memory cache and IndexedDB operate independently. Items evicted from memory remain in IndexedDB until explicitly deleted.

#### 1. Memory Cache (LRU)

- **Maximum Size:** 2GB
- **Data Structure:** `Map<string, PngCacheItem>`
- **Cache Key Format:** `{tsId}_{zIndex}_bin{bin}`
- **Eviction Policy:** LRU when exceeding 2GB capacity
- **Tracked Properties:**
  - `data`: Blob (PNG image data)
  - `size`: number (bytes)
  - `timestamp`: number (last access time)
  - `mrcPath`: string (source file path, used for validity)
  - `pngMtime`: number (disk PNG mtime for staleness checks)

**Key Functions:**

```typescript
// Get PNG with automatic promotion from IndexedDB
async function getPng(tsId: string, zIndex: number, mrcPath: string, bin = 8): Promise<{ blob: Blob; pngMtime: number } | null>

// Store in memory + IndexedDB
async function putPng(tsId: string, zIndex: number, data: Blob, mrcPath: string, pngMtime: number, bin = 8): Promise<void>

// Clear all memory + IndexedDB cache
async function clearCache(): Promise<void>
```

#### 2. IndexedDB Cache

- **Database Name:** `TsSvCache`
- **Version:** 2
- **Store Name:** `pngs`
- **Persistence:** Survives browser restarts
- **No quota management** (relies on browser's built-in storage limits)
- **DB version bumps** purge stale cache entries when key format changes

**Initialization:**

```typescript
async function initDB(): Promise<IDBDatabase>
```

#### Cache Validation

The frontend validates cached PNGs against backend disk mtimes:

```typescript
// Validate cached PNGs for a tilt series against backend mtimes
async function validateTsCache(ts: TiltSeries, bin = 8): Promise<void>
```

This fetches current disk mtimes from the backend and evicts any cached entries whose stored `pngMtime` differs from the backend's current value.

#### Bulk Caching

```typescript
// Cache all selected frames of a single tilt series (concurrency = 6)
async function cacheMdoc(ts: TiltSeries, onProgress?: (current: number, total: number) => void): Promise<{ success: number; failed: number }>

// Cache all tilt series sequentially
async function cacheAllMdocs(tiltSeries: TiltSeries[], onProgress?: (progress) => void): Promise<{ success: number; failed: number; total: number }>
```

### Backend Architecture (`backend/src/cache/lru.rs`)

#### LRU Cache

- **Maximum Size:** 2048MB (2GB)
- **Data Structure:** `HashMap<u64, PngCacheEntry>`
- **Cache Key:** Hash of `{ts_id}_{frame_id}_bin{bin}` via `DefaultHasher`
- **Eviction Policy:** When over capacity, evicts the entry with the oldest `last_accessed` timestamp (O(n) scan, only on write path)
- **Instance:** Global singleton `PNG_CACHE`

**Entry Fields:**
- `data: Vec<u8>` — raw PNG bytes
- `mtime: Option<u64>` — disk mtime of the cached PNG file
- `last_accessed: u64` — epoch seconds of last access (for LRU eviction)

**Key Functions:**

```rust
pub fn get(&mut self, ts_id: &str, frame_id: i32, bin: i32) -> Option<&PngCacheEntry>
pub fn put(&mut self, ts_id: &str, frame_id: i32, bin: i32, data: Vec<u8>, mtime: Option<u64>)
pub fn clear(&mut self)
```

### Backend Disk Cache (`backend/src/routes/preview.rs`)

#### File System Cache

- **Path Pattern:** `{png_dir}/{ts_id}/bin{bin}/frame_{frame_id:04d}.png`
- **Checked After:** Memory cache check (middle tier)
- **Updated On:** PNG generation (saved to disk after processing)

**Cache Hierarchy:**

```
Request → Memory Cache → Disk Cache → PNG Generation
         (hit: update timestamp)
         (miss: check disk, update memory)
         (miss: generate, save to disk + memory)
```

### Concurrent Task Deduplication

The backend prevents duplicate PNG generation when multiple requests arrive simultaneously for the same frame:

```rust
static INFLIGHT: LazyLock<Mutex<HashMap<String, oneshot::Receiver<(Vec<u8>, Option<u64>)>>>>;
```

When a request arrives while another is already processing the same frame, the second request waits on the `oneshot::Receiver` for the first to complete. The inflight entry is always cleaned up after processing (success or failure) to prevent stale entries.

---

## MDOC Cache System

### Backend State Management (`backend/src/state/project_state.rs`)

#### Project State

```rust
pub struct ProjectState {
    pub config: RwLock<Option<ScanConfig>>,
    pub tilt_series: RwLock<HashMap<String, TiltSeries>>,
}
```

**Key Operations:**

```rust
pub async fn set_config(config: ScanConfig)                              // Reset state on new scan
pub async fn add_tilt_series(ts: TiltSeries)                             // Store parsed tilt series
pub async fn get_tilt_series(ts_id: &str) -> Option<TiltSeries>
pub async fn list_tilt_series() -> Vec<TiltSeries>
pub async fn remove_tilt_series_by_mdoc_path(mdoc_path: &str)
pub async fn update_tilt_series_frames(mdoc_path: &str, selections: &HashMap<i32, bool>) -> Result<(), String>
```

**Global Instance:** `PROJECT_STATE` (singleton via `LazyLock`)

### Frontend Persistence (`src/lib/store.tsx`)

#### TiltSeries Storage

- **localStorage Key:** `ts_tiltSeries`
- **Auto-save:** On changes via `setTiltSeries`
- **Load:** On app mount from `useEffect` hydration
- **Clear:** After successful save (backend refresh)
- **Version check:** `ts_storage_version` key purges stale data on format changes

#### Selection State

**Type Definition:**

```typescript
type SelectionState = Map<mdocPath, Map<zIndex, boolean>>
```

- **localStorage Key:** `ts_selections`
- **Debounce:** 1 second to avoid excessive writes
- **Load:** On app mount from `useEffect` hydration
- **Clear:** After successful save

**Key Functions (via `AppProvider` context):**

```typescript
function getFrameSelection(mdocPath: string, zIndex: number, original: boolean): boolean
function setFrameSelection(mdocPath: string, zIndex: number, selected: boolean): void
function setBatchSelection(mdocPath: string, selectionsMap: Map<number, boolean>): void
function clearTsSelections(mdocPath: string): void
function clearAllSelections(): void
```

### MDOC File Operations

#### Parser (`backend/src/mdoc/parser.rs`)

**Format:** SerialEM mdoc

**Sections:**
- `[TiltSeries]`: Header with ImageFile
- `[ZValue = X]`: Individual frame sections

**Extracted Fields:**
- `TiltAngle`: Frame angle
- `SubFramePath`: Image path (matched to actual files via `ImageMatcher`)
- `mrcPath`: Resolved image path
- `mrcMtime`: Source file modification time

**Returns:** `Result<TiltSeries, String>` with parsed frames

#### Writer (`backend/src/mdoc/writer.rs`)

**Operations:**
1. Create timestamped backup: `{mdocPath}.{timestamp}.bak`
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

### API Endpoints (`backend/src/routes/mdoc.rs`)

```
POST /api/mdoc/scan           # Scan directory, parse all mdoc files
GET  /api/mdoc/list           # List all tilt series
GET  /api/mdoc/{ts_id}        # Get specific tilt series
POST /api/mdoc/save-all       # Save all selections (batch)
POST /api/mdoc/delete-all     # Delete multiple mdoc files
POST /api/mdoc/batch-save     # Save selections for a single mdoc
POST /api/mdoc/backup-delete  # Backup and delete an mdoc file
```

---

## Status/State Management

### Frontend State Architecture

#### React `useState` (`gallery.tsx`)

**UI State:**

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

#### React Context (`src/lib/store.tsx`)

Global state shared across components via `createContext` + `useContext`:

```typescript
interface AppState {
  tiltSeries: TiltSeries[];
  setTiltSeries: (series: TiltSeries[]) => void;
  selections: SelectionState;
  setFrameSelection: (mdocPath, zIndex, selected) => void;
  setBatchSelection: (mdocPath, selectionsMap) => void;
  clearTsSelections: (mdocPath) => void;
  clearAllSelections: () => void;
  getFrameSelection: (mdocPath, zIndex, original) => boolean;
}
```

**Persistence:** Both `tiltSeries` and `selections` are persisted to `localStorage` on change. On app mount, they are restored via hydration effects.

**Key behavior:**
- `selections` act as **overrides** — if a frame has no selection override, the original `frame.selected` value from the scan is used
- Selections are debounced (1s) before writing to `localStorage`
- On successful save, selections are cleared entirely

#### Toast Notifications (sonner)

```typescript
import { toast } from 'sonner';

toast.success('Scanned 12 tilt series');
toast.error('Save failed', { description: '...' });
toast.warning('No tilt series selected');
toast.info('No changes to save');
```

### Persistence

**localStorage Keys:**

```typescript
'ts_tiltSeries'           // Tilt series data
'ts_selections'           // Frame selections (debounced 1s)
'ts_storage_version'      // Cache version (purges stale data on mismatch)
'ts_scan_config'          // Persisted scan dialog config
'gallery_thumbSize'       // Thumbnail width in pixels
```

### Backend State Flow

```
Scan → Parse MDOC → Store in project_state → Return to frontend
Save → Write MDOC → Backup → Update project_state → Clear overrides
Delete → Backup → Delete file → Remove from project_state
```

---

## Cache Coordination

### PNG Cache Lifecycle

1. **Initial Load:** Check memory → IndexedDB → Backend
2. **On Display:** Lazy load via intersection observer
3. **After Scan:** Validate cached PNGs against backend mtimes
4. **Manual Operations:** Cache all / Clear cache

### MDOC Cache Lifecycle

1. **Scan:** Parse all mdoc files, store in project_state
2. **Load:** Restore from localStorage
3. **Edit:** Track overrides in selections store
4. **Save:** Write to file, backup, update state, clear overrides
5. **Delete:** Backup, remove file, clear from state

### Cache Invalidation

**PNG Memory Cache Cleared On:**
- LRU eviction (when exceeding 2GB limit)
- Manual clear operation
- `validateTsCache` (stale mtime mismatch)

**PNG IndexedDB Cache Cleared On:**
- Manual clear operation
- `validateTsCache` (stale mtime mismatch)
- DB version upgrade

**MDOC State Cleared On:**
- New scan
- Save operation (state updated)
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
- IndexedDB provides persistence across reloads
- Lazy loading via IntersectionObserver reduces initial load time
- Concurrent task deduplication prevents duplicate PNG generation

**Optimizations:**
- Memory cache for frequently accessed PNGs (fast access layer)
- IndexedDB for persistent storage (independent of memory eviction)
- Automatic promotion from IndexedDB to memory on access
- LRU eviction for memory (2GB limit)
- Backend disk cache acts as a middle tier
- Concurrent request deduplication via inflight task map

### MDOC Cache

**Strengths:**
- In-memory backend state for fast access
- localStorage persistence for frontend
- Debounced writes to reduce I/O
- ImageMatcher cache for file lookups

**Optimizations:**
- In-memory project_state for fast access
- Debounced localStorage writes (1 second)
- ImageMatcher file cache with prefix/suffix filtering

### Potential Issues

1. **localStorage Capacity:**
   - localStorage has 5-10MB limit
   - May overflow with large tiltSeries data
   - Version-based purging helps migrate formats

2. **Cache Versioning:**
   - `ts_storage_version` key enables format migration
   - DB version bumps purge IndexedDB on format changes

3. **Memory Usage:**
   - Multiple state stores may consume significant memory
   - LRU eviction bounds the memory cache at 2GB

4. **IndexedDB Quota:**
   - Relies on browser's built-in storage limits
   - No explicit quota management in the application

---

## API Reference

### Frontend Cache API (`src/lib/cache.ts`)

#### PNG Cache Functions

```typescript
// Get PNG from cache hierarchy (memory → IndexedDB → backend)
async function getPng(tsId: string, zIndex: number, mrcPath: string, bin?: number): Promise<{ blob: Blob; pngMtime: number } | null>

// Store PNG in cache (memory + IndexedDB)
async function putPng(tsId: string, zIndex: number, data: Blob, mrcPath: string, pngMtime: number, bin?: number): Promise<void>

// Clear all PNG cache (memory + IndexedDB)
async function clearCache(): Promise<void>

// Validate cached PNGs against backend mtimes
async function validateTsCache(ts: TiltSeries, bin?: number): Promise<void>

// Cache all selected frames of a single tilt series
async function cacheMdoc(ts: TiltSeries, onProgress?: (current: number, total: number) => void): Promise<{ success: number; failed: number }>

// Cache all tilt series sequentially
async function cacheAllMdocs(tiltSeries: TiltSeries[], onProgress?: (progress) => void): Promise<{ success: number; failed: number; total: number }>
```

#### IndexedDB

```typescript
// Initialize IndexedDB database
async function initDB(): Promise<IDBDatabase>
```

### Frontend API Client (`src/lib/api.ts`)

```typescript
// Scan project directory
async function scanProject(config: ScanConfig): Promise<TiltSeries[]>

// List all tilt series
async function listTiltSeries(): Promise<TiltSeries[]>

// Get specific tilt series
async function getTiltSeries(tsId: string): Promise<TiltSeries | null>

// Fetch PNG preview from backend
async function fetchPng(tsId: string, zIndex: number, bin?: number): Promise<{ blob: Blob; pngMtime: number }>

// Fetch PNG disk mtimes for a tilt series
async function fetchMtimes(tsId: string, bin?: number): Promise<Map<number, number>>

// Save all selections (batch)
async function saveAll(selectionsState: SelectionState, deletePaths?: string[]): Promise<SaveAllResult>

// Get user home directory
async function fetchUserHome(): Promise<string>

// List directory contents
async function listDirectory(path: string): Promise<{ name: string; type: "dir" | "file" }[]>

// Save/load/list/delete scan configurations
async function saveConfig(config: ScanConfig): Promise<void>
async function loadConfig(filename: string): Promise<ScanConfig>
async function listConfigs(): Promise<string[]>
```

### Backend Cache API (`backend/src/cache/lru.rs`)

```rust
// Get from LRU cache (updates last_accessed timestamp)
pub fn get(&mut self, ts_id: &str, frame_id: i32, bin: i32) -> Option<&PngCacheEntry>

// Put in LRU cache (evicts oldest entries if over capacity)
pub fn put(&mut self, ts_id: &str, frame_id: i32, bin: i32, data: Vec<u8>, mtime: Option<u64>)

// Clear LRU cache
pub fn clear(&mut self)
```

### Backend State API (`backend/src/state/project_state.rs`)

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
pub async fn update_tilt_series_frames(mdoc_path: &str, selections: &HashMap<i32, bool>) -> Result<(), String>
```

### Backend MDOC API (`backend/src/routes/mdoc.rs`)

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
Response: { success, saved, failed, deleted, backups, message }

# Delete all
POST /api/mdoc/delete-all
Request: { mdoc_paths: string[] }
Response: { success, deleted, failed, message }

# Batch save single mdoc
POST /api/mdoc/batch-save
Request: { mdoc_path, selections: Record<zIndex, bool> }
Response: { success, message, backup_path?, updated_tilt_series? }

# Backup and delete
POST /api/mdoc/backup-delete
Request: { mdoc_path }
Response: { success, message, backup_path? }
```

### Backend PNG API (`backend/src/routes/preview.rs`)

```
# Get PNG preview
GET /api/preview/{ts_id}/{frame_id}
Query: bin (1,2,4,8)
Response: image/png (with x-png-mtime header)

# Get frame disk mtimes
GET /api/preview/{ts_id}/frame-mtimes
Query: bin (1,2,4,8)
Response: { mtimes: Record<zIndex, mtime> }

# Get capabilities
GET /api/preview/capabilities
Response: { supported_bins, default_bin, format }
```

---

## Data Structures

### Type Definitions (`src/lib/types.ts`)

```typescript
// Frame in mdoc
interface Frame {
  zIndex: number;
  angle: number;
  mrcPath: string;
  selected: boolean;
  mrcMtime: number;
}

// Tilt Series from mdoc file
interface TiltSeries {
  id: string;
  mdocPath: string;
  frames: Frame[];
  angleRange: [number, number];
}

// Scan configuration
interface ScanConfig {
  mdoc_dir: string;
  image_dir: string;
  png_dir: string;
  mdoc_prefix_cut?: number;
  mdoc_suffix_cut?: number;
  image_prefix_cut?: number;
  image_suffix_cut?: number;
}

// Selection state
type SelectionState = Map<string, Map<number, boolean>>;

// PNG cache item
interface PngCacheItem {
  data: Blob;
  timestamp: number;
  size: number;
  mrcPath: string;
  pngMtime: number;
}

// Save all result
interface SaveAllResult {
  success: boolean;
  saved: string[];
  failed: string[];
  deleted: string[];
  message: string;
}

// Cache progress
interface CacheProgress {
  cached: number;
  total: number;
  currentTs: string;
  currentFrame: number;
}
```

### Backend Types (`backend/src/models/types.rs`)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub z_index: i32,
    pub angle: f64,
    pub mrc_path: String,
    pub selected: bool,
    pub mrc_mtime: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiltSeries {
    pub id: String,
    pub mdoc_path: String,
    pub frames: Vec<Frame>,
    pub angle_range: (f64, f64),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    pub mdoc_dir: String,
    pub image_dir: String,
    pub png_dir: String,
    pub mdoc_prefix_cut: i32,
    pub mdoc_suffix_cut: i32,
    pub image_prefix_cut: i32,
    pub image_suffix_cut: i32,
}

#[derive(Debug, Serialize)]
pub struct SaveAllResponse {
    pub success: bool,
    pub saved: Vec<String>,
    pub failed: Vec<String>,
    pub deleted: Vec<String>,
    pub message: String,
    pub backups: Vec<String>,
}
```

---

## Best Practices

### When Using PNG Cache

1. **Use `getPng()` for all PNG access** — It handles the cache hierarchy automatically
2. **Let LRU manage memory** — Don't manually clear unless necessary; items stay in IndexedDB
3. **Use `cacheAllMdocs()` for offline preparation** — Pre-cache before going offline
4. **Use `validateTsCache()` after scan** — Ensures cached PNGs are still fresh
5. **Use `clearCache()` to free space** — Clears both memory and IndexedDB caches

### When Using MDOC Cache

1. **Let selections persist automatically** — Debounced writes optimize performance
2. **Clear selections after save** — Prevents stale data
3. **Use overrides for unsaved changes** — Keeps original data intact
4. **Re-scan after external changes** — Ensures consistency between file and state

### State Management

1. **Use `useCallback` for stable function references** — Prevents unnecessary re-renders
2. **Use `useRef` for initial-expansion tracking** — Prevents re-expansion bugs
3. **Persist critical state to localStorage** — Survives page refreshes
4. **Clear stale state appropriately** — Prevents memory leaks

---

## Troubleshooting

### PNG Cache Issues

**Problem:** PNGs not loading
- Check: Backend API is running
- Check: Frame has a valid `mrcPath` (starts with `/`)
- Solution: Clear cache and retry

**Problem:** Memory usage too high
- Check: LRU eviction is working (2GB limit)
- Solution: Reduce `MAX_MEMORY_CACHE` or clear cache

**Problem:** Stale PNGs after file changes
- Check: `validateTsCache()` was called after scan
- Solution: Re-scan project or manually clear cache

**Problem:** IndexedDB entries not found after upgrade
- Check: DB version was bumped (purges old format entries)
- Solution: Re-cache PNGs

### MDOC Cache Issues

**Problem:** Selections not persisting
- Check: localStorage is accessible
- Check: Debounce timer is working
- Solution: Check browser console for errors

**Problem:** Unsaved changes lost
- Check: Save operation completed successfully
- Check: Backup file was created (`.{timestamp}.bak`)
- Solution: Restore from backup

**Problem:** TiltSeries not loading
- Check: localStorage has data
- Check: Scan was successful
- Solution: Re-scan project

### State Issues

**Problem:** UI not updating
- Check: Using state/context correctly
- Check: Dependencies in `useEffect`/`useCallback` are correct
- Solution: Verify React reactivity chain

---

## Future Improvements

1. **localStorage Capacity Management**
   - Implement compression for large data
   - Add chunking for oversized data
   - Fallback to IndexedDB for large datasets

2. **Cache Versioning**
   - Add version metadata to cache entries
   - Implement granular migration strategies
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
   - Implement explicit quota management
   - Add manual quota management controls
   - Implement cache warming strategies

6. **Advanced Cache Strategies**
   - Implement predictive caching based on usage patterns
   - Add cache priority levels (critical vs optional)
   - Add cache sharing across browser tabs

---

## References

- **Frontend Store:** `src/lib/store.tsx`
- **Frontend Types:** `src/lib/types.ts`
- **Frontend Cache:** `src/lib/cache.ts`
- **Frontend API Client:** `src/lib/api.ts`
- **Frontend Components:** `src/components/gallery/`
- **Backend Cache:** `backend/src/cache/lru.rs`
- **Backend State:** `backend/src/state/project_state.rs`
- **Backend MDOC API:** `backend/src/routes/mdoc.rs`
- **Backend PNG API:** `backend/src/routes/preview.rs`
- **MDOC Parser:** `backend/src/mdoc/parser.rs`
- **MDOC Writer:** `backend/src/mdoc/writer.rs`
- **Backend Types:** `backend/src/models/types.rs`
