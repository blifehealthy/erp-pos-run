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
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-8">
      {/* Header */}
      <div className="mb-12 text-center">
        <p className="text-lg font-semibold uppercase tracking-[0.4em] text-orange-400">รับอาหาร</p>
        <p className="mt-2 text-5xl font-black text-white">พร้อมรับแล้ว!</p>
      </div>

      {/* Queue Numbers */}
      {readyQueue.length === 0 ? (
        <div className="text-center">
          <p className="text-6xl">⏳</p>
          <p className="mt-4 text-2xl font-medium text-slate-400">ยังไม่มีออเดอร์พร้อม</p>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-6">
          {readyQueue.map((num) => (
            <div
              key={num}
              className="flex flex-col items-center rounded-3xl border-4 border-orange-400 bg-orange-500 px-10 py-8 shadow-2xl shadow-orange-900/50 animate-bounce"
              style={{ animationDuration: "1.5s" }}
            >
              <span className="text-lg font-bold text-orange-100 uppercase tracking-widest">{prefix || "คิว"}</span>
              <span className="mt-1 text-8xl font-black text-white leading-none">
                {String(num).padStart(3, "0")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-16 text-center text-slate-600">
        <p className="text-sm">อัปเดตทุก 5 วินาที</p>
        <p className="mt-1 text-xs">Kitchen Display → เสร็จแล้ว → แสดงที่นี่</p>
      </div>
    </div>
  );
}
