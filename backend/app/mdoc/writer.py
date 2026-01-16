from pathlib import Path
from typing import Dict
from fastapi import HTTPException


def write_mdoc_with_selections(
	mdoc_path: str,
	selections: Dict[int, bool],
	backup_path: str | None = None
) -> str:
	"""
	Write mdoc file with frame selections - FIXED VERSION

	Frames that are not selected are removed from the file.
	ZValues are preserved as immutable identifiers (not reassigned).

	IMPORTANT DATA CONSISTENCY:
	- ZValue serves as the immutable primary key for each frame
	- ZValue must NEVER be modified or reassigned
	- ZValue maps 1:1 with frame metadata (angle, mrcPath, etc.)
	- When frames are deleted, remaining frames keep their original ZValues
	- This ensures frontend-backend consistency across save/rescan cycles

	Args:
		mdoc_path: Path to mdoc file
		selections: Dictionary mapping original zIndex -> selected state
		backup_path: Optional path for backup file

	Returns:
		Path to backup file (if created)

	Raises:
		HTTPException: If file operations fail
	"""
	mdoc_path = Path(mdoc_path)
	if not mdoc_path.exists():
		raise HTTPException(status_code=404, detail=f"mdoc file not found: {mdoc_path}")

	# Create backup ONLY if it doesn't exist (preserve original backup)
	backup = None
	if backup_path:
		backup = Path(backup_path)
	else:
		backup = mdoc_path.with_suffix('.mdoc.bak')

	import shutil
	# Only create backup if it doesn't already exist
	if not backup.exists():
		shutil.copy2(mdoc_path, backup)

	try:
		# Read and modify mdoc
		with open(mdoc_path, 'r') as f:
			lines = f.readlines()

		modified_lines = []
		current_frame_z = None  # This tracks the original ZValue we're processing
		in_frame_section = False
		skip_frame = False
		frame_buffer = []  # Buffer to hold current frame lines
		header_lines = []  # Store header lines before first frame

		for line in lines:
			stripped = line.strip()

			# Store header lines (before first frame)
			if current_frame_z is None and not stripped.startswith('[ZValue'):
				header_lines.append(line)
				continue

			# Start of a new frame section
			if stripped.startswith('[ZValue'):
				# Process previous frame if any
				if current_frame_z is not None and not skip_frame:
					# Write out the kept frame with ORIGINAL ZValue (immutable)
					# CRITICAL: We preserve the entire frame_buffer including original ZValue line
					# This ensures ZValue never changes, maintaining data consistency
					modified_lines.extend(frame_buffer)

				# Parse the original Z value
				try:
					current_frame_z = int(stripped.split('=')[1].split(']')[0].strip())
				except (IndexError, ValueError):
					current_frame_z = None
					skip_frame = True
					continue

				# Check if this frame should be kept
				selected = selections.get(current_frame_z, True)
				skip_frame = not selected

				# Reset frame buffer for new frame
				frame_buffer = [line]  # Store the original ZValue line as first item
				in_frame_section = True

			elif in_frame_section:
				# Collect all lines for this frame
				frame_buffer.append(line)

		# Process the last frame
		if current_frame_z is not None and not skip_frame:
			# Write out the kept frame with ORIGINAL ZValue (immutable)
			modified_lines.extend(frame_buffer)

		# Combine header and modified frames
		final_lines = header_lines + modified_lines

		# Write to temp file first for atomic operation
		temp_path = mdoc_path.with_suffix('.mdoc.tmp')
		with open(temp_path, 'w') as f:
			f.writelines(final_lines)

		# Atomic rename (overwrite original)
		temp_path.replace(mdoc_path)

		return str(backup)

	except Exception as e:
		# Clean up temp file if it exists
		temp_path = mdoc_path.with_suffix('.mdoc.tmp')
		if temp_path.exists():
			temp_path.unlink()
		raise HTTPException(status_code=409, detail=f"Failed to write mdoc: {str(e)}")