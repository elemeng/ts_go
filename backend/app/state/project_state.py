from typing import Dict, List, Optional
from app.models.types import TiltSeries, ScanConfig


class ProjectState:
    """
    Simple project state manager.
    Selections are managed by frontend - backend just stores current tilt series state.
    On save, frontend sends selections, backend writes directly to disk.
    """

    def __init__(self):
        self.config: Optional[ScanConfig] = None
        self.tilt_series: Dict[str, TiltSeries] = {}  # id -> TiltSeries

    def set_config(self, config: ScanConfig):
        self.config = config
        self.tilt_series.clear()

    def add_tilt_series(self, ts: TiltSeries):
        self.tilt_series[ts.id] = ts

    def get_tilt_series(self, ts_id: str) -> Optional[TiltSeries]:
        return self.tilt_series.get(ts_id)

    def remove_tilt_series_by_mdoc_path(self, mdoc_path: str):
        """Remove tilt series by mdoc path"""
        to_remove = [ts_id for ts_id, ts in self.tilt_series.items() if ts.mdocPath == mdoc_path]
        for ts_id in to_remove:
            del self.tilt_series[ts_id]

    def list_tilt_series(self) -> List[TiltSeries]:
        return list(self.tilt_series.values())

    def update_tilt_series_frames(self, mdoc_path: str, selections: Dict[int, bool]) -> bool:
        """
        Update tilt series frames based on selections (keep only selected frames).
        Returns True if found and updated.
        selections: zIndex -> selected (True = keep frame)
        """
        ts = next((t for t in self.tilt_series.values() if t.mdocPath == mdoc_path), None)
        if not ts:
            return False
        
        # Filter frames and update in one pass
        updated_frames = []
        min_angle = float('inf')
        max_angle = float('-inf')
        
        for frame in ts.frames:
            if selections.get(frame.zIndex, True):
                updated_frames.append(frame)
                if frame.angle < min_angle:
                    min_angle = frame.angle
                if frame.angle > max_angle:
                    max_angle = frame.angle
        
        if updated_frames:
            from app.models.types import TiltSeries
            updated_ts = TiltSeries(
                id=ts.id,
                mdocPath=ts.mdocPath,
                frames=updated_frames,
                angleRange=(min_angle, max_angle),
            )
            self.tilt_series[ts.id] = updated_ts
        
        return True


# Global state instance
project_state = ProjectState()
