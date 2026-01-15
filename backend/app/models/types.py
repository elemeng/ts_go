from pydantic import BaseModel
from typing import List, Optional, Dict


class Frame(BaseModel):
    zIndex: int
    angle: float
    mrcPath: str
    selected: bool


class TiltSeries(BaseModel):
    id: str
    mdocPath: str
    frames: List[Frame]
    angleRange: tuple[float, float]


class ScanConfig(BaseModel):
    mdoc_dir: str
    image_dir: str
    png_dir: str
    mdoc_prefix_cut: int = 0
    mdoc_suffix_cut: int = 0
    image_prefix_cut: int = 0
    image_suffix_cut: int = 0


class MdocScanResponse(BaseModel):
    tiltSeries: List[TiltSeries]
    total: int


class BatchSaveRequest(BaseModel):
    mdocPath: str
    selections: Dict[int, bool]  # zIndex -> selected


class BatchSaveResponse(BaseModel):
    success: bool
    message: str
    backupPath: Optional[str] = None
    updatedTiltSeries: Optional[TiltSeries] = None


class BackupDeleteRequest(BaseModel):
    mdocPath: str


class BackupDeleteResponse(BaseModel):
    success: bool
    message: str
    backupPath: Optional[str] = None


class PngRequest(BaseModel):
    bin: int = 8
    quality: int = 90