'use client';

import { useState, useEffect, useCallback } from 'react';
import { listDirectory } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { FolderIcon, FileIcon, HomeIcon, ArrowUpIcon, SearchIcon } from 'lucide-react';

interface FileEntry {
  name: string;
  type: 'dir' | 'file';
}

interface FileBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
}

export function FileBrowser({ open, onOpenChange, onSelect, initialPath, title }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDir, setSelectedDir] = useState<string | null>(null);

  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listDirectory(path);
      setEntries(result);
      setCurrentPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load directory');
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load initial path on open
  useEffect(() => {
    if (open) {
      const path = initialPath || '/';
      setSelectedDir(null);
      loadDirectory(path);
    }
  }, [open, initialPath, loadDirectory]);

  const navigateTo = useCallback((name: string) => {
    const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    setSelectedDir(newPath);
    loadDirectory(newPath);
  }, [currentPath, loadDirectory]);

  const navigateUp = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      const newPath = parts.length === 0 ? '/' : `/${parts.join('/')}`;
      setSelectedDir(newPath);
      loadDirectory(newPath);
    }
  }, [currentPath, loadDirectory]);

  const navigateHome = useCallback(() => {
    setSelectedDir('/');
    loadDirectory('/');
  }, [loadDirectory]);

  const breadcrumbs = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean);

  const navigateToBreadcrumb = useCallback((index: number) => {
    const path = index === -1 ? '/' : `/${breadcrumbs.slice(0, index + 1).join('/')}`;
    setSelectedDir(path);
    loadDirectory(path);
  }, [breadcrumbs, loadDirectory]);

  // Filter and sort entries
  const filteredEntries = entries
    .filter((entry) => {
      if (searchTerm && !entry.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      // Directories first
      if (a.type === 'dir' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });

  const handleSelectDir = useCallback(() => {
    if (selectedDir) {
      onSelect(selectedDir);
      onOpenChange(false);
    }
  }, [selectedDir, onSelect, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[600px] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>{title || 'Select Directory'}</DialogTitle>
        </DialogHeader>

        {/* Search bar */}
        <div className="px-4 pt-2">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter files..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {/* Breadcrumb navigation */}
        <div className="flex items-center gap-1 px-4 pt-2 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" onClick={navigateHome} className="h-7 px-2">
            <HomeIcon className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={navigateUp} className="h-7 px-2">
            <ArrowUpIcon className="h-4 w-4" />
          </Button>
          <span className="mx-1 text-xs truncate max-w-[300px]" title={currentPath}>
            {currentPath || 'Root'}
          </span>
        </div>

        {/* Breadcrumb path links */}
        <div className="flex flex-wrap items-center gap-1 px-4 pb-2 text-xs">
          <button
            className="text-primary hover:underline"
            onClick={() => navigateToBreadcrumb(-1)}
          >
            /
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-muted-foreground">/</span>
              <button
                className={`hover:underline ${i === breadcrumbs.length - 1 ? 'font-medium text-foreground' : 'text-primary'}`}
                onClick={() => navigateToBreadcrumb(i)}
              >
                {crumb}
              </button>
            </span>
          ))}
        </div>

        {/* File listing */}
        <div className="flex-1 overflow-auto px-4 pb-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Loading...
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              {searchTerm ? `No files match "${searchTerm}"` : 'Directory is empty'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-0.5">
              {filteredEntries.map((entry) => (
                <button
                  key={entry.name}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                    selectedDir ===
                    (currentPath === '/'
                      ? `/${entry.name}`
                      : `${currentPath}/${entry.name}`)
                      ? 'bg-accent'
                      : ''
                  }`}
                  onClick={() => {
                    const fullPath =
                      currentPath === '/'
                        ? `/${entry.name}`
                        : `${currentPath}/${entry.name}`;
                    if (entry.type === 'dir') {
                      setSelectedDir(fullPath);
                      // Double-click navigates into directory
                    } else {
                      setSelectedDir(fullPath);
                    }
                  }}
                  onDoubleClick={() => {
                    if (entry.type === 'dir') {
                      navigateTo(entry.name);
                    }
                  }}
                >
                  {entry.type === 'dir' ? (
                    <FolderIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{entry.name}</span>
                  {entry.type === 'dir' && (
                    <span
                      className="ml-auto text-xs text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateTo(entry.name);
                      }}
                    >
                      Open
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="border-t p-4">
          <div className="flex w-full items-center justify-between">
            <span className="text-xs text-muted-foreground truncate max-w-[300px]">
              {selectedDir || 'No directory selected'}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSelectDir} disabled={!selectedDir}>
                Select This Directory
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
