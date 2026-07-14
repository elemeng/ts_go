'use client';

import { useState, useEffect } from 'react';
import { fetchUserHome } from '@/lib/api';
import type { ScanConfig } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface ScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (config: ScanConfig) => Promise<void>;
}

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

  return (
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

          <div className="grid gap-2">
            <Label htmlFor="mdoc_dir">MDOC Directory</Label>
            <Input
              id="mdoc_dir"
              value={config.mdoc_dir}
              onChange={(e) => setConfig((prev) => ({ ...prev, mdoc_dir: e.target.value }))}
              placeholder="/path/to/mdoc/files"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="image_dir">Image Directory</Label>
            <Input
              id="image_dir"
              value={config.image_dir}
              onChange={(e) => setConfig((prev) => ({ ...prev, image_dir: e.target.value }))}
              placeholder="/path/to/image/files"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="png_dir">PNG Output Directory</Label>
            <Input
              id="png_dir"
              value={config.png_dir}
              onChange={(e) => setConfig((prev) => ({ ...prev, png_dir: e.target.value }))}
              placeholder="/path/to/png/cache"
            />
          </div>

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
  );
}
