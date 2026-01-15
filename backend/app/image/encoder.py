import numpy as np
from PIL import Image
from pathlib import Path


def encode_png(img: np.ndarray, quality: int = 90) -> bytes:
    """Encode numpy array as PNG bytes"""
    if img.dtype != np.uint8:
        img = img.astype(np.uint8)

    pil_img = Image.fromarray(img)
    import io
    buffer = io.BytesIO()
    pil_img.save(buffer, format='PNG', optimize=True)
    return buffer.getvalue()


def save_png(img: np.ndarray, path: str, quality: int = 90):
    """Save numpy array as PNG file"""
    if img.dtype != np.uint8:
        img = img.astype(np.uint8)

    pil_img = Image.fromarray(img)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    pil_img.save(path, optimize=True)