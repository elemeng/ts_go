use std::collections::VecDeque;
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;

/// LRU cache for PNG data with size-based eviction.
pub struct PngCache {
    max_size: usize,
    cache: VecDeque<(u64, Vec<u8>)>,
    current_size: usize,
}

impl PngCache {
    pub fn new(max_size_mb: usize) -> Self {
        Self {
            max_size: max_size_mb * 1024 * 1024,
            cache: VecDeque::new(),
            current_size: 0,
        }
    }

    fn key(&self, ts_id: &str, frame_id: i32, bin: i32, quality: i32) -> u64 {
        let key_str = format!("{ts_id}_{frame_id}_bin{bin}_q{quality}");
        let mut hasher = DefaultHasher::new();
        key_str.hash(&mut hasher);
        hasher.finish()
    }

    pub fn get(&mut self, ts_id: &str, frame_id: i32, bin: i32, quality: i32) -> Option<&[u8]> {
        let key = self.key(ts_id, frame_id, bin, quality);
        if let Some(pos) = self.cache.iter().position(|(k, _)| *k == key) {
            // Move to end (most recently used)
            let entry = self.cache.remove(pos).unwrap();
            self.cache.push_back(entry);
            Some(&self.cache.back().unwrap().1)
        } else {
            None
        }
    }

    pub fn put(&mut self, ts_id: &str, frame_id: i32, bin: i32, quality: i32, data: Vec<u8>) {
        let key = self.key(ts_id, frame_id, bin, quality);
        let size = data.len();

        // Remove if exists
        if let Some(pos) = self.cache.iter().position(|(k, _)| *k == key) {
            let removed = self.cache.remove(pos).unwrap();
            self.current_size -= removed.1.len();
        }

        // Evict oldest entries if needed
        while self.current_size + size > self.max_size && !self.cache.is_empty() {
            if let Some(old) = self.cache.pop_front() {
                self.current_size -= old.1.len();
            }
        }

        // Add new entry
        self.cache.push_back((key, data));
        self.current_size += size;
    }

    pub fn clear(&mut self) {
        self.cache.clear();
        self.current_size = 0;
    }
}
