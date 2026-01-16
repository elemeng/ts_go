from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pathlib import Path
import asyncio
from threading import Lock

from app.state.project_state import project_state
from app.image.reader import read_image
from app.image.binning import bin_ndarray
from app.image.contrast import autocontrast_minmax
from app.image.encoder import save_png, encode_png
from app.cache.lru import png_cache

router = APIRouter()

# 并发控制：防止重复生成相同的 PNG
_inflight_tasks: dict[tuple[str, int, int, int], asyncio.Future] = {}
_inflight_lock = Lock()


def get_png_path(ts_id: str, frame_id: int, bin: int, quality: int) -> Path:
    """Generate PNG file path"""
    config = project_state.config
    if not config:
        raise HTTPException(status_code=400, detail="Project not scanned")

    png_dir = Path(config.png_dir) / ts_id / f"bin{bin}"
    png_dir.mkdir(parents=True, exist_ok=True)
    return png_dir / f"frame_{frame_id:04d}_q{quality}.png"


@router.get("/{ts_id}/{frame_id}")
async def get_preview(ts_id: str, frame_id: int, bin: int = 8, quality: int = 90):
    """Get PNG preview for a frame"""
    try:
        # Validate parameters
        if bin not in [1, 2, 4, 8]:
            raise HTTPException(status_code=400, detail="bin must be 1, 2, 4, or 8")
        if quality < 1 or quality > 100:
            raise HTTPException(
                status_code=400, detail="quality must be between 1 and 100"
            )

        task_key = (ts_id, frame_id, bin, quality)

        # 检查是否有正在进行的相同任务
        with _inflight_lock:
            if task_key in _inflight_tasks:
                # 等待现有任务完成
                return await _inflight_tasks[task_key]
            # 创建新任务
            future = asyncio.Future()
            _inflight_tasks[task_key] = future

        try:
            # Check memory cache
            cached = png_cache.get(ts_id, frame_id, bin, quality)
            if cached:
                future.set_result(Response(content=cached, media_type="image/png"))
                return future.result()

            # Check disk cache
            png_path = get_png_path(ts_id, frame_id, bin, quality)
            if png_path.exists():
                with open(png_path, "rb") as f:
                    data = f.read()
                png_cache.put(ts_id, frame_id, bin, quality, data)
                future.set_result(Response(content=data, media_type="image/png"))
                return future.result()

            # Generate PNG
            ts = project_state.get_tilt_series(ts_id)
            if not ts:
                raise HTTPException(
                    status_code=404, detail=f"Tilt series not found: {ts_id}"
                )

            # Find frame
            frame = None
            for f in ts.frames:
                if f.zIndex == frame_id:
                    frame = f
                    break

            if not frame:
                raise HTTPException(
                    status_code=404, detail=f"Frame not found: {frame_id}"
                )

            # Read raw image
            img = read_image(frame.mrcPath)
            if img is None:
                raise HTTPException(
                    status_code=404, detail=f"Failed to read image: {frame.mrcPath}"
                )

            # Bin if needed
            if bin > 1:
                img = bin_ndarray(img, bin)

            # Apply autocontrast
            img = autocontrast_minmax(
                img,
                lower_percentile=0.1,
                upper_percentile=99.9,
                gamma=0.75,  # Slight boost for low-contrast proteins
                bg_subtract=False,
            )

            # Save to disk
            save_png(img, str(png_path), quality)

            # Encode and cache
            data = encode_png(img, quality)
            png_cache.put(ts_id, frame_id, bin, quality, data)

            result = Response(content=data, media_type="image/png")
            future.set_result(result)
            return result

        finally:
            # Cleanup task record
            with _inflight_lock:
                if task_key in _inflight_tasks:
                    del _inflight_tasks[task_key]

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PNG generation failed: {str(e)}")


@router.get("/capabilities")
async def get_capabilities():
    """Get PNG generation capabilities"""
    return {
        "supported_bins": [1, 2, 4, 8],
        "default_bin": 8,
        "quality_range": [1, 100],
        "default_quality": 90,
        "format": "PNG",
    }
