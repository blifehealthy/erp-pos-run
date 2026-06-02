import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, MessageCircle, Send, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { branchApi } from "@/lib/adminApi";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import type { BranchSettings } from "@/types/admin";

type ServiceMode = "dine_in" | "quick_service" | "both";

export default function FBSettingsPage(): JSX.Element {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const branchId = useAuthStore((s) => s.branchId);

  const settingsQuery = useQuery({
    queryKey: ["branch-settings", branchId],
    queryFn: async () => {
      if (!branchId) return null;
      return (await branchApi.getSettings(branchId)).data.data as BranchSettings;
    },
    enabled: Boolean(branchId),
  });

  const s = settingsQuery.data;

  const [serviceMode, setServiceMode] = useState<ServiceMode>("quick_service");
  const [queuePrefix, setQueuePrefix] = useState("");
  const [queueReset, setQueueReset] = useState<"daily" | "per_shift">("daily");
  const [lineToken, setLineToken] = useState("");
  const [lineEnabled, setLineEnabled] = useState(false);
  const [kitchenStations, setKitchenStations] = useState<string[]>([]);
  const [newStation, setNewStation] = useState("");
  const [pickupDisplay, setPickupDisplay] = useState(true);
  const [tableQr, setTableQr] = useState(true);
  const [billAtTable, setBillAtTable] = useState(true);

  useEffect(() => {
    if (!s) return;
    setServiceMode(s.fb_service_mode as ServiceMode);
    setQueuePrefix(s.fb_queue_prefix ?? "");
    setQueueReset(s.fb_queue_reset as "daily" | "per_shift");
    setLineToken(s.fb_line_notify_token ?? "");
    setLineEnabled(Boolean(s.fb_line_notify_token));
    setKitchenStations(s.fb_kitchen_stations ?? []);
    setPickupDisplay(s.fb_pickup_display_enabled);
    setTableQr(s.fb_table_qr_enabled);
    setBillAtTable(s.fb_bill_at_table);
  }, [s]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("ไม่พบสาขา");
      await branchApi.updateSettings(branchId, {
        fb_service_mode: serviceMode,
        fb_queue_prefix: queuePrefix,
        fb_queue_reset: queueReset,
        fb_line_notify_token: lineEnabled ? lineToken : null,
        fb_kitchen_stations: kitchenStations.filter(Boolean),
        fb_pickup_display_enabled: pickupDisplay,
        fb_table_qr_enabled: tableQr,
        fb_bill_at_table: billAtTable,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["branch-settings"] });
      toast({ title: "บันทึกการตั้งค่าแล้ว" });
    },
    onError: () => toast({ title: "บันทึกไม่สำเร็จ" }),
  });

  const testLineMutation = useMutation({
    mutationFn: async () => authApi.post("/restaurant/line-notify/test"),
    onSuccess: () => toast({ title: "ส่ง Line Notify สำเร็จ ✅", description: "ตรวจสอบ Line ของคุณ" }),
    onError: () => toast({ title: "ส่งไม่สำเร็จ ❌", description: "ตรวจสอบ Token อีกครั้ง" }),
  });

  const hasDineIn = serviceMode === "dine_in" || serviceMode === "both";
  const hasQuickService = serviceMode === "quick_service" || serviceMode === "both";

  return (
    <div>
      <PageHeader
        title="ตั้งค่า F&B"
        subtitle="ปรับการตั้งค่าร้านอาหาร / คาเฟ่"
        actions={
          <Button className="bg-orange-500 hover:bg-orange-600" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        }
      />

      <div className="space-y-6 p-6 max-w-2xl">

        {/* Service Mode */}
        <Section title="รูปแบบบริการ" icon={<Settings className="h-5 w-5" />}>
          <div className="grid grid-cols-3 gap-3">
            {([
              { value: "dine_in", label: "Dine-in", desc: "บริการที่โต๊ะ" },
              { value: "quick_service", label: "Quick Service", desc: "มารับเอง" },
              { value: "both", label: "ทั้งสองแบบ", desc: "มีทั้งคู่" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setServiceMode(opt.value)}
                className={`rounded-2xl border-2 px-4 py-3 text-left transition-all ${serviceMode === opt.value ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
              >
                <p className={`font-semibold ${serviceMode === opt.value ? "text-orange-700" : "text-slate-800"}`}>{opt.label}</p>
                <p className="text-xs text-slate-500">{opt.desc}</p>
              </button>
            ))}
          </div>
        </Section>

        {/* Dine-in Settings */}
        {hasDineIn && (
          <Section title="Dine-in">
            <Toggle label="QR ประจำโต๊ะ" desc="ลูกค้าสแกน QR บนโต๊ะเพื่อสั่งอาหาร" checked={tableQr} onChange={setTableQr} />
            <Toggle label="ลูกค้าขอบิลจาก QR ได้" desc="ปุ่ม 'เรียกบิล' บนหน้าเมนูลูกค้า" checked={billAtTable} onChange={setBillAtTable} />
          </Section>
        )}

        {/* Quick Service Settings */}
        {hasQuickService && (
          <Section title="Quick Service / คิว">
            <Toggle label="หน้าจอแสดงคิวที่เคาน์เตอร์" desc="TV/tablet แสดงเลขคิวพร้อมรับ" checked={pickupDisplay} onChange={setPickupDisplay} />
            <div className="grid grid-cols-2 gap-4 mt-2">
              <div>
                <Label className="text-xs text-slate-600">Prefix คิว</Label>
                <Input className="mt-1" value={queuePrefix} onChange={(e) => setQueuePrefix(e.target.value)}
                  placeholder="เช่น Q (แสดงเป็น Q001)" maxLength={5} />
              </div>
              <div>
                <Label className="text-xs text-slate-600">Reset เลขคิว</Label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(["daily", "per_shift"] as const).map((r) => (
                    <button key={r} type="button" onClick={() => setQueueReset(r)}
                      className={`rounded-lg border px-3 py-2 text-sm ${queueReset === r ? "border-orange-400 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-600"}`}>
                      {r === "daily" ? "รายวัน" : "รายกะ"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        )}

        {/* Kitchen Stations */}
        <Section title="Kitchen Stations">
          <div className="flex flex-wrap gap-2">
            {kitchenStations.map((station) => (
              <span key={station} className="flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-sm text-orange-700">
                {station}
                <button type="button" onClick={() => setKitchenStations((prev) => prev.filter((s) => s !== station))}
                  className="ml-1 text-orange-400 hover:text-orange-700">×</button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Input value={newStation} onChange={(e) => setNewStation(e.target.value)}
              placeholder="ชื่อ station เช่น Coffee, Food, Bar"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newStation.trim() && !kitchenStations.includes(newStation.trim())) {
                  setKitchenStations((prev) => [...prev, newStation.trim()]);
                  setNewStation("");
                }
              }} />
            <Button variant="outline" onClick={() => {
              if (newStation.trim() && !kitchenStations.includes(newStation.trim())) {
                setKitchenStations((prev) => [...prev, newStation.trim()]);
                setNewStation("");
              }
            }}>เพิ่ม</Button>
          </div>
        </Section>

        {/* Line Notify */}
        <Section title="Line Notify" icon={<MessageCircle className="h-5 w-5 text-green-600" />}>
          <Toggle
            label="เปิดใช้ Line Notify"
            desc="ส่งข้อความ Line เมื่ออาหารพร้อม"
            checked={lineEnabled}
            onChange={setLineEnabled}
          />

          {lineEnabled && (
            <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <Label className="text-xs text-slate-600">Line Notify Token</Label>
                <Input
                  className="mt-1 font-mono text-sm"
                  type="password"
                  value={lineToken}
                  onChange={(e) => setLineToken(e.target.value)}
                  placeholder="วาง token จาก notify.line.me"
                />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={!lineToken || testLineMutation.isPending}
                  onClick={() => testLineMutation.mutate()}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {testLineMutation.isPending ? "กำลังส่ง..." : "ทดสอบส่ง Line"}
                </Button>
                <Button variant="outline" asChild className="flex-1">
                  <a href="https://notify-bot.line.me/th/" target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    วิธีขอ Token
                  </a>
                </Button>
              </div>

              <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
                <p className="font-semibold">วิธีใช้งาน Line Notify</p>
                <ol className="mt-2 list-decimal list-inside space-y-1 text-xs">
                  <li>ไปที่ notify.line.me แล้วล็อกอิน</li>
                  <li>กด "Generate token" สร้าง token ใหม่</li>
                  <li>เลือก Line Group ที่ต้องการรับแจ้งเตือน</li>
                  <li>คัดลอก token แล้ววางในช่องด้านบน</li>
                  <li>กด "ทดสอบส่ง Line" เพื่อยืนยัน</li>
                </ol>
              </div>

              {/* Preview message */}
              <div>
                <p className="text-xs text-slate-500 mb-2">ตัวอย่างข้อความที่ลูกค้าจะได้รับ:</p>
                <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm font-mono text-green-800 whitespace-pre-line">
                  {`🍽️ ออเดอร์พร้อมแล้ว!\nคิว ${queuePrefix || ""}001 — มารับได้เลยครับ 🔔`}
                </div>
              </div>
            </div>
          )}

          {!lineEnabled && (
            <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
              Line Notify ปิดอยู่ — ลูกค้าจะได้รับแจ้งเตือนผ่านหน้า QR เท่านั้น
            </div>
          )}
        </Section>

        <div className="flex justify-end pb-6">
          <Button className="bg-orange-500 hover:bg-orange-600 px-8" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 hover:bg-slate-100">
      <div>
        <p className="font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
      <div className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${checked ? "bg-orange-500" : "bg-slate-300"}`}
        onClick={() => onChange(!checked)}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </div>
    </label>
  );
}
