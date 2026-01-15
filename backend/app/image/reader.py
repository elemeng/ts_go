import numpy as np
from pathlib import Path
from typing import Optional
import mrcfile


def read_mrc(path: str) -> Optional[np.ndarray]:
    """Read MRC file and return 2D numpy array"""
    try:
        with mrcfile.open(path) as mrc:
            data = mrc.data
            if data.ndim == 3:
                return data[0]  # Take first slice if 3D
            return data
    except Exception as e:
        print(f"Error reading MRC {path}: {e}")
        return None


def read_image(path: str) -> Optional[np.ndarray]:
    """Read image file (MRC or TIFF)"""
    path = Path(path)
    suffix = path.suffix.lower()

    if suffix in ['.mrc', '.mrcs', '.rec']:
        return read_mrc(path)
    elif suffix in ['.tif', '.tiff']:
        try:
            from tifffile import imread
            data = imread(path)
            if data.ndim == 3:
                return data[0]
            return data
        except Exception as e:
            print(f"Error reading TIFF {path}: {e}")
            return None
    else:
        print(f"Unsupported image format: {suffix}")
        return None