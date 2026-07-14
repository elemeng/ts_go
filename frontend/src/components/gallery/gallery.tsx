'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useAppState } from '@/lib/store';
import { scanProject, saveAll } from '@/lib/api';
import { cacheAllMdocs, clearCache } from '@/lib/cache';
import { TiltSeriesCard } from './tilt-series-card';
import { ScanDialog } from './scan-dialog';
import { CacheManager } from './cache-manager';
import type { ScanConfig, TiltSeries } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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
  const [isSaving, setIsSaving] = useState(false);
  const [showScanDialog, setShowScanDialog] = useState(false);
  const [isCaching, setIsCaching] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({ cached: 0, total: 0, currentTs: '' });

  // Load persisted state on mount
  useEffect(() => {
    // Load thumbSize
    try {
      const saved = localStorage.getItem('gallery_thumbSize');
      if (saved) setThumbSize(parseInt(saved, 10));
    } catch {}
  }, []);

  // Save thumbSize
  useEffect(() => {
    localStorage.setItem('gallery_thumbSize', thumbSize.toString());
  }, [thumbSize]);

  // Expand all when tilt series load
  useEffect(() => {
    if (tiltSeries.length > 0 && expandedTs.size === 0) {
      setExpandedTs(new Set(tiltSeries.map((ts) => ts.id)));
    }
    if (tiltSeries.length > 0 && selectedTsIds.size === 0) {
      setSelectedTsIds(new Set(tiltSeries.map((ts) => ts.id)));
    }
  }, [tiltSeries, expandedTs.size, selectedTsIds.size]);

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

  const applyBatchFilter = useCallback(
    (preset: 'center' | 'edges' | 'alternate' | 'all' | 'none') => {
      if (selectedTsIds.size === 0) {
        toast.warning('No tilt series selected', { description: 'Select one or more TS first' });
        return;
      }

      let applied = 0;
      for (const ts of tiltSeries) {
        if (selectedTsIds.has(ts.id)) {
          applyQuickFilter(ts, preset);
          applied++;
        }
      }
      toast.success(`Applied ${preset} filter to ${applied} tilt series`);
    },
    [tiltSeries, selectedTsIds]
  );

  const applyQuickFilter = useCallback(
    (ts: TiltSeries, preset: 'center' | 'edges' | 'alternate' | 'all' | 'none') => {
      const selectionsMap = new Map<number, boolean>();
      const totalFrames = ts.frames.length;

      switch (preset) {
        case 'center': {
          const start = Math.floor(totalFrames * 0.2);
          const end = Math.ceil(totalFrames * 0.8);
          for (const frame of ts.frames) {
            selectionsMap.set(frame.zIndex, frame.zIndex >= start && frame.zIndex <= end);
          }
          break;
        }
        case 'edges': {
          const edgeSize = Math.floor(totalFrames * 0.2);
          for (const frame of ts.frames) {
            selectionsMap.set(frame.zIndex, frame.zIndex < edgeSize || frame.zIndex >= totalFrames - edgeSize);
          }
          break;
        }
        case 'alternate': {
          for (const frame of ts.frames) {
            selectionsMap.set(frame.zIndex, frame.zIndex % 2 === 0);
          }
          break;
        }
        case 'all': {
          for (const frame of ts.frames) {
            selectionsMap.set(frame.zIndex, true);
          }
          break;
        }
        case 'none': {
          for (const frame of ts.frames) {
            selectionsMap.set(frame.zIndex, false);
          }
          break;
        }
      }

      setBatchSelection(ts.mdocPath, selectionsMap);
      toast.success(`Applied ${preset} filter`, { description: ts.id });
    },
    [setBatchSelection]
  );

  const handleScan = useCallback(
    async (config: ScanConfig) => {
      try {
        const series = await scanProject(config);
        setTiltSeries(series);
        setShowScanDialog(false);
        toast.success(`Scanned ${series.length} tilt series`);
      } catch (e) {
        toast.error('Scan failed', { description: e instanceof Error ? e.message : 'Unknown error' });
      }
    },
    [setTiltSeries]
  );

  const handleSaveAll = useCallback(async () => {
    if (tiltSeries.length === 0) {
      toast.info('No tilt series loaded');
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

      if (selections.size === 0 && deletePaths.length === 0) {
        toast.info('No changes to save');
        return;
      }

      const result = await saveAll(selections, deletePaths);

      // Update tilt series - remove deleted
      if (deletePaths.length > 0) {
        const deletedSet = new Set(deletePaths);
        setTiltSeries(tiltSeries.filter((ts) => !deletedSet.has(ts.mdocPath)));
      }

      // Clear all selections
      clearAllSelections();

      if (result.failed.length > 0) {
        toast.error(`Saved ${result.saved.length}, deleted ${result.deleted.length}`, {
          description: `Failed: ${result.failed.slice(0, 3).join(', ')}${result.failed.length > 3 ? '...' : ''}`,
        });
      } else {
        toast.success(`Saved ${result.saved.length} tilt series, deleted ${result.deleted.length} mdocs`);
      }
    } catch (e) {
      toast.error('Save failed', { description: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      setIsSaving(false);
    }
  }, [tiltSeries, selections, selectedTsIds, setTiltSeries, clearAllSelections]);

  const handleCacheAll = useCallback(async () => {
    if (tiltSeries.length === 0) {
      toast.warning('No tilt series loaded', { description: 'Scan a project first' });
      return;
    }

    setIsCaching(true);
    try {
      const result = await cacheAllMdocs(tiltSeries, (progress) => {
        setCacheProgress({ cached: progress.current, total: progress.total, currentTs: progress.currentTs });
      });
      toast.success(
        `Cache complete: ${result.success}/${result.total} PNGs cached` +
        (result.failed ? ` (${result.failed} failed)` : '')
      );
    } catch (e) {
      toast.error('Cache failed', { description: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      setIsCaching(false);
      setCacheProgress({ cached: 0, total: 0, currentTs: '' });
    }
  }, [tiltSeries]);

  const handleClearCache = useCallback(async () => {
    await clearCache();
    toast.success('All cached PNGs deleted');
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
    [getFrameSelection]
  );

  const stats = {
    totalSeries: tiltSeries.length,
    totalFrames: tiltSeries.reduce((sum, ts) => sum + ts.frames.length, 0),
    selectedFrames: tiltSeries.reduce(
      (sum, ts) => sum + ts.frames.filter((f) => getFrameSelection(ts.mdocPath, f.zIndex, f.selected)).length,
      0
    ),
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <div className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold">CryoET Gallery</h1>
            <Button variant="default" size="sm" onClick={() => setShowScanDialog(true)}>
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
              <Button variant="outline" size="sm" onClick={() => setSelectedTsIds(new Set(tiltSeries.map((t) => t.id)))}>
                ☑ All
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedTsIds(new Set())}>
                ☐ Clear
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline">{stats.totalSeries} TS</Badge>
            <CacheManager
              onCacheAll={handleCacheAll}
              onClearCache={handleClearCache}
              isCaching={isCaching}
              cacheProgress={cacheProgress}
            />
            <Button variant="default" size="sm" onClick={handleSaveAll} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save All'}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Batch operations */}
        {selectedTsIds.size > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm font-medium">{selectedTsIds.size} TS selected</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => applyBatchFilter('all')}>
                ☑ All
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyBatchFilter('none')}>
                ☐ None
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyBatchFilter('alternate')}>
                ↻ Alternate
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
                  const current = getFrameSelection(ts.mdocPath, frame.zIndex, frame.selected);
                  map.set(frame.zIndex, !current);
                }
                setBatchSelection(ts.mdocPath, map);
              }}
              onReset={() => clearTsSelections(ts.mdocPath)}
              onQuickFilter={(preset) => applyQuickFilter(ts, preset)}
              onFrameToggle={(frame) => {
                const current = getFrameSelection(ts.mdocPath, frame.zIndex, frame.selected);
                setFrameSelection(ts.mdocPath, frame.zIndex, !current);
              }}
              onThumbSizeChange={setThumbSize}
            />
          ))}
        </div>

        {/* Empty state */}
        {tiltSeries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-lg text-muted-foreground">
              No tilt series loaded. Configure and scan a project directory.
            </p>
            <Button variant="default" className="mt-4" onClick={() => setShowScanDialog(true)}>
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
