import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, Clock, ReceiptText, RefreshCw, ShoppingBag, Users, UtensilsCrossed,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/api";
import { formatThaiCurrency } from "@/lib/cartUtils";
import { useAuthStore } from "@/stores/auth.store";

type SessionRow = {
  id: string;
  status: string;
  table_name: string | null;
  queue_number: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  opened_at: string;
  closed_at: string | null;
  item_count: number;
  total_amount: number;
  sale_order_id: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  open:            { label: "กำลังสั่ง",   color: "bg-blue-50 border-blue-200 text-blue-700",     dot: "bg-blue-500" },
  bill_requested:  { label: "เรียกบิลแล้ว", color: "bg-amber-50 border-amber-200 text-amber-700",   dot: "bg-amber-500 animate-pulse" },
  closed:          { label: "ปิดแล้ว",      color: "bg-slate-50 border-slate-200 text-slate-500",   dot: "bg-slate-400" },
};

function elapsed(openedAt: string): string {
  const diff = Math.floor((Date.now() - new Date(openedAt).getTime()) / 60000);
  if (diff < 60) return `${diff} นาที`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h} ชม. ${m} นาที`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function FBOrdersPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const branchId = useAuthStore((s) => s.branchId);
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [filterDate, setFilterDate] = useState(todayStr());

  const sessionsQuery = useQuery({
    queryKey: ["fb-sessions", branchId, filterStatus, filterDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("date", filterDate);
      if (filterStatus !== "active") params.set("status", filterStatus);
      const res = await authApi.get(`/restaurant/sessions?${params}`);
      return res.data.data as SessionRow[];
    },
    enabled: Boolean(branchId),
    refetchInterval: 15_000,
  });

  const allSessions = sessionsQuery.data ?? [];

  // "active" = open + bill_requested
  const sessions = useMemo(() => {
    if (filterStatus === "active") {
      return allSessions.filter((s) => s.status === "open" || s.status === "bill_requested");
    }
    return allSessions;
  }, [allSessions, filterStatus]);

  // Summary stats
  const stats = useMemo(() => ({
    open: allSessions.filter((s) => s.status === "open").length,
    bill_requested: allSessions.filter((s) => s.status === "bill_requested").length,
    closed: allSessions.filter((s) => s.status === "closed").length,
    total_revenue: allSessions.filter((s) => s.status === "closed").reduce((sum, s) => sum + s.total_amount, 0),
  }), [allSessions]);

  return (
    <div>
      <PageHeader
        title="ออเดอร์ทั้งหมด"
        subtitle={`วันที่ ${filterDate} — อัปเดตทุก 15 วินาที`}
        actions={
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filterDate}
              max={todayStr()}
              onChange={(e) => setFilterDate(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 px-3 text-sm"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["fb-sessions"] })}
            >
              <RefreshCw className={`h-4 w-4 ${sessionsQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        }
      />

      <div className="space-y-6 p-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="กำลังสั่ง"
            value={stats.open}
            icon={<UtensilsCrossed className="h-5 w-5 text-blue-500" />}
            color="bg-blue-50"
          />
          <StatCard
            label="เรียกบิลแล้ว"
            value={stats.bill_requested}
            icon={<ReceiptText className="h-5 w-5 text-amber-500" />}
            color="bg-amber-50"
            urgent={stats.bill_requested > 0}
          />
          <StatCard
            label="ปิดแล้ววันนี้"
            value={stats.closed}
            icon={<ShoppingBag className="h-5 w-5 text-emerald-500" />}
            color="bg-emerald-50"
          />
          <StatCard
            label="รายได้วันนี้"
            value={formatThaiCurrency(stats.total_revenue)}
            icon={<ShoppingBag className="h-5 w-5 text-slate-500" />}
            color="bg-slate-50"
            isText
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 border-b border-slate-200 pb-3">
          {[
            { key: "active", label: `Active (${stats.open + stats.bill_requested})` },
            { key: "open", label: `กำลังสั่ง (${stats.open})` },
            { key: "bill_requested", label: `เรียกบิล (${stats.bill_requested})` },
            { key: "closed", label: `ปิดแล้ว (${stats.closed})` },
            { key: "", label: "ทั้งหมด" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilterStatus(tab.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                filterStatus === tab.key
                  ? "bg-orange-500 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sessions List */}
        {sessionsQuery.isLoading && (
          <div className="py-12 text-center text-slate-400">กำลังโหลด...</div>
        )}

        {!sessionsQuery.isLoading && sessions.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-slate-400">
            <UtensilsCrossed className="mx-auto mb-3 h-10 w-10" />
            <p className="font-medium">ไม่มีออเดอร์</p>
            <p className="mt-1 text-sm">ในเงื่อนไขที่เลือก</p>
          </div>
        )}

        <div className="space-y-3">
          {sessions.map((session) => {
            const cfg = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.open;
            const isBillRequested = session.status === "bill_requested";

            return (
              <div
                key={session.id}
                className={`rounded-2xl border-2 p-4 transition-all ${cfg.color} ${isBillRequested ? "shadow-md" : ""}`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: info */}
                  <div className="flex items-start gap-3">
                    <div className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${cfg.dot}`} />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {session.table_name && (
                          <span className="font-bold text-slate-900 text-base">โต๊ะ {session.table_name}</span>
                        )}
                        {session.queue_number && (
                          <span className="rounded-full bg-orange-500 px-3 py-0.5 text-sm font-bold text-white">
                            คิว {String(session.queue_number).padStart(3, "0")}
                          </span>
                        )}
                        {!session.table_name && !session.queue_number && (
                          <span className="font-bold text-slate-600">Walk-in</span>
                        )}
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${cfg.color}`}>{cfg.label}</span>
                      </div>

                      {(session.customer_name || session.customer_phone) && (
                        <div className="mt-1 flex items-center gap-1 text-sm text-slate-600">
                          <Users className="h-3 w-3" />
                          <span>{session.customer_name ?? ""}</span>
                          {session.customer_phone && <span className="text-slate-400">• {session.customer_phone}</span>}
                        </div>
                      )}

                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {session.status !== "closed"
                            ? `เปิดมา ${elapsed(session.opened_at)}`
                            : `เปิด ${new Date(session.opened_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`}
                        </span>
                        <span>{session.item_count} รายการ</span>
                        <span className="font-semibold text-slate-700">{formatThaiCurrency(session.total_amount)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex flex-shrink-0 flex-col gap-2">
                    {session.status === "closed" ? (
                      <span className="text-xs text-slate-400">
                        {session.closed_at
                          ? new Date(session.closed_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
                          : "ปิดแล้ว"}
                      </span>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          className={`${isBillRequested ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-700 hover:bg-slate-800"} text-white`}
                          onClick={() => navigate(`/restaurant/session/${session.id}/checkout`)}
                        >
                          <ReceiptText className="mr-1.5 h-4 w-4" />
                          {isBillRequested ? "รวมบิล !" : "รวมบิล"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/restaurant/session/${session.id}/detail`)}
                        >
                          ดูรายการ
                          <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Urgent banner สำหรับ bill_requested */}
                {isBillRequested && (
                  <div className="mt-3 rounded-xl bg-amber-400/20 px-3 py-2 text-center text-sm font-semibold text-amber-800">
                    ⚡ ลูกค้าเรียกบิลแล้ว — กรุณารีบดำเนินการ
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label, value, icon, color, urgent = false, isText = false,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  urgent?: boolean;
  isText?: boolean;
}): JSX.Element {
  return (
    <div className={`rounded-2xl border ${urgent ? "border-amber-400 shadow-md" : "border-slate-200"} ${color} p-4`}>
      <div className="flex items-center justify-between">
        {icon}
        {urgent && <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />}
      </div>
      <p className={`mt-2 ${isText ? "text-lg" : "text-3xl"} font-black text-slate-900`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
