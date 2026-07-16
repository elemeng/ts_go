"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppState } from "@/lib/store";
import { saveAll, scanProject, listTiltSeries } from "@/lib/api";
import { cacheAllMdocs, clearCache, validateTsCache } from "@/lib/cache";
import { TiltSeriesCard } from "./tilt-series-card";
import { ScanDialog } from "./scan-dialog";
import { CacheManager } from "./cache-manager";
import type { Frame, ScanConfig, TiltSeries } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function Gallery() {
  const {
    tiltSeries,
    setTiltSeries,
    selections,
    setFrameSelection,
    setBatchSelection,
    clearTsSelections,
    clearAllSelections,
    getFrameSelection,
  } = useAppState();

  const [expandedTs, setExpandedTs] = useState<Set<string>>(new Set());
  const [selectedTsIds, setSelectedTsIds] = useState<Set<string>>(new Set());
  const [thumbSize, setThumbSize] = useState(128);
  const [bin, setBin] = useState(8);
  const [isSaving, setIsSaving] = useState(false);
  const [showScanDialog, setShowScanDialog] = useState(false);
  const [isCaching, setIsCaching] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({
    cached: 0,
    total: 0,
    currentTs: "",
  });
  const [deletedFrames, setDeletedFrames] = useState<Map<string, Frame[]>>(new Map());
  const [sortBy, setSortBy] = useState<"angle" | "time">("angle");
  const [showDeleted, setShowDeleted] = useState(false);

  // Load persisted state on mount
  useEffect(() => {
    // Load thumbSize
    try {
      const saved = localStorage.getItem("gallery_thumbSize");
      if (saved) setThumbSize(parseInt(saved, 10));
    } catch (e) {
      console.warn("Failed to load persisted thumbSize:", e);
    }
    // Load bin
    try {
      const saved = localStorage.getItem("gallery_bin");
      if (saved) setBin(parseInt(saved, 10));
    } catch (e) {
      console.warn("Failed to load persisted bin:", e);
    }
  }, []);

  // Validate cached PNGs after restoring persisted tilt series.
  useEffect(() => {
    for (const ts of tiltSeries) {
      validateTsCache(ts, bin).catch((e) => {
        console.warn(`[cache] Failed to validate ${ts.id}:`, e);
      });
    }
  }, [tiltSeries, bin]);

  // Save thumbSize
  useEffect(() => {
    localStorage.setItem("gallery_thumbSize", thumbSize.toString());
  }, [thumbSize]);

  // Save bin
  useEffect(() => {
    localStorage.setItem("gallery_bin", bin.toString());
  }, [bin]);

  const hasInitiallyExpanded = useRef(false);

  // Expand all when tilt series load (only on initial load, not after collapse)
  useEffect(() => {
    if (tiltSeries.length > 0 && !hasInitiallyExpanded.current) {
      hasInitiallyExpanded.current = true;
      setExpandedTs(new Set(tiltSeries.map((ts) => ts.id)));
      setSelectedTsIds(new Set(tiltSeries.map((ts) => ts.id)));
    }
  }, [tiltSeries]);

  const toggleTs = useCallback((tsId: string) => {
    setExpandedTs((prev) => {
      const next = new Set(prev);
      if (next.has(tsId)) next.delete(tsId);
      else next.add(tsId);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedTs(new Set(tiltSeries.map((ts) => ts.id)));
  }, [tiltSeries]);

  const collapseAll = useCallback(() => {
    setExpandedTs(new Set());
  }, []);

  const toggleTsSelection = useCallback((tsId: string) => {
    setSelectedTsIds((prev) => {
      const next = new Set(prev);
      if (next.has(tsId)) next.delete(tsId);
      else next.add(tsId);
      return next;
    });
  }, []);

  const handleScan = useCallback(
    async (config: ScanConfig) => {
      try {
        const series = await scanProject(config);
        setTiltSeries(series);
        setDeletedFrames(new Map());
        setShowScanDialog(false);
        // Evict cached PNGs whose backend disk mtime has changed.
        for (const ts of series) {
          validateTsCache(ts, bin).catch((e) => {
            console.warn(`[cache] Failed to validate ${ts.id}:`, e);
          });
        }
        toast.success(`Scanned ${series.length} tilt series`);
      } catch (e) {
        toast.error("Scan failed", {
          description: e instanceof Error ? e.message : "Unknown error",
        });
      }
    },
    [setTiltSeries],
  );

  const handleSaveAll = useCallback(async () => {
    if (tiltSeries.length === 0) {
      toast.info("No tilt series loaded");
      return;
    }

    setIsSaving(true);
    try {
      const deletePaths: string[] = [];
      for (const ts of tiltSeries) {
        if (!selectedTsIds.has(ts.id)) {
          deletePaths.push(ts.mdocPath);
        }
      }

      // Compute which frames will be removed BEFORE saving (for "Show Deleted")
      const removedFrames = new Map<string, Frame[]>();
      for (const ts of tiltSeries) {
        if (deletePaths.includes(ts.mdocPath)) {
          // Entire TS will be deleted — all frames are removed
          removedFrames.set(ts.mdocPath, [...ts.frames]);
          continue;
        }
        const removed: Frame[] = [];
        for (const frame of ts.frames) {
          const effective = getFrameSelection(ts.mdocPath, frame.zIndex, frame.selected);
          if (!effective) {
            removed.push(frame);
          }
        }
        if (removed.length > 0) {
          removedFrames.set(ts.mdocPath, removed);
        }
      }

      // Always proceed with save (selections may be empty but effective state has changes)
      const result = await saveAll(tiltSeries, selections, deletePaths);

      // Refresh tilt series from backend to reflect saved changes
      // (deselected frames removed, angle ranges recalculated)
      try {
        const updatedSeries = await listTiltSeries();
        setTiltSeries(updatedSeries);
      } catch {
        // If refresh fails, fall back to local deletion only
        if (deletePaths.length > 0) {
          const deletedSet = new Set(deletePaths);
          setTiltSeries(tiltSeries.filter((ts) => !deletedSet.has(ts.mdocPath)));
        }
      }

      // Store removed frames for "Show Deleted" feature
      setDeletedFrames(removedFrames);

      // Clear all selections
      clearAllSelections();

      if (result.failed.length > 0) {
        toast.error(
          `Saved ${result.saved.length}, deleted ${result.deleted.length}`,
          {
            description: `Failed: ${result.failed.slice(0, 3).join(", ")}${
              result.failed.length > 3 ? "..." : ""
            }`,
          },
        );
      } else {
        toast.success(
          `Saved ${result.saved.length} tilt series, deleted ${result.deleted.length} mdocs`,
        );
      }
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    tiltSeries,
    selections,
    selectedTsIds,
    setTiltSeries,
    clearAllSelections,
    getFrameSelection,
  ]);

  const handleCacheAll = useCallback(async () => {
    if (tiltSeries.length === 0) {
      toast.warning("No tilt series loaded", {
        description: "Scan a project first",
      });
      return;
    }

    setIsCaching(true);
    try {
      const result = await cacheAllMdocs(tiltSeries, bin, (progress) => {
        setCacheProgress({
          cached: progress.current,
          total: progress.total,
          currentTs: progress.currentTs,
        });
      });
      toast.success(
        `Cache complete: ${result.success}/${result.total} PNGs cached` +
          (result.failed ? ` (${result.failed} failed)` : ""),
      );
    } catch (e) {
      toast.error("Cache failed", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setIsCaching(false);
      setCacheProgress({ cached: 0, total: 0, currentTs: "" });
    }
  }, [tiltSeries]);

  const handleClearCache = useCallback(async () => {
    await clearCache();
    toast.success("All cached PNGs deleted");
  }, []);

  const getSelectedCount = useCallback(
    (ts: TiltSeries): number => {
      let count = 0;
      for (const frame of ts.frames) {
        if (getFrameSelection(ts.mdocPath, frame.zIndex, frame.selected)) {
          count++;
        }
      }
      return count;
    },
    [getFrameSelection],
  );

  const stats = {
    totalSeries: tiltSeries.length,
    totalFrames: tiltSeries.reduce((sum, ts) => sum + ts.frames.length, 0),
    selectedFrames: tiltSeries.reduce(
      (sum, ts) =>
        sum +
        ts.frames.filter((f) =>
          getFrameSelection(ts.mdocPath, f.zIndex, f.selected)
        ).length,
      0,
    ),
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <div className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold">CryoET Gallery</h1>
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowScanDialog(true)}
            >
              Scan Project
            </Button>
          </div>

          <div className="flex flex-1 items-center justify-center gap-2">
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={expandAll}>
                ▼ Expand
              </Button>
              <Button variant="outline" size="sm" onClick={collapseAll}>
                ▶ Collapse
              </Button>
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelectedTsIds(new Set(tiltSeries.map((t) => t.id)))}
              >
                ☑ All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedTsIds(new Set())}
              >
                ☐ Clear
              </Button>
            </div>
            <div className="flex items-center gap-1 border-l pl-2">
              <span className="text-xs text-muted-foreground">Sort:</span>
              <Button
                variant={sortBy === "angle" ? "default" : "outline"}
                size="sm"
                onClick={() => setSortBy("angle")}
                className="h-7 text-xs"
              >
                Angle ↑
              </Button>
              <Button
                variant={sortBy === "time" ? "default" : "outline"}
                size="sm"
                onClick={() => setSortBy("time")}
                className="h-7 text-xs"
              >
                Time
              </Button>
            </div>
            {deletedFrames.size > 0 && (
              <div className="flex items-center gap-1 border-l pl-2">
                <Button
                  variant={showDeleted ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowDeleted((prev) => !prev)}
                  className={
                    showDeleted
                      ? "h-7 border-pink-400 bg-pink-50 text-pink-700 hover:bg-pink-100"
                      : "h-7"
                  }
                >
                  {showDeleted ? "Hide Deleted" : "Show Deleted"}
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline">{stats.totalSeries} TS</Badge>
            <div className="flex items-center gap-2 px-2">
              <span className="text-xs text-muted-foreground">Bin:</span>
              <Select
                value={bin.toString()}
                onValueChange={(value) => setBin(Number(value))}
              >
                <SelectTrigger className="h-7 w-16">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1x</SelectItem>
                  <SelectItem value="2">2x</SelectItem>
                  <SelectItem value="4">4x</SelectItem>
                  <SelectItem value="8">8x</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 px-2">
              <span className="text-xs text-muted-foreground">Zoom:</span>
              <Slider
                value={thumbSize}
                onValueChange={(value) => setThumbSize(Number(value))}
                min={64}
                max={1024}
                step={8}
                className="w-32"
              />
              <span className="text-xs text-muted-foreground">
                {thumbSize}px
              </span>
            </div>
            <CacheManager
              onCacheAll={handleCacheAll}
              onClearCache={handleClearCache}
              isCaching={isCaching}
              cacheProgress={cacheProgress}
            />
            <Button
              variant="default"
              size="sm"
              onClick={handleSaveAll}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save All"}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Batch filter operations */}
        {selectedTsIds.size > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm font-medium">
              {selectedTsIds.size} TS selected
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  for (const ts of tiltSeries) {
                    if (selectedTsIds.has(ts.id)) {
                      const map = new Map<number, boolean>();
                      for (const frame of ts.frames) {
                        map.set(frame.zIndex, true);
                      }
                      setBatchSelection(ts.mdocPath, map);
                    }
                  }
                }}
              >
                ☑ All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  for (const ts of tiltSeries) {
                    if (selectedTsIds.has(ts.id)) {
                      const map = new Map<number, boolean>();
                      for (const frame of ts.frames) {
                        map.set(frame.zIndex, false);
                      }
                      setBatchSelection(ts.mdocPath, map);
                    }
                  }
                }}
              >
                ☐ None
              </Button>
            </div>
          </div>
        )}

        {/* Cache progress */}
        {isCaching && cacheProgress.total > 0 && (
          <div className="mb-4 rounded-lg border bg-muted p-4">
            <p className="text-sm font-medium">Caching PNGs...</p>
            <p className="text-xs text-muted-foreground">
              {cacheProgress.cached} / {cacheProgress.total} cached
              {cacheProgress.currentTs && ` - ${cacheProgress.currentTs}`}
            </p>
          </div>
        )}

        {/* Tilt Series List */}
        <div className="space-y-4">
          {tiltSeries.map((ts) => (
            <TiltSeriesCard
              key={ts.id}
              ts={ts}
              isExpanded={expandedTs.has(ts.id)}
              isSelected={selectedTsIds.has(ts.id)}
              thumbSize={thumbSize}
              bin={bin}
              sortBy={sortBy}
              showDeleted={showDeleted}
              deletedFrames={deletedFrames.get(ts.mdocPath) || []}
              onDeletedFrameToggle={(zIndex, selected) => {
                setFrameSelection(ts.mdocPath, zIndex, selected);
              }}
              onToggle={() => toggleTs(ts.id)}
              onToggleSelection={() => toggleTsSelection(ts.id)}
              onSelectAll={(select) => {
                const map = new Map<number, boolean>();
                for (const frame of ts.frames) {
                  map.set(frame.zIndex, select);
                }
                setBatchSelection(ts.mdocPath, map);
              }}
              onInvert={() => {
                const map = new Map<number, boolean>();
                for (const frame of ts.frames) {
                  const current = getFrameSelection(
                    ts.mdocPath,
                    frame.zIndex,
                    frame.selected,
                  );
                  map.set(frame.zIndex, !current);
                }
                setBatchSelection(ts.mdocPath, map);
              }}
              onReset={() => clearTsSelections(ts.mdocPath)}
              onReset={() => clearTsSelections(ts.mdocPath)}
              onFrameToggle={(frame) => {
                const current = getFrameSelection(
                  ts.mdocPath,
                  frame.zIndex,
                  frame.selected,
                );
                setFrameSelection(ts.mdocPath, frame.zIndex, !current);
              }}
            />
          ))}
        </div>

        {/* Empty state */}
        {tiltSeries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-lg text-muted-foreground">
              No tilt series loaded. Configure and scan a project directory.
            </p>
            <Button
              variant="default"
              className="mt-4"
              onClick={() => setShowScanDialog(true)}
            >
              Scan Project
            </Button>
          </div>
        )}
      </div>

      {/* Scan Dialog */}
      <ScanDialog
        open={showScanDialog}
        onOpenChange={setShowScanDialog}
        onScan={handleScan}
      />
    </div>
  );
}
