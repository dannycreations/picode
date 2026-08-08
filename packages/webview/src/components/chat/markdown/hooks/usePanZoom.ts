import { useCallback, useState } from 'react';

import type { MouseEvent, WheelEvent } from 'react';

export interface UsePanZoomReturn {
  readonly zoomLevel: number;
  readonly dragPosition: { x: number; y: number };
  readonly isDragging: boolean;
  readonly adjustZoom: (amount: number) => void;
  readonly handleWheel: (e: WheelEvent) => void;
  readonly startDrag: (e: MouseEvent) => void;
  readonly onDrag: (e: MouseEvent) => void;
  readonly stopDrag: () => void;
  readonly resetPanZoom: () => void;
}

export const usePanZoom = (): UsePanZoomReturn => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const adjustZoom = useCallback((amount: number): void => {
    setZoomLevel((prev) => Math.max(0.5, Math.min(20, prev + amount)));
  }, []);

  const handleWheel = useCallback(
    (e: WheelEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      adjustZoom(delta);
    },
    [adjustZoom],
  );

  const startDrag = useCallback((e: MouseEvent): void => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDrag = useCallback(
    (e: MouseEvent): void => {
      if (!isDragging) return;
      setDragPosition((prev) => ({
        x: prev.x + e.movementX / zoomLevel,
        y: prev.y + e.movementY / zoomLevel,
      }));
    },
    [isDragging, zoomLevel],
  );

  const stopDrag = useCallback((): void => {
    setIsDragging(false);
  }, []);

  const resetPanZoom = useCallback((): void => {
    setZoomLevel(1);
    setDragPosition({ x: 0, y: 0 });
  }, []);

  return {
    zoomLevel,
    dragPosition,
    isDragging,
    adjustZoom,
    handleWheel,
    startDrag,
    onDrag,
    stopDrag,
    resetPanZoom,
  };
};
