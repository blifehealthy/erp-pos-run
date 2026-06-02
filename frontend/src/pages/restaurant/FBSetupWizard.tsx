import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChefHat,
  Coffee,
  ConciergeBell,
  MessageCircle,
  Monitor,
  QrCode,
  ShoppingBag,
  UtensilsCrossed,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { branchApi } from "@/lib/adminApi";
import { useAuthStore } from "@/stores/auth.store";
import type { BranchSettings } from "@/types/admin";

type ServiceMode = "dine_in" | "quick_service" | "both";
type QueueReset = "daily" | "per_shift";

type WizardState = {
  service_mode: ServiceMode;
  // dine-in
  table_qr_enabled: boolean;
  bill_at_table: boolean;
  // quick service
  queue_enabled: boolean;
  queue_reset: QueueReset;
  queue_prefix: string;
  pickup_display_enabled: boolean;
  // notifications
  line_notify_token: string;
  line_notify_enabled: boolean;
  // kitchen
  kitchen_stations: string[];
};

const DEFAULT_STATIONS = ["อาหาร", "เครื่องดื่มร้อน", "เครื่องดื่มเย็น"];

const STEPS = [
  { id: "mode", label: "รูปแบบบริการ" },
  { id: "service", label: "ตั้งค่าบริการ" },
  { id: "kitchen", label: "ส่วนครัว" },
  { id: "notify", label: "แจ้งเตือนลูกค้า" },
  { id: "confirm", label: "ยืนยัน" },
];

