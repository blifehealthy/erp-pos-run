import { useQuery } from "@tanstack/react-query";
import { Clock, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { branchApi } from "@/lib/adminApi";
import type { BranchSettings } from "@/types/admin";

type PickupQueue = {
  session_id: string;
  queue_number: number;
  customer_name: string | null;
  ticket_count: number;
  item_count: number;
  ready_at: string | null;
};

function formatQueue(prefix: string, queueNumber: number): string {
  return `${prefix}${String(queueNumber).padStart(3, "0")}`;
}

function readyAgo(readyAt: string | null): string {
  if (!readyAt) return "-";
  const diff = Math.max(Math.floor((Date.now() - new Date(readyAt).getTime()) / 60_000), 0);
  if (diff <= 0) return "พร้อมเมื่อสักครู่";
  return `พร้อมแล้ว ${diff} นาที`;
}

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
      (await authApi.get("/restaurant/pickup-queue")).data.data as PickupQueue[],
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
    const queueNumbers = readyQueue.map((queue) => queue.queue_number);
    const newQueues = queueNumbers.filter((q) => !prev.includes(q));
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
    prevQueueRef.current = queueNumbers;
  }, [readyQueue]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 px-5 py-6 text-white sm:px-8 sm:py-8">
      {/* Header */}
      <div className="text-center">
        <p className="text-lg font-semibold uppercase tracking-[0.4em] text-emerald-400">รับอาหาร</p>
        <p className="mt-2 text-4xl font-black sm:text-5xl">พร้อมรับแล้ว</p>
        <p className="mt-3 text-sm text-slate-400">โปรดตรวจเลขคิว แล้วติดต่อพนักงานที่เคาน์เตอร์</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${queueQuery.isFetching ? "animate-spin" : ""}`} />
            อัปเดตทุก 5 วินาที
          </span>
          <span className="rounded-full bg-slate-900 px-3 py-1.5">คิวพร้อมรับ {readyQueue.length}</span>
        </div>
      </div>

      {/* Queue Numbers */}
      {queueQuery.isError ? (
        <div className="flex flex-1 items-center justify-center text-center">
          <div className="rounded-[2rem] border border-rose-500 bg-rose-950/50 px-8 py-10">
            <p className="text-3xl font-black text-rose-100">โหลดคิวไม่สำเร็จ</p>
            <p className="mt-3 text-sm text-rose-200">ตรวจการเชื่อมต่อหรือ branch context ของเครื่องนี้</p>
          </div>
        </div>
      ) : readyQueue.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center">
          <div>
            <p className="text-7xl">...</p>
            <p className="mt-4 text-2xl font-medium text-slate-400">ยังไม่มีออเดอร์พร้อม</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-8">
          {primaryQueue ? (
            <div className="flex w-full max-w-xl flex-col items-center rounded-[2rem] border-4 border-emerald-300 bg-emerald-500 px-8 py-10 shadow-2xl shadow-emerald-950/60 sm:px-14">
              <span className="text-xl font-bold uppercase tracking-widest text-emerald-950">{prefix || "คิว"}</span>
              <span className="mt-2 text-8xl font-black leading-none text-white sm:text-9xl">
                {formatQueue(prefix, primaryQueue.queue_number)}
              </span>
              <div className="mt-5 flex flex-wrap justify-center gap-2 text-sm font-semibold text-emerald-950">
                {primaryQueue.customer_name ? <span className="rounded-full bg-white/40 px-3 py-1">{primaryQueue.customer_name}</span> : null}
                <span className="rounded-full bg-white/40 px-3 py-1">{primaryQueue.item_count} รายการ</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/40 px-3 py-1">
                  <Clock className="h-4 w-4" />
                  {readyAgo(primaryQueue.ready_at)}
                </span>
              </div>
            </div>
          ) : null}
          {secondaryQueues.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-4">
              {secondaryQueues.map((queue) => (
                <div key={queue.session_id} className="rounded-3xl border border-slate-700 bg-slate-900 px-7 py-5 text-center">
                  <span className="block text-xs font-semibold uppercase tracking-widest text-slate-400">{prefix || "คิว"}</span>
                  <span className="mt-1 block text-5xl font-black leading-none text-white">{formatQueue(prefix, queue.queue_number)}</span>
                  <span className="mt-2 block text-xs text-slate-400">{queue.item_count} รายการ · {readyAgo(queue.ready_at)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-slate-500">
        <p className="mt-1 text-xs">Kitchen Display &gt; เสร็จแล้ว &gt; แสดงที่นี่</p>
      </div>
    </div>
  );
}
