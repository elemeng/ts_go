"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPng, putPng } from "@/lib/cache";
import { fetchPng } from "@/lib/api";
import type { Frame } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";

interface FrameThumbnailProps {
  tsId: string;
  frame: Frame;
  isSelected: boolean;
  thumbSize: number;
  bin: number;
  isVisible: boolean;
  deleted?: boolean;
  onVisible: () => void;
  onToggle: () => void;
}

export function FrameThumbnail({
  tsId,
  frame,
  isSelected,
  thumbSize,
  bin,
  isVisible,
  deleted,
  onVisible,
  onToggle,
}: FrameThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // IntersectionObserver for lazy loading (skip for deleted frames)
  useEffect(() => {
    if (deleted) return; // deleted frames are always visible
    const el = containerRef.current;
    if (!el || isVisible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onVisible();
            observer.unobserve(el);
          }
        }
      },
      { rootMargin: "1024px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isVisible, onVisible, deleted]);

  // Load PNG when visible (only if frame has a valid mrc path)
  useEffect(() => {
    if (!isVisible || isLoaded) return;
    // Skip frames with no matching mrc file on disk
    if (!frame.mrcPath.startsWith("/")) return;

    let cancelled = false;
    let currentUrl: string | null = null;

    const release = () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = null;
      }
    };

    (async () => {
      try {
        const cached = await getPng(tsId, frame.zIndex, frame.mrcPath, bin);
        if (cached) {
          if (cancelled) return;
          const url = URL.createObjectURL(cached.blob);
          currentUrl = url;
          setImgUrl(url);
          setIsLoaded(true);
        } else {
          const result = await fetchPng(tsId, frame.zIndex, bin);
          if (cancelled) return;
          const url = URL.createObjectURL(result.blob);
          currentUrl = url;
          setImgUrl(url);
          setIsLoaded(true);
          await putPng(
            tsId,
            frame.zIndex,
            result.blob,
            frame.mrcPath,
            result.pngMtime,
            bin,
          );
        }
      } catch (e) {
        console.error(`Failed to load PNG for ${tsId}/${frame.zIndex}:`, e);
      }
    })();

    return () => {
      cancelled = true;
      release();
    };
  }, [isVisible, bin, tsId, frame.zIndex, frame.mrcPath, isLoaded]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggle();
    },
    [onToggle],
  );

  // Placeholder SVG for unloaded frames
  const placeholderSvg =
    `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23e5e7eb'/%3E%3Ctext x='50' y='50' text-anchor='middle' dominant-baseline='middle' font-size='12'%3E${
      frame.angle.toFixed(1)
    }°%3C/text%3E%3C/svg%3E`;

  return (
    <div
      ref={containerRef}
      className={`inline-flex cursor-pointer flex-col items-center ${
        deleted ? "opacity-75" : ""
      }`}
      onClick={handleClick}
    >
      <figure
        className={`p-1 ${deleted ? "rounded-md border-2 border-dashed border-pink-400" : ""}`}
        style={{ width: thumbSize, height: thumbSize }}
      >
        {isVisible
          ? (
            <img
              src={imgUrl || placeholderSvg}
              alt={`${frame.angle.toFixed(1)}°`}
              className="h-full w-full object-contain"
            />
          )
          : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <span className="text-xs text-muted-foreground">Loading...</span>
            </div>
          )}
      </figure>
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="text-xs font-medium">{frame.angle.toFixed(1)}°</span>
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          className={`h-3 w-3 ${deleted ? "accent-pink-500" : ""}`}
        />
      </div>
    </div>
  );
}