export default function FBSetupWizard(): JSX.Element {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const branchId = useAuthStore((s) => s.branchId);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardState>({
    service_mode: "quick_service",
    table_qr_enabled: true,
    bill_at_table: true,
    queue_enabled: true,
    queue_reset: "daily",
    queue_prefix: "",
    pickup_display_enabled: true,
    line_notify_token: "",
    line_notify_enabled: false,
    kitchen_stations: [...DEFAULT_STATIONS],
  });

  const settingsQuery = useQuery({
    queryKey: ["branch-settings", branchId],
    queryFn: async () => {
      if (!branchId) return null;
      return (await branchApi.getSettings(branchId)).data.data as BranchSettings;
    },
    enabled: Boolean(branchId),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("ไม่พบสาขา");
      await branchApi.updateSettings(branchId, {
        fb_enabled: true,
        fb_service_mode: form.service_mode,
        fb_table_qr_enabled: form.table_qr_enabled,
        fb_bill_at_table: form.bill_at_table,
        fb_queue_enabled: form.queue_enabled,
        fb_queue_reset: form.queue_reset,
        fb_queue_prefix: form.queue_prefix,
        fb_pickup_display_enabled: form.pickup_display_enabled,
        fb_line_notify_token: form.line_notify_enabled ? form.line_notify_token : null,
        fb_line_mode: "group",
        fb_kitchen_stations: form.kitchen_stations.filter(Boolean),
        fb_setup_completed: true,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["branch-settings"] });
      toast({ title: "ตั้งค่า F&B เสร็จสมบูรณ์" });
      navigate("/restaurant");
    },
    onError: () => {
      toast({ title: "บันทึกไม่สำเร็จ กรุณาลองใหม่" });
    },
  });

  const hasDineIn = form.service_mode === "dine_in" || form.service_mode === "both";
  const hasQuickService = form.service_mode === "quick_service" || form.service_mode === "both";

  function set<K extends keyof WizardState>(key: K, value: WizardState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleStation(name: string): void {
    setForm((prev) => ({
      ...prev,
      kitchen_stations: prev.kitchen_stations.includes(name)
        ? prev.kitchen_stations.filter((s) => s !== name)
        : [...prev.kitchen_stations, name],
    }));
  }

  if (settingsQuery.data?.fb_setup_completed) {
    navigate("/restaurant");
    return <></>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50 p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500 shadow-lg">
            <UtensilsCrossed className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">ตั้งค่า F&B Module</h1>
          <p className="mt-1 text-slate-500">ใช้กับร้านอาหาร คาเฟ่ หรือทั้งสองอย่าง</p>
        </div>

        {/* Step indicator */}
        <div className="mb-8 flex items-center justify-between">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                    i < step
                      ? "bg-orange-500 text-white"
                      : i === step
                        ? "border-2 border-orange-500 bg-white text-orange-600"
                        : "border-2 border-slate-200 bg-white text-slate-400"
                  }`}
                >
                  {i < step ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className={`mt-1 hidden text-xs sm:block ${i === step ? "font-medium text-orange-600" : "text-slate-400"}`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`mx-1 h-0.5 flex-1 transition-all ${i < step ? "bg-orange-400" : "bg-slate-200"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-white bg-white p-8 shadow-xl">
          {/* Step 0 — Service Mode */}
          {step === 0 && (
            <div>
              <h2 className="mb-6 text-xl font-semibold text-slate-900">ร้านของคุณให้บริการแบบไหน?</h2>
              <div className="space-y-4">
                {(
                  [
                    {
                      mode: "dine_in" as ServiceMode,
                      icon: <ConciergeBell className="h-6 w-6" />,
                      title: "Dine-in — บริการที่โต๊ะ",
                      desc: "ลูกค้าสแกน QR ที่โต๊ะ สั่งอาหาร รอรับที่โต๊ะ เหมาะกับร้านอาหาร",
                    },
                    {
                      mode: "quick_service" as ServiceMode,
                      icon: <ShoppingBag className="h-6 w-6" />,
                      title: "Quick Service — มารับเอง",
                      desc: "ลูกค้าสั่ง ได้เลขคิว รอรับที่เคาน์เตอร์ เหมาะกับคาเฟ่และ fast food",
                    },
                    {
                      mode: "both" as ServiceMode,
                      icon: <Coffee className="h-6 w-6" />,
                      title: "ทั้งสองแบบ",
                      desc: "มีทั้งโซนโต๊ะและ takeaway เช่น คาเฟ่ที่มีทั้งที่นั่งและลูกค้ากลับบ้าน",
                    },
                  ] as const
                ).map(({ mode, icon, title, desc }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => set("service_mode", mode)}
                    className={`flex w-full items-start gap-4 rounded-2xl border-2 p-5 text-left transition-all ${
                      form.service_mode === mode
                        ? "border-orange-400 bg-orange-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className={`mt-0.5 rounded-xl p-2 ${form.service_mode === mode ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                      {icon}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900">{title}</div>
                      <div className="mt-1 text-sm text-slate-500">{desc}</div>
                    </div>
                    {form.service_mode === mode && (
                      <div className="ml-auto mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500">
                        <Check className="h-3 w-3 text-white" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 1 — Service Config */}
          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-slate-900">ตั้งค่าการบริการ</h2>

              {hasDineIn && (
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5">
                  <div className="flex items-center gap-2 font-semibold text-orange-800">
                    <ConciergeBell className="h-5 w-5" />
                    Dine-in
                  </div>
                  <div className="mt-4 space-y-3">
                    <label className="flex items-center justify-between gap-4 rounded-xl border border-orange-200 bg-white px-4 py-3">
                      <div>
                        <div className="font-medium text-slate-800">QR ประจำโต๊ะ</div>
                        <div className="text-xs text-slate-500">ลูกค้าสแกน QR บนโต๊ะเพื่อเปิดเมนูและสั่งอาหาร</div>
                      </div>
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-orange-500"
                        checked={form.table_qr_enabled}
                        onChange={(e) => set("table_qr_enabled", e.target.checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-4 rounded-xl border border-orange-200 bg-white px-4 py-3">
                      <div>
                        <div className="font-medium text-slate-800">ลูกค้าขอบิลจาก QR ได้</div>
                        <div className="text-xs text-slate-500">ปุ่ม "เรียกบิล" บนหน้าเมนูลูกค้า</div>
                      </div>
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-orange-500"
                        checked={form.bill_at_table}
                        onChange={(e) => set("bill_at_table", e.target.checked)}
                      />
                    </label>
                  </div>
                </div>
              )}

              {hasQuickService && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
                  <div className="flex items-center gap-2 font-semibold text-blue-800">
                    <ShoppingBag className="h-5 w-5" />
                    Quick Service
                  </div>
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-slate-600">Prefix คิว (ไม่บังคับ)</Label>
                        <Input
                          className="mt-1"
                          placeholder="เช่น Q, คิว"
                          value={form.queue_prefix}
                          onChange={(e) => set("queue_prefix", e.target.value)}
                          maxLength={5}
                        />
                        <p className="mt-1 text-xs text-slate-400">
                          ตัวอย่าง: {form.queue_prefix || ""}001
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-slate-600">Reset เลขคิว</Label>
                        <div className="mt-1 grid grid-cols-1 gap-2">
                          {(["daily", "per_shift"] as QueueReset[]).map((r) => (
                            <button
                              key={r}
                              type="button"
                              onClick={() => set("queue_reset", r)}
                              className={`rounded-lg border px-3 py-2 text-sm ${form.queue_reset === r ? "border-blue-500 bg-blue-100 text-blue-700" : "border-slate-200 bg-white text-slate-600"}`}
                            >
                              {r === "daily" ? "รายวัน (เที่ยงคืน)" : "รายกะ"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <label className="flex items-center justify-between gap-4 rounded-xl border border-blue-200 bg-white px-4 py-3">
                      <div>
                        <div className="font-medium text-slate-800">หน้าจอแสดงคิวที่เคาน์เตอร์</div>
                        <div className="text-xs text-slate-500">TV/tablet แสดงเลขคิวที่พร้อมรับ</div>
                      </div>
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-blue-500"
                        checked={form.pickup_display_enabled}
                        onChange={(e) => set("pickup_display_enabled", e.target.checked)}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Kitchen */}
          {step === 2 && (
            <div>
              <h2 className="mb-2 text-xl font-semibold text-slate-900">ส่วนครัว / Station</h2>
              <p className="mb-6 text-sm text-slate-500">
                เลือก station ที่ครัวของคุณมี ออเดอร์จะถูกส่งไปยัง station ที่ถูกต้อง
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { name: "อาหาร", icon: <UtensilsCrossed className="h-5 w-5" /> },
                  { name: "เครื่องดื่มร้อน", icon: <Coffee className="h-5 w-5" /> },
                  { name: "เครื่องดื่มเย็น", icon: <Coffee className="h-5 w-5" /> },
                  { name: "ขนมอบ", icon: <ChefHat className="h-5 w-5" /> },
                  { name: "ของหวาน", icon: <ChefHat className="h-5 w-5" /> },
                  { name: "Bar", icon: <Coffee className="h-5 w-5" /> },
                ].map(({ name, icon }) => {
                  const active = form.kitchen_stations.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleStation(name)}
                      className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-4 py-5 transition-all ${active ? "border-orange-400 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                    >
                      {icon}
                      <span className="text-sm font-medium">{name}</span>
                      {active && <Check className="h-4 w-4 text-orange-500" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4">
                <Label className="text-xs text-slate-500">เพิ่ม station เอง (กด Enter)</Label>
                <Input
                  className="mt-1"
                  placeholder="เช่น Sushi Bar"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val && !form.kitchen_stations.includes(val)) {
                        setForm((prev) => ({ ...prev, kitchen_stations: [...prev.kitchen_stations, val] }));
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                />
                {form.kitchen_stations.filter((s) => !["อาหาร", "เครื่องดื่มร้อน", "เครื่องดื่มเย็น", "ขนมอบ", "ของหวาน", "Bar"].includes(s)).map((s) => (
                  <span key={s} className="mt-2 mr-2 inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-xs text-orange-700">
                    {s}
                    <button type="button" onClick={() => toggleStation(s)} className="ml-1 text-orange-400 hover:text-orange-700">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Step 3 — Notifications */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold text-slate-900">แจ้งเตือนลูกค้าเมื่ออาหารพร้อม</h2>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-emerald-700">
                  <Monitor className="h-5 w-5" />
                  <span className="font-medium">หน้าจอคิว + แจ้งในแอปลูกค้า</span>
                </div>
                <p className="mt-1 text-sm text-emerald-700">เปิดใช้งานอัตโนมัติ ไม่ต้องตั้งค่าเพิ่ม</p>
              </div>

              <div className={`rounded-2xl border-2 p-5 transition-all ${form.line_notify_enabled ? "border-green-400 bg-green-50" : "border-slate-200 bg-white"}`}>
                <label className="flex cursor-pointer items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <MessageCircle className={`mt-0.5 h-5 w-5 ${form.line_notify_enabled ? "text-green-600" : "text-slate-400"}`} />
                    <div>
                      <div className="font-medium text-slate-800">Line Notify</div>
                      <div className="text-sm text-slate-500">ส่งข้อความ Line เมื่ออาหารพร้อม (ต้องมี Line Notify Token)</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-green-500"
                    checked={form.line_notify_enabled}
                    onChange={(e) => set("line_notify_enabled", e.target.checked)}
                  />
                </label>
                {form.line_notify_enabled && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <Label className="text-xs text-slate-600">Line Notify Token</Label>
                      <Input
                        className="mt-1 font-mono text-sm"
                        placeholder="วาง token จาก notify.line.me"
                        value={form.line_notify_token}
                        onChange={(e) => set("line_notify_token", e.target.value)}
                      />
                    </div>
                    <a
                      href="https://notify-bot.line.me/th/"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-green-600 underline"
                    >
                      วิธีขอ Line Notify Token →
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4 — Confirm */}
          {step === 4 && (
            <div>
              <h2 className="mb-6 text-xl font-semibold text-slate-900">สรุปการตั้งค่า</h2>
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm">
                <Row label="รูปแบบบริการ" value={
                  form.service_mode === "dine_in" ? "Dine-in (บริการที่โต๊ะ)"
                  : form.service_mode === "quick_service" ? "Quick Service (มารับเอง)"
                  : "ทั้งสองแบบ"
                } />
                {hasDineIn && <>
                  <Row label="QR ประจำโต๊ะ" value={form.table_qr_enabled ? "เปิด" : "ปิด"} />
                  <Row label="ลูกค้าขอบิลจาก QR" value={form.bill_at_table ? "เปิด" : "ปิด"} />
                </>}
                {hasQuickService && <>
                  <Row label="เลขคิว" value={`${form.queue_prefix || "(ไม่มี prefix)"}001 — reset ${form.queue_reset === "daily" ? "รายวัน" : "รายกะ"}`} />
                  <Row label="หน้าจอคิว" value={form.pickup_display_enabled ? "เปิด" : "ปิด"} />
                </>}
                <Row label="Kitchen Stations" value={form.kitchen_stations.length > 0 ? form.kitchen_stations.join(", ") : "ยังไม่เลือก"} />
                <Row label="Line Notify" value={form.line_notify_enabled && form.line_notify_token ? "เปิด" : "ปิด"} />
              </div>
              <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
                สามารถแก้ไขการตั้งค่าเหล่านี้ได้ภายหลังที่ <strong>ตั้งค่าสาขา → F&B</strong>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="mt-8 flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0}
            >
              ย้อนกลับ
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                className="bg-orange-500 hover:bg-orange-600"
                onClick={() => setStep((s) => s + 1)}
              >
                ถัดไป →
              </Button>
            ) : (
              <Button
                className="bg-orange-500 hover:bg-orange-600"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "กำลังบันทึก..." : "เริ่มใช้งาน F&B 🎉"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}
