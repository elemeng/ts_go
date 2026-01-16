from os import cpu_count
from fastapi import APIRouter, HTTPException
from pathlib import Path
from typing import List
import shutil
import asyncio

from app.models.types import (
    TiltSeries,
    ScanConfig,
    MdocScanResponse,
    BatchSaveRequest,
    BatchSaveResponse,
    BackupDeleteRequest,
    BackupDeleteResponse,
)
from app.state.project_state import project_state
from app.matcher.cut_match import ImageMatcher
from app.mdoc.parser import parse_mdoc_file
from app.mdoc.writer import write_mdoc_with_selections

router = APIRouter()


@router.post("/scan", response_model=MdocScanResponse)
async def scan_project(config: ScanConfig):
    """Scan project directory for mdoc files"""
    try:
        project_state.set_config(config)

        # Build image matcher cache
        matcher = ImageMatcher(
            config.image_dir,
            config.image_prefix_cut,
            config.image_suffix_cut,
        )
        matcher.build_cache()

        # Scan for mdoc files
        mdoc_dir = Path(config.mdoc_dir)
        if not mdoc_dir.exists():
            raise HTTPException(
                status_code=404, detail=f"mdoc directory not found: {config.mdoc_dir}"
            )

        # Collect all mdoc files first
        mdoc_files = list(mdoc_dir.rglob("*.mdoc"))
        print(f"Found {len(mdoc_files)} mdoc files to scan")

        # Parse mdoc files in parallel
        from concurrent.futures import ProcessPoolExecutor
        import functools

        def parse_single_mdoc(mdoc_file_path: str):
            """Parse a single mdoc file - runs in worker process"""
            try:
                ts = parse_mdoc_file(mdoc_file_path, matcher)
                return ts
            except Exception as e:
                print(f"Warning: Failed to parse {mdoc_file_path}: {e}")
                return None

        # Use ProcessPoolExecutor for parallel parsing

        tilt_series: List[TiltSeries] = []
        max_workers = min(
            cpu_count(), len(mdoc_files)
        )  # Limit to 4 workers or number of files

        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            # Submit all parsing tasks
            future_to_file = {
                executor.submit(parse_single_mdoc, str(mdoc_file)): mdoc_file
                for mdoc_file in mdoc_files
            }

            # Collect results as they complete
            for future in future_to_file:
                try:
                    ts = await asyncio.get_event_loop().run_in_executor(
                        None, future.result
                    )
                    if ts:
                        project_state.add_tilt_series(ts)
                        tilt_series.append(ts)
                except Exception as e:
                    mdoc_file = future_to_file[future]
                    print(f"Warning: Failed to parse {mdoc_file}: {e}")

        print(f"Successfully scanned {len(tilt_series)} tilt series")

        

                return MdocScanResponse(tiltSeries=tilt_series, total=len(tilt_series))

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scan failed: {str(e)}")


@router.get("/list")
async def list_tilt_series():
    """List all tilt series"""
    return project_state.list_tilt_series()


@router.get("/{ts_id}")
async def get_tilt_series(ts_id: str):
    """Get specific tilt series"""
    ts = project_state.get_tilt_series(ts_id)
    if not ts:
        raise HTTPException(status_code=404, detail=f"Tilt series not found: {ts_id}")
    return ts


@router.post("/batch-save", response_model=BatchSaveResponse)
async def batch_save(request: BatchSaveRequest):
    """Save frame selections to mdoc file"""
    try:
        ts = None
        for tilt_series in project_state.list_tilt_series():
            if tilt_series.mdocPath == request.mdocPath:
                ts = tilt_series
                break

        if not ts:
            raise HTTPException(
                status_code=404, detail=f"Tilt series not found: {request.mdocPath}"
            )

        # Use writer module to save with selections
        backup_path = write_mdoc_with_selections(request.mdocPath, request.selections)

        # Clear overrides
        project_state.clear_overrides(request.mdocPath)

        # Re-parse the mdoc file to get the updated tiltSeries
        from app.matcher.cut_match import ImageMatcher

        config = project_state.config
        if config:
            matcher = ImageMatcher(
                config.image_dir,
                config.image_prefix_cut,
                config.image_suffix_cut,
            )
            matcher.build_cache()
            updated_ts = parse_mdoc_file(request.mdocPath, matcher)
            # Update in project state
            project_state.add_tilt_series(updated_ts)
        else:
            updated_ts = ts

        return BatchSaveResponse(
            success=True,
            message=f"Saved {len(request.selections)} frame selections",
            backupPath=backup_path,
            updatedTiltSeries=updated_ts,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=409, detail=f"Save failed: {str(e)}")


@router.post("/backup-delete", response_model=BackupDeleteResponse)
async def backup_delete(request: BackupDeleteRequest):
    """Backup and delete mdoc file"""
    try:
        mdoc_path = Path(request.mdocPath)
        if not mdoc_path.exists():
            raise HTTPException(
                status_code=404, detail=f"mdoc file not found: {request.mdocPath}"
            )

        # Create backup
        backup = mdoc_path.with_suffix(".mdoc.bak")
        shutil.copy2(mdoc_path, backup)

        # Delete original
        mdoc_path.unlink()

        # Remove from project state
        project_state.remove_tilt_series_by_mdoc_path(request.mdocPath)

        return BackupDeleteResponse(
            success=True,
            message=f"Backed up and deleted {request.mdocPath}",
            backupPath=str(backup),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=409, detail=f"Backup-delete failed: {str(e)}")
