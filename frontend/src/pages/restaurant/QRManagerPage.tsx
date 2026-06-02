import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, QrCode, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import PageHeader from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { authApi } from "@/lib/api";
import { branchApi } from "@/lib/adminApi";
import { useAuthStore } from "@/stores/auth.store";
import type { BranchSettings } from "@/types/admin";

export default function QRManagerPage(): JSX.Element {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const branchId = useAuthStore((s) => s.branchId);
  const [qsQrDataUrl, setQsQrDataUrl] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["branch-settings", branchId],
    queryFn: async () => {
      if (!branchId) return null;
      return (await branchApi.getSettings(branchId)).data.data as BranchSettings;
    },
    enabled: Boolean(branchId),
  });

  const settings = settingsQuery.data;

  // Generate QR image เมื่อมี token
  useEffect(() => {
    if (!settings?.fb_qs_qr_token) { setQsQrDataUrl(""); return; }
    const url = `${window.location.origin}/order/${settings.fb_qs_qr_token}`;
    QRCode.toDataURL(url, { width: 300, margin: 2, color: { dark: "#1e293b" } })
      .then(setQsQrDataUrl)
      .catch(() => setQsQrDataUrl(""));
  }, [settings?.fb_qs_qr_token]);

  const generateMutation = useMutation({
    mutationFn: async () => (await authApi.post("/restaurant/qs-qr/generate")).data.data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["branch-settings"] });
      toast({ title: "สร้าง QR สำเร็จ" });
    },
  });

  function downloadQr(dataUrl: string, name: string): void {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${name}.png`;
    a.click();
  }

  function printQr(): void {
    window.print();
  }

  return (
    <div>
      <PageHeader title="QR Code เมนู" subtitle="สร้างและพิมพ์ QR สำหรับลูกค้าสแกนสั่งอาหาร" />

      <div className="grid gap-6 p-6 md:grid-cols-2">
        {/* Quick Service QR */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-2xl bg-orange-100 p-3">
              <QrCode className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">QR สำหรับร้าน (Quick Service)</h3>
              <p className="text-sm text-slate-500">ลูกค้าสแกนที่เคาน์เตอร์ ไม่ต้องมีโต๊ะ</p>
            </div>
          </div>

          {qsQrDataUrl ? (
            <>
              <div className="flex justify-center">
                <div className="rounded-3xl border-4 border-orange-200 bg-white p-4 shadow-md print:border-0">
                  <img src={qsQrDataUrl} alt="Quick Service QR" className="h-64 w-64" />
                  <p className="mt-3 text-center text-sm font-semibold text-slate-700">สแกนเพื่อสั่งอาหาร</p>
                  <p className="text-center text-xs text-slate-400">{settingsQuery.data?.fb_queue_prefix ? `ระบบคิว: ${settingsQuery.data.fb_queue_prefix}XXX` : "ระบบคิวอัตโนมัติ"}</p>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => downloadQr(qsQrDataUrl, "shop-qr")}>
                  <Download className="mr-2 h-4 w-4" /> ดาวน์โหลด
                </Button>
                <Button variant="outline" className="flex-1" onClick={printQr}>
                  พิมพ์
                </Button>
                <Button
                  variant="outline"
                  className="text-red-500 hover:bg-red-50"
                  onClick={() => window.confirm("สร้าง QR ใหม่? QR เดิมจะใช้ไม่ได้") && generateMutation.mutate()}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-medium">URL:</p>
                <p className="mt-1 break-all text-xs font-mono text-blue-600">
                  {window.location.origin}/order/{settingsQuery.data?.fb_qs_qr_token}
                </p>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <QrCode className="h-16 w-16 text-slate-200 mb-4" />
              <p className="text-slate-500 mb-4">ยังไม่มี QR สำหรับ Quick Service</p>
              <Button
                className="bg-orange-500 hover:bg-orange-600"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? "กำลังสร้าง..." : "สร้าง QR"}
              </Button>
            </div>
          )}
        </div>

        {/* Info panel */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <h4 className="font-semibold text-blue-800 mb-3">วิธีใช้งาน Quick Service QR</h4>
            <ol className="space-y-2 text-sm text-blue-700">
              <li className="flex gap-2"><span className="flex-shrink-0 font-bold">1.</span>Print QR แล้วติดที่เคาน์เตอร์หรือโต๊ะลูกค้า</li>
              <li className="flex gap-2"><span className="flex-shrink-0 font-bold">2.</span>ลูกค้าสแกน QR ด้วยกล้องโทรศัพท์</li>
              <li className="flex gap-2"><span className="flex-shrink-0 font-bold">3.</span>เลือกเมนู ใส่ตะกร้า กด "สั่งอาหาร"</li>
              <li className="flex gap-2"><span className="flex-shrink-0 font-bold">4.</span>ระบบออกเลขคิวให้อัตโนมัติ</li>
              <li className="flex gap-2"><span className="flex-shrink-0 font-bold">5.</span>เมื่อครัวกด "เสร็จแล้ว" ลูกค้าเห็น notification ทันที</li>
            </ol>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h4 className="font-semibold text-amber-800 mb-2">ข้อแตกต่างกับ QR โต๊ะ</h4>
            <div className="text-sm text-amber-700 space-y-1">
              <p>• <strong>QR ร้าน:</strong> ลูกค้าแต่ละคนได้ session + คิวของตัวเอง</p>
              <p>• <strong>QR โต๊ะ:</strong> ลูกค้าทุกคนที่โต๊ะเดียวกัน share session เดียวกัน</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h4 className="font-semibold text-slate-700 mb-2">QR โต๊ะ (Dine-in)</h4>
            <p className="text-sm text-slate-500">สร้าง QR ประจำแต่ละโต๊ะได้ที่</p>
            <Button variant="outline" className="mt-2 w-full" asChild>
              <a href="/restaurant/tables">แผนที่โต๊ะ →</a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
