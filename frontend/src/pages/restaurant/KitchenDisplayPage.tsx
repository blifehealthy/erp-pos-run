import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, Clock } from "lucide-react";
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
const NEXT_LABEL: Record<string, string> = { pending: "เริ่มทำ →", cooking: "เสร็จแล้ว ✅", done: "เสิร์ฟแล้ว 🍽️" };

function elapsed(createdAt: string): string {
  const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
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

  // unique stations from tickets
  const allStations = [...new Set(tickets.map((t) => t.station).filter(Boolean))] as string[];

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
        <div className="flex items-center gap-3">
          <ChefHat className="h-7 w-7 text-orange-400" />
          <h1 className="text-xl font-bold">Kitchen Display</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStation("")}
            className={`rounded-full px-3 py-1.5 text-sm ${!station ? "bg-orange-500 text-white" : "border border-slate-600 text-slate-300"}`}
          >
            ทั้งหมด
          </button>
          {allStations.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStation(s)}
              className={`rounded-full px-3 py-1.5 text-sm ${station === s ? "bg-orange-500 text-white" : "border border-slate-600 text-slate-300"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="text-sm text-slate-400">
          <Clock className="mr-1 inline h-4 w-4" />
          Auto-refresh 5s
        </div>
      </div>

      <div className="grid h-[calc(100vh-73px)] grid-cols-3 gap-0 divide-x divide-slate-700">
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
                  <div key={ticket.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {ticket.queue_number && (
                          <span className="text-xs font-bold text-orange-400">คิว {String(ticket.queue_number).padStart(3, "0")} </span>
                        )}
                        {ticket.table_name && (
                          <span className="text-xs text-slate-400">โต๊ะ {ticket.table_name}</span>
                        )}
                        <p className="mt-1 text-base font-bold text-white">{ticket.product_name}</p>
                        <p className="text-2xl font-bold text-orange-400">×{ticket.qty}</p>
                        {ticket.special_request && (
                          <p className="mt-1 rounded-lg bg-amber-900/40 px-2 py-1 text-xs text-amber-300">
                            ⚠️ {ticket.special_request}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-slate-500 flex-shrink-0">{elapsed(ticket.created_at)}</span>
                    </div>
                    {NEXT_STATUS[statusKey] && (
                      <button
                        type="button"
                        onClick={() => updateMutation.mutate({ id: ticket.id, status: NEXT_STATUS[statusKey] })}
                        className="mt-3 w-full rounded-xl bg-slate-700 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600"
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
