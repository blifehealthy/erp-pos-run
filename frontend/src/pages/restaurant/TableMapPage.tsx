import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ConciergeBell, Plus, QrCode, ReceiptText, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import PageHeader from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";

type TableData = {
  id: string; name: string; capacity: number; qr_token: string;
  table_type: string; status: string; is_active: boolean;
  active_session_id: string | null; queue_number: number | null;
};

const STATUS_STYLE: Record<string, string> = {
  available: "border-emerald-200 bg-white",
  occupied: "border-amber-300 bg-amber-50",
  bill_requested: "border-sky-400 bg-sky-50 ring-2 ring-sky-200",
  cleaning: "border-slate-300 bg-slate-100",
};
const STATUS_LABEL: Record<string, string> = {
  available: "ว่าง", occupied: "มีลูกค้า", bill_requested: "เรียกบิล", cleaning: "กำลังทำความสะอาด",
};

export default function TableMapPage(): JSX.Element {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const branchId = useAuthStore((s) => s.branchId);
  const [addOpen, setAddOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrTable, setQrTable] = useState<TableData | null>(null);
  const [newName, setNewName] = useState("");
  const [newCapacity, setNewCapacity] = useState("4");

  const tablesQuery = useQuery({
    queryKey: ["dining-tables", branchId],
    queryFn: async () => (await authApi.get("/restaurant/tables")).data.data as TableData[],
    refetchInterval: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: async () => authApi.post("/restaurant/tables", { name: newName, capacity: Number(newCapacity) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dining-tables"] });
      toast({ title: `เพิ่มโต๊ะ "${newName}" แล้ว` });
      setAddOpen(false); setNewName(""); setNewCapacity("4");
    },
  });

  const openSessionMutation = useMutation({
    mutationFn: async (tableId: string) =>
      authApi.post("/restaurant/sessions", { table_id: tableId, guest_count: 1 }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dining-tables"] });
      toast({ title: "เปิดโต๊ะแล้ว" });
    },
  });

  const closeSessionMutation = useMutation({
    mutationFn: async (sessionId: string) =>
      authApi.post(`/restaurant/sessions/${sessionId}/close`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dining-tables"] });
      toast({ title: "ปิดโต๊ะแล้ว" });
    },
  });

  async function showQr(table: TableData): Promise<void> {
    const url = `${window.location.origin}/menu/${table.qr_token}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 280, margin: 2 });
    setQrDataUrl(dataUrl);
    setQrTable(table);
    setQrOpen(true);
  }

  const tables = tablesQuery.data ?? [];
  const occupiedCount = tables.filter((table) => table.status === "occupied").length;
  const billRequestedCount = tables.filter((table) => table.status === "bill_requested").length;
  const availableCount = tables.filter((table) => table.status === "available").length;

  return (
    <div>
      <PageHeader
        title="แผนที่โต๊ะ"
        subtitle={`${tables.filter((t) => t.status === "occupied" || t.status === "bill_requested").length} / ${tables.length} โต๊ะที่มีลูกค้า`}
        actions={
          <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> เพิ่มโต๊ะ
          </Button>
        }
      />

      <div className="p-6">
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-xs font-semibold text-emerald-700">โต๊ะว่าง</p>
            <p className="mt-1 text-2xl font-bold text-emerald-900">{availableCount}</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-semibold text-amber-700">มีลูกค้า</p>
            <p className="mt-1 text-2xl font-bold text-amber-900">{occupiedCount}</p>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
            <p className="text-xs font-semibold text-sky-700">เรียกบิล</p>
            <p className="mt-1 text-2xl font-bold text-sky-900">{billRequestedCount}</p>
          </div>
        </div>

        {tables.length === 0 && !tablesQuery.isLoading && (
          <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
            <ConciergeBell className="mx-auto mb-3 h-10 w-10" />
            <p className="font-medium">ยังไม่มีโต๊ะ</p>
            <p className="mt-1 text-sm">กดปุ่ม "เพิ่มโต๊ะ" เพื่อเริ่มต้น</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {tables.map((table) => (
            <div key={table.id} className={`rounded-2xl border-2 p-5 shadow-sm transition-all ${STATUS_STYLE[table.status] ?? "border-slate-200 bg-white"}`}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{table.name}</h3>
                  <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    <Users className="h-3 w-3" />
                    <span>{table.capacity} ที่นั่ง</span>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
                  table.status === "available" ? "bg-emerald-100 text-emerald-700"
                  : table.status === "bill_requested" ? "bg-sky-600 text-white"
                  : "bg-amber-100 text-amber-800"
                }`}>
                  {table.status === "bill_requested" ? <Bell className="h-3 w-3" /> : null}
                  {STATUS_LABEL[table.status] ?? table.status}
                </span>
              </div>

              {table.queue_number && (
                <div className="mt-3 rounded-xl bg-white/90 px-3 py-2 text-center shadow-sm">
                  <span className="text-xs text-slate-500">คิว</span>
                  <span className="ml-2 text-2xl font-bold text-slate-950">{String(table.queue_number).padStart(3, "0")}</span>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => showQr(table)}
                  className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <QrCode className="h-3 w-3" /> QR
                </button>

                {table.status === "available" ? (
                  <button
                    type="button"
                    onClick={() => openSessionMutation.mutate(table.id)}
                    className="flex-1 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    เปิดโต๊ะ
                  </button>
                ) : table.active_session_id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate(`/restaurant/session/${table.active_session_id}/detail`)}
                      className="flex items-center gap-1 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      ดู/สั่งเพิ่ม
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/restaurant/session/${table.active_session_id}/checkout`)}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      <ReceiptText className="h-3 w-3" />
                      รวมบิล
                    </button>
                    <button
                      type="button"
                      onClick={() => table.active_session_id && closeSessionMutation.mutate(table.active_session_id)}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      ปิด
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add Table Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>เพิ่มโต๊ะใหม่</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>ชื่อโต๊ะ</Label><Input className="mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="เช่น A1, โต๊ะริมหน้าต่าง" /></div>
            <div><Label>จำนวนที่นั่ง</Label><Input type="number" className="mt-1" value={newCapacity} onChange={(e) => setNewCapacity(e.target.value)} min="1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>ยกเลิก</Button>
            <Button className="bg-orange-500 hover:bg-orange-600" disabled={!newName || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "กำลังบันทึก..." : "เพิ่มโต๊ะ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader><DialogTitle>QR โต๊ะ {qrTable?.name}</DialogTitle></DialogHeader>
          {qrDataUrl && <img src={qrDataUrl} alt="QR" className="mx-auto rounded-2xl" />}
          <p className="text-xs text-slate-500 mt-2">ลูกค้าสแกนเพื่อดูเมนูและสั่งอาหาร</p>
          <Button onClick={() => window.print()} variant="outline" className="mt-2">พิมพ์ QR</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
