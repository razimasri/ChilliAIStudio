import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
type Point = { x: number; y: number };
export function useCanvasPointer({
  mode,
  disabled,
  viewport,
  onPreview,
  onCommit,
}: {
  mode: 'draw' | 'pan';
  disabled?: boolean;
  viewport: React.RefObject<HTMLDivElement>;
  onPreview: (start: Point, end: Point, drawing: boolean) => void;
  onCommit: (start: Point, end: Point) => void;
}) {
  const drag = useRef<{
    id: number;
    start: Point;
    end: Point;
    client: Point;
    scroll: Point;
    canvas: HTMLCanvasElement;
  } | null>(null);
  const point = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget,
      rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          canvas.width,
          ((event.clientX - rect.left) * canvas.width) / rect.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          canvas.height,
          ((event.clientY - rect.top) * canvas.height) / rect.height,
        ),
      ),
    };
  };
  const cancel = () => {
    const active = drag.current;
    drag.current = null;
    if (active) {
      onPreview(active.start, active.end, false);
      if (active.canvas.hasPointerCapture(active.id))
        active.canvas.releasePointerCapture(active.id);
    }
  };
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (drag.current && drag.current.id !== event.pointerId) {
        cancel();
        return;
      }
      if (disabled || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      const start = point(event);
      drag.current = {
        id: event.pointerId,
        start,
        end: start,
        client: { x: event.clientX, y: event.clientY },
        scroll: {
          x: viewport.current?.scrollLeft || 0,
          y: viewport.current?.scrollTop || 0,
        },
        canvas: event.currentTarget,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      if (mode === 'draw') onPreview(start, start, true);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      event.preventDefault();
      if (mode === 'pan') {
        if (viewport.current) {
          viewport.current.scrollLeft =
            active.scroll.x + active.client.x - event.clientX;
          viewport.current.scrollTop =
            active.scroll.y + active.client.y - event.clientY;
        }
      } else {
        active.end = point(event);
        onPreview(active.start, active.end, true);
      }
    },
    onPointerUp: (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      active.end = point(event);
      cancel();
      if (mode === 'draw') onCommit(active.start, active.end);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  };
}
