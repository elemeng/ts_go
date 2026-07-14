'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { TiltSeries, SelectionState } from './types';

interface AppState {
  tiltSeries: TiltSeries[];
  setTiltSeries: (series: TiltSeries[]) => void;
  selections: SelectionState;
  setFrameSelection: (mdocPath: string, zIndex: number, selected: boolean) => void;
  setBatchSelection: (mdocPath: string, selectionsMap: Map<number, boolean>) => void;
  clearTsSelections: (mdocPath: string) => void;
  clearAllSelections: () => void;
  getFrameSelection: (mdocPath: string, zIndex: number, original: boolean) => boolean;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [tiltSeries, setTiltSeriesState] = useState<TiltSeries[]>([]);
  const [selections, setSelections] = useState<SelectionState>(new Map());
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistSelections = useCallback((state: SelectionState) => {
    // Debounced persist to localStorage
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(() => {
      const serializable: Record<string, Record<number, boolean>> = {};
      for (const [mdocPath, tsSelections] of state) {
        serializable[mdocPath] = Object.fromEntries(tsSelections);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('ts_selections', JSON.stringify(serializable));
      }
    }, 1000);
  }, []);

  const setTiltSeries = useCallback((series: TiltSeries[]) => {
    setTiltSeriesState(series);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ts_tiltSeries', JSON.stringify(series));
    }
  }, []);

  const setFrameSelection = useCallback(
    (mdocPath: string, zIndex: number, selected: boolean) => {
      setSelections((prev) => {
        const newState = new Map(prev);
        if (!newState.has(mdocPath)) {
          newState.set(mdocPath, new Map());
        }
        const tsSelections = newState.get(mdocPath)!;
        tsSelections.set(zIndex, selected);
        persistSelections(newState);
        return newState;
      });
    },
    [persistSelections]
  );

  const setBatchSelection = useCallback(
    (mdocPath: string, selectionsMap: Map<number, boolean>) => {
      setSelections((prev) => {
        const newState = new Map(prev);
        if (!newState.has(mdocPath)) {
          newState.set(mdocPath, new Map());
        }
        const tsSelections = newState.get(mdocPath)!;
        for (const [zIndex, selected] of selectionsMap) {
          tsSelections.set(zIndex, selected);
        }
        persistSelections(newState);
        return newState;
      });
    },
    [persistSelections]
  );

  const clearTsSelections = useCallback((mdocPath: string) => {
    setSelections((prev) => {
      const newState = new Map(prev);
      newState.delete(mdocPath);
      persistSelections(newState);
      return newState;
    });
  }, [persistSelections]);

  const clearAllSelections = useCallback(() => {
    setSelections(new Map());
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ts_selections');
    }
  }, []);

  const getFrameSelection = useCallback(
    (mdocPath: string, zIndex: number, original: boolean): boolean => {
      const tsSelections = selections.get(mdocPath);
      if (!tsSelections) return original;
      return tsSelections.get(zIndex) ?? original;
    },
    [selections]
  );

  return (
    <AppContext.Provider
      value={{
        tiltSeries,
        setTiltSeries,
        selections,
        setFrameSelection,
        setBatchSelection,
        clearTsSelections,
        clearAllSelections,
        getFrameSelection,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppState must be used within an AppProvider');
  }
  return context;
}
