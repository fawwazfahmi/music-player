"use client";

import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface Row {
  key: string;
  label: string;
  trailing?: string;
}

export interface VirtualizedListProps {
  title: string;
  rows: Row[];
  selected: number;
  onSelect?: (index: number) => void;
}

const ROW_HEIGHT = 16;

export function VirtualizedList({ title, rows, selected }: VirtualizedListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  useEffect(() => {
    virtualizer.scrollToIndex(selected, { align: "auto" });
  }, [selected, virtualizer]);

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        {title}
      </div>
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index];
            if (!row) return null;
            return (
              <div
                key={row.key}
                data-virtual-index={vi.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                }}
                className={
                  "flex items-center justify-between border-b border-black/5 px-2 " +
                  (vi.index === selected
                    ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
                    : "")
                }
              >
                <span className="truncate">{row.label}</span>
                {row.trailing && <span className="ml-2 text-[9px] opacity-70">{row.trailing}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
