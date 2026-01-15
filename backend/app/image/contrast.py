import numpy as np


def autocontrast_minmax(img: np.ndarray) -> np.ndarray:
    """
    Apply min/max autocontrast to image.
    Uses global min/max scaling - no histogram equalization or CLAHE.
    """
    min_val = img.min()
    max_val = img.max()

    if max_val == min_val:
        return np.zeros_like(img, dtype=np.uint8)

    # Scale to 0-255
    scaled = (img - min_val) / (max_val - min_val)
    return (scaled * 255).astype(np.uint8)