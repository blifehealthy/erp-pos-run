import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChefHat,
  ChevronRight,
  Loader2,
  Minus,
  Plus,
  ReceiptText,
  ShoppingCart,
  Utensils,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  selling_price: number;
  category_id: string | null;
  category_name: string | null;
  image_url: string | null;
  is_available: boolean;
};

type MenuResponse = {
  session_id: string | null;
  queue_number: number | null;
  table_name: string | null;
  branch_name: string;
  fb_service_mode: string;
  categories: { id: string; name: string }[];
  products: MenuItem[];
  session_status: string | null;
};

type CartItem = { product: MenuItem; qty: number; special_request: string };

type OrderStatus = {
  session_id: string;
  queue_number: number | null;
  session_status: string;
  items: { id: string; product_name: string; qty: number; status: string }[];
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "รอรับออเดอร์", color: "bg-amber-100 text-amber-800" },
  cooking: { label: "กำลังทำ", color: "bg-sky-100 text-sky-800" },
  done: { label: "พร้อมเสิร์ฟ", color: "bg-emerald-100 text-emerald-800" },
  served: { label: "เสิร์ฟแล้ว", color: "bg-slate-100 text-slate-600" }
};

function formatCurrency(value: number): string {
  return `฿${value.toFixed(0)}`;
}

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
    enabled: Boolean(token)
  });

  const menu = menuQuery.data;

  useEffect(() => {
    const stored = localStorage.getItem(`dining-session-${token}`);
    if (stored) setSessionId(stored);
    if (menu?.session_id && !sessionId) {
      setSessionId(menu.session_id);
      localStorage.setItem(`dining-session-${token}`, menu.session_id);
    }
  }, [menu?.session_id, sessionId, token]);

  const statusQuery = useQuery({
    queryKey: ["order-status", sessionId],
    queryFn: async () =>
      (await axios.get(`/api/public/menu/${token}/status?session_id=${sessionId}`)).data.data as OrderStatus,
    enabled: Boolean(sessionId) && orderPlaced,
    refetchInterval: 8_000
  });

  useEffect(() => {
    const items = statusQuery.data?.items ?? [];
    const allDone = items.length > 0 && items.every((item) => item.status === "done" || item.status === "served");
    if (!allDone) return;

    if (!audioRef.current) audioRef.current = new AudioContext();
    const ctx = audioRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.8);
  }, [statusQuery.data]);

  const orderMutation = useMutation({
    mutationFn: async () => {
      const res = await axios.post(`/api/public/menu/${token}/orders`, {
        items: cart.map((item) => ({
          product_id: item.product.id,
          qty: item.qty,
          special_request: item.special_request || null
        })),
        note: note || null
      });
      return res.data.data as { session_id: string; queue_number: number | null };
    },
    onSuccess: (data) => {
      setSessionId(data.session_id);
      localStorage.setItem(`dining-session-${token}`, data.session_id);
      setCart([]);
      setCartOpen(false);
      setOrderPlaced(true);
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["order-status"] });
    }
  });

  const billMutation = useMutation({
    mutationFn: async () => axios.post(`/api/public/menu/${token}/bill?session_id=${sessionId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["order-status"] })
  });

  function addToCart(product: MenuItem): void {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) => item.product.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...prev, { product, qty: 1, special_request: "" }];
    });
  }

  function removeFromCart(productId: string): void {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  }

  function updateQty(productId: string, delta: number): void {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item;
          const next = item.qty + delta;
          return next <= 0 ? null : { ...item, qty: next };
        })
        .filter(Boolean) as CartItem[]
    );
  }

  const visibleProducts = useMemo(
    () => (menu?.products ?? []).filter((product) => !selectedCategory || product.category_id === selectedCategory),
    [menu?.products, selectedCategory]
  );

  const cartTotal = cart.reduce((sum, item) => sum + item.product.selling_price * item.qty, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const orderStatus = statusQuery.data;
  const queueNum = orderStatus?.queue_number ?? menuQuery.data?.queue_number;
  const hasOrderItems = (orderStatus?.items ?? []).length > 0;
  const allDone = hasOrderItems && (orderStatus?.items ?? []).every((item) => item.status === "done" || item.status === "served");

  if (menuQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-700" />
      </div>
    );
  }

  if (!menu) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-center">
        <div>
          <p className="text-2xl font-bold text-slate-800">ไม่พบเมนูนี้</p>
          <p className="mt-2 text-slate-500">QR อาจหมดอายุหรือไม่ถูกต้อง</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <Utensils className="h-3.5 w-3.5" />
            <span className="truncate">{menu.branch_name}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xl font-bold text-slate-950">
                {menu.table_name ? `โต๊ะ ${menu.table_name}` : "เมนูอาหาร"}
              </p>
              <p className="text-xs text-slate-500">เลือกเมนู ใส่หมายเหตุ แล้วส่งออเดอร์เข้าครัว</p>
            </div>
            {queueNum ? (
              <div className="shrink-0 rounded-2xl bg-slate-950 px-3 py-2 text-center text-white">
                <span className="block text-[10px] font-medium uppercase text-slate-300">Queue</span>
                <span className="text-xl font-bold">{String(queueNum).padStart(3, "0")}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-lg">
        <section className="mx-4 mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <ChefHat className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-950">สั่งอาหารที่โต๊ะได้ทันที</p>
              <p className="mt-0.5 text-sm text-slate-500">เพิ่มรายการได้หลายรอบ ระบบจะรวมกับโต๊ะเดิม</p>
            </div>
          </div>
        </section>

        {orderPlaced && orderStatus ? (
          <section className={`mx-4 mt-4 rounded-2xl border p-4 shadow-sm ${allDone ? "border-emerald-200 bg-emerald-50" : "border-sky-200 bg-sky-50"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-base font-bold ${allDone ? "text-emerald-900" : "text-sky-900"}`}>
                  {allDone ? "อาหารพร้อมเสิร์ฟแล้ว" : "สถานะออเดอร์"}
                </p>
                <p className={`mt-0.5 text-xs ${allDone ? "text-emerald-700" : "text-sky-700"}`}>
                  อัปเดตอัตโนมัติทุก 8 วินาที
                </p>
              </div>
              {orderStatus.session_status === "open" ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  disabled={billMutation.isPending}
                  onClick={() => !billMutation.isPending && billMutation.mutate()}
                >
                  {billMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ReceiptText className="h-3.5 w-3.5" />}
                  เรียกบิล
                </button>
              ) : null}
            </div>
            <div className="mt-4 space-y-2">
              {orderStatus.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/80 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{item.product_name} x{item.qty}</span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_LABEL[item.status]?.color ?? "bg-slate-100 text-slate-600"}`}>
                    {STATUS_LABEL[item.status]?.label ?? item.status}
                  </span>
                </div>
              ))}
            </div>
            {allDone ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-emerald-800">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-semibold">พนักงานจะนำอาหารไปเสิร์ฟที่โต๊ะ</span>
              </div>
            ) : null}
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-700"
              onClick={() => setOrderPlaced(false)}
            >
              สั่งเพิ่ม <ChevronRight className="h-4 w-4" />
            </button>
          </section>
        ) : null}

        {!orderPlaced ? (
          <>
            <div className="sticky top-[94px] z-10 mt-4 border-y border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur">
              <div className="flex gap-2 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setSelectedCategory("")}
                  className={`h-10 flex-shrink-0 rounded-full px-4 text-sm font-semibold transition-all ${!selectedCategory ? "bg-slate-950 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600"}`}
                >
                  ทั้งหมด
                </button>
                {menu.categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategory(category.id)}
                    className={`h-10 flex-shrink-0 rounded-full px-4 text-sm font-semibold transition-all ${selectedCategory === category.id ? "bg-slate-950 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600"}`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3 px-4 py-4">
              {visibleProducts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-slate-500">
                  <Utensils className="mx-auto mb-2 h-7 w-7 text-slate-400" />
                  <p className="font-medium">ยังไม่มีเมนูในหมวดนี้</p>
                </div>
              ) : null}
              {visibleProducts.map((product) => {
                const cartItem = cart.find((item) => item.product.id === product.id);
                return (
                  <div key={product.id} className="flex items-stretch gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} className="h-20 w-20 flex-shrink-0 rounded-xl object-cover" />
                    ) : (
                      <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                        <Utensils className="h-7 w-7" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-semibold leading-snug text-slate-950">{product.name}</p>
                      {product.description ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{product.description}</p> : null}
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <p className="text-base font-bold text-emerald-700">{formatCurrency(Number(product.selling_price))}</p>
                        {cartItem ? (
                          <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 p-1">
                            <button type="button" aria-label={`ลดจำนวน ${product.name}`} onClick={() => updateQty(product.id, -1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm">
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-7 text-center font-bold text-slate-950">{cartItem.qty}</span>
                            <button type="button" aria-label={`เพิ่มจำนวน ${product.name}`} onClick={() => updateQty(product.id, 1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-white shadow-sm">
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={!product.is_available}
                            onClick={() => addToCart(product)}
                            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-slate-950 px-3 text-sm font-semibold text-white shadow-sm disabled:bg-slate-200 disabled:text-slate-500"
                          >
                            {product.is_available ? "เพิ่ม" : "หมด"}
                            {product.is_available ? <Plus className="h-4 w-4" /> : null}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </main>

      {cartCount > 0 && !cartOpen ? (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="fixed bottom-4 left-4 right-4 z-20 mx-auto flex max-w-lg items-center justify-between rounded-2xl bg-slate-950 px-4 py-4 text-white shadow-xl"
        >
          <span className="inline-flex items-center gap-2 font-semibold">
            <ShoppingCart className="h-5 w-5" />
            {cartCount} รายการ
          </span>
          <span className="inline-flex items-center gap-2 font-bold">
            {formatCurrency(cartTotal)}
            <ChevronRight className="h-5 w-5" />
          </span>
        </button>
      ) : null}

      {cartOpen ? (
        <div className="fixed inset-0 z-30 flex flex-col bg-white">
          <div className="mx-auto flex w-full max-w-lg items-center justify-between border-b px-4 py-4">
            <div>
              <h2 className="text-lg font-bold text-slate-950">ตรวจสอบออเดอร์</h2>
              <p className="text-sm text-slate-500">{cartCount} รายการสำหรับ{menu.table_name ? `โต๊ะ ${menu.table_name}` : "ออเดอร์นี้"}</p>
            </div>
            <button type="button" aria-label="ปิดตะกร้า" onClick={() => setCartOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mx-auto w-full max-w-lg flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {cart.map((item) => (
              <div key={item.product.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-950">{item.product.name}</p>
                  <button type="button" aria-label={`ลบ ${item.product.name}`} onClick={() => removeFromCart(item.product.id)} className="text-slate-400">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 p-1">
                    <button type="button" onClick={() => updateQty(item.product.id, -1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm">
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-8 text-center font-bold">{item.qty}</span>
                    <button type="button" onClick={() => updateQty(item.product.id, 1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-white shadow-sm">
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <span className="font-bold text-emerald-700">{formatCurrency(item.product.selling_price * item.qty)}</span>
                </div>
                <input
                  className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  placeholder="หมายเหตุเพิ่มเติม เช่น ไม่ใส่น้ำตาล"
                  value={item.special_request}
                  onChange={(event) => setCart((prev) => prev.map((cartItem) => cartItem.product.id === item.product.id ? { ...cartItem, special_request: event.target.value } : cartItem))}
                />
              </div>
            ))}
            <textarea
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              placeholder="หมายเหตุรวมสำหรับออเดอร์นี้"
              value={note}
              rows={2}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <div className="border-t bg-white px-4 py-4">
            <div className="mx-auto max-w-lg">
              <div className="mb-3 flex justify-between text-lg font-bold">
                <span>รวม</span>
                <span className="text-emerald-700">{formatCurrency(cartTotal)}</span>
              </div>
              <button
                type="button"
                disabled={orderMutation.isPending}
                onClick={() => orderMutation.mutate()}
                className="h-14 w-full rounded-2xl bg-slate-950 text-lg font-bold text-white shadow-sm disabled:opacity-60"
              >
                {orderMutation.isPending ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : "สั่งอาหาร"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
