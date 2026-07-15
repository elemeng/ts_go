use std::path::Path;

/// Matches mdoc entries to image files by checking if the mdoc's filename
/// stem is contained within the mrc filename.
///
/// For example, an mdoc named `Position_1_13.mdoc` will match any mrc file
/// whose name contains `Position_1_13`, such as
/// `Position_1_13_006_-21.00_20260527_144344_EER.mrc`.
pub struct ImageMatcher {
    image_dir: String,
    /// List of (filename_stem, full_path) for all image files found
    files: Vec<(String, String)>,
}

impl ImageMatcher {
    pub fn new(image_dir: &str, _image_prefix_cut: usize, _image_suffix_cut: usize) -> Self {
        Self {
            image_dir: image_dir.to_string(),
            files: Vec::new(),
        }
    }

    /// Scan image directory and build a list of all image files.
    pub fn build_cache(&mut self) {
        self.files.clear();
        let dir = Path::new(&self.image_dir);
        if !dir.exists() {
            return;
        }

        let walker = walkdir::WalkDir::new(dir).max_depth(10);
        for entry in walker.into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let path = entry.path().to_string_lossy().to_string();
                let name = entry.file_name().to_string_lossy().to_string();
                let stem = Path::new(&name)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if !stem.is_empty() {
                    self.files.push((stem, path));
                }
            }
        }
    }

    /// Match a filename to an image path.
    ///
    /// Checks if any known mrc stem contains the given filename as a substring.
    /// This handles the common case where mrc filenames embed the mdoc basename:
    ///   mdoc: Position_1_13.mdoc
    ///   mrc:  Position_1_13_006_-21.00_20260527_144344_EER.mrc
    pub fn match_filename(&self, filename: &str) -> Option<String> {
        if filename.is_empty() {
            return None;
        }

        for (stem, path) in &self.files {
            if stem.contains(filename) {
                return Some(path.clone());
            }
        }

        None
    }
}
