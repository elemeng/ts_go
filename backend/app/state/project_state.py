from typing import Dict, List, Optional
from app.models.types import TiltSeries, ScanConfig


class ProjectState:
    """In-memory project state manager"""

    def __init__(self):
        self.config: Optional[ScanConfig] = None
        self.tilt_series: Dict[str, TiltSeries] = {}  # id -> TiltSeries
        self.frame_overrides: Dict[str, Dict[int, bool]] = {}  # mdocPath -> zIndex -> selected

    def set_config(self, config: ScanConfig):
        self.config = config
        self.tilt_series.clear()
        self.frame_overrides.clear()

    def add_tilt_series(self, ts: TiltSeries):
        self.tilt_series[ts.id] = ts

    def get_tilt_series(self, ts_id: str) -> Optional[TiltSeries]:
        return self.tilt_series.get(ts_id)

    def remove_tilt_series_by_mdoc_path(self, mdoc_path: str):
        """Remove tilt series by mdoc path"""
        to_remove = [ts_id for ts_id, ts in self.tilt_series.items() if ts.mdocPath == mdoc_path]
        for ts_id in to_remove:
            del self.tilt_series[ts_id]
        # Also clear overrides
        if mdoc_path in self.frame_overrides:
            del self.frame_overrides[mdoc_path]

    def list_tilt_series(self) -> List[TiltSeries]:
        return list(self.tilt_series.values())

    def set_frame_override(self, mdoc_path: str, overrides: Dict[int, bool]):
        self.frame_overrides[mdoc_path] = overrides

    def get_frame_override(self, mdoc_path: str, z_index: int, original: bool) -> bool:
        if mdoc_path not in self.frame_overrides:
            return original
        return self.frame_overrides[mdoc_path].get(z_index, original)

    def get_all_overrides(self, mdoc_path: str) -> Dict[int, bool]:
        return self.frame_overrides.get(mdoc_path, {})

    def clear_overrides(self, mdoc_path: str):
        if mdoc_path in self.frame_overrides:
            del self.frame_overrides[mdoc_path]

    def has_unsaved_changes(self, mdoc_path: str) -> bool:
        return mdoc_path in self.frame_overrides and len(self.frame_overrides[mdoc_path]) > 0


# Global state instance
project_state = ProjectState()