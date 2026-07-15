"use client";

import { useCallback, useState } from "react";
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
  onToggle: () => void;
  onToggleSelection: () => void;
  onSelectAll: (select: boolean) => void;
  onInvert: () => void;
  onReset: () => void;
  onQuickFilter: (
    preset: "center" | "edges" | "alternate" | "all" | "none",
  ) => void;
  onFrameToggle: (frame: Frame) => void;
}

export function TiltSeriesCard({
  ts,
  isExpanded,
  isSelected,
  thumbSize,
  onToggle,
  onToggleSelection,
  onSelectAll,
  onInvert,
  onReset,
  onQuickFilter,
  onFrameToggle,
}: TiltSeriesCardProps) {
  const { getFrameSelection } = useAppState();
  const [visibleFrames, setVisibleFrames] = useState<Set<string>>(new Set());

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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onQuickFilter("center")}
              >
                Center
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onQuickFilter("edges")}
              >
                Edges
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onQuickFilter("alternate")}
              >
                Alternate
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
            {ts.frames.map((frame) => (
              <FrameThumbnail
                key={frame.zIndex}
                tsId={ts.id}
                frame={frame}
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
        </div>
      )}
    </div>
  );
}
