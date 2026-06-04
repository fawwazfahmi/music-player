import type { ReactNode } from "react";

export interface ChassisProps {
  screen: ReactNode;
  wheel: ReactNode;
}

export function Chassis({ screen, wheel }: ChassisProps) {
  return (
    <div className="mx-auto w-[280px] rounded-[28px] border border-zinc-400 bg-gradient-to-b from-zinc-100 via-zinc-200 to-zinc-400 p-5 shadow-[inset_0_1px_2px_rgba(255,255,255,0.9),0_8px_32px_rgba(0,0,0,0.5)]">
      <div className="mb-4 overflow-hidden rounded-md border-[3px] border-zinc-900 bg-[#d8e0c8] shadow-inner">
        <div className="h-[200px] w-full font-[Lucida_Grande,Helvetica,sans-serif] text-[11px] text-black">
          {screen}
        </div>
      </div>
      {wheel}
    </div>
  );
}
