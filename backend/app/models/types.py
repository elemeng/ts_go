from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Dict


class Frame(BaseModel):
    """
    Represents a single frame in a tilt series.
    
    IMPORTANT: zIndex is an immutable identifier that must never change.
    - zIndex: Unique identifier for this frame (from mdoc ZValue)
    - angle: Tilt angle in degrees
    - mrcPath: Path to the MRC file containing this frame
    - selected: Current selection state (mutable)
    
    The zIndex serves as the primary key and should be preserved across
    save operations even if other frames are deleted.
    """
    model_config = ConfigDict(populate_by_name=True)
    
    zIndex: int
    angle: float
    mrcPath: str
    selected: bool


class TiltSeries(BaseModel):
    """
    Represents a complete tilt series from an mdoc file.
    
    IMPORTANT: All fields except 'selected' in frames should be treated as immutable.
    - id: Unique identifier (typically mdoc filename)
    - mdocPath: Absolute path to the mdoc file
    - frames: List of frames (zIndex values are immutable identifiers)
    - angleRange: Min and max tilt angles
    
    When saving, only the 'selected' state of frames should change.
    The zIndex values must never be reassigned or modified.
    """
    model_config = ConfigDict(populate_by_name=True)
    
    id: str
    mdocPath: str
    frames: List[Frame]
    angleRange: tuple[float, float]


class ScanConfig(BaseModel):
    """Configuration for scanning a project directory."""
    mdoc_dir: str
    image_dir: str
    png_dir: str
    mdoc_prefix_cut: int = 0
    mdoc_suffix_cut: int = 0
    image_prefix_cut: int = 0
    image_suffix_cut: int = 0


class MdocScanResponse(BaseModel):
    """Response from project scan operation."""
    model_config = ConfigDict(populate_by_name=True)
    
    tiltSeries: List[TiltSeries]
    total: int


class BatchSaveRequest(BaseModel):
    """
    Request to save frame selections.
    
    IMPORTANT: selections dict maps zIndex (immutable) to selected state.
    The zIndex values must match the original zIndex from the TiltSeries.
    """
    mdocPath: str
    selections: Dict[int, bool]  # zIndex -> selected (zIndex is immutable key)


class BatchSaveResponse(BaseModel):
    """Response from batch save operation."""
    success: bool
    message: str
    backupPath: Optional[str] = None
    updatedTiltSeries: Optional[TiltSeries] = None


class BackupDeleteRequest(BaseModel):
    """Request to backup and delete an mdoc file."""
    mdocPath: str


class BackupDeleteResponse(BaseModel):
    """Response from backup-delete operation."""
    success: bool
    message: str
    backupPath: Optional[str] = None


class PngRequest(BaseModel):
    """Parameters for PNG generation."""
    bin: int = 8
    quality: int = 90