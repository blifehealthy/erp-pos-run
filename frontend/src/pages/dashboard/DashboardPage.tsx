import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Package, ShoppingCart, TrendingUp } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatThaiCurrency } from "@/lib/cartUtils";
import { reportApi } from "@/lib/reportApi";
import { syncStockBalances } from "@/lib/syncService";
import type { ApiResponse } from "@/types/api";
import type { DashboardStats, HourlySales } from "@/types/report";
import { useAuthStore } from "@/stores/auth.store";

export default function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const branchId = useAuthStore((state) => state.branchId);
  const permissions = useAuthStore((state) => state.permissions);
  const statsQuery = useQuery({
    queryKey: ["dashboard-stats", branchId],
    queryFn: async () => {
      const response = await reportApi.dashboard(branchId ?? undefined);
      return response.data as ApiResponse<DashboardStats>;
    },
    staleTime: 300_000
  });
  const hourlyQuery = useQuery({
    queryKey: ["dashboard-hourly", branchId],
    queryFn: async () => {
      const response = await reportApi.hourlySales(undefined, branchId ?? undefined);
      return response.data as ApiResponse<HourlySales[]>;
    },
    staleTime: 300_000
  });

  useEffect(() => {
    void syncStockBalances();
  }, []);

  const dashboardStats = statsQuery.data?.data;
  const lowStockCount = dashboardStats?.low_stock_count ?? 0;
  const comparison = dashboardStats?.compared_yesterday_pct;
  const comparisonBadge =
    comparison == null
      ? { label: "N/A", className: "bg-gray-100 text-gray-500" }
      : comparison > 0
        ? { label: `↑ +${Number(comparison).toFixed(1)}%`, className: "bg-green-50 text-green-700" }
        : comparison < 0
          ? { label: `↓ ${Number(comparison).toFixed(1)}%`, className: "bg-red-50 text-red-700" }
          : { label: "= 0.0%", className: "bg-gray-100 text-gray-600" };
  const cards = [
    {
      label: "ออร์เดอร์วันนี้",
      value: dashboardStats ? String(dashboardStats.today_orders) : null,
      subtitle: dashboardStats ? `เฉลี่ย ${formatThaiCurrency(Number(dashboardStats.today_avg_order))} / บิล` : null,
      icon: ShoppingCart,
      color: "text-blue-600 bg-blue-50"
    },
    {
      label: "ยอดขายวันนี้",
      value: dashboardStats ? formatThaiCurrency(Number(dashboardStats.today_sales)) : null,
      subtitle: dashboardStats ? `VAT ${formatThaiCurrency(Number(dashboardStats.today_vat))}` : null,
      badge: comparisonBadge,
      icon: TrendingUp,
      color: "text-green-600 bg-green-50"
    },
    {
      label: "สต็อกต่ำ",
      value: dashboardStats ? String(lowStockCount) : null,
      subtitle: "คลิกเพื่อดูรายการสินค้าใกล้หมด",
      icon: AlertTriangle,
      color: "text-orange-600 bg-orange-50",
      clickable: true
    },
    {
      label: "สินค้าทั้งหมด",
      value: dashboardStats ? String(dashboardStats.total_products) : null,
      subtitle: `เปิดกะอยู่ ${dashboardStats?.open_shifts_count ?? 0} กะ`,
      icon: Package,
      color: "text-blue-600 bg-blue-50"
    }
  ];

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="ภาพรวมระบบ" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {cards.map((stat) => (
          <Card
            key={stat.label}
            className={stat.label === "สต็อกต่ำ" && lowStockCount > 0 ? "border-orange-300" : ""}
          >
            <CardContent className="p-5">
              <button
                type="button"
                className="flex w-full items-start justify-between text-left"
                onClick={() => {
                  if (stat.clickable) {
                    navigate("/stock?tab=2&filter=low");
                  }
                }}
              >
                <div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  {stat.value === null ? (
                    <Skeleton className="mt-3 h-8 w-28" />
                  ) : (
                    <p className="mt-3 text-2xl font-semibold text-gray-900">{stat.value}</p>
                  )}
                  {stat.subtitle ? <p className="mt-2 text-xs text-gray-500">{stat.subtitle}</p> : null}
                  {"badge" in stat && stat.badge ? (
                    <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-medium ${stat.badge.className}`}>
                      {stat.badge.label}
                    </span>
                  ) : null}
                </div>
                <div className={`rounded-xl p-3 ${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
              </button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">ยอดขายรายชั่วโมงวันนี้</p>
              <p className="text-sm text-gray-500">
                ผู้ใช้งานปัจจุบัน: {user?.display_name ?? user?.username ?? "-"} · สิทธิ์ {permissions.length}
              </p>
            </div>
          </div>

          {hourlyQuery.isLoading ? (
            <Skeleton className="h-[120px] w-full" />
          ) : (
            <div className="h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={(hourlyQuery.data?.data ?? []).map((item) => ({
                    ...item,
                    label: `${String(item.hour).padStart(2, "0")}:00`
                  }))}
                >
                  <defs>
                    <linearGradient id="dashboardSalesGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" hide />
                  <YAxis hide />
                  <Tooltip formatter={(value: number) => formatThaiCurrency(Number(value))} />
                  <Area
                    type="monotone"
                    dataKey="total_amount"
                    stroke="#2563eb"
                    fill="url(#dashboardSalesGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
