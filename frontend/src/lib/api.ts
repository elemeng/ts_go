import type {
  SaveAllResult,
  ScanConfig,
  SelectionState,
  TiltSeries,
} from "./types";

// API base URL — empty = same origin (production, backend serves frontend)
// Set NEXT_PUBLIC_API_BASE for dev mode (e.g. http://localhost:8000)
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

// ==================== Project / Scan ====================

/** Scan a project directory for mdoc files */
export async function scanProject(config: ScanConfig): Promise<TiltSeries[]> {
  const response = await fetch(`${API_BASE}/api/mdoc/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Scan failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  // Handle both camelCase and snake_case responses
  const series = data.tilt_series || data.tiltSeries || [];
  return series;
}

/** List all tilt series */
export async function listTiltSeries(): Promise<TiltSeries[]> {
  const response = await fetch(`${API_BASE}/api/mdoc/list`);
  if (!response.ok) throw new Error("Failed to list tilt series");
  return response.json();
}

/** Get a specific tilt series */
export async function getTiltSeries(tsId: string): Promise<TiltSeries | null> {
  try {
    const response = await fetch(
      `${API_BASE}/api/mdoc/${encodeURIComponent(tsId)}`,
    );
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

// ==================== File Browser ====================

/** Get user home directory */
export async function fetchUserHome(): Promise<string> {
  const response = await fetch(`${API_BASE}/api/files/user-home`);
  if (!response.ok) throw new Error("Failed to fetch user home");
  const data = await response.json();
  return data.home;
}

/** List directory contents */
export async function listDirectory(
  path: string,
): Promise<{ name: string; type: "dir" | "file" }[]> {
  const response = await fetch(
    `${API_BASE}/api/files/list?path=${encodeURIComponent(path)}`,
  );
  if (!response.ok) throw new Error("Failed to list directory");
  const data = await response.json();
  return data.entries || [];
}

/** Save scan configuration */
export async function saveConfig(config: ScanConfig): Promise<void> {
  const response = await fetch(`${API_BASE}/api/files/save-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to save configuration: ${errorText}`);
  }
}

/** Load scan configuration */
export async function loadConfig(filename: string): Promise<ScanConfig> {
  const response = await fetch(
    `${API_BASE}/api/files/load-config?filename=${
      encodeURIComponent(filename)
    }`,
  );
  if (!response.ok) throw new Error("Failed to load configuration");
  return response.json();
}

/** List saved configurations */
export async function listConfigs(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/files/list-configs`);
  if (!response.ok) throw new Error("Failed to list configs");
  const data = await response.json();
  return data.configs || [];
}

// ==================== Preview / PNG ====================

/** Fetch a PNG preview for a frame, returning the blob and its disk cache mtime. */
export async function fetchPng(
  tsId: string,
  zIndex: number,
  bin = 8,
): Promise<{ blob: Blob; pngMtime: number }> {
  const response = await fetch(
    `${API_BASE}/api/preview/${
      encodeURIComponent(tsId)
    }/${zIndex}?bin=${bin}`,
  );
  if (!response.ok) throw new Error("Failed to fetch PNG");
  const blob = await response.blob();
  const pngMtime = parseInt(response.headers.get("x-png-mtime") || "0", 10);
  return { blob, pngMtime };
}

/** Fetch current PNG disk mtimes for all frames of a tilt series.
 *  Returns a map of zIndex -> mtime (entries missing means no disk PNG yet). */
export async function fetchMtimes(
  tsId: string,
  bin = 8,
): Promise<Map<number, number>> {
  const response = await fetch(
    `${API_BASE}/api/preview/${
      encodeURIComponent(tsId)
    }/frame-mtimes?bin=${bin}`,
  );
  if (!response.ok) throw new Error("Failed to fetch PNG mtimes");
  const data = await response.json() as { mtimes: Record<string, number> };
  const result = new Map<number, number>();
  for (const [zIndex, mtime] of Object.entries(data.mtimes)) {
    result.set(Number(zIndex), mtime);
  }
  return result;
}

// ==================== Save / Delete ====================

/** Save all mdoc changes */
export async function saveAll(
  selectionsState: SelectionState,
  deletePaths?: string[],
): Promise<SaveAllResult> {
  // Convert selections Map to plain object for JSON serialization
  const selectionsPayload: Record<string, Record<number, boolean>> = {};

  for (const [mdocPath, tsSelections] of selectionsState) {
    if (tsSelections.size > 0) {
      selectionsPayload[mdocPath] = Object.fromEntries(tsSelections);
    }
  }

  // Send save request
  const response = await fetch(`${API_BASE}/api/mdoc/save-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selections: selectionsPayload }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Save all failed: ${errorText}`);
  }

  const saveResult = await response.json();

  // Handle deletions if any
  let deleteResult = { deleted: [] as string[], failed: [] as string[] };
  if (deletePaths && deletePaths.length > 0) {
    const deleteResponse = await fetch(`${API_BASE}/api/mdoc/delete-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mdoc_paths: deletePaths }),
    });

    if (deleteResponse.ok) {
      deleteResult = await deleteResponse.json();
    }
  }

  return {
    success: saveResult.success && (deleteResult.failed?.length === 0),
    saved: saveResult.saved || [],
    failed: [...(saveResult.failed || []), ...(deleteResult.failed || [])],
    deleted: deleteResult.deleted || [],
    message: saveResult.message,
  };
}

// ==================== Frame Selection Helpers ====================

/** Get frame selection state */
export function getFrameSelection(
  mdocPath: string,
  zIndex: number,
  original: boolean,
  selectionsState?: Map<string, Map<number, boolean>>,
): boolean {
  if (selectionsState) {
    const tsSelections = selectionsState.get(mdocPath);
    if (!tsSelections) return original;
    return tsSelections.get(zIndex) ?? original;
  }
  return original;
}
