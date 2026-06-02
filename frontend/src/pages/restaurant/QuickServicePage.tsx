import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Loader2, ShoppingCart, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

type MenuItem = {
  id: string; name: string; description: string | null;
  selling_price: number; category_id: string | null; category_name: string | null;
  image_url: string | null; is_available: boolean;
};
type QSMenu = {
  branch_name: string; fb_service_mode: string; queue_prefix: string;
  categories: { id: string; name: string }[];
  products: MenuItem[];
};
type CartItem = { product: MenuItem; qty: number; special_request: string };
type OrderResult = { session_id: string; queue_number: number | null; queue_display: string | null };
type OrderStatus = { session_id: string; queue_number: number | null; session_status: string; items: { id: string; product_name: string; qty: number; status: string }[] };

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "รอทำ ⏳", color: "bg-amber-100 text-amber-700" },
  cooking: { label: "กำลังทำ 🔥", color: "bg-blue-100 text-blue-700" },
  done: { label: "พร้อมรับ ✅", color: "bg-emerald-100 text-emerald-700" },
  served: { label: "รับแล้ว", color: "bg-slate-100 text-slate-600" },
};

export default function QuickServicePage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const audioRef = useRef<AudioContext | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [orderResult, setOrderResult] = useState<OrderResult | null>(() => {
    const raw = localStorage.getItem(`qs-order-${token}`);
    return raw ? JSON.parse(raw) as OrderResult : null;
  });
  const [note, setNote] = useState("");
  const [customerName, setCustomerName] = useState("");

  const menuQuery = useQuery({
    queryKey: ["qs-menu", token],
    queryFn: async () => (await axios.get(`/api/public/qs/${token}`)).data.data as QSMenu,
    enabled: Boolean(token),
  });

  const statusQuery = useQuery({
    queryKey: ["qs-status", orderResult?.session_id],
    queryFn: async () =>
      (await axios.get(`/api/public/qs/${token}/status?session_id=${orderResult!.session_id}`)).data.data as OrderStatus,
    enabled: Boolean(orderResult?.session_id),
    refetchInterval: 7_000,
  });

  const orderStatus = statusQuery.data;
  const menu = menuQuery.data;

  // เล่นเสียงเมื่อพร้อม
  useEffect(() => {
    const items = orderStatus?.items ?? [];
    if (items.length > 0 && items.every((i) => i.status === "done" || i.status === "served")) {
      if (!audioRef.current) audioRef.current = new AudioContext();
      const ctx = audioRef.current;
      [0, 0.25, 0.5].forEach((t) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = [660, 880, 1100][Math.round(t * 4)];
        gain.gain.setValueAtTime(0.35, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.35);
        osc.start(ctx.currentTime + t); osc.stop(ctx.currentTime + t + 0.35);
      });
    }
  }, [orderStatus]);

  const orderMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams();
      if (customerName.trim()) params.set("customer_name", customerName.trim());
      const res = await axios.post(`/api/public/qs/${token}/orders?${params}`, {
        items: cart.map((c) => ({ product_id: c.product.id, qty: c.qty, special_request: c.special_request || null })),
        note: note || null,
      });
      return res.data.data as OrderResult;
    },
    onSuccess: (result) => {
      setOrderResult(result);
      localStorage.setItem(`qs-order-${token}`, JSON.stringify(result));
      setCart([]); setCartOpen(false); setNote(""); setCustomerName("");
      queryClient.invalidateQueries({ queryKey: ["qs-status"] });
    },
  });

  const visibleProducts = useMemo(() =>
    (menu?.products ?? []).filter((p) => !selectedCategory || p.category_id === selectedCategory),
    [menu, selectedCategory]
  );

  function addToCart(product: MenuItem): void {
    setCart((prev) => {
      const ex = prev.find((c) => c.product.id === product.id);
      return ex ? prev.map((c) => c.product.id === product.id ? { ...c, qty: c.qty + 1 } : c)
        : [...prev, { product, qty: 1, special_request: "" }];
    });
  }

  function updateQty(id: string, delta: number): void {
    setCart((prev) => prev.map((c) => c.product.id === id ? { ...c, qty: c.qty + delta } : c).filter((c) => c.qty > 0));
  }

  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const cartTotal = cart.reduce((s, c) => s + c.product.selling_price * c.qty, 0);
  const allDone = (orderStatus?.items ?? []).length > 0 && (orderStatus?.items ?? []).every((i) => i.status === "done" || i.status === "served");

  if (menuQuery.isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-orange-50"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div>;
  }
  if (!menu) {
    return <div className="flex min-h-screen items-center justify-center p-4 text-center"><p className="text-slate-500">ไม่พบ QR นี้</p></div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white pb-32">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-orange-100 bg-white/90 backdrop-blur px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-orange-500">{menu.branch_name}</p>
        <div className="flex items-center justify-between">
          <p className="text-lg font-bold text-slate-900">สั่งอาหาร</p>
          {orderResult?.queue_display && (
            <div className="rounded-full bg-orange-500 px-4 py-1 text-white text-center">
              <span className="text-xs block">คิวของคุณ</span>
              <span className="text-2xl font-black">{orderResult.queue_display}</span>
            </div>
          )}
        </div>
      </div>

      {/* Order Status Banner */}
      {orderResult && orderStatus && (
        <div className={`mx-4 mt-4 rounded-2xl border p-4 ${allDone ? "border-emerald-300 bg-emerald-50" : "border-blue-200 bg-blue-50"}`}>
          <div className="flex items-center justify-between">
            <p className={`font-semibold ${allDone ? "text-emerald-800" : "text-blue-800"}`}>
              {allDone ? "🎉 พร้อมรับแล้ว!" : "⏳ สถานะออเดอร์"}
            </p>
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${allDone ? "bg-emerald-500 text-white animate-pulse" : "bg-blue-200 text-blue-700"}`}>
              คิว {orderResult.queue_display ?? "-"}
            </span>
          </div>

          {allDone && (
            <div className="mt-2 flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">มารับที่เคาน์เตอร์ได้เลยครับ!</span>
            </div>
          )}

          <div className="mt-3 space-y-1.5">
            {orderStatus.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{item.product_name} ×{item.qty}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_LABEL[item.status]?.color ?? "bg-slate-100"}`}>
                  {STATUS_LABEL[item.status]?.label ?? item.status}
                </span>
              </div>
            ))}
          </div>

          <button type="button" className="mt-3 text-xs text-blue-600 underline" onClick={() => {
            localStorage.removeItem(`qs-order-${token}`);
            setOrderResult(null);
          }}>
            สั่งรอบใหม่
          </button>
        </div>
      )}

      {/* Show menu when no pending order */}
      {!orderResult && (
        <>
          {/* Categories */}
          <div className="flex gap-2 overflow-x-auto px-4 py-4">
            <button type="button" onClick={() => setSelectedCategory("")}
              className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium ${!selectedCategory ? "bg-orange-500 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>
              ทั้งหมด
            </button>
            {menu.categories.map((cat) => (
              <button key={cat.id} type="button" onClick={() => setSelectedCategory(cat.id)}
                className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium ${selectedCategory === cat.id ? "bg-orange-500 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>
                {cat.name}
              </button>
            ))}
          </div>

          {/* Products */}
          <div className="space-y-3 px-4">
            {visibleProducts.length === 0 && (
              <p className="py-8 text-center text-slate-400">ยังไม่มีเมนู</p>
            )}
            {visibleProducts.map((product) => {
              const ci = cart.find((c) => c.product.id === product.id);
              return (
                <div key={product.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  {product.image_url
                    ? <img src={product.image_url} alt={product.name} className="h-16 w-16 flex-shrink-0 rounded-xl object-cover" />
                    : <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-orange-100 text-2xl">☕</div>
                  }
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{product.name}</p>
                    {product.description && <p className="text-xs text-slate-400 line-clamp-1">{product.description}</p>}
                    <p className="mt-1 font-bold text-orange-600">฿{Number(product.selling_price).toFixed(0)}</p>
                  </div>
                  {ci ? (
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => updateQty(product.id, -1)} className="h-8 w-8 rounded-full border text-slate-600">−</button>
                      <span className="w-6 text-center font-bold">{ci.qty}</span>
                      <button type="button" onClick={() => updateQty(product.id, 1)} className="h-8 w-8 rounded-full bg-orange-500 text-white">+</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => addToCart(product)}
                      className="h-9 w-9 rounded-full bg-orange-500 text-white flex items-center justify-center">
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Floating Cart */}
      {cartCount > 0 && !cartOpen && (
        <button type="button" onClick={() => setCartOpen(true)}
          className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-orange-500 px-6 py-4 text-white shadow-xl">
          <ShoppingCart className="h-5 w-5" />
          <span className="font-semibold">{cartCount} รายการ</span>
          <span className="ml-2 font-bold">฿{cartTotal.toFixed(0)}</span>
        </button>
      )}

      {/* Cart Sheet */}
      {cartOpen && (
        <div className="fixed inset-0 z-30 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b px-4 py-4">
            <h2 className="text-lg font-bold">ตะกร้า ({cartCount})</h2>
            <button type="button" onClick={() => setCartOpen(false)}><X className="h-6 w-6" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {/* Customer name (optional) */}
            <div>
              <p className="text-xs text-slate-500 mb-1">ชื่อผู้สั่ง (ไม่บังคับ)</p>
              <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="เช่น คุณแจ้" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            {cart.map((item) => (
              <div key={item.product.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{item.product.name}</p>
                  <button type="button" onClick={() => setCart((p) => p.filter((c) => c.product.id !== item.product.id))}><X className="h-4 w-4 text-slate-400" /></button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => updateQty(item.product.id, -1)} className="h-8 w-8 rounded-full border text-slate-600">−</button>
                    <span className="w-8 text-center font-bold">{item.qty}</span>
                    <button type="button" onClick={() => updateQty(item.product.id, 1)} className="h-8 w-8 rounded-full bg-orange-500 text-white">+</button>
                  </div>
                  <span className="font-bold text-orange-600">฿{(item.product.selling_price * item.qty).toFixed(0)}</span>
                </div>
                <input className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs" placeholder="หมายเหตุ เช่น ไม่หวาน" value={item.special_request}
                  onChange={(e) => setCart((p) => p.map((c) => c.product.id === item.product.id ? { ...c, special_request: e.target.value } : c))} />
              </div>
            ))}
            <textarea className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="หมายเหตุรวม" value={note} rows={2} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="border-t px-4 py-4">
            <div className="mb-3 flex justify-between text-lg font-bold">
              <span>รวม</span><span className="text-orange-600">฿{cartTotal.toFixed(0)}</span>
            </div>
            <button type="button" disabled={orderMutation.isPending} onClick={() => orderMutation.mutate()}
              className="h-14 w-full rounded-2xl bg-orange-500 text-lg font-bold text-white disabled:opacity-60">
              {orderMutation.isPending ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : "สั่งอาหาร"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
