from fastapi import APIRouter, HTTPException
from typing import List, Dict

from app.models.types import BatchSaveRequest, BatchSaveResponse
from app.state.project_state import project_state

router = APIRouter()


@router.get("")
async def list_tilt_series():
	"""List all tilt series"""
	return project_state.list_tilt_series()


@router.get("/{ts_id}")
async def get_tilt_series(ts_id: str):
	"""Get specific tilt series by ID"""
	ts = project_state.get_tilt_series(ts_id)
	if not ts:
		raise HTTPException(status_code=404, detail=f"Tilt series not found: {ts_id}")
	return ts


@router.get("/{ts_id}/frames")
async def get_tilt_series_frames(ts_id: str):
	"""Get frames for a specific tilt series"""
	ts = project_state.get_tilt_series(ts_id)
	if not ts:
		raise HTTPException(status_code=404, detail=f"Tilt series not found: {ts_id}")
	return ts.frames


@router.post("/{ts_id}/frames/override")
async def set_frame_overrides(ts_id: str, overrides: Dict[int, bool]):
	"""Set frame overrides for a tilt series"""
	ts = project_state.get_tilt_series(ts_id)
	if not ts:
		raise HTTPException(status_code=404, detail=f"Tilt series not found: {ts_id}")

	project_state.set_frame_override(ts.mdocPath, overrides)
	return {"success": True, "count": len(overrides)}


@router.post("/{ts_id}/frames/batch")
async def batch_frame_operations(ts_id: str, operation: str, frame_ids: List[int]):
	"""Perform batch operations on frames"""
	ts = project_state.get_tilt_series(ts_id)
	if not ts:
		raise HTTPException(status_code=404, detail=f"Tilt series not found: {ts_id}")

	overrides = project_state.get_all_overrides(ts.mdocPath)
	modified_count = 0

	for frame_id in frame_ids:
		frame = next((f for f in ts.frames if f.zIndex == frame_id), None)
		if not frame:
			continue

		if operation == "select":
			overrides[frame_id] = True
		elif operation == "deselect":
			overrides[frame_id] = False
		elif operation == "invert":
			current = overrides.get(frame_id, frame.selected)
			overrides[frame_id] = not current
		elif operation == "reset":
			if frame_id in overrides:
				del overrides[frame_id]

		modified_count += 1

	project_state.set_frame_override(ts.mdocPath, overrides)
	return {"success": True, "modifiedCount": modified_count}


@router.post("/{ts_id}/save", response_model=BatchSaveResponse)
async def save_tilt_series(ts_id: str):
	"""Save a specific tilt series"""
	ts = project_state.get_tilt_series(ts_id)
	if not ts:
		raise HTTPException(status_code=404, detail=f"Tilt series not found: {ts_id}")

	overrides = project_state.get_all_overrides(ts.mdocPath)
	if not overrides:
		return BatchSaveResponse(
			success=True,
			message="No changes to save",
			backupPath=None,
		)

	# Import here to avoid circular dependency
	from app.api.mdoc import batch_save as save_ts
	request = BatchSaveRequest(mdocPath=ts.mdocPath, selections=overrides)
	return await save_ts(request)


@router.post("/{ts_id}/reset")
async def reset_tilt_series(ts_id: str):
	"""Reset all overrides for a tilt series"""
	ts = project_state.get_tilt_series(ts_id)
	if not ts:
		raise HTTPException(status_code=404, detail=f"Tilt series not found: {ts_id}")

	project_state.clear_overrides(ts.mdocPath)
	return {"success": True, "message": f"Reset {ts.id}"}