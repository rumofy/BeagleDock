import React, { useState, useRef } from "react";
import {
  X,
  Move,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { SessionShell } from "./SessionShell";

import { t } from "../../i18n";
export function FloatingTerminal({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const {
    activeTab,
    showInlineTerminal,
    setShowInlineTerminal,
    currentSession,
    currentProvider,
  } = useApp();
  const [floatPos, setFloatPos] = useState<{ x: number; y: number }>({
    x: 40,
    y: 24,
  });
  const [floatSize, setFloatSize] = useState<{ width: number; height: number }>(
    { width: 640, height: 340 },
  );
  const floatBoxRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    initialX: number;
    initialY: number;
  }>({ mouseX: 0, mouseY: 0, initialX: 0, initialY: 0 });
  const resizeStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    initialW: number;
    initialH: number;
  }>({ mouseX: 0, mouseY: 0, initialW: 0, initialH: 0 });
  // 60/120 FPS dragging via requestAnimationFrame and direct DOM with a hardware transform
  const handleStartDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: floatPos.x,
      initialY: floatPos.y,
    };

    let latestX = floatPos.x;
    let latestY = floatPos.y;
    let ticking = false;

    const containerRect = containerRef.current?.getBoundingClientRect();
    const maxW = containerRect
      ? containerRect.width - floatSize.width - 20
      : window.innerWidth - floatSize.width - 40;
    const maxH = containerRect
      ? containerRect.height - floatSize.height - 20
      : window.innerHeight - floatSize.height - 40;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - dragStartRef.current.mouseX;
      const deltaY = moveEvent.clientY - dragStartRef.current.mouseY;

      latestX = Math.max(
        10,
        Math.min(Math.max(10, maxW), dragStartRef.current.initialX + deltaX),
      );
      latestY = Math.max(
        10,
        Math.min(Math.max(10, maxH), dragStartRef.current.initialY + deltaY),
      );

      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (floatBoxRef.current) {
            floatBoxRef.current.style.transform = `translate3d(${latestX}px, ${latestY}px, 0)`;
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    const onMouseUp = () => {
      setFloatPos({ x: latestX, y: latestY });
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp, { once: true });
  };

  // High-performance resizing
  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialW: floatSize.width,
      initialH: floatSize.height,
    };

    let latestW = floatSize.width;
    let latestH = floatSize.height;
    let ticking = false;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaW = moveEvent.clientX - resizeStartRef.current.mouseX;
      const deltaH = moveEvent.clientY - resizeStartRef.current.mouseY;

      latestW = Math.max(
        380,
        Math.min(1800, resizeStartRef.current.initialW + deltaW),
      );
      latestH = Math.max(
        180,
        Math.min(1000, resizeStartRef.current.initialH + deltaH),
      );

      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (floatBoxRef.current) {
            floatBoxRef.current.style.width = `${latestW}px`;
            floatBoxRef.current.style.height = `${latestH}px`;
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    const onMouseUp = () => {
      setFloatSize({ width: latestW, height: latestH });
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp, { once: true });
  };
  if (!(activeTab === "chat" && showInlineTerminal && currentSession)) return null;

  return (
            <div
              ref={floatBoxRef}
              style={{
                left: 0,
                top: 0,
                transform: `translate3d(${floatPos.x}px, ${floatPos.y}px, 0)`,
                width: `${floatSize.width}px`,
                height: `${floatSize.height}px`,
                willChange: "transform, width, height",
              }}
              className="absolute z-40 bg-[#141416]/95 backdrop-blur-md rounded-2xl border border-[#3f3f46] shadow-2xl flex flex-col overflow-hidden select-none"
            >
              {/* TOP BAR FOR DRAGGING */}
              <div
                onMouseDown={handleStartDrag}
                className="h-9 bg-[#1e1e21] px-3.5 flex items-center justify-between border-b border-[#2e2e33] cursor-grab active:cursor-grabbing select-none"
                title={t("floating.dragHint")}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
                  <span className="ml-2 font-mono text-[11px] text-[#a1a1aa] font-medium flex items-center gap-1.5">
                    <Move size={11} className="text-[#71717a]" />
                    pty://{currentProvider?.name} ({currentSession.cwd})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[#a1a1aa] bg-[#27272a] px-1.5 py-0.5 rounded">
                    PID: {currentSession.pid || "ready"}
                  </span>
                  <button
                    onClick={() => setShowInlineTerminal(false)}
                    className="p-1 hover:bg-[#2e2e33] rounded text-[#a1a1aa]"
                    title={t("floating.hide")}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              <SessionShell sessionId={currentSession.id} />

              {/* BOTTOM BAR FOR RESIZING */}
              <div
                onMouseDown={handleStartResize}
                className="h-4 bg-[#1e1e21]/90 border-t border-[#2e2e33] flex items-center justify-between px-2.5 cursor-nwse-resize select-none"
                title={t("floating.resizeHint")}
              >
                <span className="text-[9px] font-mono text-[#71717a]">
                  {floatSize.width}x{floatSize.height} • GPU Accelerated
                </span>
                <span className="text-[10px] text-[#a1a1aa] font-mono">
                  ⤡ resize
                </span>
              </div>
            </div>
  );
}
