import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { ArrowLeft, Camera, Loader2, Search, ShoppingCart, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { authApi } from "@/lib/api";
import { branchApi } from "@/lib/adminApi";
import { crmApi } from "@/lib/crmApi";
import {
  buildCartItem,
  calcCart,
  calcChange,
  formatThaiDate,
  formatThaiCurrency,
  generateClientOrderId,
} from "@/lib/cartUtils";
import { db } from "@/lib/db";
import { posApi } from "@/lib/posApi";
import { productApi } from "@/lib/productApi";
import { syncPendingSales, syncProductCatalog, syncStockBalances, useOfflineProducts, useOnlineStatus } from "@/lib/syncService";
import { useAuthStore } from "@/stores/auth.store";
import type { BranchReplacementRule, BranchSettings } from "@/types/admin";
import type { ProductListItem } from "@/types/product";
import type { Customer, CustomerSearchResult, LoyaltySettings } from "@/types/crm";
import type { CartItem, CashierShift, ExchangeContextDraft, HeldSaleDraft, PaymentDraft, PaymentMethod, PendingSale, ReplacementRuleDraft, SaleOrder } from "@/types/pos";
import type { StockBalance, StockLocation } from "@/types/stock";
import CreateCustomerDialog from "@/pages/crm/CreateCustomerDialog";
import RedeemPointsDialog from "@/pages/crm/RedeemPointsDialog";
import CloseShiftDialog from "@/pages/pos/CloseShiftDialog";
import ReceiptView from "@/pages/pos/ReceiptView";

const SHIFT_CACHE_KEY = "erp-pos-current-shift";
const BARCODE_FORMATS = ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code"] as const;

type BranchOption = {
  branch_id: string;
  branch_name: string;
  role_name: string;
  is_default: boolean;
};

type BarcodeDetectorResult = {
  rawValue?: string;
};

type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas) => Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;
type OrderTimelineEventType = "sale" | "partial_refund" | "full_refund" | "void";

type OrderTimelineEvent = {
  id: string;
  type: OrderTimelineEventType;
  occurredAt: string;
  title: string;
  toneClassName: string;
  amount?: number;
  detail?: string;
  reason?: string | null;
};

