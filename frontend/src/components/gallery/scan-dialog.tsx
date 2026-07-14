'use client';

import { useState, useEffect } from 'react';
import { fetchUserHome } from '@/lib/api';
import type { ScanConfig } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FolderIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { FileBrowser } from './file-browser';

interface ScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (config: ScanConfig) => Promise<void>;
}

type DirField = 'mdoc_dir' | 'image_dir' | 'png_dir';

export function ScanDialog({ open, onOpenChange, onScan }: ScanDialogProps) {
  const [config, setConfig] = useState<ScanConfig>({
    mdoc_dir: '',
    image_dir: '',
    png_dir: '',
    mdoc_prefix_cut: 0,
    mdoc_suffix_cut: 0,
    image_prefix_cut: 0,
    image_suffix_cut: 0,
  });
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browserTarget, setBrowserTarget] = useState<DirField | null>(null);

  useEffect(() => {
    if (open && !config.mdoc_dir) {
      fetchUserHome()
        .then((home) => {
          setConfig((prev) => ({
            ...prev,
            mdoc_dir: home,
            image_dir: home,
            png_dir: home,
          }));
        })
        .catch(() => {});
    }
  }, [open, config.mdoc_dir]);

  const openBrowser = (field: DirField) => {
    setBrowserTarget(field);
  };

  const handleBrowserSelect = (path: string) => {
    if (browserTarget) {
      setConfig((prev) => ({ ...prev, [browserTarget]: path }));
      setBrowserTarget(null);
    }
  };

  const handleScan = async () => {
    setIsScanning(true);
    setError(null);
    try {
      await onScan(config);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  const dirLabel = (field: DirField) => {
    switch (field) {
      case 'mdoc_dir': return 'MDOC Directory';
      case 'image_dir': return 'Image Directory';
      case 'png_dir': return 'PNG Output Directory';
    }
  };

  const dirPlaceholder = (field: DirField) => {
    switch (field) {
      case 'mdoc_dir': return '/path/to/mdoc/files';
      case 'image_dir': return '/path/to/image/files';
      case 'png_dir': return '/path/to/png/cache';
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Scan Project Directory</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {(['mdoc_dir', 'image_dir', 'png_dir'] as DirField[]).map((field) => (
              <div key={field} className="grid gap-2">
                <Label htmlFor={field}>{dirLabel(field)}</Label>
                <div className="flex gap-2">
                  <Input
                    id={field}
                    value={config[field]}
                    onChange={(e) => setConfig((prev) => ({ ...prev, [field]: e.target.value }))}
                    placeholder={dirPlaceholder(field)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => openBrowser(field)}
                    title={`Browse for ${dirLabel(field)}`}
                  >
                    <FolderIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="mdoc_prefix_cut">MDOC Prefix Cut</Label>
                <Input
                  id="mdoc_prefix_cut"
                  type="number"
                  value={config.mdoc_prefix_cut ?? 0}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, mdoc_prefix_cut: parseInt(e.target.value) || 0 }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mdoc_suffix_cut">MDOC Suffix Cut</Label>
                <Input
                  id="mdoc_suffix_cut"
                  type="number"
                  value={config.mdoc_suffix_cut ?? 0}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, mdoc_suffix_cut: parseInt(e.target.value) || 0 }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="image_prefix_cut">Image Prefix Cut</Label>
                <Input
                  id="image_prefix_cut"
                  type="number"
                  value={config.image_prefix_cut ?? 0}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, image_prefix_cut: parseInt(e.target.value) || 0 }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="image_suffix_cut">Image Suffix Cut</Label>
                <Input
                  id="image_suffix_cut"
                  type="number"
                  value={config.image_suffix_cut ?? 0}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, image_suffix_cut: parseInt(e.target.value) || 0 }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleScan} disabled={isScanning}>
              {isScanning ? 'Scanning...' : 'Scan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File Browser Dialog */}
      <FileBrowser
        open={browserTarget !== null}
        onOpenChange={(open) => { if (!open) setBrowserTarget(null); }}
        onSelect={handleBrowserSelect}
        initialPath={browserTarget ? config[browserTarget] : undefined}
        title={browserTarget ? `Select ${dirLabel(browserTarget)}` : 'Select Directory'}
      />
    </>
  );
}
