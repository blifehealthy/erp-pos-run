import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { branchApi } from "@/lib/adminApi";
import type { BranchSettings } from "@/types/admin";

export default function PickupDisplayPage(): JSX.Element {
  const branchId = useAuthStore((s) => s.branchId);
  const prevQueueRef = useRef<number[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["branch-settings", branchId],
    queryFn: async () => {
      if (!branchId) return null;
      return (await branchApi.getSettings(branchId)).data.data as BranchSettings;
    },
    enabled: Boolean(branchId),
  });

  const queueQuery = useQuery({
    queryKey: ["pickup-queue", branchId],
    queryFn: async () =>
      (await authApi.get("/restaurant/pickup-queue")).data.data as number[],
    refetchInterval: 5_000,
    enabled: Boolean(branchId),
  });

  const readyQueue = queueQuery.data ?? [];
  const prefix = settingsQuery.data?.fb_queue_prefix ?? "";
  const primaryQueue = readyQueue[0];
  const secondaryQueues = readyQueue.slice(1);

  // เล่นเสียงเมื่อมีคิวใหม่
  useEffect(() => {
    const prev = prevQueueRef.current;
    const newQueues = readyQueue.filter((q) => !prev.includes(q));
    if (newQueues.length > 0) {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      [0, 0.3, 0.6].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = offset === 0 ? 660 : offset === 0.3 ? 880 : 1100;
        gain.gain.setValueAtTime(0.4, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.4);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.4);
      });
    }
    prevQueueRef.current = readyQueue;
  }, [readyQueue]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 px-8 py-8 text-white">
      {/* Header */}
      <div className="text-center">
        <p className="text-lg font-semibold uppercase tracking-[0.4em] text-emerald-400">รับอาหาร</p>
        <p className="mt-2 text-5xl font-black">พร้อมรับแล้ว</p>
        <p className="mt-3 text-sm text-slate-400">โปรดตรวจเลขคิว แล้วติดต่อพนักงานที่เคาน์เตอร์</p>
      </div>

      {/* Queue Numbers */}
      {readyQueue.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center">
          <div>
            <p className="text-7xl">...</p>
            <p className="mt-4 text-2xl font-medium text-slate-400">ยังไม่มีออเดอร์พร้อม</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-8">
          {primaryQueue ? (
            <div className="flex min-w-[320px] flex-col items-center rounded-[2rem] border-4 border-emerald-300 bg-emerald-500 px-14 py-10 shadow-2xl shadow-emerald-950/60">
              <span className="text-xl font-bold uppercase tracking-widest text-emerald-950">{prefix || "คิว"}</span>
              <span className="mt-2 text-9xl font-black leading-none text-white">
                {String(primaryQueue).padStart(3, "0")}
              </span>
            </div>
          ) : null}
          {secondaryQueues.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-4">
              {secondaryQueues.map((num) => (
                <div key={num} className="rounded-3xl border border-slate-700 bg-slate-900 px-7 py-5 text-center">
                  <span className="block text-xs font-semibold uppercase tracking-widest text-slate-400">{prefix || "คิว"}</span>
                  <span className="mt-1 block text-5xl font-black leading-none text-white">{String(num).padStart(3, "0")}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-slate-500">
        <p className="text-sm">อัปเดตทุก 5 วินาที</p>
        <p className="mt-1 text-xs">Kitchen Display &gt; เสร็จแล้ว &gt; แสดงที่นี่</p>
      </div>
    </div>
  );
}