function buildOfflineOrder(
  pendingSale: PendingSale,
  branchId: string,
  userId: string,
): SaleOrder {
  const createdAt = new Date(pendingSale.created_at).toISOString();
  return {
    id: pendingSale.client_order_id,
    order_number: `OFF-${new Date(pendingSale.created_at).toISOString().slice(0, 19).replace(/[-:T]/g, "").slice(0, 14)}`,
    status: "pending_sync",
    branch_id: branchId,
    location_id: pendingSale.location_id,
    shift_id: pendingSale.shift_id,
    user_id: userId,
    customer_name: pendingSale.customer_name,
    customer_phone: pendingSale.customer_phone ?? null,
    subtotal: pendingSale.items.reduce((sum, item) => sum + item.subtotal, 0),
    discount_amount: pendingSale.discount_amount,
    vat_amount: pendingSale.items.reduce((sum, item) => sum + item.vat_amount, 0),
    total_amount: pendingSale.total_amount,
    paid_amount: pendingSale.paid_amount,
    change_amount: pendingSale.change_amount,
    voided_at: null,
    void_reason: null,
    refunded_at: null,
    is_offline: true,
    note: pendingSale.note ?? null,
    refund_amount: 0,
    created_at: createdAt,
    items: pendingSale.items.map((item, index) => ({
      id: `${pendingSale.client_order_id}-${index}`,
      product_id: item.product_id,
      variant_id: item.variant_id,
      product_name: item.product_name,
      variant_name: item.variant_name,
      sku: item.sku,
      unit_code: item.unit_code,
      qty: item.qty,
      unit_price: item.unit_price,
      original_price: item.original_price,
      discount_amount: item.discount_amount,
      vat_type: item.vat_type,
      vat_rate: item.vat_rate,
      vat_amount: item.vat_amount,
      subtotal: item.subtotal,
      refunded_qty: 0,
      refunded_amount: 0,
    })),
    payments: (pendingSale.payments ?? [
      {
        payment_method: pendingSale.payment_method,
        amount: pendingSale.paid_amount,
        reference_no: null,
      },
    ]).map((payment, index) => ({
      id: `${pendingSale.client_order_id}-payment-${index}`,
      payment_method: payment.payment_method,
      amount: payment.amount,
      reference_no: payment.reference_no ?? null,
      paid_at: createdAt,
    })),
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function tokenizeSearchTerms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[\s/(),.-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

type ReplacementPlanEntry = {
  source: NonNullable<ExchangeContextDraft["source_items"]>[number];
  candidate: ProductListItem | null;
  matchedSource: "central" | "local" | "suggested";
};

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  promptpay: "PromptPay",
  credit_card: "บัตรเครดิต",
  bank_transfer: "โอนเงิน",
  other: "อื่นๆ",
};

function getOrderStatusLabel(status: SaleOrder["status"]): string {
  if (status === "voided") return "voided";
  if (status === "refunded") return "refunded";
  if (status === "partially_refunded") return "partially refunded";
  if (status === "completed") return "completed";
  return "pending sync";
}

function getOrderStatusBadgeClass(status: SaleOrder["status"]): string {
  if (status === "voided") return "bg-slate-200 text-slate-700";
  if (status === "refunded") return "bg-rose-100 text-rose-700";
  if (status === "partially_refunded") return "bg-amber-100 text-amber-700";
  if (status === "completed") return "bg-emerald-100 text-emerald-700";
  return "bg-blue-100 text-blue-700";
}

function getTimelineEventBadgeClass(type: OrderTimelineEventType): string {
  if (type === "sale") return "bg-emerald-50 text-emerald-700";
  if (type === "partial_refund") return "bg-amber-50 text-amber-700";
  if (type === "full_refund") return "bg-rose-50 text-rose-700";
  return "bg-slate-200 text-slate-700";
}

function buildOrderTimeline(order: SaleOrder): OrderTimelineEvent[] {
  const salePaymentSummary = order.payments
    .filter((payment) => Number(payment.amount) > 0)
    .map((payment) => paymentMethodLabels[payment.payment_method] ?? "อื่นๆ");
  const saleDetail = [
    `${order.items.length} รายการ`,
    salePaymentSummary.length > 0 ? `ชำระผ่าน ${salePaymentSummary.join(", ")}` : "",
  ].filter(Boolean).join(" • ");

  const events: OrderTimelineEvent[] = [
    {
      id: `${order.id}-sale`,
      type: "sale",
      occurredAt: order.created_at,
      title: "Sale",
      toneClassName: "border-emerald-200 bg-emerald-50 text-emerald-900",
      amount: Number(order.total_amount),
      detail: saleDetail,
    },
  ];

  const negativePayments = order.payments
    .filter((payment) => Number(payment.amount) < 0)
    .sort((left, right) => new Date(left.paid_at).getTime() - new Date(right.paid_at).getTime());

  let cumulativeRefund = 0;
  const refundGroups = new Map<string, typeof negativePayments>();
  negativePayments.forEach((payment) => {
    const bucket = payment.paid_at;
    const current = refundGroups.get(bucket) ?? [];
    current.push(payment);
    refundGroups.set(bucket, current);
  });

  Array.from(refundGroups.entries()).forEach(([paidAt, payments], index) => {
    const refundAmount = Math.abs(payments.reduce((sum, payment) => sum + Number(payment.amount), 0));
    cumulativeRefund = roundMoney(cumulativeRefund + refundAmount);
    const isFullRefund = cumulativeRefund >= Number(order.total_amount) - 0.01;
    const paymentMethods = payments.map((payment) => paymentMethodLabels[payment.payment_method] ?? "อื่นๆ");
    const uniqueMethods = paymentMethods.filter((method, methodIndex) => paymentMethods.indexOf(method) === methodIndex);
    const reasons = payments.map((payment) => payment.note?.trim()).filter((value): value is string => Boolean(value));
    const uniqueReasons = reasons.filter((reason, reasonIndex) => reasons.indexOf(reason) === reasonIndex);
    events.push({
      id: `${order.id}-refund-${index}`,
      type: isFullRefund ? "full_refund" : "partial_refund",
      occurredAt: paidAt,
      title: isFullRefund ? "Full Refund" : "Partial Refund",
      toneClassName: isFullRefund ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900",
      amount: refundAmount,
      detail: uniqueMethods.length > 0 ? `คืนผ่าน ${uniqueMethods.join(", ")}` : undefined,
      reason: uniqueReasons[0] ?? null,
    });
  });

  if (order.voided_at) {
    events.push({
      id: `${order.id}-void`,
      type: "void",
      occurredAt: order.voided_at,
      title: "Void",
      toneClassName: "border-slate-300 bg-slate-100 text-slate-900",
      amount: Number(order.total_amount),
      reason: order.void_reason ?? null,
    });
  }

  return events.sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
}

function getTodayDateInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function POSPage(): JSX.Element {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const branchId = useAuthStore((state) => state.branchId);
  const user = useAuthStore((state) => state.user);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paidAmount, setPaidAmount] = useState(0);
  const [creditRef, setCreditRef] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [promptPayTarget, setPromptPayTarget] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [currentShift, setCurrentShift] = useState<CashierShift | null>(() => {
    const raw = window.localStorage.getItem(SHIFT_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CashierShift) : null;
  });
  const [shiftGateOpen, setShiftGateOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState(0);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerTaxId, setCustomerTaxId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastOrder, setLastOrder] = useState<SaleOrder | null>(null);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [heldBillsOpen, setHeldBillsOpen] = useState(false);
  const [holdLabel, setHoldLabel] = useState("");
  const [heldBillsVersion, setHeldBillsVersion] = useState(0);
  const [replacementRulesVersion, setReplacementRulesVersion] = useState(0);
  const [recentSalesOpen, setRecentSalesOpen] = useState(false);
  const [recentSalesScope, setRecentSalesScope] = useState<"current_shift" | "branch_history">("current_shift");
  const [recentSalesSearch, setRecentSalesSearch] = useState("");
  const [recentSalesDateFrom, setRecentSalesDateFrom] = useState("");
  const [recentSalesDateTo, setRecentSalesDateTo] = useState("");
  const [historyOrder, setHistoryOrder] = useState<SaleOrder | null>(null);
  const [priceEditorOpen, setPriceEditorOpen] = useState(false);
  const [priceEditProductId, setPriceEditProductId] = useState<string | null>(null);
  const [priceEditValue, setPriceEditValue] = useState("");
  const [voidOrder, setVoidOrder] = useState<SaleOrder | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [refundOrder, setRefundOrder] = useState<SaleOrder | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [partialRefundOrder, setPartialRefundOrder] = useState<SaleOrder | null>(null);
  const [partialRefundReason, setPartialRefundReason] = useState("");
  const [partialRefundQtys, setPartialRefundQtys] = useState<Record<string, string>>({});
  const [exchangeContext, setExchangeContext] = useState<ExchangeContextDraft | null>(null);
  const [splitPaymentEnabled, setSplitPaymentEnabled] = useState(false);
  const [secondaryPaymentMethod, setSecondaryPaymentMethod] = useState<PaymentMethod>("promptpay");
  const [secondaryPaymentAmount, setSecondaryPaymentAmount] = useState(0);
  const [secondaryPaymentReference, setSecondaryPaymentReference] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const cashInputRef = useRef<HTMLInputElement | null>(null);
  const receiptRef = useRef<HTMLDivElement | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerFrameRef = useRef<number | null>(null);
  const offlineProducts = useOfflineProducts(searchTerm);
  const handlePrint = useReactToPrint({ contentRef: receiptRef });

  const branchQuery = useQuery({
    queryKey: ["pos", "branches"],
    queryFn: async () => {
      const response = await authApi.myBranches();
      return response.data.data as BranchOption[];
    },
    enabled: Boolean(user),
  });

  const locationsQuery = useQuery({
    queryKey: ["pos", "locations", branchId],
    queryFn: async () => {
      const response = await posApi.listLocations(branchId ?? undefined);
      return response.data.data as StockLocation[];
    },
    enabled: Boolean(branchId),
  });

  const currentShiftQuery = useQuery({
    queryKey: ["pos", "current-shift", branchId],
    queryFn: async () => {
      const response = await posApi.getCurrentShift();
      return response.data.data as CashierShift | null;
    },
    enabled: Boolean(branchId) && isOnline,
  });
  const branchSettingsQuery = useQuery({
    queryKey: ["pos", "branch-settings", branchId],
    queryFn: async () => {
      if (!branchId) {
        return null;
      }
      return (await branchApi.getSettings(branchId)).data.data as BranchSettings;
    },
    enabled: Boolean(branchId) && isOnline,
  });

  const onlineSearchQuery = useQuery({
    queryKey: ["pos", "products", searchTerm],
    queryFn: async () => {
      const response = await productApi.list({ search: searchTerm, is_active: true, page: 1, limit: 100 });
      return response.data.data as ProductListItem[];
    },
    enabled: isOnline && searchTerm.trim().length > 0,
  });
  const loyaltySettingsQuery = useQuery({
    queryKey: ["pos", "loyalty-settings"],
    queryFn: async () => (await crmApi.getSettings()).data.data as LoyaltySettings,
    enabled: isOnline
  });
  const customerSearchQuery = useQuery({
    queryKey: ["pos", "customer-search", debouncedCustomerSearch],
    queryFn: async () => (await crmApi.searchCustomers(debouncedCustomerSearch, 10)).data.data as CustomerSearchResult[],
    enabled: debouncedCustomerSearch.trim().length >= 3
  });

  const categoriesQuery = useQuery({
    queryKey: ["pos", "categories"],
    queryFn: async () => {
      const rows = await db.categories.toArray();
      return rows;
    },
  });

  const stockBalancesQuery = useQuery({
    queryKey: ["pos", "stock-balances", branchId],
    queryFn: async () => {
      const rows = await db.stockBalances.toArray();
      return rows.filter((row) => !branchId || row.branch_id === branchId);
    },
  });
  const heldBillsQuery = useQuery({
    queryKey: ["pos", "held-bills", currentShift?.id, heldBillsVersion],
    queryFn: async () => {
      if (!currentShift) {
        return [] as HeldSaleDraft[];
      }
      const rows = await db.heldBills.where("shift_id").equals(currentShift.id).toArray();
      return rows.sort((left, right) => right.held_at - left.held_at);
    },
    enabled: Boolean(currentShift),
  });
  const replacementRulesQuery = useQuery({
    queryKey: ["pos", "local-replacement-rules", branchId, replacementRulesVersion],
    queryFn: async () => {
      const rows = await db.replacementRules.toArray();
      return rows.filter((row) => row.branch_id === null || row.branch_id === branchId);
    },
    enabled: Boolean(branchId),
  });
  const centralReplacementRulesQuery = useQuery({
    queryKey: ["pos", "central-replacement-rules", branchId],
    queryFn: async () => {
      if (!branchId) {
        return [] as BranchReplacementRule[];
      }
      const response = await branchApi.listReplacementRules(branchId);
      return response.data.data as BranchReplacementRule[];
    },
    enabled: Boolean(branchId) && isOnline,
  });
  const recentSalesQuery = useQuery({
    queryKey: ["pos", "recent-sales", currentShift?.id, branchId, recentSalesScope, recentSalesSearch, recentSalesDateFrom, recentSalesDateTo],
    queryFn: async () => {
      if (!currentShift || !branchId) {
        return [] as SaleOrder[];
      }
      const response = await posApi.listSales({
        shift_id: recentSalesScope === "current_shift" ? currentShift.id : undefined,
        branch_id: branchId,
        search: recentSalesSearch.trim() || undefined,
        date_from: recentSalesDateFrom || undefined,
        date_to: recentSalesDateTo || undefined,
        limit: recentSalesScope === "current_shift" ? 12 : 50,
        page: 1,
      });
      return response.data.data as SaleOrder[];
    },
    enabled: Boolean(currentShift && branchId) && isOnline && !(recentSalesScope === "branch_history" && recentSalesDateFrom && recentSalesDateTo && recentSalesDateTo < recentSalesDateFrom),
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchTerm(search);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedCustomerSearch(customerSearch);
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [customerSearch]);

  useEffect(() => {
    if (currentShiftQuery.data !== undefined) {
      setCurrentShift(currentShiftQuery.data);
      if (currentShiftQuery.data) {
        window.localStorage.setItem(SHIFT_CACHE_KEY, JSON.stringify(currentShiftQuery.data));
      } else {
        window.localStorage.removeItem(SHIFT_CACHE_KEY);
      }
      setShiftGateOpen(!currentShiftQuery.data);
    }
  }, [currentShiftQuery.data]);

  useEffect(() => {
    if (!recentSalesOpen) {
      return;
    }
    const today = getTodayDateInputValue();
    if (recentSalesScope === "current_shift") {
      if (recentSalesDateFrom || recentSalesDateTo || recentSalesSearch) {
        setRecentSalesDateFrom("");
        setRecentSalesDateTo("");
        setRecentSalesSearch("");
      }
      return;
    }
    if (!recentSalesDateFrom && !recentSalesDateTo) {
      setRecentSalesDateFrom(today);
      setRecentSalesDateTo(today);
    }
  }, [recentSalesDateFrom, recentSalesDateTo, recentSalesOpen, recentSalesScope, recentSalesSearch]);

  useEffect(() => {
    if (isOnline) {
      void syncProductCatalog();
      void syncStockBalances(branchId ?? undefined);
      void syncPendingSales();
    }
  }, [branchId, isOnline]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F1" || event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "F2") {
        event.preventDefault();
        cashInputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setSearch("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const branches = branchQuery.data ?? [];
  const branchName = branches.find((item) => item.branch_id === branchId)?.branch_name ?? "สาขาหลัก";
  const locations = locationsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const stockBalances = stockBalancesQuery.data ?? [];
  const products = (isOnline && searchTerm.trim().length > 0 ? onlineSearchQuery.data : offlineProducts) ?? [];
  const stockByProduct = useMemo(
    () => new Map(stockBalances.map((item) => [`${item.product_id}:${item.variant_id ?? "base"}`, item])),
    [stockBalances],
  );

  const visibleProducts = useMemo(() => {
    return products.filter((item) => {
      if (selectedCategory && item.category_id !== selectedCategory) {
        return false;
      }
      return true;
    });
  }, [products, selectedCategory]);

  const cart = useMemo(() => calcCart(cartItems, orderDiscount, "amount"), [cartItems, orderDiscount]);
  const exchangeCreditAvailable = exchangeContext?.refund_amount ?? 0;
  const exchangeCreditApplied = useMemo(
    () => roundMoney(Math.min(exchangeCreditAvailable, Math.max(cart.total_amount - loyaltyDiscount, 0))),
    [cart.total_amount, exchangeCreditAvailable, loyaltyDiscount],
  );
  const exchangeCreditRemaining = useMemo(
    () => roundMoney(Math.max(exchangeCreditAvailable - exchangeCreditApplied, 0)),
    [exchangeCreditApplied, exchangeCreditAvailable],
  );
  const totalDiscount = orderDiscount + loyaltyDiscount + exchangeCreditApplied;
  const finalTotal = Math.max(cart.total_amount - loyaltyDiscount - exchangeCreditApplied, 0);
  const secondaryAmount = Math.max(0, Math.min(secondaryPaymentAmount, finalTotal));
  const primaryDueAmount = Math.max(finalTotal - (splitPaymentEnabled ? secondaryAmount : 0), 0);
  const currentPaidAmount = useMemo(() => {
    if (splitPaymentEnabled) {
      if (paymentMethod === "cash") {
        return Math.max(paidAmount, 0) + secondaryAmount;
      }
      return finalTotal;
    }
    return paymentMethod === "cash" ? paidAmount : finalTotal;
  }, [finalTotal, paidAmount, paymentMethod, secondaryAmount, splitPaymentEnabled]);
  const changeAmount = calcChange(finalTotal, currentPaidAmount);
  const paymentReference = useMemo(() => {
    if (paymentMethod === "credit_card" || paymentMethod === "bank_transfer") {
      return creditRef.trim() || null;
    }
    return null;
  }, [creditRef, paymentMethod]);
  const checkoutPayments = useMemo((): PaymentDraft[] => {
    if (splitPaymentEnabled) {
      const rows: PaymentDraft[] = [];
      const primaryAmount = paymentMethod === "cash" ? Math.max(paidAmount, 0) : primaryDueAmount;
      if (primaryAmount > 0) {
        rows.push({
          payment_method: paymentMethod,
          amount: primaryAmount,
          reference_no: paymentReference,
        });
      }
      if (secondaryAmount > 0) {
        rows.push({
          payment_method: secondaryPaymentMethod,
          amount: secondaryAmount,
          reference_no:
            secondaryPaymentMethod === "credit_card" || secondaryPaymentMethod === "bank_transfer"
              ? secondaryPaymentReference.trim() || null
              : null,
        });
      }
      return rows;
    }
    return [
      {
        payment_method: paymentMethod,
        amount: paymentMethod === "cash" ? Math.max(paidAmount, 0) : finalTotal,
        reference_no: paymentReference,
      },
    ];
  }, [
    finalTotal,
    paidAmount,
    paymentMethod,
    paymentReference,
    primaryDueAmount,
    secondaryAmount,
    secondaryPaymentMethod,
    secondaryPaymentReference,
    splitPaymentEnabled,
  ]);
  const promptPayAmount = splitPaymentEnabled ? primaryDueAmount : finalTotal;
  const vatIncludedAmount = useMemo(
    () => cart.items.filter((item) => item.vat_type === "included").reduce((sum, item) => sum + item.vat_amount, 0),
    [cart.items],
  );
  const vatExcludedAmount = useMemo(
    () => cart.items.filter((item) => item.vat_type === "excluded").reduce((sum, item) => sum + item.vat_amount, 0),
    [cart.items],
  );
  const vatExemptSubtotal = useMemo(
    () => cart.items.filter((item) => item.vat_type === "exempt").reduce((sum, item) => sum + item.subtotal, 0),
    [cart.items],
  );
  const scanSupported = typeof window !== "undefined" && "BarcodeDetector" in window && navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    const settings = branchSettingsQuery.data;
    if (!settings) {
      return;
    }
    if (!settings.pos_allow_discount && orderDiscount !== 0) {
      setOrderDiscount(0);
      return;
    }
    const maxDiscountAmount = (cart.subtotal * settings.pos_max_discount_pct) / 100;
    if (orderDiscount > maxDiscountAmount) {
      setOrderDiscount(maxDiscountAmount);
    }
  }, [branchSettingsQuery.data, cart.subtotal, orderDiscount]);

  useEffect(() => {
    if (paymentMethod === "promptpay" && promptPayAmount > 0) {
      void posApi.getPromptPayQR(promptPayAmount)
        .then(async (response) => {
          const payload = response.data.data.payload as string;
          const dataUrl = await QRCode.toDataURL(payload, { width: 200, margin: 1 });
          setQrDataUrl(dataUrl);
          setPromptPayTarget((response.data.data.target as string | undefined) ?? "");
        })
        .catch(() => {
          setQrDataUrl("");
          setPromptPayTarget("");
        });
    }
  }, [paymentMethod, promptPayAmount]);

  useEffect(() => {
    if (!scannerOpen) {
      if (scannerFrameRef.current !== null) {
        window.cancelAnimationFrame(scannerFrameRef.current);
        scannerFrameRef.current = null;
      }
      if (scannerStreamRef.current) {
        scannerStreamRef.current.getTracks().forEach((track) => track.stop());
        scannerStreamRef.current = null;
      }
      return;
    }

    if (!scanSupported) {
      setScannerError("อุปกรณ์นี้ยังไม่รองรับการสแกนด้วยกล้อง");
      return;
    }

    let cancelled = false;
    const BarcodeDetectorClass = (window as Window & { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!BarcodeDetectorClass) {
      setScannerError("ไม่พบตัวสแกนบาร์โค้ดในเบราว์เซอร์");
      return;
    }

    const detector = new BarcodeDetectorClass({ formats: [...BARCODE_FORMATS] });

    const stopScanner = () => {
      if (scannerFrameRef.current !== null) {
        window.cancelAnimationFrame(scannerFrameRef.current);
        scannerFrameRef.current = null;
      }
      if (scannerStreamRef.current) {
        scannerStreamRef.current.getTracks().forEach((track) => track.stop());
        scannerStreamRef.current = null;
      }
    };

    const scanLoop = async () => {
      if (cancelled) {
        return;
      }
      const video = scannerVideoRef.current;
      if (video && video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        try {
          const results = await detector.detect(video);
          const code = results.find((item) => item.rawValue?.trim())?.rawValue?.trim();
          if (code) {
            stopScanner();
            setScannerOpen(false);
            await handleProductCodeLookup(code);
            return;
          }
        } catch {
          setScannerError("กล้องเปิดได้ แต่ยังอ่านบาร์โค้ดไม่ได้");
        }
      }
      scannerFrameRef.current = window.requestAnimationFrame(() => {
        void scanLoop();
      });
    };

    void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        scannerStreamRef.current = stream;
        setScannerError("");
        if (scannerVideoRef.current) {
          scannerVideoRef.current.srcObject = stream;
          await scannerVideoRef.current.play();
        }
        await scanLoop();
      })
      .catch(() => {
        setScannerError("ไม่สามารถเปิดกล้องเพื่อสแกนบาร์โค้ดได้");
      });

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [scanSupported, scannerOpen]);

  function updateCartItem(productId: string, updater: (item: CartItem) => CartItem | null): void {
    setCartItems((current) =>
      current
        .map((item) => (item.product_id === productId && item.variant_id === null ? updater(item) : item))
        .filter((item): item is CartItem => item !== null)
    );
  }

  function getAvailableStock(productId: string, variantId: string | null = null): number {
    const row = stockByProduct.get(`${productId}:${variantId ?? "base"}`);
    return Number(row?.qty_available ?? 0);
  }

  function addToCart(product: ProductListItem, qty = 1): void {
    const available = getAvailableStock(product.id, null);
    if (available <= 0) {
      return;
    }
    setCartItems((current) => {
      const existing = current.find((item) => item.product_id === product.id && item.variant_id === null);
      const safeQty = Math.max(1, Math.floor(qty));
      if (existing) {
        if (existing.qty >= available) {
          return current;
        }
        const nextQty = Math.min(existing.qty + safeQty, available);
        return current.map((item) =>
          item.product_id === product.id && item.variant_id === null
            ? { ...item, qty: nextQty, subtotal: nextQty * item.unit_price, vat_amount: item.vat_amount }
            : item
        );
      }
      return [...current, buildCartItem(product, Math.min(safeQty, available))];
    });
  }

  async function handleProductCodeLookup(rawKeyword: string): Promise<void> {
    const keyword = rawKeyword.trim().toLowerCase();
    if (!keyword) {
      return;
    }
    let candidate =
      visibleProducts.find((item) => item.barcode?.toLowerCase() === keyword || item.sku.toLowerCase() === keyword) ??
      offlineProducts.find((item) => item.barcode?.toLowerCase() === keyword || item.sku.toLowerCase() === keyword);
    if (!candidate && isOnline) {
      const response = await productApi.list({ search: keyword, is_active: true, page: 1, limit: 20 });
      const rows = response.data.data as ProductListItem[];
      candidate = rows.find((item) => item.barcode?.toLowerCase() === keyword || item.sku.toLowerCase() === keyword);
    }
    if (candidate) {
      addToCart(candidate);
      setSearch("");
      toast({ title: "เพิ่มสินค้าสำเร็จ", description: `${candidate.name} ถูกเพิ่มเข้าตะกร้าแล้ว` });
      return;
    }
    toast({ title: "ไม่พบสินค้า", description: `ไม่พบบาร์โค้ดหรือ SKU: ${rawKeyword}` });
  }

  async function handleBarcodeLookup(): Promise<void> {
    await handleProductCodeLookup(search);
  }

  function handleApplyReplacementPreset(): void {
    if (exchangeReplacementPlan.length === 0) {
      toast({ title: "ยังไม่มี preset ทดแทนที่เหมาะสม" });
      return;
    }
    let addedCount = 0;
    exchangeReplacementPlan.forEach((entry) => {
      if (!entry.candidate) {
        return;
      }
      const qty = Math.max(1, Math.floor(Number(entry.source.qty ?? 1)));
      addToCart(entry.candidate, qty);
      addedCount += 1;
    });
    if (addedCount === 0) {
      toast({ title: "ยังไม่มีสินค้าทดแทนที่พร้อมขาย" });
      return;
    }
    toast({
      title: "เติมสินค้าทดแทนอัตโนมัติแล้ว",
      description: `เพิ่มสินค้าแทน ${addedCount} รายการจาก preset ของบิลแลก`,
    });
  }

  async function handleSaveReplacementRule(
    source: NonNullable<ExchangeContextDraft["source_items"]>[number],
    candidate: ProductListItem,
  ): Promise<void> {
    if (isOnline && branchId && canManageCentralReplacementRules) {
      await branchApi.upsertReplacementRule(branchId, {
        source_product_id: source.product_id,
        replacement_product_id: candidate.id,
      });
      await centralReplacementRulesQuery.refetch();
      toast({
        title: "บันทึกกฎส่วนกลางแล้ว",
        description: `${source.product_name} -> ${candidate.name}`,
      });
      return;
    }
    const rule: ReplacementRuleDraft = {
      id: `${branchId ?? "all"}:${source.product_id}`,
      branch_id: branchId ?? null,
      source_product_id: source.product_id,
      source_product_name: source.product_name,
      replacement_product_id: candidate.id,
      replacement_product_name: candidate.name,
      created_at: Date.now(),
    };
    await db.replacementRules.put(rule);
    setReplacementRulesVersion((value) => value + 1);
    toast({
      title: "บันทึกกฎ local แล้ว",
      description: `${source.product_name} -> ${candidate.name}`,
    });
  }

  async function handleDeleteReplacementRule(sourceProductId: string, matchedSource: ReplacementPlanEntry["matchedSource"]): Promise<void> {
    if (matchedSource === "central" && isOnline && branchId && canManageCentralReplacementRules) {
      await branchApi.deleteReplacementRule(branchId, sourceProductId);
      await centralReplacementRulesQuery.refetch();
      toast({ title: "ลบกฎส่วนกลางแล้ว" });
      return;
    }
    const ruleId = `${branchId ?? "all"}:${sourceProductId}`;
    await db.replacementRules.delete(ruleId);
    setReplacementRulesVersion((value) => value + 1);
    toast({ title: matchedSource === "local" ? "ลบกฎ local แล้ว" : "ลบกฎสินค้าทดแทนแล้ว" });
  }

  async function handleOpenShift(): Promise<void> {
    if (!selectedLocationId) {
      return;
    }
    const response = await posApi.openShift({ location_id: selectedLocationId, opening_cash: openingCash });
    const shift = response.data.data as CashierShift;
    setCurrentShift(shift);
    window.localStorage.setItem(SHIFT_CACHE_KEY, JSON.stringify(shift));
    setShiftGateOpen(false);
  }

  async function handleCloseShift(closingCash: number, shiftNote: string): Promise<void> {
    if (!currentShift) {
      return;
    }
    const response = await posApi.closeShift(currentShift.id, { closing_cash: closingCash, note: shiftNote });
    setCurrentShift(response.data.data as CashierShift);
    window.localStorage.removeItem(SHIFT_CACHE_KEY);
    setCartItems([]);
    navigate("/dashboard");
  }

  function handleOrderDiscountChange(nextValue: number): void {
    const settings = branchSettingsQuery.data;
    if (!canApplyDiscount) {
      setOrderDiscount(0);
      toast({ title: "คุณไม่มีสิทธิ์ให้ส่วนลดใน POS" });
      return;
    }
    if (settings && !settings.pos_allow_discount) {
      setOrderDiscount(0);
      toast({ title: "สาขานี้ปิดการให้ส่วนลดไว้" });
      return;
    }
    const safeValue = Number.isFinite(nextValue) ? Math.max(0, nextValue) : 0;
    const branchLimit = settings ? (cart.subtotal * settings.pos_max_discount_pct) / 100 : safeValue;
    const maxDiscountAmount = canOverrideDiscount ? safeValue : branchLimit;
    setOrderDiscount(Math.min(safeValue, maxDiscountAmount));
  }

  function openPriceEditor(item: CartItem): void {
    setPriceEditProductId(item.product_id);
    setPriceEditValue(item.original_price.toString());
    setPriceEditorOpen(true);
  }

  function handleApplyPriceOverride(): void {
    if (!priceEditProductId) {
      return;
    }
    const nextPrice = Number(priceEditValue);
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      toast({ title: "กรอกราคาใหม่ไม่ถูกต้อง" });
      return;
    }
    updateCartItem(priceEditProductId, (current) => ({
      ...current,
      original_price: nextPrice,
      unit_price: nextPrice,
    }));
    setPriceEditorOpen(false);
    setPriceEditProductId(null);
    setPriceEditValue("");
    toast({ title: "อัปเดตราคาในบิลแล้ว" });
  }

  async function handleVoidSale(): Promise<void> {
    if (!voidOrder || !voidReason.trim()) {
      toast({ title: "กรุณาระบุเหตุผลในการ void" });
      return;
    }
    try {
      await posApi.voidSale(voidOrder.id, voidReason.trim());
      toast({ title: "Void บิลสำเร็จ", description: voidOrder.order_number });
      setVoidOrder(null);
      setVoidReason("");
      await recentSalesQuery.refetch();
    } catch (error) {
      toast({ title: "Void บิลไม่สำเร็จ", description: error instanceof Error ? error.message : "ลองใหม่อีกครั้ง" });
    }
  }

  async function handleRefundSale(): Promise<void> {
    if (!refundOrder || !refundReason.trim()) {
      toast({ title: "กรุณาระบุเหตุผลในการคืนสินค้า" });
      return;
    }
    try {
      await posApi.refundSale(refundOrder.id, refundReason.trim());
      toast({ title: "Refund สำเร็จ", description: refundOrder.order_number });
      setRefundOrder(null);
      setRefundReason("");
      await recentSalesQuery.refetch();
    } catch (error) {
      toast({ title: "Refund ไม่สำเร็จ", description: error instanceof Error ? error.message : "ลองใหม่อีกครั้ง" });
    }
  }

  function beginExchangeFlow(
    order: SaleOrder,
    refundAmount: number,
    refundReasonValue: string,
    refundedItemNames: string[],
    refundedSourceItems: Array<{ product_id: string; product_name: string }>,
  ): void {
    if (cart.items.length > 0 && !window.confirm("มีสินค้าอยู่ในตะกร้าปัจจุบัน ต้องการล้างแล้วเริ่มบิลแลกสินค้าหรือไม่")) {
      return;
    }
    resetActiveSale();
    setCustomerName(order.customer_name ?? "");
    setCustomerPhone(order.customer_phone ?? "");
    setCustomerTaxId(order.customer_tax_id ?? "");
    setSelectedCustomer(null);
    setExchangeContext({
      source_order_id: order.id,
      source_order_number: order.order_number,
      refund_amount: refundAmount,
      refunded_items: refundedItemNames,
      source_items: refundedSourceItems,
      refund_reason: refundReasonValue,
    });
    const noteLines = [
      `EXCHANGE FROM ${order.order_number}`,
      `Refund ${formatThaiCurrency(refundAmount)}`,
      refundedItemNames.length > 0 ? `Returned: ${refundedItemNames.join(", ")}` : "",
      refundReasonValue ? `Reason: ${refundReasonValue}` : "",
    ].filter(Boolean);
    setNote(noteLines.join("\n"));
    setRecentSalesOpen(false);
    searchRef.current?.focus();
    toast({
      title: "เริ่มบิลแลกสินค้าแล้ว",
      description: `อ้างอิง ${order.order_number} และพร้อมเพิ่มสินค้าใหม่ต่อได้เลย`,
    });
  }

  async function handlePartialRefundSale(startExchange = false): Promise<void> {
    if (!partialRefundOrder || !partialRefundReason.trim()) {
      toast({ title: "กรุณาระบุเหตุผลในการคืนสินค้า" });
      return;
    }
    const refundItems = partialRefundOrder.items
      .map((item) => {
        const qty = Number(partialRefundQtys[item.id] ?? 0);
        return {
          order_item_id: item.id,
          qty: Number.isFinite(qty) ? qty : 0,
        };
      })
      .filter((item) => item.qty > 0);
    if (refundItems.length === 0) {
      toast({ title: "เลือกสินค้าที่ต้องการคืนก่อน" });
      return;
    }
    const refundedItemNames = partialRefundOrder.items
      .filter((item) => refundItems.some((entry) => entry.order_item_id === item.id))
      .map((item) => item.product_name);
    try {
      const response = await posApi.partialRefundSale(partialRefundOrder.id, {
        refund_reason: partialRefundReason.trim(),
        items: refundItems,
      });
      const updatedOrder = response.data.data as SaleOrder;
      const refundAmount = partialRefundPreview.amount;
      toast({ title: "คืนบางรายการสำเร็จ", description: partialRefundOrder.order_number });
      setPartialRefundOrder(null);
      setPartialRefundReason("");
      setPartialRefundQtys({});
      await recentSalesQuery.refetch();
      if (startExchange) {
        beginExchangeFlow(
          updatedOrder,
          refundAmount,
          partialRefundReason.trim(),
          refundedItemNames,
          partialRefundOrder.items
            .filter((item) => refundItems.some((entry) => entry.order_item_id === item.id))
            .map((item) => ({
              product_id: item.product_id,
              product_name: item.product_name,
              qty: refundItems.find((entry) => entry.order_item_id === item.id)?.qty ?? 1,
            })),
        );
      }
    } catch (error) {
      toast({ title: "คืนบางรายการไม่สำเร็จ", description: error instanceof Error ? error.message : "ลองใหม่อีกครั้ง" });
    }
  }

  function resetActiveSale(): void {
    setCartItems([]);
    setOrderDiscount(0);
    setPaymentMethod("cash");
    setPaidAmount(0);
    setCreditRef("");
    setQrDataUrl("");
    setPromptPayTarget("");
    setSplitPaymentEnabled(false);
    setSecondaryPaymentMethod("promptpay");
    setSecondaryPaymentAmount(0);
    setSecondaryPaymentReference("");
    setCustomerName("");
    setCustomerPhone("");
    setCustomerTaxId("");
    setCustomerSearch("");
    setDebouncedCustomerSearch("");
    setSelectedCustomer(null);
    setLoyaltyDiscount(0);
    setNote("");
    setExchangeContext(null);
  }

  async function refreshHeldBills(): Promise<void> {
    setHeldBillsVersion((value) => value + 1);
  }

  async function handleHoldBill(): Promise<void> {
    if (!currentShift || cart.items.length === 0) {
      return;
    }
    const defaultLabel = customerName.trim() || selectedCustomer?.display_name || `${cart.items[0]?.product_name ?? "บิล"} +${Math.max(cart.items.length - 1, 0)}`;
    const draft: HeldSaleDraft = {
      id: generateClientOrderId(),
      shift_id: currentShift.id,
      location_id: currentShift.location_id,
      branch_id: branchId ?? null,
      label: holdLabel.trim() || defaultLabel,
      items: cart.items,
      order_discount: orderDiscount,
      loyalty_discount: loyaltyDiscount,
      payment_method: paymentMethod,
      paid_amount: paidAmount,
      payment_reference: paymentReference,
      split_payment_enabled: splitPaymentEnabled,
      secondary_payment_method: secondaryPaymentMethod,
      secondary_payment_amount: secondaryPaymentAmount,
      secondary_payment_reference: secondaryPaymentReference,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_tax_id: customerTaxId,
      customer_search: customerSearch,
      selected_customer: selectedCustomer,
      note,
      exchange_context: exchangeContext,
      held_at: Date.now(),
    };
    await db.heldBills.put(draft);
    resetActiveSale();
    setHoldLabel("");
    await refreshHeldBills();
    toast({ title: "พักบิลแล้ว", description: `${draft.label} ถูกเก็บไว้เรียบร้อย` });
  }

  async function handleResumeHeldBill(draft: HeldSaleDraft): Promise<void> {
    if (cart.items.length > 0 && !window.confirm("มีสินค้าอยู่ในตะกร้าปัจจุบัน ต้องการแทนที่ด้วยบิลที่พักไว้หรือไม่")) {
      return;
    }
    setCartItems(draft.items);
    setOrderDiscount(draft.order_discount);
    setPaymentMethod(draft.payment_method);
    setPaidAmount(draft.paid_amount);
    setCreditRef(draft.payment_reference ?? "");
    setSplitPaymentEnabled(draft.split_payment_enabled ?? false);
    setSecondaryPaymentMethod(draft.secondary_payment_method ?? "promptpay");
    setSecondaryPaymentAmount(draft.secondary_payment_amount ?? 0);
    setSecondaryPaymentReference(draft.secondary_payment_reference ?? "");
    setCustomerName(draft.customer_name);
    setCustomerPhone(draft.customer_phone);
    setCustomerTaxId(draft.customer_tax_id);
    setCustomerSearch(draft.customer_search);
    setDebouncedCustomerSearch("");
    setSelectedCustomer(draft.selected_customer);
    setLoyaltyDiscount(draft.loyalty_discount);
    setNote(draft.note);
    setExchangeContext(draft.exchange_context ?? null);
    await db.heldBills.delete(draft.id);
    await refreshHeldBills();
    setHeldBillsOpen(false);
    toast({ title: "เรียกบิลกลับแล้ว", description: `${draft.label} พร้อมขายต่อ` });
  }

  async function handleDeleteHeldBill(draftId: string): Promise<void> {
    await db.heldBills.delete(draftId);
    await refreshHeldBills();
    toast({ title: "ลบบิลที่พักไว้แล้ว" });
  }

  async function queueOfflineSale(): Promise<void> {
    if (!currentShift || !branchId || !user) {
      return;
    }
    const pendingSale: PendingSale = {
      client_order_id: generateClientOrderId(),
      shift_id: currentShift.id,
      location_id: currentShift.location_id,
      items: cart.items,
      discount_amount: totalDiscount,
      customer_id: selectedCustomer?.id ?? null,
      discount_type: "amount",
      payment_method: paymentMethod,
      payments: checkoutPayments,
      payment_reference: paymentReference,
      paid_amount: currentPaidAmount,
      customer_name: customerName || selectedCustomer?.display_name || [selectedCustomer?.first_name, selectedCustomer?.last_name].filter(Boolean).join(" ") || null,
      customer_phone: customerPhone || selectedCustomer?.phone || null,
      customer_tax_id: customerTaxId || selectedCustomer?.tax_id || null,
      note: exchangeNote,
      exchange_context: exchangeContext,
      total_amount: finalTotal,
      change_amount: changeAmount,
      created_at: Date.now(),
      synced: false,
    };
    await db.pendingSales.put(pendingSale);
    await db.transaction("rw", db.stockBalances, async () => {
      for (const item of cart.items) {
        const key = `${item.product_id}:${item.variant_id ?? "base"}`;
        const balance = stockByProduct.get(key);
        if (!balance) {
          continue;
        }
        await db.stockBalances.update(balance.id, {
          qty_on_hand: Number(balance.qty_on_hand) - item.qty,
          qty_available: Number(balance.qty_available) - item.qty,
        });
      }
    });
    const offlineOrder = buildOfflineOrder(pendingSale, branchId, user.id);
    setLastOrder(offlineOrder);
    setShowReceipt(true);
    resetActiveSale();
    toast({ title: "บันทึกออฟไลน์แล้ว", description: "รายการขายถูกคิวไว้เพื่อ sync ภายหลัง" });
  }

  async function handleCheckout(): Promise<void> {
    if (!currentShift || cart.items.length === 0) {
      return;
    }
    setIsSubmitting(true);
    try {
      if (!isOnline) {
        await queueOfflineSale();
        return;
      }
      const response = await posApi.createSale({
        shift_id: currentShift.id,
        location_id: currentShift.location_id,
        items: cart.items.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          qty: item.qty,
          unit_price: item.unit_price,
          original_price: item.original_price,
          discount_amount: item.discount_amount,
          discount_type: item.discount_type,
          vat_type: item.vat_type,
          vat_rate: item.vat_rate,
        })),
        discount_amount: totalDiscount,
        discount_type: "amount",
        payment_method: paymentMethod,
        payments: checkoutPayments,
        payment_reference: paymentReference,
        paid_amount: currentPaidAmount,
        customer_name: customerName || selectedCustomer?.display_name || [selectedCustomer?.first_name, selectedCustomer?.last_name].filter(Boolean).join(" ") || null,
        customer_phone: customerPhone || selectedCustomer?.phone || null,
        customer_tax_id: customerTaxId || selectedCustomer?.tax_id || null,
        customer_id: selectedCustomer?.id ?? null,
        note: exchangeNote,
      });
      const order = response.data.data as SaleOrder;
      setLastOrder(order);
      setShowReceipt(true);
      resetActiveSale();
      await db.completedOrders.put({ ...order, synced_at: Date.now() });
      await syncStockBalances(branchId ?? undefined);
      toast({ title: "ชำระเงินสำเร็จ" });
    } catch (error) {
      toast({ title: "ชำระเงินไม่สำเร็จ", description: error instanceof Error ? error.message : "ลองใหม่อีกครั้ง" });
    } finally {
      setIsSubmitting(false);
    }
  }

  const quickAmounts = useMemo(() => {
    const exact = finalTotal;
    const ceil100 = Math.ceil(finalTotal / 100) * 100;
    const ceil500 = Math.ceil(finalTotal / 500) * 500;
    const ceil1000 = Math.ceil(finalTotal / 1000) * 1000;
    return [exact, ceil100, ceil500, ceil1000].filter((value, index, list) => list.indexOf(value) === index);
  }, [finalTotal]);
  const currentLocationName = useMemo(
    () => locations.find((location) => location.id === currentShift?.location_id)?.name ?? "ยังไม่เลือกคลัง",
    [currentShift?.location_id, locations],
  );
  const visibleLowStockCount = useMemo(
    () => visibleProducts.filter((product) => {
      const stock = getAvailableStock(product.id);
      return stock > 0 && stock <= 5;
    }).length,
    [visibleProducts, stockByProduct],
  );
  const paymentLabel = useMemo(() => {
    return paymentMethodLabels[paymentMethod] ?? "อื่นๆ";
  }, [paymentMethod]);
  const amountDue = Math.max(finalTotal - currentPaidAmount, 0);
  const heldBills = heldBillsQuery.data ?? [];
  const replacementRules = replacementRulesQuery.data ?? [];
  const recentSales = recentSalesQuery.data ?? [];
  const recentSalesDateRangeInvalid = recentSalesScope === "branch_history" && recentSalesDateFrom && recentSalesDateTo && recentSalesDateTo < recentSalesDateFrom;
  const recentSalesEmptyMessage = useMemo(() => {
    if (recentSalesDateRangeInvalid) {
      return "กรุณาเลือกช่วงวันที่ให้วันสิ้นสุดไม่น้อยกว่าวันเริ่มต้น";
    }
    if (!isOnline) {
      return "ต้องเชื่อมต่อออนไลน์ก่อนจึงจะค้นบิลย้อนหลังเพื่อพิมพ์ซ้ำได้";
    }
    if (recentSalesScope === "current_shift") {
      return "ยังไม่มีออเดอร์ในกะนี้";
    }
    return "ไม่พบบิลย้อนหลังตามเงื่อนไขที่ค้นหา";
  }, [isOnline, recentSalesDateRangeInvalid, recentSalesScope]);
  const branchSettings = branchSettingsQuery.data;
  const canApplyDiscount = hasPermission("pos.discount.apply") || hasPermission("pos.discount.override");
  const canOverrideDiscount = hasPermission("pos.discount.override");
  const canVoidSale = hasPermission("pos.sale.void");
  const canRefundSale = hasPermission("pos.refund.create");
  const canManageCentralReplacementRules = hasPermission("system.branch.edit");
  const discountAllowed = (branchSettings?.pos_allow_discount ?? true) && canApplyDiscount;
  const maxDiscountPct = branchSettings?.pos_max_discount_pct ?? 100;
  const maxDiscountAmount = (cart.subtotal * maxDiscountPct) / 100;
  const refundableStatuses: SaleOrder["status"][] = ["completed", "partially_refunded"];
  const paymentAuditSummary = useMemo(() => {
    const totals = new Map<string, number>();
    recentSales
      .filter((order) => order.status === "completed" || order.status === "partially_refunded" || order.status === "refunded")
      .forEach((order) => {
        order.payments.forEach((payment) => {
          totals.set(payment.payment_method, (totals.get(payment.payment_method) ?? 0) + Number(payment.amount));
        });
      });
    return Array.from(totals.entries()).map(([method, amount]) => ({
      method: paymentMethodLabels[method as PaymentMethod] ?? "อื่นๆ",
      amount,
    }));
  }, [recentSales]);
  const expectedCashNow = useMemo(() => {
    const cashPayments = recentSales
      .filter((order) => order.status === "completed" || order.status === "partially_refunded" || order.status === "refunded")
      .flatMap((order) => order.payments.filter((payment) => payment.payment_method === "cash"))
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const totalChange = recentSales
      .filter((order) => order.status === "completed" || order.status === "partially_refunded" || order.status === "refunded")
      .reduce((sum, order) => sum + Number(order.change_amount), 0);
    return Number(currentShift?.opening_cash ?? 0) + cashPayments - totalChange;
  }, [currentShift?.opening_cash, recentSales]);
  const partialRefundPreview = useMemo(() => {
    if (!partialRefundOrder) {
      return { amount: 0, itemCount: 0 };
    }
    let amount = 0;
    let itemCount = 0;
    partialRefundOrder.items.forEach((item) => {
      const requestedQty = Number(partialRefundQtys[item.id] ?? 0);
      if (!Number.isFinite(requestedQty) || requestedQty <= 0 || item.qty <= 0) {
        return;
      }
      const safeQty = Math.min(requestedQty, Math.max(Number(item.qty) - Number(item.refunded_qty ?? 0), 0));
      if (safeQty <= 0) {
        return;
      }
      const ratio = safeQty / Number(item.qty);
      const lineSubtotal = Number(item.subtotal) * ratio;
      const orderDiscountShare = partialRefundOrder.subtotal > 0
        ? Number(partialRefundOrder.discount_amount) * (lineSubtotal / Number(partialRefundOrder.subtotal))
        : 0;
      const excludedVat = item.vat_type === "excluded" ? Number(item.vat_amount) * ratio : 0;
      amount += lineSubtotal - orderDiscountShare + excludedVat;
      itemCount += 1;
    });
    return { amount: roundMoney(amount), itemCount };
  }, [partialRefundOrder, partialRefundQtys]);
  const historyRefundableAmount = historyOrder
    ? Math.max(Number(historyOrder.total_amount) - Number(historyOrder.refund_amount ?? 0), 0)
    : 0;
  const historySalePayments = historyOrder?.payments.filter((payment) => Number(payment.amount) >= 0) ?? [];
  const historyRefundPayments = historyOrder?.payments.filter((payment) => Number(payment.amount) < 0) ?? [];
  const historyTimeline = historyOrder ? buildOrderTimeline(historyOrder) : [];
  const historyNoteLines = historyOrder?.note?.split("\n").map((line) => line.trim()).filter(Boolean) ?? [];
  const historyAdditionalNotes = historyNoteLines.filter((line) => !line.startsWith("REFUND "));
  const exchangeNote = useMemo(() => {
    if (!exchangeContext) {
      return note || null;
    }
    const creditLine = `Exchange credit used: ${formatThaiCurrency(exchangeCreditApplied)}${exchangeCreditRemaining > 0 ? `, remaining ${formatThaiCurrency(exchangeCreditRemaining)}` : ""}`;
    const combined = [note?.trim() || "", creditLine].filter(Boolean).join("\n");
    return combined || null;
  }, [exchangeContext, exchangeCreditApplied, exchangeCreditRemaining, note]);
  const replacementRuleMap = useMemo(
    () => new Map(replacementRules.map((rule) => [rule.source_product_id, rule])),
    [replacementRules],
  );
  const centralReplacementRuleMap = useMemo(
    () => new Map((centralReplacementRulesQuery.data ?? []).map((rule) => [rule.source_product_id, rule])),
    [centralReplacementRulesQuery.data],
  );
  const exchangeSuggestedProducts = useMemo(() => {
    if (!exchangeContext || products.length === 0) {
      return [] as ProductListItem[];
    }
    const sourceProductIds = new Set((exchangeContext.source_items ?? []).map((item) => item.product_id));
    const sourceTokens = new Set(
      (exchangeContext.source_items ?? exchangeContext.refunded_items.map((productName) => ({ product_id: "", product_name: productName })))
        .flatMap((item) => tokenizeSearchTerms(item.product_name))
    );
    if (sourceTokens.size === 0) {
      return [] as ProductListItem[];
    }
    return [...products]
      .map((product) => {
        if (sourceProductIds.has(product.id)) {
          return { product, score: -1 };
        }
        const haystack = `${product.name} ${product.sku} ${product.barcode ?? ""}`.toLowerCase();
        let score = 0;
        sourceTokens.forEach((token) => {
          if (haystack.includes(token)) {
            score += product.name.toLowerCase().includes(token) ? 2 : 1;
          }
        });
        return { product, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)
      .map((entry) => entry.product);
  }, [exchangeContext, products]);
  const exchangeReplacementPlan = useMemo(() => {
    if (!exchangeContext?.source_items?.length || products.length === 0) {
      return [] as ReplacementPlanEntry[];
    }
    return exchangeContext.source_items.map((sourceItem) => {
      const centralRule = centralReplacementRuleMap.get(sourceItem.product_id);
      const centralCandidate = centralRule
        ? products.find((product) => product.id === centralRule.replacement_product_id && getAvailableStock(product.id) > 0) ?? null
        : null;
      if (centralCandidate) {
        return { source: sourceItem, candidate: centralCandidate, matchedSource: "central" as const };
      }
      const localRule = replacementRuleMap.get(sourceItem.product_id);
      const localCandidate = localRule
        ? products.find((product) => product.id === localRule.replacement_product_id && getAvailableStock(product.id) > 0) ?? null
        : null;
      if (localCandidate) {
        return { source: sourceItem, candidate: localCandidate, matchedSource: "local" as const };
      }
      const sourceProduct = products.find((product) => product.id === sourceItem.product_id);
      const sourceTokens = tokenizeSearchTerms(sourceItem.product_name);
      const sourcePrice = sourceProduct ? Number(sourceProduct.selling_price ?? 0) : 0;
      const bestCandidate = [...products]
        .filter((product) => product.id !== sourceItem.product_id && getAvailableStock(product.id) > 0)
        .map((product) => {
          const productTokens = tokenizeSearchTerms(product.name);
          const sharedTokens = sourceTokens.filter((token) => productTokens.includes(token)).length;
          const sameCategory = sourceProduct?.category_id && sourceProduct.category_id === product.category_id ? 3 : 0;
          const priceDelta = sourcePrice > 0 ? Math.abs(Number(product.selling_price ?? 0) - sourcePrice) / sourcePrice : 1;
          const priceScore = sourcePrice > 0 ? Math.max(0, 2 - priceDelta * 4) : 0;
          return {
            product,
            score: sameCategory + sharedTokens * 2 + priceScore,
          };
        })
        .sort((left, right) => right.score - left.score)
        .find((entry) => entry.score > 0)?.product ?? null;

      return { source: sourceItem, candidate: bestCandidate, matchedSource: "suggested" as const };
    });
  }, [centralReplacementRuleMap, exchangeContext, products, replacementRuleMap, stockByProduct]);

  return (
    <div className="pos-page flex min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.16),_transparent_28%),linear-gradient(180deg,_#fffaf0_0%,_#f8fafc_42%,_#eef2ff_100%)] xl:h-screen">
      <div className="flex flex-1 flex-col xl:overflow-hidden">
        <div className="pos-shell-header border-b border-slate-200/80 bg-white/85 px-6 py-4 backdrop-blur">
          <div className="pos-header-top flex flex-wrap items-start gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-600">Front Counter</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">ERP-POS</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">{branchName}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">{currentLocationName}</span>
                {currentShift ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
                    {currentShift.shift_number} • {new Date(currentShift.opened_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                ) : null}
                <span className={`rounded-full px-3 py-1 font-medium ${isOnline ? "bg-blue-50 text-blue-700" : "bg-red-100 text-red-700"}`}>
                  {isOnline ? "ONLINE" : "OFFLINE"}
                </span>
              </div>
            </div>
            <div className="pos-header-stats grid min-w-[320px] flex-1 gap-2 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">สินค้าแสดงผล</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{visibleProducts.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">ใกล้หมดในหน้า</div>
                <div className="mt-1 text-lg font-semibold text-amber-700">{visibleLowStockCount}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">ยอดสุทธิรอชำระ</div>
                <div className="mt-1 text-lg font-semibold text-blue-700">{formatThaiCurrency(finalTotal)}</div>
              </div>
            </div>
          </div>
          <div className="pos-header-actions ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={() => setRecentSalesOpen(true)} disabled={!currentShift}>
              ออเดอร์ล่าสุด
            </Button>
            <Button variant="outline" onClick={() => setCloseShiftOpen(true)} disabled={!currentShift}>ปิดกะ</Button>
            <Button
              variant="outline"
              onClick={() => {
                if (cart.items.length > 0 && !window.confirm("มีสินค้าอยู่ในตะกร้า ต้องการย้อนกลับหรือไม่")) {
                  return;
                }
                navigate("/dashboard");
              }}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              กลับ
            </Button>
          </div>
        </div>

        <div className="pos-main-shell flex flex-1 flex-col xl:overflow-hidden xl:flex-row">
          <div className="pos-catalog-pane flex flex-1 flex-col p-4 md:p-6 xl:overflow-hidden">
            <div className="rounded-[28px] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur">
              <div className="pos-search-toolbar flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                  <input
                    ref={searchRef}
                    className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm shadow-sm"
                    placeholder="ค้นหาสินค้า / สแกนบาร์โค้ด / ยิง QR"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleBarcodeLookup();
                      }
                    }}
                    autoFocus
                  />
                </div>
                <div className="pos-search-actions flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl px-4"
                    onClick={() => {
                      setScannerError("");
                      setScannerOpen(true);
                    }}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    เปิดกล้องสแกน
                  </Button>
                  <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-4 text-xs text-slate-500">
                    Enter = เพิ่มสินค้า, F1 = โฟกัสค้นหา, F2 = ช่องเงินสด
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm ${selectedCategory === "" ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
                onClick={() => setSelectedCategory("")}
              >
                ทั้งหมด
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm ${selectedCategory === category.id ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>

            {exchangeContext && exchangeSuggestedProducts.length > 0 ? (
              <div className="mt-4 rounded-[28px] border border-amber-200 bg-amber-50/80 p-4 shadow-[0_16px_40px_rgba(180,83,9,0.08)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">Replacement Ideas</div>
                    <div className="mt-1 text-lg font-semibold text-amber-950">สินค้าแนะนำสำหรับบิลแลก</div>
                    <div className="mt-1 text-sm text-amber-800">
                      เลือกจากรายการที่ชื่อใกล้เคียงกับสินค้าที่เพิ่งคืนได้ทันที
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="border-amber-300 bg-white text-amber-800"
                      onClick={() => {
                        const firstItem = exchangeContext.refunded_items[0];
                        if (firstItem) {
                          setSearch(firstItem);
                          setSearchTerm(firstItem);
                          searchRef.current?.focus();
                        }
                      }}
                    >
                      ค้นหาชื่อเดิม
                    </Button>
                    <Button
                      className="bg-amber-600 text-white hover:bg-amber-700"
                      onClick={handleApplyReplacementPreset}
                      disabled={exchangeReplacementPlan.every((entry) => !entry.candidate)}
                    >
                      เติมสินค้าทดแทนอัตโนมัติ
                    </Button>
                  </div>
                </div>
                {exchangeReplacementPlan.some((entry) => entry.candidate) ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-white/80 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-700">Replacement Preset</div>
                    <div className="mt-3 space-y-3">
                      {exchangeReplacementPlan.map((entry) => (
                        <div key={`replacement-plan-${entry.source.product_id}`} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <div className="text-xs text-slate-500">คืนสินค้าเดิม</div>
                            <div className="font-medium text-slate-900">{entry.source.product_name} x{Math.max(1, Math.floor(Number(entry.source.qty ?? 1)))}</div>
                          </div>
                          {entry.candidate ? (
                            <div className="flex flex-col gap-2 md:items-end">
                              <div className="text-sm text-amber-800">
                                แนะนำแทนด้วย <span className="font-semibold">{entry.candidate.name}</span>
                                {entry.matchedSource === "central" ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">กฎส่วนกลาง</span> : null}
                                {entry.matchedSource === "local" ? <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">กฎ local</span> : null}
                              </div>
                              <div className="flex flex-wrap gap-2 md:justify-end">
                                <Button
                                  variant="outline"
                                  className="border-amber-300 bg-white text-amber-800"
                                  onClick={() => addToCart(entry.candidate as ProductListItem, Math.max(1, Math.floor(Number(entry.source.qty ?? 1))))}
                                >
                                  เพิ่มสินค้าทดแทนนี้
                                </Button>
                                {entry.matchedSource === "suggested" ? (
                                  <Button
                                    variant="outline"
                                    className="border-slate-300 bg-white text-slate-700"
                                    onClick={() => void handleSaveReplacementRule(entry.source, entry.candidate as ProductListItem)}
                                  >
                                    {canManageCentralReplacementRules && isOnline ? "บันทึกเป็นกฎส่วนกลาง" : "จำเป็นตัวแทนหลักในเครื่องนี้"}
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline"
                                    className="border-slate-300 bg-white text-slate-700"
                                    onClick={() => void handleDeleteReplacementRule(entry.source.product_id, entry.matchedSource)}
                                  >
                                    {entry.matchedSource === "central" ? "ลบกฎส่วนกลาง" : "ล้างกฎ local"}
                                  </Button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm text-slate-500">
                              {centralReplacementRuleMap.get(entry.source.product_id)
                                ? "มีกฎส่วนกลางเดิมอยู่ แต่สินค้าทดแทนไม่พร้อมขายตอนนี้"
                                : replacementRuleMap.get(entry.source.product_id)
                                ? "มีกฎ local เดิมอยู่ แต่สินค้าทดแทนไม่พร้อมขายตอนนี้"
                                : "ยังไม่มีตัวแทนที่ตรงพอในระบบ"}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {exchangeSuggestedProducts.map((product) => {
                    const stock = getAvailableStock(product.id);
                    return (
                      <button
                        key={`exchange-suggestion-${product.id}`}
                        type="button"
                        disabled={stock <= 0}
                        onClick={() => addToCart(product)}
                        className="rounded-2xl border border-amber-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="line-clamp-2 text-sm font-semibold text-slate-900">{product.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{product.sku}</div>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${stock <= 5 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"}`}>
                            {stock <= 5 ? `เหลือ ${stock}` : "พร้อมขาย"}
                          </span>
                        </div>
                        <div className="mt-3 text-base font-semibold text-amber-700">{formatThaiCurrency(Number(product.selling_price))}</div>
                        <div className="mt-2 text-xs text-slate-500">กดเพื่อเพิ่มเป็นสินค้าทดแทน</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="pos-product-grid mt-6 grid flex-1 grid-cols-2 gap-3 md:grid-cols-3 xl:overflow-y-auto xl:grid-cols-4">
              {visibleProducts.map((product) => {
                const stock = getAvailableStock(product.id);
                const stockLabel = stock <= 0 ? "หมด" : stock <= 5 ? "ใกล้หมด" : `เหลือ ${stock}`;
                const stockStyle = stock <= 0 ? "bg-red-100 text-red-700" : stock <= 5 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700";
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={stock <= 0}
                    onClick={() => addToCart(product)}
                    className="flex items-start gap-3 rounded-3xl border border-white/70 bg-white/90 p-4 text-left shadow-[0_16px_40px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_20px_48px_rgba(37,99,235,0.16)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                      {product.image_url ? <img src={product.image_url} alt={product.name} className="h-10 w-10 rounded-xl object-cover" /> : <ShoppingCart className="h-4 w-4 text-slate-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium text-slate-900">{product.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{product.sku}{product.barcode ? ` • ${product.barcode}` : ""}</p>
                      <p className="mt-2 text-base font-semibold text-blue-600">{formatThaiCurrency(Number(product.selling_price))}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {product.vat_type === "included" ? `รวม VAT ${Number(product.vat_rate)}%` : product.vat_type === "excluded" ? `VAT ${Number(product.vat_rate)}% แยกนอก` : "ยกเว้น VAT"}
                      </p>
                      <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-medium ${stockStyle}`}>{stockLabel}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="pos-cart-pane flex w-full flex-col border-t border-slate-200/80 bg-white/92 backdrop-blur xl:w-[28rem] xl:border-l xl:border-t-0 xl:max-h-none">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900">ตะกร้า</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{cart.items.length}</span>
                <button
                  type="button"
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                  onClick={() => setHeldBillsOpen(true)}
                >
                  พักไว้ {heldBills.length}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-sm text-amber-700"
                  onClick={() => void handleHoldBill()}
                  disabled={cart.items.length === 0 || !currentShift}
                >
                  พักบิล
                </button>
                <button type="button" className="text-sm text-slate-500" onClick={() => window.confirm("ล้างตะกร้าหรือไม่") && resetActiveSale()}>ล้าง</button>
              </div>
            </div>

            <div className="pos-cart-body">
            <div className="pos-cart-scroll flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <div className="pos-step-grid grid grid-cols-3 gap-2">
                <div className={`rounded-2xl border px-3 py-3 text-xs ${cart.items.length > 0 ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                  <div className="font-semibold uppercase tracking-[0.2em]">1</div>
                  <div className="mt-1">เลือกสินค้า</div>
                </div>
                <div className={`rounded-2xl border px-3 py-3 text-xs ${selectedCustomer || customerName || customerPhone ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                  <div className="font-semibold uppercase tracking-[0.2em]">2</div>
                  <div className="mt-1">ข้อมูลลูกค้า</div>
                </div>
                <div className={`rounded-2xl border px-3 py-3 text-xs ${finalTotal > 0 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                  <div className="font-semibold uppercase tracking-[0.2em]">3</div>
                  <div className="mt-1">รับชำระเงิน</div>
                </div>
              </div>
              {exchangeContext ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">กำลังทำบิลแลกสินค้า</div>
                      <div className="mt-1 text-xs text-amber-700">
                        อ้างอิง {exchangeContext.source_order_number} • คืนแล้ว {formatThaiCurrency(exchangeContext.refund_amount)}
                      </div>
                      <div className="mt-1 text-xs text-amber-700">
                        {exchangeContext.refunded_items.length > 0 ? "สินค้าเดิมที่คืน:" : ""}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {exchangeContext.refunded_items.map((itemName) => (
                          <button
                            key={itemName}
                            type="button"
                            className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs text-amber-800"
                            onClick={() => {
                              setSearch(itemName);
                              setSearchTerm(itemName);
                              searchRef.current?.focus();
                            }}
                          >
                            {itemName}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-xs font-medium text-amber-700"
                      onClick={() => setExchangeContext(null)}
                    >
                      ปิดโหมดนี้
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-700">สมาชิก</div>
                  <Input placeholder="ค้นหาสมาชิก (เบอร์โทร/ชื่อ)" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} />
                  {(customerSearchQuery.data ?? []).length > 0 && !selectedCustomer ? (
                    <div className="space-y-2 rounded-lg border bg-slate-50 p-2">
                      {(customerSearchQuery.data ?? []).map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          className="w-full rounded-md border bg-white px-3 py-2 text-left text-sm"
                          onClick={async () => {
                            const response = await crmApi.getCustomer(customer.id);
                            const fullCustomer = response.data.data as Customer;
                            setSelectedCustomer(fullCustomer);
                            setCustomerName(fullCustomer.display_name || [fullCustomer.first_name, fullCustomer.last_name].filter(Boolean).join(" "));
                            setCustomerPhone(fullCustomer.phone || "");
                            setCustomerTaxId(fullCustomer.tax_id || "");
                            setCustomerSearch("");
                            setDebouncedCustomerSearch("");
                          }}
                        >
                          <div className="font-medium">{customer.customer_code} • {customer.display_name || "-"}</div>
                          <div className="text-xs text-slate-500">{customer.phone || "-"} • {customer.tier_name || "-"} • {customer.points_balance} ⭐</div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {selectedCustomer ? (
                    <div className="rounded-lg border bg-blue-50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">{selectedCustomer.display_name || [selectedCustomer.first_name, selectedCustomer.last_name].filter(Boolean).join(" ")}</div>
                          <div className="text-xs text-slate-500">{selectedCustomer.tier?.name ?? "-"} • แต้ม {selectedCustomer.points_balance} ⭐</div>
                        </div>
                        <button
                          type="button"
                          className="text-sm text-slate-500"
                          onClick={() => {
                            setSelectedCustomer(null);
                            setLoyaltyDiscount(0);
                            setCustomerSearch("");
                            setDebouncedCustomerSearch("");
                          }}
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <button type="button" className="text-sm text-blue-600" onClick={() => setCreateCustomerOpen(true)}>เพิ่มสมาชิกใหม่</button>
                  <div className="grid gap-3 pt-2">
                    <Input placeholder="ชื่อลูกค้า / ชื่อออกใบเสร็จ" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
                    <div className="pos-customer-fields grid grid-cols-2 gap-3">
                      <Input placeholder="เบอร์โทร" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
                      <Input placeholder="เลขผู้เสียภาษี" value={customerTaxId} onChange={(event) => setCustomerTaxId(event.target.value)} />
                    </div>
                    <textarea
                      className="min-h-20 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      placeholder="หมายเหตุในบิล"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </div>
                </div>
              </div>
              {cart.items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
                  <ShoppingCart className="mb-3 h-10 w-10" />
                  <p>ยังไม่มีสินค้า</p>
                </div>
              ) : (
                cart.items.map((item) => (
                  <div key={`${item.product_id}:${item.variant_id ?? "base"}`} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{item.product_name}</p>
                        {item.variant_name ? <p className="text-xs text-slate-500">{item.variant_name}</p> : null}
                        <p className="text-xs text-slate-500">
                          {item.vat_type === "included" ? `ราคารวม VAT ${item.vat_rate}%` : item.vat_type === "excluded" ? `VAT ${item.vat_rate}% แยกนอก` : "ยกเว้น VAT"}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          ราคาปกติ {formatThaiCurrency(item.original_price)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {canOverrideDiscount ? (
                          <button
                            type="button"
                            className="text-xs text-blue-600"
                            onClick={() => openPriceEditor(item)}
                          >
                            แก้ราคา
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="text-sm text-slate-400"
                          onClick={() => updateCartItem(item.product_id, () => null)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="h-8 w-8 rounded-md border border-slate-300"
                          onClick={() =>
                            updateCartItem(item.product_id, (current) =>
                              current.qty <= 1
                                ? null
                                : { ...current, qty: current.qty - 1, subtotal: (current.qty - 1) * current.unit_price }
                            )
                          }
                        >
                          -
                        </button>
                        <input
                          type="number"
                          className="h-8 w-16 rounded-md border border-slate-300 text-center"
                          value={item.qty}
                          min={1}
                          max={getAvailableStock(item.product_id, item.variant_id)}
                          onChange={(event) =>
                            updateCartItem(item.product_id, (current) => ({
                              ...current,
                              qty: Math.max(1, Math.min(Number(event.target.value), getAvailableStock(item.product_id, item.variant_id))),
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="h-8 w-8 rounded-md border border-slate-300"
                          onClick={() =>
                            updateCartItem(item.product_id, (current) => ({
                              ...current,
                              qty: Math.min(current.qty + 1, getAvailableStock(item.product_id, item.variant_id)),
                            }))
                          }
                        >
                          +
                        </button>
                      </div>
                      <div className="text-right text-sm">
                        <p>{formatThaiCurrency(item.unit_price)}</p>
                        <p className="font-semibold">{formatThaiCurrency(item.qty * item.unit_price)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pos-checkout-pane space-y-4 border-t border-slate-200 px-5 py-4">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span>ยอดรวม</span><span>{formatThaiCurrency(cart.subtotal)}</span></div>
                  <div className="flex items-center justify-between gap-3">
                    <span>ส่วนลด</span>
                    <input
                      type="number"
                      className="h-9 w-28 rounded-md border border-slate-300 bg-white px-2 text-right disabled:bg-slate-100 disabled:text-slate-400"
                      value={orderDiscount}
                      disabled={!discountAllowed}
                      onChange={(event) => handleOrderDiscountChange(Number(event.target.value))}
                    />
                  </div>
                  <div className="text-xs text-slate-500">
                    {discountAllowed
                      ? canOverrideDiscount
                        ? "คุณมีสิทธิ์ override ส่วนลดได้"
                        : `ส่วนลดสูงสุด ${maxDiscountPct}% (${formatThaiCurrency(maxDiscountAmount)})`
                      : canApplyDiscount
                        ? "สาขานี้ปิดการให้ส่วนลดไว้"
                        : "คุณไม่มีสิทธิ์ให้ส่วนลดใน POS"}
                  </div>
                  {loyaltyDiscount > 0 ? <div className="flex justify-between text-emerald-700"><span>ส่วนลดแต้ม</span><span>- {formatThaiCurrency(loyaltyDiscount)}</span></div> : null}
                  {exchangeCreditApplied > 0 ? (
                    <div className="flex justify-between text-amber-700">
                      <span>เครดิตแลกสินค้า</span>
                      <span>- {formatThaiCurrency(exchangeCreditApplied)}</span>
                    </div>
                  ) : null}
                  {exchangeContext && exchangeCreditRemaining > 0 ? (
                    <div className="flex justify-between text-xs text-amber-700">
                      <span>เครดิตคงเหลือหลังบิลนี้</span>
                      <span>{formatThaiCurrency(exchangeCreditRemaining)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between"><span>VAT ในสินค้า</span><span>{formatThaiCurrency(vatIncludedAmount)}</span></div>
                  {vatExcludedAmount > 0 ? <div className="flex justify-between"><span>VAT แยกนอก</span><span>{formatThaiCurrency(vatExcludedAmount)}</span></div> : null}
                  {vatExemptSubtotal > 0 ? <div className="flex justify-between text-slate-500"><span>สินค้ายกเว้น VAT</span><span>{formatThaiCurrency(vatExemptSubtotal)}</span></div> : null}
                  <div className="mt-3 rounded-2xl bg-blue-600 px-4 py-3 text-white shadow-sm">
                    <div className="text-xs uppercase tracking-[0.25em] text-blue-100">ยอดสุทธิ</div>
                    <div className="mt-1 text-2xl font-semibold">{formatThaiCurrency(finalTotal)}</div>
                  </div>
                </div>
              </div>
              {selectedCustomer && loyaltySettingsQuery.data?.enabled ? (
                <Button variant="outline" onClick={() => setRedeemOpen(true)}>แลกแต้มส่วนลด</Button>
              ) : null}

              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-500">ช่องทางชำระเงิน</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{paymentLabel}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-3 py-2 text-right text-xs text-slate-500">
                    <div>ค้างชำระ</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{formatThaiCurrency(amountDue)}</div>
                    {exchangeCreditApplied > 0 ? (
                      <div className="mt-1 text-[11px] text-amber-700">ใช้เครดิตแลกแล้ว {formatThaiCurrency(exchangeCreditApplied)}</div>
                    ) : null}
                  </div>
                </div>

              <div className="pos-payment-methods grid grid-cols-2 gap-2">
                {(["cash", "promptpay", "credit_card", "bank_transfer", "other"] as PaymentMethod[]).map((method) => (
                  <button
                    key={method}
                    type="button"
                    className={`rounded-xl border px-3 py-2 text-sm ${paymentMethod === method ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700"}`}
                    onClick={() => setPaymentMethod(method)}
                  >
                    {method === "cash" ? "เงินสด" : method === "promptpay" ? "PromptPay" : method === "credit_card" ? "บัตรเครดิต" : method === "bank_transfer" ? "โอนเงิน" : "อื่นๆ"}
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-2xl border border-dashed border-slate-200 p-3">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>เปิด split payment</span>
                  <input
                    type="checkbox"
                    checked={splitPaymentEnabled}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setSplitPaymentEnabled(next);
                      if (!next) {
                        setSecondaryPaymentAmount(0);
                        setSecondaryPaymentReference("");
                      }
                    }}
                  />
                </label>
                {splitPaymentEnabled ? (
                  <div className="mt-3 space-y-3">
                    <div className="pos-payment-methods grid grid-cols-2 gap-2">
                      {(["promptpay", "credit_card", "bank_transfer", "other"] as PaymentMethod[]).map((method) => (
                        <button
                          key={method}
                          type="button"
                          className={`rounded-xl border px-3 py-2 text-sm ${secondaryPaymentMethod === method ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-300 bg-white text-slate-700"}`}
                          onClick={() => setSecondaryPaymentMethod(method)}
                        >
                          {method === "promptpay" ? "PromptPay" : method === "credit_card" ? "บัตรเครดิต" : method === "bank_transfer" ? "โอนเงิน" : "อื่นๆ"}
                        </button>
                      ))}
                    </div>
                    <Input
                      type="number"
                      value={secondaryPaymentAmount}
                      onChange={(event) => setSecondaryPaymentAmount(Number(event.target.value))}
                      placeholder="ยอดชำระช่องทางที่ 2"
                    />
                    {secondaryPaymentMethod === "credit_card" || secondaryPaymentMethod === "bank_transfer" ? (
                      <Input
                        type="text"
                        value={secondaryPaymentReference}
                        onChange={(event) => setSecondaryPaymentReference(event.target.value)}
                        placeholder="เลขอ้างอิงช่องทางที่ 2"
                      />
                    ) : null}
                    <div className="text-xs text-slate-500">
                      ยอดคงเหลือของช่องทางหลัก: {formatThaiCurrency(primaryDueAmount)}
                    </div>
                  </div>
                ) : null}
              </div>
              </div>

              {paymentMethod === "cash" ? (
                <div className="space-y-3 rounded-3xl border border-slate-200 bg-emerald-50/80 p-4">
                  <input
                    ref={cashInputRef}
                    type="number"
                    className="h-12 w-full rounded-xl border border-emerald-200 bg-white px-3 text-right text-xl font-semibold"
                    value={paidAmount}
                    onChange={(event) => setPaidAmount(Number(event.target.value))}
                  />
                  <div className="pos-quick-amounts grid grid-cols-2 gap-2">
                    {quickAmounts.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        onClick={() => setPaidAmount(value)}
                      >
                        {formatThaiCurrency(value)}
                      </button>
                    ))}
                  </div>
                  <div className={`rounded-xl px-4 py-3 text-lg font-semibold ${currentPaidAmount >= finalTotal ? "bg-green-100 text-green-700" : "bg-red-50 text-red-700"}`}>
                    {currentPaidAmount >= finalTotal ? `เงินทอน: ${formatThaiCurrency(changeAmount)}` : `ยังขาด: ${formatThaiCurrency(amountDue)}`}
                  </div>
                </div>
              ) : null}

              {paymentMethod === "promptpay" ? (
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-center">
                  {qrDataUrl ? <img src={qrDataUrl} alt="PromptPay QR" className="mx-auto h-48 w-48" /> : <WifiOff className="mx-auto h-10 w-10 text-slate-400" />}
                  <p className="mt-3 text-sm text-slate-500">ให้ลูกค้าสแกนยอด {formatThaiCurrency(promptPayAmount)}</p>
                  <p className="mt-1 text-xs text-slate-400">{promptPayTarget}</p>
                  <Button variant="outline" className="mt-3" onClick={() => setQrDataUrl("")}>รีเฟรช QR</Button>
                </div>
              ) : null}

              {paymentMethod === "credit_card" || paymentMethod === "bank_transfer" ? (
                <input
                  type="text"
                  className="h-11 w-full rounded-xl border border-slate-300 px-3"
                  placeholder={paymentMethod === "credit_card" ? "เลขอ้างอิงบัตร" : "เลขอ้างอิงการโอน"}
                  value={creditRef}
                  onChange={(event) => setCreditRef(event.target.value)}
                />
              ) : null}

              <Button
                className="h-12 w-full rounded-2xl bg-green-600 text-base hover:bg-green-700"
                disabled={
                  cart.items.length === 0 ||
                  !currentShift ||
                  (paymentMethod === "cash" && currentPaidAmount < finalTotal) ||
                  isSubmitting
                }
                onClick={() => void handleCheckout()}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                ชำระเงิน {formatThaiCurrency(finalTotal)}
              </Button>
            </div>
            </div>
          </aside>
        </div>
      </div>

      <Dialog open={shiftGateOpen} onOpenChange={setShiftGateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เปิดกะก่อนเริ่มขาย</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">คลังสินค้า</label>
              <select
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                value={selectedLocationId}
                onChange={(event) => setSelectedLocationId(event.target.value)}
              >
                <option value="">เลือกคลัง</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">เงินเปิดลิ้นชัก</label>
              <input
                type="number"
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                value={openingCash}
                onChange={(event) => setOpeningCash(Number(event.target.value))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void handleOpenShift()} disabled={!selectedLocationId}>เปิดกะ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {currentShift ? (
        <CloseShiftDialog
          open={closeShiftOpen}
          onOpenChange={setCloseShiftOpen}
          shift={currentShift}
          expectedCashNow={expectedCashNow}
          paymentSummary={paymentAuditSummary}
          onConfirm={handleCloseShift}
        />
      ) : null}

      <Dialog open={showReceipt} onOpenChange={setShowReceipt}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>ใบเสร็จ</DialogTitle>
          </DialogHeader>
          {lastOrder ? (
            <ReceiptView
              ref={receiptRef}
              order={lastOrder}
              company={{ name: "ERP-POS", phone: "0812345678" }}
              branch={{ name: branchName }}
              cashier={user?.display_name ?? user?.username ?? "Cashier"}
            />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => void handlePrint()}>พิมพ์</Button>
            <Button onClick={() => setShowReceipt(false)}>ขายต่อ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={heldBillsOpen} onOpenChange={setHeldBillsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>บิลที่พักไว้</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="ตั้งชื่อบิลก่อนพัก เช่น โต๊ะ 2 / ลูกค้าฝากไว้ / คิวถัดไป"
              value={holdLabel}
              onChange={(event) => setHoldLabel(event.target.value)}
            />
            {heldBills.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                ยังไม่มีบิลที่พักไว้
              </div>
            ) : (
              <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
                {heldBills.map((draft) => {
                  const itemCount = draft.items.reduce((sum, item) => sum + item.qty, 0);
                  const draftTotal = draft.items.reduce((sum, item) => sum + item.subtotal, 0) - draft.order_discount - draft.loyalty_discount;
                  return (
                    <div key={draft.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-semibold text-slate-900">{draft.label}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            {draft.customer_name || "ลูกค้าทั่วไป"} • {itemCount} ชิ้น • {formatThaiCurrency(Math.max(draftTotal, 0))}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            พักไว้ {new Date(draft.held_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => void handleDeleteHeldBill(draft.id)}>ลบ</Button>
                          <Button onClick={() => void handleResumeHeldBill(draft)}>เรียกบิลกลับ</Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHeldBillsOpen(false)}>ปิด</Button>
            <Button onClick={() => void handleHoldBill()} disabled={cart.items.length === 0 || !currentShift}>
              พักบิลปัจจุบัน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={recentSalesOpen} onOpenChange={setRecentSalesOpen}>
        <DialogContent className="pos-reprint-dialog max-w-3xl">
          <DialogHeader>
            <DialogTitle>Receipt Reprint / บิลย้อนหลัง</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[1.1fr_1.4fr_1fr_1fr]">
              <select
                className="h-10 rounded-md border border-gray-300 px-3 text-sm"
                value={recentSalesScope}
                onChange={(event) => setRecentSalesScope(event.target.value as "current_shift" | "branch_history")}
              >
                <option value="current_shift">เฉพาะกะนี้</option>
                <option value="branch_history">ย้อนหลังทั้งสาขา</option>
              </select>
              <Input
                value={recentSalesSearch}
                onChange={(event) => setRecentSalesSearch(event.target.value)}
                placeholder="ค้นหาเลขบิล, ลูกค้า, เบอร์โทร, เลขผู้เสียภาษี, เลขกะ"
                disabled={recentSalesScope === "current_shift"}
              />
              <Input
                type="date"
                value={recentSalesDateFrom}
                onChange={(event) => setRecentSalesDateFrom(event.target.value)}
                disabled={recentSalesScope === "current_shift"}
              />
              <Input
                type="date"
                value={recentSalesDateTo}
                onChange={(event) => setRecentSalesDateTo(event.target.value)}
                disabled={recentSalesScope === "current_shift"}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {recentSalesScope === "current_shift"
                  ? "แสดงออเดอร์ล่าสุดเฉพาะกะที่กำลังใช้งาน"
                  : "ค้นย้อนหลังข้ามกะภายในสาขาปัจจุบันเพื่อเปิดบิลและพิมพ์ซ้ำ"}
              </span>
              <span>
                {recentSalesDateRangeInvalid
                  ? "ช่วงวันที่ไม่ถูกต้อง"
                  : recentSalesQuery.isFetching
                    ? "กำลังโหลด..."
                    : `พบ ${recentSales.length} บิล`}
              </span>
            </div>
            {recentSalesQuery.isError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                ค้นบิลย้อนหลังไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
              </div>
            ) : null}
            {recentSales.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                {recentSalesEmptyMessage}
              </div>
            ) : (
              <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
                {recentSales.map((order) => (
                  <div key={order.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    {(() => {
                      const refundedAmount = Number(order.refund_amount ?? 0);
                      const remainingRefund = Math.max(Number(order.total_amount) - refundedAmount, 0);
                      const refundableItemCount = order.items.filter((item) => Number(item.qty) - Number(item.refunded_qty ?? 0) > 0).length;
                      const timelinePreview = buildOrderTimeline(order).slice(0, 2);
                      return (
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold text-slate-900">{order.order_number}</div>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${getOrderStatusBadgeClass(order.status)}`}>
                            {getOrderStatusLabel(order.status)}
                          </span>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${order.is_offline ? "bg-slate-200 text-slate-700" : "bg-blue-100 text-blue-700"}`}>
                            {order.is_offline ? "offline" : "online"}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          {order.customer_name || "ลูกค้าทั่วไป"} • {formatThaiCurrency(order.total_amount)} • {formatThaiDate(order.created_at)}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          {order.shift_number ? <span className="rounded-full bg-white px-3 py-1 font-medium text-slate-600">กะ {order.shift_number}</span> : null}
                          {order.location_name ? <span className="rounded-full bg-white px-3 py-1 font-medium text-slate-600">{order.location_name}</span> : null}
                          <span className="rounded-full bg-white px-3 py-1 font-medium text-slate-600">{order.items.length} รายการ</span>
                        </div>
                        {refundedAmount > 0 ? (
                          <div className="mt-2 text-xs text-amber-700">
                            คืนแล้ว {formatThaiCurrency(refundedAmount)} • คงเหลือคืนได้ {formatThaiCurrency(remainingRefund)}
                          </div>
                        ) : null}
                        {timelinePreview.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {timelinePreview.map((event) => (
                              <span
                                key={event.id}
                                className={`rounded-full px-3 py-1 text-[11px] font-medium ${getTimelineEventBadgeClass(event.type)}`}
                              >
                                {event.title}
                                {typeof event.amount === "number" ? ` • ${formatThaiCurrency(event.amount)}` : ""}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="pos-reprint-actions flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setHistoryOrder(order);
                          }}
                        >
                          รายละเอียด
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setLastOrder(order);
                            setShowReceipt(true);
                            setRecentSalesOpen(false);
                            }}
                          >
                          พิมพ์ซ้ำ
                        </Button>
                        {canVoidSale && order.status === "completed" ? (
                          <Button variant="outline" onClick={() => { setVoidOrder(order); setVoidReason(""); }}>
                            Void บิล
                          </Button>
                        ) : null}
                        {canRefundSale && refundableStatuses.includes(order.status) && refundableItemCount > 0 ? (
                          <Button
                            variant="outline"
                          onClick={() => {
                              const nextQtys = Object.fromEntries(
                                order.items.map((item) => [item.id, ""])
                              ) as Record<string, string>;
                              setPartialRefundOrder(order);
                              setPartialRefundReason("");
                              setPartialRefundQtys(nextQtys);
                            }}
                          >
                            คืนบางรายการ / แลก
                          </Button>
                        ) : null}
                        {canRefundSale && refundableStatuses.includes(order.status) && remainingRefund > 0 ? (
                          <Button variant="outline" onClick={() => { setRefundOrder(order); setRefundReason(""); }}>
                            คืนทั้งหมด
                          </Button>
                        ) : null}
                      </div>
                    </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecentSalesOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(historyOrder)} onOpenChange={(open) => { if (!open) setHistoryOrder(null); }}>
        <DialogContent className="pos-history-dialog max-w-4xl">
          <DialogHeader>
            <DialogTitle>รายละเอียดบิลย้อนหลัง</DialogTitle>
          </DialogHeader>
          {historyOrder ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">บิล</div>
                  <div className="mt-1 font-semibold text-slate-900">{historyOrder.order_number}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatThaiDate(historyOrder.created_at)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">สถานะ</div>
                  <div className="mt-1 font-semibold text-slate-900">{getOrderStatusLabel(historyOrder.status)}</div>
                  <div className="mt-1 text-xs text-slate-500">{historyOrder.customer_name || "ลูกค้าทั่วไป"}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">ยอดขายเดิม</div>
                  <div className="mt-1 font-semibold text-slate-900">{formatThaiCurrency(historyOrder.total_amount)}</div>
                  <div className="mt-1 text-xs text-slate-500">VAT {formatThaiCurrency(historyOrder.vat_amount)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">คืนสะสม</div>
                  <div className="mt-1 font-semibold text-amber-700">{formatThaiCurrency(Number(historyOrder.refund_amount ?? 0))}</div>
                  <div className="mt-1 text-xs text-slate-500">คงเหลือคืนได้ {formatThaiCurrency(historyRefundableAmount)}</div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <div className="font-semibold text-slate-900">รายการสินค้า</div>
                    </div>
                    <div className="max-h-[22rem] space-y-3 overflow-y-auto p-4">
                      {historyOrder.items.map((item) => {
                        const refundedQty = Number(item.refunded_qty ?? 0);
                        const refundableQty = Math.max(Number(item.qty) - refundedQty, 0);
                        return (
                          <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div>
                                <div className="font-medium text-slate-900">{item.product_name}</div>
                                {item.variant_name ? <div className="text-xs text-slate-500">{item.variant_name}</div> : null}
                                <div className="mt-2 text-sm text-slate-500">
                                  {formatThaiCurrency(item.unit_price)} x {item.qty} • รวม {formatThaiCurrency(item.subtotal)}
                                </div>
                              </div>
                              <div className="text-sm text-right">
                                <div className="text-slate-600">คืนแล้ว {refundedQty}</div>
                                <div className="text-slate-500">คืนได้อีก {refundableQty}</div>
                                {Number(item.refunded_amount ?? 0) > 0 ? (
                                  <div className="text-amber-700">ยอดคืนสะสม {formatThaiCurrency(Number(item.refunded_amount ?? 0))}</div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {historyTimeline.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200">
                      <div className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Timeline เหตุการณ์บิล</div>
                      <div className="space-y-2 p-4 text-sm text-slate-600">
                        {historyTimeline.map((event) => (
                          <div key={event.id} className={`rounded-xl border px-3 py-3 ${event.toneClassName}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-semibold">{event.title}</div>
                                <div className="text-xs opacity-80">{formatThaiDate(event.occurredAt)}</div>
                                {event.detail ? <div className="mt-1 text-sm opacity-90">{event.detail}</div> : null}
                                {event.reason ? <div className="mt-1 text-sm opacity-90">เหตุผล: {event.reason}</div> : null}
                              </div>
                              {typeof event.amount === "number" ? (
                                <div className="text-right font-semibold">
                                  {event.type === "partial_refund" || event.type === "full_refund" ? "-" : ""}
                                  {formatThaiCurrency(event.amount)}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {historyAdditionalNotes.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200">
                      <div className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">หมายเหตุเพิ่มเติม</div>
                      <div className="space-y-2 p-4 text-sm text-slate-600">
                        {historyAdditionalNotes.map((line, index) => (
                          <div key={`${historyOrder.id}-note-${index}`} className="rounded-xl bg-slate-50 px-3 py-2">
                            {line}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200">
                    <div className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">ข้อมูลลูกค้า</div>
                    <div className="space-y-2 p-4 text-sm text-slate-600">
                      <div>ชื่อ: {historyOrder.customer_name || "ลูกค้าทั่วไป"}</div>
                      <div>โทร: {historyOrder.customer_phone || "-"}</div>
                      <div>เลขผู้เสียภาษี: {historyOrder.customer_tax_id || "-"}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200">
                    <div className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">ประวัติการชำระเงิน</div>
                    <div className="space-y-3 p-4">
                      {historySalePayments.length === 0 ? (
                        <div className="text-sm text-slate-500">ไม่มีข้อมูลการชำระเงิน</div>
                      ) : (
                        historySalePayments.map((payment) => (
                          <div key={payment.id} className="rounded-xl bg-slate-50 px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium text-slate-900">{paymentMethodLabels[payment.payment_method] ?? "อื่นๆ"}</div>
                                <div className="text-xs text-slate-500">{formatThaiDate(payment.paid_at)}</div>
                                {payment.reference_no ? <div className="text-xs text-slate-500">อ้างอิง {payment.reference_no}</div> : null}
                              </div>
                              <div className="font-semibold text-slate-900">{formatThaiCurrency(Number(payment.amount))}</div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50">
                    <div className="border-b border-amber-200 px-4 py-3 font-semibold text-amber-900">ประวัติคืนสินค้า / คืนเงิน</div>
                    <div className="space-y-3 p-4">
                      <div className="flex items-center justify-between text-sm text-amber-900">
                        <span>คืนสะสม</span>
                        <span className="font-semibold">{formatThaiCurrency(Number(historyOrder.refund_amount ?? 0))}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm text-amber-900">
                        <span>คงเหลือคืนได้</span>
                        <span className="font-semibold">{formatThaiCurrency(historyRefundableAmount)}</span>
                      </div>
                      {historyRefundPayments.length === 0 ? (
                        <div className="text-sm text-amber-800">ยังไม่มี payment ติดลบจากการ refund</div>
                      ) : (
                        historyRefundPayments.map((payment) => (
                          <div key={payment.id} className="rounded-xl bg-white/70 px-3 py-3 text-sm text-amber-900">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium">{paymentMethodLabels[payment.payment_method] ?? "อื่นๆ"}</div>
                                <div className="text-xs text-amber-800">{formatThaiDate(payment.paid_at)}</div>
                                {payment.reference_no ? <div className="text-xs text-amber-800">อ้างอิง {payment.reference_no}</div> : null}
                              </div>
                              <div className="font-semibold">{formatThaiCurrency(Number(payment.amount))}</div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOrder(null)}>ปิด</Button>
            <Button
              onClick={() => {
                if (!historyOrder) {
                  return;
                }
                setLastOrder(historyOrder);
                setShowReceipt(true);
              }}
            >
              เปิดใบเสร็จเพื่อพิมพ์ซ้ำ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={priceEditorOpen} onOpenChange={setPriceEditorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>แก้ราคาในบิล</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="number"
              value={priceEditValue}
              onChange={(event) => setPriceEditValue(event.target.value)}
              placeholder="ราคาใหม่"
            />
            <p className="text-sm text-slate-500">ใช้สำหรับ override ราคาเฉพาะบิลนี้เท่านั้น</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceEditorOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleApplyPriceOverride}>บันทึกราคาใหม่</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(voidOrder)} onOpenChange={(open) => { if (!open) { setVoidOrder(null); setVoidReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Void บิล</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-slate-600">
              {voidOrder ? `บิล ${voidOrder.order_number} • ${formatThaiCurrency(voidOrder.total_amount)}` : ""}
            </div>
            <textarea
              className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="เหตุผลที่ต้อง void บิล"
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setVoidOrder(null); setVoidReason(""); }}>ยกเลิก</Button>
            <Button onClick={() => void handleVoidSale()}>ยืนยัน void</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(partialRefundOrder)}
        onOpenChange={(open) => {
          if (!open) {
            setPartialRefundOrder(null);
            setPartialRefundReason("");
            setPartialRefundQtys({});
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>คืนบางรายการ / Partial Refund</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-slate-600">
              {partialRefundOrder ? `บิล ${partialRefundOrder.order_number} • คาดว่าจะคืน ${formatThaiCurrency(partialRefundPreview.amount)}` : ""}
            </div>
            {partialRefundOrder ? (
              <div className="max-h-[24rem] space-y-3 overflow-y-auto pr-1">
                {partialRefundOrder.items.map((item) => {
                  const availableQty = Math.max(Number(item.qty) - Number(item.refunded_qty ?? 0), 0);
                  return (
                    <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-medium text-slate-900">{item.product_name}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            ขาย {item.qty} • คืนแล้ว {item.refunded_qty ?? 0} • คงเหลือคืนได้ {availableQty}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            มูลค่าต่อรายการ {formatThaiCurrency(item.subtotal)}{item.refunded_amount ? ` • คืนสะสม ${formatThaiCurrency(item.refunded_amount)}` : ""}
                          </div>
                        </div>
                        <Input
                          className="w-full md:w-32"
                          type="number"
                          min="0"
                          max={availableQty.toString()}
                          step="1"
                          value={partialRefundQtys[item.id] ?? ""}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setPartialRefundQtys((current) => ({ ...current, [item.id]: nextValue }));
                          }}
                          placeholder="จำนวนคืน"
                          disabled={availableQty <= 0}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <textarea
              className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="เหตุผลที่ต้องคืนสินค้า / ใช้กรณี exchange ได้เช่น คืนชิ้นเดิมแล้วขายชิ้นใหม่ต่อ"
              value={partialRefundReason}
              onChange={(event) => setPartialRefundReason(event.target.value)}
            />
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              เลือกสินค้าที่ต้องคืน แล้วค่อยสร้างบิลขายใหม่ถ้าต้องการ exchange ต่อในหน้า POS เดิม
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPartialRefundOrder(null);
                setPartialRefundReason("");
                setPartialRefundQtys({});
              }}
            >
              ยกเลิก
            </Button>
            <Button variant="outline" onClick={() => void handlePartialRefundSale()}>
              คืนอย่างเดียว
            </Button>
            <Button onClick={() => void handlePartialRefundSale(true)}>
              คืนและเปิดบิลแลก {partialRefundPreview.itemCount > 0 ? formatThaiCurrency(partialRefundPreview.amount) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(refundOrder)} onOpenChange={(open) => { if (!open) { setRefundOrder(null); setRefundReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Refund / คืนทั้งหมดที่เหลือในบิล</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-slate-600">
              {refundOrder ? `บิล ${refundOrder.order_number} • คงเหลือคืนได้ ${formatThaiCurrency(Math.max(Number(refundOrder.total_amount) - Number(refundOrder.refund_amount ?? 0), 0))}` : ""}
            </div>
            <textarea
              className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="เหตุผลที่ต้องคืนสินค้า / refund"
              value={refundReason}
              onChange={(event) => setRefundReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRefundOrder(null); setRefundReason(""); }}>ยกเลิก</Button>
            <Button onClick={() => void handleRefundSale()}>ยืนยัน refund</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scannerOpen} onOpenChange={setScannerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>สแกนบาร์โค้ด / QR</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl bg-slate-950">
              <video ref={scannerVideoRef} className="aspect-video w-full object-cover" muted playsInline />
            </div>
            <p className="text-sm text-slate-500">วางบาร์โค้ดหรือ QR ของสินค้าไว้กลางกล้อง ระบบจะเพิ่มสินค้าเข้าตะกร้าอัตโนมัติ</p>
            {scannerError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{scannerError}</p> : null}
            {!scanSupported ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">เบราว์เซอร์นี้ยังไม่รองรับตัวสแกนในตัว ให้ใช้การยิงบาร์โค้ดผ่านช่องค้นหาด้านบนแทน</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScannerOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateCustomerDialog
        open={createCustomerOpen}
        onOpenChange={setCreateCustomerOpen}
        requirePhone={loyaltySettingsQuery.data?.require_phone ?? true}
        onCreated={async (customerId) => {
          const response = await crmApi.getCustomer(customerId);
          const fullCustomer = response.data.data as Customer;
          setSelectedCustomer(fullCustomer);
          setCustomerName(fullCustomer.display_name || [fullCustomer.first_name, fullCustomer.last_name].filter(Boolean).join(" "));
          setCustomerPhone(fullCustomer.phone || "");
          setCustomerTaxId(fullCustomer.tax_id || "");
          setCustomerSearch("");
          setDebouncedCustomerSearch("");
        }}
      />
      <RedeemPointsDialog
        open={redeemOpen}
        onOpenChange={setRedeemOpen}
        customer={selectedCustomer}
        settings={loyaltySettingsQuery.data ?? null}
        onRedeemed={(discountAmount) => setLoyaltyDiscount(discountAmount)}
      />
    </div>
  );
}
