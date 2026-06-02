import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Clock, Loader2, ShoppingCart, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

type MenuItem = {
  id: string; name: string; description: string | null;
  selling_price: number; category_id: string | null; category_name: string | null;
  image_url: string | null; is_available: boolean;
};

type MenuResponse = {
  session_id: string | null; queue_number: number | null;
  table_name: string | null; branch_name: string;
  fb_service_mode: string; categories: { id: string; name: string }[];
  products: MenuItem[]; session_status: string | null;
};

type CartItem = { product: MenuItem; qty: number; special_request: string };
type OrderStatus = { session_id: string; queue_number: number | null; session_status: string; items: { id: string; product_name: string; qty: number; status: string }[] };

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "รอทำ", color: "bg-amber-100 text-amber-700" },
  cooking: { label: "กำลังทำ", color: "bg-blue-100 text-blue-700" },
  done: { label: "พร้อมเสิร์ฟ ✅", color: "bg-emerald-100 text-emerald-700" },
  served: { label: "เสิร์ฟแล้ว", color: "bg-slate-100 text-slate-600" },
};

export default function CustomerMenuPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [note, setNote] = useState("");
  const audioRef = useRef<AudioContext | null>(null);

  const menuQuery = useQuery({
    queryKey: ["public-menu", token],
    queryFn: async () => (await axios.get(`/api/public/menu/${token}`)).data.data as MenuResponse,
    enabled: Boolean(token),
  });

  const menu = menuQuery.data;

  // restore session from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`dining-session-${token}`);
    if (stored) setSessionId(stored);
    if (menu?.session_id && !sessionId) {
      setSessionId(menu.session_id);
      localStorage.setItem(`dining-session-${token}`, menu.session_id);
    }
  }, [menu?.session_id, token]);

  const statusQuery = useQuery({
    queryKey: ["order-status", sessionId],
    queryFn: async () =>
      (await axios.get(`/api/public/menu/${token}/status?session_id=${sessionId}`)).data.data as OrderStatus,
    enabled: Boolean(sessionId) && orderPlaced,
    refetchInterval: 8_000,
  });

  // เล่นเสียงเมื่อออเดอร์ done
  useEffect(() => {
    const items = statusQuery.data?.items ?? [];
    const allDone = items.length > 0 && items.every((i) => i.status === "done" || i.status === "served");
    if (allDone) {
      if (!audioRef.current) audioRef.current = new AudioContext();
      const ctx = audioRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.8);
    }
  }, [statusQuery.data]);

  const orderMutation = useMutation({
    mutationFn: async () => {
      const res = await axios.post(`/api/public/menu/${token}/orders`, {
        items: cart.map((c) => ({ product_id: c.product.id, qty: c.qty, special_request: c.special_request || null })),
        note: note || null,
      });
      return res.data.data as { session_id: string; queue_number: number | null };
    },
    onSuccess: (data) => {
      setSessionId(data.session_id);
      localStorage.setItem(`dining-session-${token}`, data.session_id);
      setCart([]); setCartOpen(false); setOrderPlaced(true); setNote("");
      queryClient.invalidateQueries({ queryKey: ["order-status"] });
    },
  });

  const billMutation = useMutation({
    mutationFn: async () => axios.post(`/api/public/menu/${token}/bill?session_id=${sessionId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["order-status"] }),
  });

  function addToCart(product: MenuItem): void {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id);
      if (existing) return prev.map((c) => c.product.id === product.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { product, qty: 1, special_request: "" }];
    });
  }

  function removeFromCart(productId: string): void {
    setCart((prev) => prev.filter((c) => c.product.id !== productId));
  }

  function updateQty(productId: string, delta: number): void {
    setCart((prev) => prev.map((c) => {
      if (c.product.id !== productId) return c;
      const next = c.qty + delta;
      return next <= 0 ? null : { ...c, qty: next };
    }).filter(Boolean) as CartItem[]);
  }

  const visibleProducts = useMemo(() =>
    (menu?.products ?? []).filter((p) => !selectedCategory || p.category_id === selectedCategory),
    [menu?.products, selectedCategory]
  );

  const cartTotal = cart.reduce((sum, c) => sum + c.product.selling_price * c.qty, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.qty, 0);
  const orderStatus = statusQuery.data;
  const queueNum = orderStatus?.queue_number ?? menuQuery.data?.queue_number;

  if (menuQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-orange-50">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!menu) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-orange-50 p-4 text-center">
        <div>
          <p className="text-2xl font-bold text-slate-700">ไม่พบเมนูนี้</p>
          <p className="mt-2 text-slate-500">QR อาจหมดอายุหรือไม่ถูกต้อง</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white pb-32">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-orange-100 bg-white/90 backdrop-blur px-4 py-3">
        <p className="text-xs text-orange-500 font-semibold uppercase tracking-wider">{menu.branch_name}</p>
        <div className="flex items-center justify-between">
          <p className="text-lg font-bold text-slate-900">
            {menu.table_name ? `โต๊ะ ${menu.table_name}` : "เมนู"}
          </p>
          {queueNum && (
            <div className="rounded-full bg-orange-500 px-4 py-1 text-white">
              <span className="text-xs">คิว</span>
              <span className="ml-1 text-xl font-bold">{String(queueNum).padStart(3, "0")}</span>
            </div>
          )}
        </div>
      </div>

      {/* Order Status Banner */}
      {orderPlaced && orderStatus && (
        <div className="mx-4 mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-blue-800">สถานะออเดอร์</p>
            {orderStatus.session_status === "open" && (
              <button
                type="button"
                className="rounded-full bg-blue-600 px-3 py-1 text-xs text-white"
                onClick={() => !billMutation.isPending && billMutation.mutate()}
              >
                เรียกบิล
              </button>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {orderStatus.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{item.product_name} ×{item.qty}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_LABEL[item.status]?.color ?? "bg-slate-100"}`}>
                  {STATUS_LABEL[item.status]?.label ?? item.status}
                </span>
              </div>
            ))}
          </div>
          {orderStatus.items.every((i) => i.status === "done") && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-100 px-3 py-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold">ออเดอร์พร้อมแล้ว! มารับได้เลยครับ</span>
            </div>
          )}
          <button
            type="button"
            className="mt-3 text-xs text-blue-600 underline"
            onClick={() => setOrderPlaced(false)}
          >
            สั่งเพิ่ม
          </button>
        </div>
      )}

      {/* Categories */}
      {!orderPlaced && (
        <>
          <div className="flex gap-2 overflow-x-auto px-4 py-4 no-scrollbar">
            <button
              type="button"
              onClick={() => setSelectedCategory("")}
              className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all ${!selectedCategory ? "bg-orange-500 text-white shadow-md" : "border border-slate-200 bg-white text-slate-600"}`}
            >
              ทั้งหมด
            </button>
            {menu.categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all ${selectedCategory === cat.id ? "bg-orange-500 text-white shadow-md" : "border border-slate-200 bg-white text-slate-600"}`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Product Grid */}
          <div className="space-y-3 px-4">
            {visibleProducts.map((product) => {
              const cartItem = cart.find((c) => c.product.id === product.id);
              return (
                <div key={product.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="h-16 w-16 flex-shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-orange-100 text-2xl">🍽️</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{product.name}</p>
                    {product.description && <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">{product.description}</p>}
                    <p className="mt-1 font-bold text-orange-600">฿{Number(product.selling_price).toFixed(0)}</p>
                  </div>
                  {cartItem ? (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => updateQty(product.id, -1)} className="h-8 w-8 rounded-full border border-slate-300 text-slate-600">−</button>
                      <span className="w-6 text-center font-semibold">{cartItem.qty}</span>
                      <button type="button" onClick={() => updateQty(product.id, 1)} className="h-8 w-8 rounded-full bg-orange-500 text-white">+</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!product.is_available}
                      onClick={() => addToCart(product)}
                      className="h-9 w-9 flex-shrink-0 rounded-full bg-orange-500 text-white disabled:opacity-40 flex items-center justify-center"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Floating Cart Button */}
      {cartCount > 0 && !cartOpen && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-orange-500 px-6 py-4 text-white shadow-xl"
        >
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
            {cart.map((item) => (
              <div key={item.product.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-900">{item.product.name}</p>
                  <button type="button" onClick={() => removeFromCart(item.product.id)}><X className="h-4 w-4 text-slate-400" /></button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => updateQty(item.product.id, -1)} className="h-8 w-8 rounded-full border text-slate-600">−</button>
                    <span className="w-8 text-center font-bold">{item.qty}</span>
                    <button type="button" onClick={() => updateQty(item.product.id, 1)} className="h-8 w-8 rounded-full bg-orange-500 text-white">+</button>
                  </div>
                  <span className="font-bold text-orange-600">฿{(item.product.selling_price * item.qty).toFixed(0)}</span>
                </div>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                  placeholder="หมายเหตุเพิ่มเติม เช่น ไม่ใส่น้ำตาล"
                  value={item.special_request}
                  onChange={(e) => setCart((prev) => prev.map((c) => c.product.id === item.product.id ? { ...c, special_request: e.target.value } : c))}
                />
              </div>
            ))}
            <textarea
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="หมายเหตุรวมสำหรับออเดอร์นี้"
              value={note}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="border-t px-4 py-4">
            <div className="mb-3 flex justify-between text-lg font-bold">
              <span>รวม</span><span className="text-orange-600">฿{cartTotal.toFixed(0)}</span>
            </div>
            <button
              type="button"
              disabled={orderMutation.isPending}
              onClick={() => orderMutation.mutate()}
              className="h-14 w-full rounded-2xl bg-orange-500 text-lg font-bold text-white disabled:opacity-60"
            >
              {orderMutation.isPending ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : "สั่งอาหาร"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
