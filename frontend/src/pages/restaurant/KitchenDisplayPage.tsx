import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, Clock, Flame, Timer } from "lucide-react";
import { useState } from "react";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";

type Ticket = {
  id: string; product_name: string; qty: number;
  special_request: string | null; station: string | null;
  queue_number: number | null; table_name: string | null;
  status: string; created_at: string; done_at: string | null;
};

const STATUSES = ["pending", "cooking", "done"] as const;
const STATUS_CONFIG = {
  pending: { label: "รอทำ", bg: "bg-amber-50", border: "border-amber-300", badge: "bg-amber-400", text: "text-amber-900" },
  cooking: { label: "กำลังทำ 🔥", bg: "bg-blue-50", border: "border-blue-300", badge: "bg-blue-500", text: "text-blue-900" },
  done: { label: "เสร็จแล้ว ✅", bg: "bg-emerald-50", border: "border-emerald-300", badge: "bg-emerald-500", text: "text-emerald-900" },
};
const NEXT_STATUS: Record<string, string> = { pending: "cooking", cooking: "done", done: "served" };
const NEXT_LABEL: Record<string, string> = { pending: "เริ่มทำ", cooking: "เสร็จแล้ว", done: "เสิร์ฟแล้ว" };

function elapsedSeconds(createdAt: string): number {
  const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
  return Math.max(diff, 0);
}

function elapsed(createdAt: string): string {
  const diff = elapsedSeconds(createdAt);
  if (diff < 60) return `${diff}s`;
  return `${Math.floor(diff / 60)}m ${diff % 60}s`;
}

export default function KitchenDisplayPage(): JSX.Element {
  const queryClient = useQueryClient();
  const branchId = useAuthStore((s) => s.branchId);
  const [station, setStation] = useState<string>("");

  const ticketsQuery = useQuery({
    queryKey: ["kitchen-tickets", branchId, station],
    queryFn: async () => {
      const params = station ? `?station=${encodeURIComponent(station)}` : "";
      return (await authApi.get(`/restaurant/kitchen${params}`)).data.data as Ticket[];
    },
    refetchInterval: 5_000,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      authApi.patch(`/restaurant/kitchen/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kitchen-tickets"] }),
  });

  const tickets = ticketsQuery.data ?? [];
  const grouped: Record<string, Ticket[]> = { pending: [], cooking: [], done: [] };
  tickets.forEach((t) => { if (t.status in grouped) grouped[t.status].push(t); });
  Object.values(grouped).forEach((items) => items.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
  const oldestPending = grouped.pending[0];
  const urgentCount = tickets.filter((ticket) => ticket.status !== "done" && elapsedSeconds(ticket.created_at) >= 600).length;

  // unique stations from tickets
  const allStations = [...new Set(tickets.map((t) => t.station).filter(Boolean))] as string[];

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="border-b border-slate-700 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ChefHat className="h-7 w-7 text-emerald-400" />
            <div>
              <h1 className="text-xl font-bold">Kitchen Display</h1>
              <p className="text-sm text-slate-400">รายการเก่าจะเรียงขึ้นก่อนในแต่ละคอลัมน์</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1.5">
              <Clock className="h-4 w-4" /> Auto-refresh 5s
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 ${urgentCount > 0 ? "bg-rose-500 text-white" : "bg-slate-800"}`}>
              <Flame className="h-4 w-4" /> เกิน 10 นาที {urgentCount}
            </span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStation("")}
            className={`rounded-full px-3 py-1.5 text-sm ${!station ? "bg-emerald-500 text-white" : "border border-slate-600 text-slate-300"}`}
          >
            ทั้งหมด
          </button>
          {allStations.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStation(s)}
              className={`rounded-full px-3 py-1.5 text-sm ${station === s ? "bg-emerald-500 text-white" : "border border-slate-600 text-slate-300"}`}
            >
              {s}
            </button>
          ))}
          {oldestPending ? (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1.5 text-sm font-semibold text-amber-950">
              <Timer className="h-4 w-4" /> รอนานสุด {elapsed(oldestPending.created_at)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid h-[calc(100vh-129px)] grid-cols-3 gap-0 divide-x divide-slate-700">
        {STATUSES.map((statusKey) => {
          const cfg = STATUS_CONFIG[statusKey];
          return (
            <div key={statusKey} className="flex flex-col overflow-hidden">
              <div className={`flex items-center gap-2 px-4 py-3 ${cfg.bg} bg-opacity-10 border-b border-slate-700`}>
                <span className={`h-3 w-3 rounded-full ${cfg.badge}`} />
                <span className="font-semibold text-slate-200">{cfg.label}</span>
                <span className="ml-auto rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">{grouped[statusKey].length}</span>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {grouped[statusKey].map((ticket) => (
                  <div key={ticket.id} className={`rounded-2xl border p-4 ${elapsedSeconds(ticket.created_at) >= 600 && ticket.status !== "done" ? "border-rose-400 bg-rose-950/40" : "border-slate-700 bg-slate-800"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {ticket.queue_number && (
                          <span className="text-xs font-bold text-emerald-400">คิว {String(ticket.queue_number).padStart(3, "0")} </span>
                        )}
                        {ticket.table_name && (
                          <span className="text-xs text-slate-400">โต๊ะ {ticket.table_name}</span>
                        )}
                        <p className="mt-1 text-base font-bold text-white">{ticket.product_name}</p>
                        <p className="text-3xl font-bold text-emerald-400">x{ticket.qty}</p>
                        {ticket.special_request && (
                          <p className="mt-1 rounded-lg bg-amber-900/40 px-2 py-1 text-xs text-amber-300">
                            {ticket.special_request}
                          </p>
                        )}
                      </div>
                      <span className="flex-shrink-0 rounded-full bg-slate-900 px-2 py-1 text-xs text-slate-300">{elapsed(ticket.created_at)}</span>
                    </div>
                    {NEXT_STATUS[statusKey] && (
                      <button
                        type="button"
                        onClick={() => updateMutation.mutate({ id: ticket.id, status: NEXT_STATUS[statusKey] })}
                        className="mt-3 w-full rounded-xl bg-slate-100 py-2 text-sm font-bold text-slate-950 hover:bg-white"
                      >
                        {NEXT_LABEL[statusKey]}
                      </button>
                    )}
                  </div>
                ))}
                {grouped[statusKey].length === 0 && (
                  <p className="py-8 text-center text-sm text-slate-600">ว่าง</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
