/**
 * Frame - Represents a single frame in a tilt series.
 * zIndex is an immutable identifier that must never change.
 */
export interface Frame {
  zIndex: number;
  angle: number;
  mrcPath: string;
  selected: boolean;
}

/** Represents a complete tilt series from an mdoc file. */
export interface TiltSeries {
  id: string;
  mdocPath: string;
  frames: Frame[];
  angleRange: [number, number];
}

/** Configuration for scanning a project directory. */
export interface ScanConfig {
  mdoc_dir: string;
  image_dir: string;
  png_dir: string;
  mdoc_prefix_cut?: number;
  mdoc_suffix_cut?: number;
  image_prefix_cut?: number;
  image_suffix_cut?: number;
}

/** Selection state: Map<mdocPath, Map<zIndex, boolean>> */
export type SelectionState = Map<string, Map<number, boolean>>;

/** PNG cache item */
export interface PngCacheItem {
  data: Blob;
  timestamp: number;
  size: number;
}

/** Result from saveAll API */
export interface SaveAllResult {
  success: boolean;
  saved: string[];
  failed: string[];
  deleted: string[];
  message: string;
}

/** Cache progress info */
export interface CacheProgress {
  cached: number;
  total: number;
  currentTs: string;
  currentFrame: number;
}
