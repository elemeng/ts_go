"use client";

import { useCallback, useMemo, useState } from "react";
import { useAppState } from "@/lib/store";
import type { Frame, TiltSeries } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { FrameThumbnail } from "./frame-thumbnail";

interface TiltSeriesCardProps {
  ts: TiltSeries;
  isExpanded: boolean;
  isSelected: boolean;
  thumbSize: number;
  bin: number;
  sortBy: "angle" | "time";
  showDeleted: boolean;
  deletedFrames: Frame[];
  onToggle: () => void;
  onToggleSelection: () => void;
  onSelectAll: (select: boolean) => void;
  onInvert: () => void;
  onReset: () => void;
  onFrameToggle: (frame: Frame) => void;
  onDeletedFrameToggle?: (zIndex: number, selected: boolean) => void;
}

export function TiltSeriesCard({
  ts,
  isExpanded,
  isSelected,
  thumbSize,
  bin,
  sortBy,
  showDeleted,
  deletedFrames,
  onToggle,
  onToggleSelection,
  onSelectAll,
  onInvert,
  onReset,
  onFrameToggle,
  onDeletedFrameToggle,
}: TiltSeriesCardProps) {
  const { getFrameSelection } = useAppState();
  const [visibleFrames, setVisibleFrames] = useState<Set<string>>(new Set());

  // Parse mdoc DateTime format: "DD-Mon-YYYY HH:MM:SS" or "DD-Mon-YY HH:MM:SS" → epoch ms
  function parseMdocDateTime(dt: string): number {
    if (!dt) return 0;
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    // Try 4-digit year: DD-Mon-YYYY HH:MM:SS
    let match = dt.match(/^(\d{2})-(\w{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (match) {
      const [, dd, mon, yyyy, hh, mm, ss] = match;
      return new Date(parseInt(yyyy), months[mon], parseInt(dd), parseInt(hh), parseInt(mm), parseInt(ss)).getTime();
    }
    // Try 2-digit year: DD-Mon-YY HH:MM:SS
    match = dt.match(/^(\d{2})-(\w{3})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (match) {
      const [, dd, mon, yy, hh, mm, ss] = match;
      const year = 2000 + parseInt(yy);
      return new Date(year, months[mon], parseInt(dd), parseInt(hh), parseInt(mm), parseInt(ss)).getTime();
    }
    return 0;
  }

  // Sort frames based on the current sort mode
  const sortedFrames = useMemo(() => {
    return [...ts.frames].sort((a, b) => {
      if (sortBy === "angle") {
        return a.angle - b.angle;
      }
      // sortBy === "time"
      return parseMdocDateTime(a.dateTime) - parseMdocDateTime(b.dateTime);
    });
  }, [ts.frames, sortBy]);

  const selectedCount =
    ts.frames.filter((f) =>
      getFrameSelection(ts.mdocPath, f.zIndex, f.selected)
    ).length;

  const isFrameVisible = useCallback(
    (tsId: string, zIndex: number) => visibleFrames.has(`${tsId}_${zIndex}`),
    [visibleFrames],
  );

  const setFrameVisible = useCallback((tsId: string, zIndex: number) => {
    setVisibleFrames((prev) => new Set(prev).add(`${tsId}_${zIndex}`));
  }, []);

  const hasDeleted = deletedFrames.length > 0;

  return (
    <div className="rounded-lg border bg-card">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggleSelection}
            />
            <Button variant="ghost" size="sm" onClick={onToggle}>
              {isExpanded ? "▼" : "▶"}
            </Button>
            <div>
              <h2 className="text-lg font-semibold">{ts.id}</h2>
              <p className="text-sm text-muted-foreground">
                {ts.frames.length} frames | {ts.angleRange[0]}° →{" "}
                {ts.angleRange[1]}°
                {hasDeleted && (
                  <span className="ml-2 text-destructive">
                    ({deletedFrames.length} deleted)
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              ☑ {selectedCount} / {ts.frames.length}
            </Badge>
          </div>
        </div>

        {/* Expanded controls */}
        {isExpanded && (
          <div className="mt-2 flex items-center justify-end gap-4">
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSelectAll(true)}
              >
                ☑ All
              </Button>
              <Button variant="outline" size="sm" onClick={onInvert}>
                ↻ Invert
              </Button>
              <Button variant="ghost" size="sm" onClick={onReset}>
                ↺ Reset
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Frames Grid */}
      {isExpanded && (
        <div className="p-4 pt-0">
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns:
                `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`,
            }}
          >
            {sortedFrames.map((frame) => (
              <FrameThumbnail
                key={`${frame.zIndex}_bin${bin}`}
                tsId={ts.id}
                frame={frame}
                bin={bin}
                isSelected={getFrameSelection(
                  ts.mdocPath,
                  frame.zIndex,
                  frame.selected,
                )}
                thumbSize={thumbSize}
                isVisible={isFrameVisible(ts.id, frame.zIndex)}
                onVisible={() => setFrameVisible(ts.id, frame.zIndex)}
                onToggle={() => onFrameToggle(frame)}
              />
            ))}
          </div>

          {/* Deleted Frames Section */}
          {showDeleted && hasDeleted && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="h-px flex-1 bg-pink-200" />
                <span className="text-xs font-medium text-pink-500">
                  Deleted Frames — check to restore on next save
                </span>
                <div className="h-px flex-1 bg-pink-200" />
              </div>
              <div
                className="grid gap-2"
                style={{
                  gridTemplateColumns:
                    `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`,
                }}
              >
                {deletedFrames.map((frame) => (
                  <FrameThumbnail
                    key={`deleted_${frame.zIndex}_bin${bin}`}
                    tsId={ts.id}
                    frame={frame}
                    bin={bin}
                    isSelected={getFrameSelection(
                      ts.mdocPath,
                      frame.zIndex,
                      frame.selected,
                    )}
                    thumbSize={thumbSize}
                    deleted={true}
                    isVisible={true}
                    onVisible={() => {}}
                    onToggle={() =>
                      onDeletedFrameToggle?.(
                        frame.zIndex,
                        !getFrameSelection(
                          ts.mdocPath,
                          frame.zIndex,
                          frame.selected,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
