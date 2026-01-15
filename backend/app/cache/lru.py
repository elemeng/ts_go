from typing import Optional, Tuple
from collections import OrderedDict
import hashlib


class LRUCache:
    """LRU cache for PNG data with size-based eviction"""

    def __init__(self, max_size_mb: int = 2048):
        self.max_size = max_size_mb * 1024 * 1024
        self.cache: OrderedDict[str, Tuple[bytes, int]] = OrderedDict()
        self.current_size = 0

    def _key(self, ts_id: str, frame_id: int, bin: int, quality: int) -> str:
        key_str = f"{ts_id}_{frame_id}_bin{bin}_q{quality}"
        return hashlib.md5(key_str.encode()).hexdigest()

    def get(self, ts_id: str, frame_id: int, bin: int, quality: int) -> Optional[bytes]:
        key = self._key(ts_id, frame_id, bin, quality)
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key][0]
        return None

    def put(self, ts_id: str, frame_id: int, bin: int, quality: int, data: bytes):
        key = self._key(ts_id, frame_id, bin, quality)
        size = len(data)

        # Remove if exists
        if key in self.cache:
            self.current_size -= self.cache[key][1]
            del self.cache[key]

        # Evict if needed
        while self.current_size + size > self.max_size and self.cache:
            old_key, old_data = self.cache.popitem(last=False)
            self.current_size -= old_data[1]

        # Add new
        self.cache[key] = (data, size)
        self.current_size += size

    def clear(self):
        self.cache.clear()
        self.current_size = 0


# Global cache instance
png_cache = LRUCache(max_size_mb=2048)