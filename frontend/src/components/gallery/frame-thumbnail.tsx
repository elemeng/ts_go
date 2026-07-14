'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { getPng } from '@/lib/cache';
import { fetchPng } from '@/lib/api';
import type { Frame } from '@/lib/types';
import { Checkbox } from '@/components/ui/checkbox';

interface FrameThumbnailProps {
  tsId: string;
  frame: Frame;
  isSelected: boolean;
  thumbSize: number;
  isVisible: boolean;
  onVisible: () => void;
  onToggle: () => void;
}

export function FrameThumbnail({
  tsId,
  frame,
  isSelected,
  thumbSize,
  isVisible,
  onVisible,
  onToggle,
}: FrameThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // IntersectionObserver for lazy loading
  useEffect(() => {
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
      { rootMargin: '1024px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isVisible, onVisible]);

  // Load PNG when visible (only if frame has a valid mrc path)
  useEffect(() => {
    if (!isVisible || isLoaded) return;
    // Skip frames with no matching mrc file on disk
    if (!isSelected && !frame.mrcPath.startsWith('/')) return;

    let cancelled = false;
    let currentUrl: string | null = null;

    (async () => {
      try {
        let blob = await getPng(tsId, frame.zIndex, 8, 90);
        if (!blob) {
          blob = await fetchPng(tsId, frame.zIndex, 8, 90);
        }

        if (cancelled) {
          URL.revokeObjectURL(currentUrl!);
          return;
        }

        const url = URL.createObjectURL(blob);
        currentUrl = url;
        setImgUrl(url);
        setIsLoaded(true);
      } catch (e) {
        console.error(`Failed to load PNG for ${tsId}/${frame.zIndex}:`, e);
      }
    })();

    return () => {
      cancelled = true;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [isVisible, tsId, frame.zIndex, isLoaded]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggle();
    },
    [onToggle]
  );

  // Placeholder SVG for unloaded frames
  const placeholderSvg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23e5e7eb'/%3E%3Ctext x='50' y='50' text-anchor='middle' dominant-baseline='middle' font-size='12'%3E${frame.angle.toFixed(1)}°%3C/text%3E%3C/svg%3E`;

  return (
    <div
      ref={containerRef}
      className="inline-flex cursor-pointer flex-col items-center"
      onClick={handleClick}
    >
      <figure
        className="p-1"
        style={{ width: thumbSize, height: thumbSize }}
      >
        {isVisible ? (
          <img
            src={imgUrl || placeholderSvg}
            alt={`${frame.angle.toFixed(1)}°`}
            className="h-full w-full object-contain"
          />
        ) : (
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
          className="h-3 w-3"
        />
      </div>
    </div>
  );
}
