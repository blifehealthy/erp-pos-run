import { ChevronRight, Minus, Plus, ShoppingCart, Utensils, X } from "lucide-react";
import type { ReactNode } from "react";

export type MobileMenuItem = {
  id: string;
  name: string;
  description: string | null;
  selling_price: number;
  category_id: string | null;
  category_name: string | null;
  image_url: string | null;
  is_available: boolean;
};

export type MobileCategory = { id: string; name: string };

export type MobileCartItem<TProduct extends MobileMenuItem = MobileMenuItem> = {
  product: TProduct;
  qty: number;
  special_request: string;
};

export function formatCurrency(value: number): string {
  return `฿${value.toFixed(0)}`;
}

type CategoryTabsProps = {
  categories: MobileCategory[];
  selectedCategory: string;
  onSelect: (categoryId: string) => void;
  stickyTopClassName?: string;
};

export function CategoryTabs({ categories, selectedCategory, onSelect, stickyTopClassName = "top-[94px]" }: CategoryTabsProps): JSX.Element {
  return (
    <div className={`sticky ${stickyTopClassName} z-10 mt-4 border-y border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur`}>
      <div className="flex gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => onSelect("")}
          className={`h-10 flex-shrink-0 rounded-full px-4 text-sm font-semibold transition-all ${!selectedCategory ? "bg-slate-950 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600"}`}
        >
          ทั้งหมด
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onSelect(category.id)}
            className={`h-10 flex-shrink-0 rounded-full px-4 text-sm font-semibold transition-all ${selectedCategory === category.id ? "bg-slate-950 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600"}`}
          >
            {category.name}
          </button>
        ))}
      </div>
    </div>
  );
}

type QuantityControlProps = {
  label: string;
  qty: number;
  onDecrease: () => void;
  onIncrease: () => void;
};

export function QuantityControl({ label, qty, onDecrease, onIncrease }: QuantityControlProps): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 p-1">
      <button type="button" aria-label={`ลดจำนวน ${label}`} onClick={onDecrease} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm">
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-7 text-center font-bold text-slate-950">{qty}</span>
      <button type="button" aria-label={`เพิ่มจำนวน ${label}`} onClick={onIncrease} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-white shadow-sm">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

type MenuItemRowProps<TProduct extends MobileMenuItem> = {
  product: TProduct;
  cartItem?: MobileCartItem<TProduct>;
  onAdd: (product: TProduct) => void;
  onQtyChange: (productId: string, delta: number) => void;
};

export function MenuItemRow<TProduct extends MobileMenuItem>({ product, cartItem, onAdd, onQtyChange }: MenuItemRowProps<TProduct>): JSX.Element {
  return (
    <div className="flex items-stretch gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
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
            <QuantityControl
              label={product.name}
              qty={cartItem.qty}
              onDecrease={() => onQtyChange(product.id, -1)}
              onIncrease={() => onQtyChange(product.id, 1)}
            />
          ) : (
            <button
              type="button"
              disabled={!product.is_available}
              onClick={() => onAdd(product)}
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
}

type MenuListProps<TProduct extends MobileMenuItem> = {
  products: TProduct[];
  cart: MobileCartItem<TProduct>[];
  onAdd: (product: TProduct) => void;
  onQtyChange: (productId: string, delta: number) => void;
  emptyLabel?: string;
};

export function MenuList<TProduct extends MobileMenuItem>({ products, cart, onAdd, onQtyChange, emptyLabel = "ยังไม่มีเมนูในหมวดนี้" }: MenuListProps<TProduct>): JSX.Element {
  return (
    <div className="space-y-3 px-4 py-4">
      {products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-slate-500">
          <Utensils className="mx-auto mb-2 h-7 w-7 text-slate-400" />
          <p className="font-medium">{emptyLabel}</p>
        </div>
      ) : null}
      {products.map((product) => (
        <MenuItemRow
          key={product.id}
          product={product}
          cartItem={cart.find((item) => item.product.id === product.id)}
          onAdd={onAdd}
          onQtyChange={onQtyChange}
        />
      ))}
    </div>
  );
}

