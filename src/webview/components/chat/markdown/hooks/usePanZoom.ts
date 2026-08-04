import { useCallback, useState } from 'react';

import type { MouseEvent, WheelEvent } from 'react';

export function usePanZoom() {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const adjustZoom = useCallback((amount: number) => {
    setZoomLevel((prev) => Math.max(0.5, Math.min(20, prev + amount)));
  }, []);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      adjustZoom(delta);
    },
    [adjustZoom],
  );

  const startDrag = useCallback((e: MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDrag = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      setDragPosition((prev) => ({
        x: prev.x + e.movementX / zoomLevel,
        y: prev.y + e.movementY / zoomLevel,
      }));
    },
    [isDragging, zoomLevel],
  );

  const stopDrag = useCallback(() => {
    setIsDragging(false);
  }, []);

  const resetPanZoom = useCallback(() => {
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
}
