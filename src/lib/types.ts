// Frame = mdoc 中的一帧
export interface Frame {
	zIndex: number
	angle: number
	mrcPath: string
	selected: boolean
}

// 一个 mdoc = 一个 Tilt Series
export interface TiltSeries {
	id: string
	mdocPath: string
	frames: Frame[]
	angleRange: [number, number]
}

// 扫描配置
export interface ScanConfig {
	mdoc_dir: string
	image_dir: string
	png_dir: string
	mdoc_prefix_cut?: number
	mdoc_suffix_cut?: number
	image_prefix_cut?: number
	image_suffix_cut?: number
}

// 选择状态 Map<mdocPath, Map<zIndex, boolean>>
export type SelectionState = Map<string, Map<number, boolean>>

// PNG 缓存项
export interface PngCacheItem {
	data: Blob
	timestamp: number
	size: number
}