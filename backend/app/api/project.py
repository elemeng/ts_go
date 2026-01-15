from fastapi import APIRouter, HTTPException
from typing import List

from app.models.types import ScanConfig, TiltSeries, BatchSaveRequest
from app.state.project_state import project_state

router = APIRouter()


@router.post("/scan")
async def scan_project(config: ScanConfig):
	"""Scan project directory for mdoc files"""
	# Import here to avoid circular dependency
	from app.api.mdoc import parse_mdoc_file
	from app.matcher.cut_match import ImageMatcher
	from pathlib import Path

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
			raise HTTPException(status_code=404, detail=f"mdoc directory not found: {config.mdoc_dir}")

		tilt_series: List[TiltSeries] = []

		for mdoc_file in mdoc_dir.rglob("*.mdoc"):
			try:
				ts = parse_mdoc_file(str(mdoc_file), matcher)
				project_state.add_tilt_series(ts)
				tilt_series.append(ts)
			except Exception as e:
				print(f"Warning: Failed to parse {mdoc_file}: {e}")
				continue

		return {"tiltSeries": tilt_series, "total": len(tilt_series)}

	except HTTPException:
		raise
	except Exception as e:
		raise HTTPException(status_code=500, detail=f"Scan failed: {str(e)}")


@router.get("/status")
async def get_project_status():
	"""Get current project status"""
	return {
		"totalSeries": len(project_state.list_tilt_series()),
		"hasConfig": project_state.config is not None,
		"unsavedCount": len(project_state.frame_overrides),
	}


@router.post("/save_all")
async def save_all():
	"""Save all modified tilt series"""
	try:
		saved_count = 0
		failed_count = 0
		errors = []

		for ts in project_state.list_tilt_series():
			overrides = project_state.get_all_overrides(ts.mdocPath)
			if not overrides:
				continue

			try:
				# Import here to avoid circular dependency
				from app.api.mdoc import batch_save as save_ts
				request = BatchSaveRequest(mdocPath=ts.mdocPath, selections=overrides)
				result = await save_ts(request)
				if result.success:
					saved_count += 1
				else:
					failed_count += 1
					errors.append(f"{ts.id}: {result.message}")
			except Exception as e:
				failed_count += 1
				errors.append(f"{ts.id}: {str(e)}")

		return {
			"success": failed_count == 0,
			"savedCount": saved_count,
			"failedCount": failed_count,
			"errors": errors,
		}

	except Exception as e:
		raise HTTPException(status_code=500, detail=f"Save all failed: {str(e)}")