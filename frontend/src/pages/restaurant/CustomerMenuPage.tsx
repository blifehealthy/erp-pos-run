import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChefHat,
  ChevronRight,
  Loader2,
  ReceiptText,
  Utensils
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import {
  CartBar,
  CartSheet,
  CategoryTabs,
  MenuList,
  StatusList,
  formatCurrency,
  type MobileCartItem,
  type MobileMenuItem
} from "@/pages/restaurant/components/MobileOrdering";

type MenuItem = MobileMenuItem;

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

type CartItem = MobileCartItem<MenuItem>;

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

  function updateItemNote(productId: string, value: string): void {
    setCart((prev) => prev.map((item) => item.product.id === productId ? { ...item, special_request: value } : item));
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
            <StatusList items={orderStatus.items} labels={STATUS_LABEL} />
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
            <CategoryTabs categories={menu.categories} selectedCategory={selectedCategory} onSelect={setSelectedCategory} />
            <MenuList products={visibleProducts} cart={cart} onAdd={addToCart} onQtyChange={updateQty} />
          </>
        ) : null}
      </main>

      {!cartOpen ? <CartBar count={cartCount} total={cartTotal} onOpen={() => setCartOpen(true)} /> : null}
      <CartSheet
        open={cartOpen}
        title="ตรวจสอบออเดอร์"
        subtitle={`${cartCount} รายการสำหรับ${menu.table_name ? `โต๊ะ ${menu.table_name}` : "ออเดอร์นี้"}`}
        cart={cart}
        note={note}
        notePlaceholder="หมายเหตุรวมสำหรับออเดอร์นี้"
        submitLabel="สั่งอาหาร"
        isSubmitting={orderMutation.isPending}
        onClose={() => setCartOpen(false)}
        onRemove={removeFromCart}
        onQtyChange={updateQty}
        onItemNoteChange={updateItemNote}
        onNoteChange={setNote}
        onSubmit={() => orderMutation.mutate()}
      />
    </div>
  );
}
