use std::collections::HashMap;
use std::path::Path;

/// Extract matching key from filename using prefix/suffix cuts.
fn cut_key(filename: &str, prefix_cut: usize, suffix_cut: usize) -> Option<String> {
    if prefix_cut + suffix_cut > filename.len() {
        return None;
    }
    Some(filename[prefix_cut..filename.len() - suffix_cut].to_string())
}

/// Matches mdoc entries to image files using cut keys.
pub struct ImageMatcher {
    image_dir: String,
    image_prefix_cut: usize,
    image_suffix_cut: usize,
    cache: HashMap<String, String>,
}

impl ImageMatcher {
    pub fn new(image_dir: &str, image_prefix_cut: usize, image_suffix_cut: usize) -> Self {
        Self {
            image_dir: image_dir.to_string(),
            image_prefix_cut,
            image_suffix_cut,
            cache: HashMap::new(),
        }
    }

    /// Scan image directory and build key -> path cache.
    pub fn build_cache(&mut self) {
        self.cache.clear();
        let dir = Path::new(&self.image_dir);
        if !dir.exists() {
            return;
        }

        let walker = walkdir::WalkDir::new(dir).max_depth(10);
        for entry in walker.into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                let stem = Path::new(&name)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();

                // Cache with both keys, preferring the full name
                if let Some(key) = cut_key(&name, self.image_prefix_cut, self.image_suffix_cut) {
                    self.cache.insert(key, entry.path().to_string_lossy().to_string());
                }
                if !stem.is_empty() {
                    if let Some(key) = cut_key(&stem, self.image_prefix_cut, self.image_suffix_cut) {
                        self.cache.insert(key, entry.path().to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    /// Match a filename to an image path.
    pub fn match_filename(&self, filename: &str) -> Option<String> {
        // Try with full name
        if let Some(key) = cut_key(filename, self.image_prefix_cut, self.image_suffix_cut) {
            if let Some(path) = self.cache.get(&key) {
                return Some(path.clone());
            }
        }

        // Try without extension
        let stem = Path::new(filename)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if !stem.is_empty() {
            if let Some(key) = cut_key(&stem, self.image_prefix_cut, self.image_suffix_cut) {
                if let Some(path) = self.cache.get(&key) {
                    return Some(path.clone());
                }
            }
        }

        None
    }
}
