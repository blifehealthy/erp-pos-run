import Dexie, { type Table } from "dexie";
import type { Category, ProductListItem, Unit } from "@/types/product";
import type { HeldSaleDraft, PendingSale, ReplacementRuleDraft, SaleOrder } from "@/types/pos";
import type { StockBalance } from "@/types/stock";

export type PendingTransaction = {
  id?: number;
  type: string;
  payload: string;
  createdAt: string;
  syncedAt?: string;
};

export type OfflineProduct = {
  id: string;
  data: string;
  updatedAt: string;
};

export type OfflineSetting = {
  key: string;
  value: string;
};

export type LowStockAlert = {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  qty_on_hand: number;
  min_stock_qty: number;
  branch_id: string;
  synced_at: number;
};

export type SyncedCompletedOrder = Omit<SaleOrder, "synced_at"> & { synced_at: number };

export class ERPDatabase extends Dexie {
  pendingTransactions!: Table<PendingTransaction, number>;
  offlineProducts!: Table<OfflineProduct, string>;
  offlineSettings!: Table<OfflineSetting, string>;
  products!: Table<ProductListItem & { synced_at: number }, string>;
  categories!: Table<Category & { synced_at: number }, string>;
  units!: Table<Unit & { synced_at: number }, string>;
  stockBalances!: Table<StockBalance & { synced_at: number }, string>;
  lowStockAlerts!: Table<LowStockAlert, string>;
  pendingSales!: Table<PendingSale, string>;
  completedOrders!: Table<SyncedCompletedOrder, string>;
  heldBills!: Table<HeldSaleDraft, string>;
  replacementRules!: Table<ReplacementRuleDraft, string>;

  public constructor() {
    super("ERPDatabase");

    this.version(1).stores({
      pendingTransactions: "++id, type, payload, createdAt, syncedAt",
      offlineProducts: "id, data, updatedAt",
      offlineSettings: "key, value"
    });

    this.version(2).stores({
      pendingTransactions: "++id, type, payload, createdAt, syncedAt",
      offlineProducts: "id, data, updatedAt",
      offlineSettings: "key, value",
      products: "id, sku, barcode, category_id, is_active, synced_at",
      categories: "id, parent_id, synced_at",
      units: "id, code, synced_at"
    });

    this.version(3).stores({
      pendingTransactions: "++id, type, payload, createdAt, syncedAt",
      offlineProducts: "id, data, updatedAt",
      offlineSettings: "key, value",
      products: "id, sku, barcode, category_id, is_active, synced_at",
      categories: "id, parent_id, synced_at",
      units: "id, code, synced_at",
      stockBalances: "id, product_id, location_id, branch_id, synced_at",
      lowStockAlerts: "id, product_id, branch_id, synced_at"
    });

    this.version(4).stores({
      pendingTransactions: "++id, type, payload, createdAt, syncedAt",
      offlineProducts: "id, data, updatedAt",
      offlineSettings: "key, value",
      products: "id, sku, barcode, category_id, is_active, synced_at",
      categories: "id, parent_id, synced_at",
      units: "id, code, synced_at",
      stockBalances: "id, product_id, location_id, branch_id, synced_at",
      lowStockAlerts: "id, product_id, branch_id, synced_at",
      pendingSales: "client_order_id, synced, created_at",
      completedOrders: "id, shift_id, created_at, synced_at"
    });

    this.version(5).stores({
      pendingTransactions: "++id, type, payload, createdAt, syncedAt",
      offlineProducts: "id, data, updatedAt",
      offlineSettings: "key, value",
      products: "id, sku, barcode, category_id, is_active, synced_at",
      categories: "id, parent_id, synced_at",
      units: "id, code, synced_at",
      stockBalances: "id, product_id, location_id, branch_id, synced_at",
      lowStockAlerts: "id, product_id, branch_id, synced_at",
      pendingSales: "client_order_id, synced, created_at",
      completedOrders: "id, shift_id, created_at, synced_at",
      heldBills: "id, shift_id, location_id, held_at"
    });

    this.version(6).stores({
      pendingTransactions: "++id, type, payload, createdAt, syncedAt",
      offlineProducts: "id, data, updatedAt",
      offlineSettings: "key, value",
      products: "id, sku, barcode, category_id, is_active, synced_at",
      categories: "id, parent_id, synced_at",
      units: "id, code, synced_at",
      stockBalances: "id, product_id, location_id, branch_id, synced_at",
      lowStockAlerts: "id, product_id, branch_id, synced_at",
      pendingSales: "client_order_id, synced, created_at",
      completedOrders: "id, shift_id, created_at, synced_at",
      heldBills: "id, shift_id, location_id, held_at",
      replacementRules: "id, branch_id, source_product_id, replacement_product_id, created_at"
    });
  }
}

export const db = new ERPDatabase();
