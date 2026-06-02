import { useQuery } from "@tanstack/react-query";
import { BarChart2, ChefHat, ConciergeBell, Monitor, QrCode, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { branchApi } from "@/lib/adminApi";
import { useAuthStore } from "@/stores/auth.store";
import type { BranchSettings } from "@/types/admin";
import PageHeader from "@/components/layout/PageHeader";

export default function RestaurantIndexPage(): JSX.Element {
  const navigate = useNavigate();
  const branchId = useAuthStore((s) => s.branchId);

  const settingsQuery = useQuery({
    queryKey: ["branch-settings", branchId],
    queryFn: async () => {
      if (!branchId) return null;
      return (await branchApi.getSettings(branchId)).data.data as BranchSettings;
    },
    enabled: Boolean(branchId),
  });

  const settings = settingsQuery.data;

  if (settingsQuery.isLoading) {
    return <div className="p-8 text-center text-slate-500">กำลังโหลด...</div>;
  }

  if (!settings?.fb_setup_completed) {
    navigate("/restaurant/setup");
    return <></>;
  }

  const hasDineIn = settings.fb_service_mode === "dine_in" || settings.fb_service_mode === "both";
  const hasQuickService = settings.fb_service_mode === "quick_service" || settings.fb_service_mode === "both";

  const cards = [
    ...(hasDineIn ? [
      {
        to: "/restaurant/tables",
        icon: <ConciergeBell className="h-7 w-7" />,
        title: "แผนที่โต๊ะ",
        desc: "เปิด/ปิดโต๊ะ ดูออเดอร์ รวมบิล",
        color: "bg-orange-500",
      },
    ] : []),
    ...(hasQuickService ? [
      {
        to: "/restaurant/qr",
        icon: <ShoppingBag className="h-7 w-7" />,
        title: "QR สั่งอาหาร (Quick Service)",
        desc: "สร้าง QR สำหรับลูกค้าสแกนสั่งเอง ได้เลขคิว",
        color: "bg-blue-500",
      },
    ] : []),
    {
      to: "/restaurant/orders",
      icon: <UtensilsCrossed className="h-7 w-7" />,
      title: "ออเดอร์วันนี้",
      desc: "ดูทุก session ของวัน สถานะ และรวมบิล",
      color: "bg-indigo-500",
    },
    {
      to: "/restaurant/kitchen",
      icon: <ChefHat className="h-7 w-7" />,
      title: "Kitchen Display",
      desc: "หน้าจอครัว — รับและอัปเดตสถานะออเดอร์",
      color: "bg-red-500",
    },
    ...(hasQuickService && settings.fb_pickup_display_enabled ? [
      {
        to: "/restaurant/pickup",
        icon: <Monitor className="h-7 w-7" />,
        title: "หน้าจอคิวเคาน์เตอร์",
        desc: "เปิดบน TV/tablet ที่เคาน์เตอร์",
        color: "bg-emerald-500",
      },
    ] : []),
    {
      to: "/restaurant/recipes",
      icon: <UtensilsCrossed className="h-7 w-7" />,
      title: "สูตรอาหาร / วัตถุดิบ",
      desc: "จัดการสูตร ต้นทุน และการตัดสต็อก",
      color: "bg-purple-500",
    },
    {
      to: "/restaurant/qr",
      icon: <QrCode className="h-7 w-7" />,
      title: "QR Code เมนู",
      desc: "สร้างและพิมพ์ QR สำหรับโต๊ะหรือร้าน",
      color: "bg-slate-600",
    },
    {
      to: "/restaurant/reports/ingredients",
      icon: <BarChart2 className="h-7 w-7" />,
      title: "รายงานวัตถุดิบ",
      desc: "ต้นทุน ปริมาณใช้ และ variance รายวัน/รายกะ",
      color: "bg-indigo-500",
    },
  ];

  return (
    <div>
      <PageHeader
        title="F&B — ร้านอาหาร / คาเฟ่"
        subtitle={
          settings.fb_service_mode === "dine_in" ? "โหมด: บริการที่โต๊ะ"
          : settings.fb_service_mode === "quick_service" ? "โหมด: Quick Service"
          : "โหมด: Dine-in + Quick Service"
        }
        actions={
          <Button variant="outline" asChild>
            <Link to="/restaurant/settings">ตั้งค่า F&B</Link>
          </Button>
        }
      />
      <div className="p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.to}
              to={card.to}
              className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className={`rounded-xl p-3 text-white ${card.color}`}>
                {card.icon}
              </div>
              <div>
                <div className="font-semibold text-slate-900">{card.title}</div>
                <div className="mt-1 text-sm text-slate-500">{card.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
