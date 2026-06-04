"use client";

import { useState } from "react";

const items = [
  { label: "Artists" },
  { label: "Albums" },
  { label: "Songs" },
];

export function MusicSub() {
  const [selected] = useState(0);
  return (
    <div className="h-full">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        Music
      </div>
      <ul>
        {items.map((it, i) => (
          <li
            key={it.label}
            data-screen-row={it.label}
            className={
              "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
              (i === selected ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white" : "")
            }
          >
            <span>{it.label}</span>
            <span>›</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
