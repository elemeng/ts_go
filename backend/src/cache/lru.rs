use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Cached PNG entry: raw bytes, disk mtime, and last-access timestamp for LRU.
pub struct PngCacheEntry {
    pub data: Vec<u8>,
    pub mtime: Option<u64>,
    pub last_accessed: u64,
}

/// LRU cache for PNG data with size-based eviction.
///
/// Uses a HashMap for O(1) lookups.  Eviction scans entries for the oldest
/// `last_accessed` timestamp — this is O(n) but only runs when the cache is
/// over its size budget, so it is far cheaper on the hot read path than a
/// VecDeque-based O(n) lookup on every request.
pub struct PngCache {
    max_size: usize,
    cache: HashMap<u64, PngCacheEntry>,
    current_size: usize,
}

impl PngCache {
    pub fn new(max_size_mb: usize) -> Self {
        Self {
            max_size: max_size_mb * 1024 * 1024,
            cache: HashMap::new(),
            current_size: 0,
        }
    }

    fn key(&self, ts_id: &str, frame_id: i32, bin: i32, quality: i32) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        ts_id.hash(&mut hasher);
        frame_id.hash(&mut hasher);
        bin.hash(&mut hasher);
        quality.hash(&mut hasher);
        hasher.finish()
    }

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    pub fn get(
        &mut self,
        ts_id: &str,
        frame_id: i32,
        bin: i32,
        quality: i32,
    ) -> Option<&PngCacheEntry> {
        let key = self.key(ts_id, frame_id, bin, quality);
        let entry = self.cache.get_mut(&key)?;
        entry.last_accessed = Self::now();
        Some(&*entry)
    }

    pub fn put(
        &mut self,
        ts_id: &str,
        frame_id: i32,
        bin: i32,
        quality: i32,
        data: Vec<u8>,
        mtime: Option<u64>,
    ) {
        let key = self.key(ts_id, frame_id, bin, quality);
        let size = data.len();

        // Remove if exists
        if let Some(old) = self.cache.remove(&key) {
            self.current_size -= old.data.len();
        }

        // Evict oldest entries if needed
        while self.current_size + size > self.max_size && !self.cache.is_empty() {
            let oldest_key = self
                .cache
                .iter()
                .min_by_key(|(_, entry)| entry.last_accessed)
                .map(|(k, _)| *k);
            if let Some(k) = oldest_key {
                if let Some(old) = self.cache.remove(&k) {
                    self.current_size -= old.data.len();
                }
            } else {
                break;
            }
        }

        // Add new entry
        self.cache.insert(
            key,
            PngCacheEntry {
                data,
                mtime,
                last_accessed: Self::now(),
            },
        );
        self.current_size += size;
    }

    #[allow(dead_code)] // We'll keep it for future use!
    pub fn clear(&mut self) {
        self.cache.clear();
        self.current_size = 0;
    }
}
