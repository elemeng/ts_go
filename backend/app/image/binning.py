import numpy as np


def bin_ndarray(arr: np.ndarray, factor: int) -> np.ndarray:
    """
    Bin downsample numpy array by averaging blocks.
    factor must be a positive integer.
    """
    if factor <= 0:
        raise ValueError("Binning factor must be positive")
    if factor == 1:
        return arr

    h, w = arr.shape
    # Trim to multiple of factor
    arr = arr[: h - h % factor, : w - w % factor]

    # Reshape and mean over block dimensions
    binned = arr.reshape(h // factor, factor, w // factor, factor).mean(axis=(1, 3))
    return binned.astype(arr.dtype)