import numpy as np


def autocontrast_minmax(
    img: np.ndarray,
    lower_percentile: float = 0.1,
    upper_percentile: float = 99.9,
    gamma: float = 1.0,
    bg_subtract: bool = True,
    out_dtype: np.dtype = np.uint8,
) -> np.ndarray:
    """
    Robust min/max autocontrast with percentile clipping for cryo-ET data.

    Args:
        img: Input image array (any numeric dtype)
        lower_percentile: Lower percentile for robust min (0-100).
                          Use 0.1 for cryo-ET to exclude ice artifacts
        upper_percentile: Upper percentile for robust max (0-100).
                          Use 99.9 for cryo-ET to exclude carbon edges
        gamma: Gamma correction factor. Use 0.7-0.8 for cryo-ET to boost low contrast
        bg_subtract: Subtract median background from corners before scaling
        out_dtype: Output dtype (default: uint8). For float, returns [0,1] range

    Returns:
        Contrast-enhanced image scaled to full range of out_dtype
    """
    # Work with float64 for safety
    data = img.astype(np.float64)

    # Robust percentile clipping (ignores outliers)
    if lower_percentile > 0 or upper_percentile < 100:
        min_val = np.percentile(data, lower_percentile)
        max_val = np.percentile(data, upper_percentile)
    else:
        min_val, max_val = data.min(), data.max()

    # Handle uniform data
    if max_val == min_val:
        if out_dtype == np.uint8:
            return np.zeros_like(data, dtype=np.uint8)
        return np.full_like(data, data.min(), dtype=out_dtype)

    # Optional background subtraction (cryo-ET specific)
    if bg_subtract:
        # Estimate background from corners (avoids biological features)
        corner_data = np.concatenate(
            [
                data[:10, :10].ravel(),
                data[-10:, :10].ravel(),
                data[:10, -10:].ravel(),
                data[-10:, -10:].ravel(),
            ]
        )
        bg_value = np.median(corner_data)
        data = data - bg_value
        max_val = max_val - bg_value  # Adjust max after subtraction

    # Normalize to [0, 1]
    data = (data - min_val) / (max_val - min_val)

    # Apply gamma correction for nonlinear contrast enhancement
    if gamma != 1.0:
        data = np.power(np.clip(data, 0, 1), gamma)

    # Scale to output dtype
    if out_dtype == np.uint8:
        return (data * 255).astype(np.uint8)
    elif out_dtype == np.uint16:
        return (data * 65535).astype(np.uint16)
    elif out_dtype.kind == "f":
        return data.astype(out_dtype)  # Already in [0,1] for float types
    else:
        # For other integer types
        max_val = np.iinfo(out_dtype).max
        return (data * max_val).astype(out_dtype)
