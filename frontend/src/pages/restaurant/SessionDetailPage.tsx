import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChefHat, Clock, Plus, ReceiptText, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { authApi } from "@/lib/api";
import { formatThaiCurrency } from "@/lib/cartUtils";

type SessionItem = {
  id: string; product_name: string; qty: number;
  unit_price: number; special_request: string | null; status: string;
};
type SessionOrder = { id: string; status: string; source: string; items: SessionItem[] };
type SessionData = {
  id: string; status: string; queue_number: number | null; table_name: string | null;
  customer_name: string | null; customer_phone: string | null;
  opened_at: string; orders: SessionOrder[];
};

type MenuProduct = { id: string; name: string; selling_price: number; category_name: string | null };

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  cooking: "bg-blue-100 text-blue-700",
  done:    "bg-emerald-100 text-emerald-700",
  served:  "bg-slate-100 text-slate-600",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "รอทำ", cooking: "กำลังทำ", done: "เสร็จแล้ว", served: "เสิร์ฟแล้ว",
};

export default function SessionDetailPage(): JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOrderOpen, setAddOrderOpen] = useState(false);
  const [orderCart, setOrderCart] = useState<{ product: MenuProduct; qty: number; special_request: string }[]>([]);
  const [menuSearch, setMenuSearch] = useState("");

  const sessionQuery = useQuery({
    queryKey: ["session-detail", sessionId],
    queryFn: async () =>
      (await authApi.get(`/restaurant/sessions/${sessionId}/detail`)).data.data as SessionData,
    enabled: Boolean(sessionId),
    refetchInterval: 10_000,
  });

  const menuQuery = useQuery({
    queryKey: ["menu-products"],
    queryFn: async () =>
      (await authApi.get("/products?product_type=menu_item&is_active=true&limit=200")).data.data as MenuProduct[],
    enabled: addOrderOpen,
  });

  const addOrderMutation = useMutation({
    mutationFn: async () => {
      await authApi.post(`/restaurant/sessions/${sessionId}/orders`, {
        items: orderCart.map((c) => ({
          product_id: c.product.id,
          qty: c.qty,
          special_request: c.special_request || null,
        })),
        note: null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session-detail"] });
      toast({ title: "เพิ่มออเดอร์แล้ว" });
      setAddOrderOpen(false);
      setOrderCart([]);
    },
    onError: () => toast({ title: "เพิ่มออเดอร์ไม่สำเร็จ" }),
  });

  const session = sessionQuery.data;
  if (!session && !sessionQuery.isLoading) {
    return <div className="p-8 text-center text-slate-400">ไม่พบ session</div>;
  }

  const allItems = session?.orders.flatMap((o) =>
    o.status !== "cancelled" ? o.items : []
  ) ?? [];
  const totalAmount = allItems.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const products = (menuQuery.data ?? []).filter((p) =>
    !menuSearch || p.name.toLowerCase().includes(menuSearch.toLowerCase())
  );

  function addToCart(product: MenuProduct): void {
    setOrderCart((prev) => {
      const ex = prev.find((c) => c.product.id === product.id);
      return ex
        ? prev.map((c) => c.product.id === product.id ? { ...c, qty: c.qty + 1 } : c)
        : [...prev, { product, qty: 1, special_request: "" }];
    });
  }

  return (
    <div>
      <PageHeader
        title={
          session
            ? [
                session.table_name ? `โต๊ะ ${session.table_name}` : null,
                session.queue_number ? `คิว ${String(session.queue_number).padStart(3, "0")}` : null,
              ].filter(Boolean).join(" — ") || "Session"
            : "..."
        }
        subtitle={session?.customer_name ?? undefined}
        actions={
          session?.status !== "closed" ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAddOrderOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> สั่งเพิ่ม (Staff)
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => navigate(`/restaurant/session/${sessionId}/checkout`)}
              >
                <ReceiptText className="mr-1 h-4 w-4" /> รวมบิล
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="p-6 space-y-6">
        {/* Session meta */}
        {session && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "สถานะ", value: session.status === "open" ? "กำลังสั่ง" : session.status === "bill_requested" ? "เรียกบิลแล้ว" : "ปิดแล้ว" },
              { label: "เปิดเมื่อ", value: new Date(session.opened_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) },
              { label: "รายการ", value: `${allItems.length} รายการ` },
              { label: "ยอดรวม", value: formatThaiCurrency(totalAmount) },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-400">{s.label}</p>
                <p className="mt-1 font-bold text-slate-900">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Orders */}
        {session?.orders.map((order) => (
          <div key={order.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 flex items-center gap-3">
              <ChefHat className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-medium text-slate-600">
                {order.source === "qr_self" ? "ลูกค้าสั่งเอง (QR)" : "Staff สั่ง"}
              </span>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${order.status === "cancelled" ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500"}`}>
                {order.status}
              </span>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {order.items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{item.product_name}</p>
                      {item.special_request && (
                        <p className="text-xs text-amber-600">⚠️ {item.special_request}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center text-slate-600">×{item.qty}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">
                      {formatThaiCurrency(item.unit_price * item.qty)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[item.status] ?? "bg-slate-100 text-slate-500"}`}>
                        {STATUS_LABEL[item.status] ?? item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {allItems.length === 0 && !sessionQuery.isLoading && (
          <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400">
            ยังไม่มีรายการอาหาร
          </div>
        )}

        {/* Total */}
        {allItems.length > 0 && (
          <div className="rounded-2xl bg-orange-50 border border-orange-200 px-5 py-4 flex justify-between items-center">
            <span className="font-semibold text-slate-800">ยอดรวมทั้งหมด</span>
            <span className="text-2xl font-black text-orange-600">{formatThaiCurrency(totalAmount)}</span>
          </div>
        )}
      </div>

      {/* Add Order Sheet */}
      {addOrderOpen && (
        <div className="fixed inset-0 z-40 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="text-lg font-bold">สั่งเพิ่ม (Staff)</h2>
            <Button variant="ghost" onClick={() => { setAddOrderOpen(false); setOrderCart([]); }}>
              ปิด
            </Button>
          </div>
          <div className="flex flex-1 overflow-hidden">
            {/* Product list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 border-r">
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm mb-3"
                placeholder="ค้นหาเมนู..."
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                autoFocus
              />
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-orange-300 hover:bg-orange-50"
                >
                  <div>
                    <p className="font-medium text-slate-900">{p.name}</p>
                    {p.category_name && <p className="text-xs text-slate-400">{p.category_name}</p>}
                  </div>
                  <span className="font-bold text-orange-600">{formatThaiCurrency(p.selling_price)}</span>
                </button>
              ))}
            </div>
            {/* Cart */}
            <div className="flex w-72 flex-col border-l">
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {orderCart.length === 0 && (
                  <p className="text-center text-slate-400 py-8 text-sm">เลือกเมนูด้านซ้าย</p>
                )}
                {orderCart.map((c) => (
                  <div key={c.product.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-slate-900 text-sm">{c.product.name}</p>
                      <button type="button" onClick={() => setOrderCart((p) => p.filter((x) => x.product.id !== c.product.id))}>
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" onClick={() => setOrderCart((p) => p.map((x) => x.product.id === c.product.id ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}
                        className="h-7 w-7 rounded-full border text-slate-600">−</button>
                      <span className="w-6 text-center font-bold text-sm">{c.qty}</span>
                      <button type="button" onClick={() => setOrderCart((p) => p.map((x) => x.product.id === c.product.id ? { ...x, qty: x.qty + 1 } : x))}
                        className="h-7 w-7 rounded-full bg-orange-500 text-white">+</button>
                      <span className="ml-auto text-sm font-semibold text-orange-600">{formatThaiCurrency(c.product.selling_price * c.qty)}</span>
                    </div>
                    <input className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      placeholder="หมายเหตุ" value={c.special_request}
                      onChange={(e) => setOrderCart((p) => p.map((x) => x.product.id === c.product.id ? { ...x, special_request: e.target.value } : x))} />
                  </div>
                ))}
              </div>
              <div className="border-t p-4">
                <div className="mb-3 flex justify-between font-bold">
                  <span>รวม</span>
                  <span className="text-orange-600">{formatThaiCurrency(orderCart.reduce((s, c) => s + c.product.selling_price * c.qty, 0))}</span>
                </div>
                <Button
                  className="w-full bg-orange-500 hover:bg-orange-600"
                  disabled={orderCart.length === 0 || addOrderMutation.isPending}
                  onClick={() => addOrderMutation.mutate()}
                >
                  {addOrderMutation.isPending ? "กำลังส่ง..." : "ส่งออเดอร์ไปครัว"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
