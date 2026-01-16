/**
 * Frame - Represents a single frame in a tilt series
 * 
 * IMPORTANT: zIndex is an immutable identifier that must never change.
 * - zIndex: Unique identifier for this frame (from mdoc ZValue)
 * - angle: Tilt angle in degrees
 * - mrcPath: Path to the MRC file containing this frame
 * - selected: Current selection state (mutable)
 * 
 * The zIndex serves as the primary key and should be preserved across
 * save operations even if other frames are deleted. It must match
 * exactly with the backend's Frame.zIndex.
 */
export interface Frame {
	/** Immutable unique identifier - never changes even after save */
	zIndex: number;
	/** Tilt angle in degrees */
	angle: number;
	/** Path to the MRC file */
	mrcPath: string;
	/** Selection state - this is the only mutable field */
	selected: boolean;
}

/**
 * TiltSeries - Represents a complete tilt series from an mdoc file
 * 
 * IMPORTANT: All fields except 'selected' in frames should be treated as immutable.
 * - id: Unique identifier (typically mdoc filename)
 * - mdocPath: Absolute path to the mdoc file
 * - frames: List of frames (zIndex values are immutable identifiers)
 * - angleRange: Min and max tilt angles
 * 
 * When saving, only the 'selected' state of frames should change.
 * The zIndex values must never be reassigned or modified.
 */
export interface TiltSeries {
	/** Unique identifier for this tilt series */
	id: string;
	/** Absolute path to the mdoc file */
	mdocPath: string;
	/** List of frames - zIndex values are immutable */
	frames: Frame[];
	/** [min_angle, max_angle] range */
	angleRange: [number, number];
}

/**
 * ScanConfig - Configuration for scanning a project directory
 */
export interface ScanConfig {
	/** Directory containing mdoc files */
	mdoc_dir: string;
	/** Directory containing MRC image files */
	image_dir: string;
	/** Directory for PNG output */
	png_dir: string;
	/** Characters to remove from start of mdoc filenames */
	mdoc_prefix_cut?: number;
	/** Characters to remove from end of mdoc filenames */
	mdoc_suffix_cut?: number;
	/** Characters to remove from start of image filenames */
	image_prefix_cut?: number;
	/** Characters to remove from end of image filenames */
	image_suffix_cut?: number;
}

/**
 * SelectionState - Map of frame selections
 * 
 * Structure: Map<mdocPath, Map<zIndex, boolean>>
 * 
 * IMPORTANT: zIndex keys are immutable identifiers from the original TiltSeries.
 * They must never be modified or reassigned.
 */
export type SelectionState = Map<string, Map<number, boolean>>;

/**
 * PngCacheItem - Cached PNG data
 */
export interface PngCacheItem {
	/** Blob data of the PNG */
	data: Blob;
	/** Last access timestamp */
	timestamp: number;
	/** Size in bytes */
	size: number;
}
