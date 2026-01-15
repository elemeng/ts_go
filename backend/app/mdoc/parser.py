from typing import List
from pathlib import Path

from app.models.types import TiltSeries, Frame
from app.matcher.cut_match import ImageMatcher
from fastapi import HTTPException


def parse_mdoc_file(mdoc_path: str, matcher: ImageMatcher) -> TiltSeries:
	"""
	Parse mdoc file and return TiltSeries.

	SerialEM mdoc format:
	- [TiltSeries] section with ImageFile
	- [ZValue = X] sections for each frame

	Args:
		mdoc_path: Path to mdoc file
		matcher: ImageMatcher instance for matching image files

	Returns:
		TiltSeries object with parsed frames

	Raises:
		HTTPException: If file not found or parsing fails
	"""
	mdoc_path = Path(mdoc_path)
	if not mdoc_path.exists():
		raise HTTPException(status_code=404, detail=f"mdoc file not found: {mdoc_path}")

	frames: List[Frame] = []
	angles: List[float] = []

	try:
		with open(mdoc_path, 'r') as f:
			lines = f.readlines()

		current_frame = None
		z_index = 0
		image_file = None

		for line in lines:
			line = line.strip()
			if not line:
				continue

			# Parse TiltSeries section header
			if line.startswith('[TiltSeries]'):
				continue

			# Parse ZValue section (SerialEM format)
			if line.startswith('[ZValue ='):
				if current_frame:
					frames.append(current_frame)
				# Extract ZValue from section header: [ZValue = X]
				try:
					z_value = int(line.split('=')[1].split(']')[0].strip())
				except (IndexError, ValueError):
					z_value = z_index  # Fallback to incrementing if parsing fails
				current_frame = Frame(zIndex=z_value, angle=0.0, mrcPath='', selected=True)
				z_index = z_value + 1  # Update for next frame
				continue

			# Parse key-value pairs
			if '=' in line:
				key, value = line.split('=', 1)
				key = key.strip()
				value = value.strip()

				# Extract ImageFile from header (before first ZValue section)
				if current_frame is None and key == 'ImageFile':
					image_file = value
				elif current_frame:
					if key == 'TiltAngle':
						current_frame.angle = float(value)
						angles.append(current_frame.angle)
					elif key == 'SubFramePath':
						# Match to image file using SubFramePath
						# Convert Windows backslashes to forward slashes for Path parsing
						normalized_path = value.replace('\\', '/')
						# Extract just the filename from the path
						filename = Path(normalized_path).name
						# Strip extension before matching since mdoc may reference .tif but actual files are .mrc
						filename_no_ext = Path(filename).stem
						matched_path = matcher.match(filename_no_ext)
						if matched_path:
							current_frame.mrcPath = matched_path
						else:
							# Try with original filename
							matched_path = matcher.match(filename)
							if matched_path:
								current_frame.mrcPath = matched_path
							else:
								current_frame.mrcPath = filename  # Keep original if no match

		# Add last frame
		if current_frame:
			frames.append(current_frame)

		if not frames:
			raise HTTPException(status_code=400, detail=f"No frames found in mdoc: {mdoc_path}")

		angle_range = (min(angles), max(angles)) if angles else (0.0, 0.0)

		return TiltSeries(
			id=mdoc_path.stem,
			mdocPath=str(mdoc_path),
			frames=frames,
			angleRange=angle_range,
		)

	except HTTPException:
		raise
	except Exception as e:
		raise HTTPException(status_code=500, detail=f"Error parsing mdoc: {str(e)}")