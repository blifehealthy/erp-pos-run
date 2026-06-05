import api from "@/lib/api";
import type { StockLocation } from "@/types/stock";

export const stockApi = {
  listLocations: (branchId?: string) =>
    api.get("/stock/locations", { params: { branch_id: branchId } }),
  createLocation: (data: Partial<StockLocation>) =>
    api.post("/stock/locations", data),
  listBalances: (params?: {
    branch_id?: string;
    location_id?: string;
    product_id?: string;
    low_stock_only?: boolean;
  }) => api.get("/stock/balances", { params }),
  getSummary: (branchId?: string) =>
    api.get("/stock/summary", { params: { branch_id: branchId } }),
  getProductStock: (productId: string) =>
    api.get(`/stock/products/${productId}`),
  listMovements: (params?: {
    product_id?: string;
    branch_id?: string;
    movement_type?: string;
    page?: number;
    limit?: number;
    date_from?: string;
    date_to?: string;
  }) => api.get("/stock/movements", { params }),
  adjust: (data: {
    location_id: string;
    product_id: string;
    variant_id?: string;
    qty: number;
    note?: string;
    cost_per_unit?: number;
  }) => api.post("/stock/adjust", data),
  receive: (data: {
    location_id: string;
    items: Array<{ product_id: string; variant_id?: string; qty: number; cost_per_unit?: number }>;
    note?: string;
    reference_type?: string;
    reference_id?: string;
  }) => api.post("/stock/receive", data),
  transfer: (data: {
    from_location_id: string;
    to_location_id: string;
    items: Array<{ product_id: string; variant_id?: string; qty: number }>;
    note?: string;
  }) => api.post("/stock/transfer", data)
};
