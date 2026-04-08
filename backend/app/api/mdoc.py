from os import cpu_count
from fastapi import APIRouter, HTTPException
from pathlib import Path
from typing import List, Dict
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
from pydantic import BaseModel
from app.state.project_state import project_state
from app.matcher.cut_match import ImageMatcher
from app.mdoc.parser import parse_mdoc_file
from app.mdoc.writer import write_mdoc_with_selections

router = APIRouter()


# ===== SAVE ALL REQUEST/RESPONSE =====

class SaveAllRequest(BaseModel):
    """Request to save all mdoc changes. Frontend sends all selections."""
    selections: Dict[str, Dict[int, bool]]  # mdocPath -> {zIndex: selected}


class SaveAllResponse(BaseModel):
    """Response from save all operation."""
    success: bool
    saved: List[str] = []
    failed: List[str] = []
    deleted: List[str] = []
    message: str


class DeleteAllRequest(BaseModel):
    """Request to delete multiple mdoc files."""
    mdocPaths: List[str]


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
        from concurrent.futures import ThreadPoolExecutor

        def parse_single_mdoc(mdoc_file_path: str):
            """Parse a single mdoc file - runs in worker thread"""
            try:
                ts = parse_mdoc_file(mdoc_file_path, matcher)
                return ts
            except Exception as e:
                print(f"Warning: Failed to parse {mdoc_file_path}: {e}")
                return None

        # Use ThreadPoolExecutor for parallel parsing (can share matcher object)
        tilt_series: List[TiltSeries] = []
        max_workers = min(cpu_count() or 4, len(mdoc_files))

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
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
    """
    Save single mdoc file directly to disk.
    NOTE: Consider using /save-all for bulk operations.
    """
    try:
        # Find tilt series
        ts = next((t for t in project_state.list_tilt_series() if t.mdocPath == request.mdocPath), None)
        if not ts:
            raise HTTPException(status_code=404, detail=f"Tilt series not found: {request.mdocPath}")

        # Write directly to disk
        backup_path = write_mdoc_with_selections(request.mdocPath, request.selections)
        
        # Update in-memory state
        project_state.update_tilt_series_frames(request.mdocPath, request.selections)

        return BatchSaveResponse(
            success=True,
            message=f"Saved {len(request.selections)} frame selections",
            backupPath=backup_path,
            updatedTiltSeries=project_state.get_tilt_series(ts.id),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=409, detail=f"Save failed: {str(e)}")


@router.post("/backup-delete", response_model=BackupDeleteResponse)
async def backup_delete(request: BackupDeleteRequest):
    """Backup and delete single mdoc file"""
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


# ===== UNIFIED SAVE ALL API =====

@router.post("/save-all", response_model=SaveAllResponse)
async def save_all(request: SaveAllRequest):
    """
    Save all mdoc changes in one request.
    Frontend sends all selections: {mdocPath: {zIndex: selected}}
    Backend writes directly to disk, no staging.
    """
    saved = []
    failed = []
    
    if not request.selections:
        return SaveAllResponse(
            success=True,
            message="No changes to save",
            saved=[],
            failed=[],
            deleted=[]
        )
    
    # Write each mdoc file directly to disk
    for mdoc_path, selections in request.selections.items():
        try:
            # Verify tilt series exists
            ts = next((t for t in project_state.list_tilt_series() if t.mdocPath == mdoc_path), None)
            if not ts:
                failed.append(f"{mdoc_path}: tilt series not found")
                continue
            
            # Write to disk
            write_mdoc_with_selections(mdoc_path, selections)
            
            # Update in-memory state
            project_state.update_tilt_series_frames(mdoc_path, selections)
            
            saved.append(mdoc_path)
            
        except Exception as e:
            print(f"Failed to save {mdoc_path}: {e}")
            failed.append(f"{mdoc_path}: {str(e)}")
    
    success = len(failed) == 0
    message = f"Saved {len(saved)} mdoc files"
    if failed:
        message += f", {len(failed)} failed"
    
    return SaveAllResponse(
        success=success,
        saved=saved,
        failed=failed,
        deleted=[],
        message=message
    )


@router.post("/delete-all")
async def delete_all(request: DeleteAllRequest):
    """Delete multiple mdoc files in one request"""
    deleted = []
    failed = []
    
    for mdoc_path_str in request.mdocPaths:
        try:
            mdoc_path = Path(mdoc_path_str)
            if not mdoc_path.exists():
                failed.append(f"{mdoc_path_str}: file not found")
                continue

            # Create backup
            backup = mdoc_path.with_suffix(".mdoc.bak")
            shutil.copy2(mdoc_path, backup)

            # Delete original
            mdoc_path.unlink()

            # Remove from project state
            project_state.remove_tilt_series_by_mdoc_path(mdoc_path_str)
            
            deleted.append(mdoc_path_str)
            
        except Exception as e:
            print(f"Failed to delete {mdoc_path_str}: {e}")
            failed.append(f"{mdoc_path_str}: {str(e)}")
    
    return {
        "success": len(failed) == 0,
        "deleted": deleted,
        "failed": failed,
        "message": f"Deleted {len(deleted)} mdoc files, {len(failed)} failed"
    }
