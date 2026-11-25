// The handle between two columns: drag it to move the edge. Pointer
// events, so a finger on the iPad works as a mouse does; text selection
// is held off while the drag lasts.
import { useRef } from "react";

export function Resizer({ onDrag, onEnd }: { onDrag: (dx: number) => void; onEnd?: () => void }) {
  const last = useRef(0);
  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        last.current = e.clientX;
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return;
        const dx = e.clientX - last.current;
        last.current = e.clientX;
        if (dx) onDrag(dx);
      }}
      onPointerUp={(e) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        document.body.classList.remove("resizing");
        onEnd?.();
      }}
    />
  );
}