type CartBarProps = {
  count: number;
  total: number;
  onOpen: () => void;
};

export function CartBar({ count, total, onOpen }: CartBarProps): JSX.Element | null {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed bottom-4 left-4 right-4 z-20 mx-auto flex max-w-lg items-center justify-between rounded-2xl bg-slate-950 px-4 py-4 text-white shadow-xl"
    >
      <span className="inline-flex items-center gap-2 font-semibold">
        <ShoppingCart className="h-5 w-5" />
        {count} รายการ
      </span>
      <span className="inline-flex items-center gap-2 font-bold">
        {formatCurrency(total)}
        <ChevronRight className="h-5 w-5" />
      </span>
    </button>
  );
}

type CartSheetProps<TProduct extends MobileMenuItem> = {
  open: boolean;
  title: string;
  subtitle: string;
  cart: MobileCartItem<TProduct>[];
  note: string;
  notePlaceholder: string;
  submitLabel: string;
  isSubmitting: boolean;
  extraFields?: ReactNode;
  onClose: () => void;
  onRemove: (productId: string) => void;
  onQtyChange: (productId: string, delta: number) => void;
  onItemNoteChange: (productId: string, value: string) => void;
  onNoteChange: (value: string) => void;
  onSubmit: () => void;
};

export function CartSheet<TProduct extends MobileMenuItem>({
  open,
  title,
  subtitle,
  cart,
  note,
  notePlaceholder,
  submitLabel,
  isSubmitting,
  extraFields,
  onClose,
  onRemove,
  onQtyChange,
  onItemNoteChange,
  onNoteChange,
  onSubmit
}: CartSheetProps<TProduct>): JSX.Element | null {
  if (!open) return null;

  const total = cart.reduce((sum, item) => sum + item.product.selling_price * item.qty, 0);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-white">
      <div className="mx-auto flex w-full max-w-lg items-center justify-between border-b px-4 py-4">
        <div>
          <h2 className="text-lg font-bold text-slate-950">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <button type="button" aria-label="ปิดตะกร้า" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-auto w-full max-w-lg flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {extraFields}
        {cart.map((item) => (
          <div key={item.product.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-950">{item.product.name}</p>
              <button type="button" aria-label={`ลบ ${item.product.name}`} onClick={() => onRemove(item.product.id)} className="text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <QuantityControl
                label={item.product.name}
                qty={item.qty}
                onDecrease={() => onQtyChange(item.product.id, -1)}
                onIncrease={() => onQtyChange(item.product.id, 1)}
              />
              <span className="font-bold text-emerald-700">{formatCurrency(item.product.selling_price * item.qty)}</span>
            </div>
            <input
              className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              placeholder="หมายเหตุเพิ่มเติม เช่น ไม่ใส่น้ำตาล"
              value={item.special_request}
              onChange={(event) => onItemNoteChange(item.product.id, event.target.value)}
            />
          </div>
        ))}
        <textarea
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
          placeholder={notePlaceholder}
          value={note}
          rows={2}
          onChange={(event) => onNoteChange(event.target.value)}
        />
      </div>

      <div className="border-t bg-white px-4 py-4">
        <div className="mx-auto max-w-lg">
          <div className="mb-3 flex justify-between text-lg font-bold">
            <span>รวม</span>
            <span className="text-emerald-700">{formatCurrency(total)}</span>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onSubmit}
            className="h-14 w-full rounded-2xl bg-slate-950 text-lg font-bold text-white shadow-sm disabled:opacity-60"
          >
            {isSubmitting ? "กำลังส่ง..." : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type StatusListProps = {
  items: { id: string; product_name: string; qty: number; status: string }[];
  labels: Record<string, { label: string; color: string }>;
};

export function StatusList({ items, labels }: StatusListProps): JSX.Element {
  return (
    <div className="mt-4 space-y-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/80 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{item.product_name} x{item.qty}</span>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${labels[item.status]?.color ?? "bg-slate-100 text-slate-600"}`}>
            {labels[item.status]?.label ?? item.status}
          </span>
        </div>
      ))}
    </div>
  );
}
