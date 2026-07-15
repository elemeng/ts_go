'use client';

import { Button } from '@/components/ui/button';

interface CacheManagerProps {
  onCacheAll: () => void;
  onClearCache: () => void;
  isCaching: boolean;
  cacheProgress: {
    cached: number;
    total: number;
    currentTs: string;
  };
}

export function CacheManager({
  onCacheAll,
  onClearCache,
  isCaching,
}: CacheManagerProps) {
  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="sm" onClick={onCacheAll} disabled={isCaching}>
        {isCaching ? 'Caching...' : 'Cache'}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClearCache}>
        Clear
      </Button>
    </div>
  );
}
