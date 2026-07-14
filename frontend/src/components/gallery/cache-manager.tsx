'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  cacheProgress,
}: CacheManagerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button variant="ghost" size="sm">
          Cache
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onCacheAll} disabled={isCaching}>
          {isCaching ? 'Caching...' : 'Cache All'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onClearCache}>
          Clear Cache
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
