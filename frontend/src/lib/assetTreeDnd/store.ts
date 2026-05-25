import { create } from "zustand";
import type { InsertionPoint } from "./insertionPoint";

interface IndicatorState {
  point: InsertionPoint | null;
  indicatorY: number | null;
  indicatorDepth: number | null;
  setIndicator: (point: InsertionPoint | null, y: number | null, depth: number | null) => void;
  clear: () => void;
}

export const useAssetTreeDndStore = create<IndicatorState>((set) => ({
  point: null,
  indicatorY: null,
  indicatorDepth: null,
  setIndicator: (point, indicatorY, indicatorDepth) => set({ point, indicatorY, indicatorDepth }),
  clear: () => set({ point: null, indicatorY: null, indicatorDepth: null }),
}));
