from fastapi import APIRouter, HTTPException

from app.state.project_state import project_state

router = APIRouter()


@router.get("/{ts_id}/{frame_id}")
async def get_frame(ts_id: str, frame_id: int):
	"""Get a specific frame from a tilt series"""
	ts = project_state.get_tilt_series(ts_id)
	if not ts:
		raise HTTPException(status_code=404, detail=f"Tilt series not found: {ts_id}")

	frame = next((f for f in ts.frames if f.zIndex == frame_id), None)
	if not frame:
		raise HTTPException(status_code=404, detail=f"Frame not found: {frame_id}")

	# Get effective selection state
	effective_selected = project_state.get_frame_override(ts.mdocPath, frame_id, frame.selected)

	return {
		"zIndex": frame.zIndex,
		"angle": frame.angle,
		"mrcPath": frame.mrcPath,
		"originalSelected": frame.selected,
		"effectiveSelected": effective_selected,
		"hasOverride": project_state.get_frame_override(ts.mdocPath, frame_id, frame.selected) != frame.selected,
	}


@router.post("/{ts_id}/{frame_id}/select")
async def select_frame(ts_id: str, frame_id: int, selected: bool):
	"""Set selection state for a specific frame"""
	ts = project_state.get_tilt_series(ts_id)
	if not ts:
		raise HTTPException(status_code=404, detail=f"Tilt series not found: {ts_id}")

	frame = next((f for f in ts.frames if f.zIndex == frame_id), None)
	if not frame:
		raise HTTPException(status_code=404, detail=f"Frame not found: {frame_id}")

	project_state.set_frame_override(ts.mdocPath, {frame_id: selected})

	return {
		"success": True,
		"frameId": frame_id,
		"selected": selected,
		"effectiveSelected": project_state.get_frame_override(ts.mdocPath, frame_id, frame.selected),
	}


@router.post("/{ts_id}/{frame_id}/toggle")
async def toggle_frame_selection(ts_id: str, frame_id: int):
	"""Toggle selection state for a specific frame"""
	ts = project_state.get_tilt_series(ts_id)
	if not ts:
		raise HTTPException(status_code=404, detail=f"Tilt series not found: {ts_id}")

	frame = next((f for f in ts.frames if f.zIndex == frame_id), None)
	if not frame:
		raise HTTPException(status_code=404, detail=f"Frame not found: {frame_id}")

	current = project_state.get_frame_override(ts.mdocPath, frame_id, frame.selected)
	new_state = not current

	project_state.set_frame_override(ts.mdocPath, {frame_id: new_state})

	return {
		"success": True,
		"frameId": frame_id,
		"previousState": current,
		"newState": new_state,
	}