from typing import Dict, Optional
from pathlib import Path


def cut_key(filename: str, prefix_cut: int, suffix_cut: int) -> str:
    """
    Extract matching key from filename using prefix/suffix cuts.
    Cuts apply to entire filename including extension.
    """
    if prefix_cut < 0 or suffix_cut < 0:
        raise ValueError("Cut values must be non-negative")
    if prefix_cut + suffix_cut > len(filename):
        raise ValueError("Total cut exceeds filename length")
    return filename[prefix_cut : len(filename) - suffix_cut]


class ImageMatcher:
    """Matches mdoc entries to image files using cut keys"""

    def __init__(self, image_dir: str, image_prefix_cut: int = 0, image_suffix_cut: int = 0):
        self.image_dir = Path(image_dir)
        self.image_prefix_cut = image_prefix_cut
        self.image_suffix_cut = image_suffix_cut
        self._cache: Dict[str, str] = {}

    def build_cache(self):
        """Scan image directory and build key -> path cache"""
        self._cache.clear()
        if not self.image_dir.exists():
            return

        for img_path in self.image_dir.rglob("*"):
            if img_path.is_file():
                # Cache both with and without extension
                key_with_ext = cut_key(img_path.name, self.image_prefix_cut, self.image_suffix_cut)
                key_no_ext = cut_key(img_path.stem, self.image_prefix_cut, self.image_suffix_cut)
                # Store with both keys, preferring the full name
                self._cache[key_with_ext] = str(img_path)
                self._cache[key_no_ext] = str(img_path)

    def match(self, filename: str) -> Optional[str]:
        """Match a filename to an image path"""
        # Try with extension first
        key = cut_key(filename, self.image_prefix_cut, self.image_suffix_cut)
        if key in self._cache:
            return self._cache[key]
        # Try without extension
        key_no_ext = cut_key(Path(filename).stem, self.image_prefix_cut, self.image_suffix_cut)
        return self._cache.get(key_no_ext)