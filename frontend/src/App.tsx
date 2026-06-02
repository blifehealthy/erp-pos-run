import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AppShell from "@/components/layout/AppShell";
import { Toaster } from "@/components/ui/toaster";
import { initAutoSync } from "@/lib/syncService";
import AccountingPage from "@/pages/accounting/AccountingPage";
import LoginPage from "@/pages/auth/LoginPage";
import AcceptInvitationPage from "@/pages/auth/AcceptInvitationPage";
import DashboardPage from "@/pages/dashboard/DashboardPage";
import StorefrontPage from "@/pages/storefront/StorefrontPage";
import BranchesPage from "@/pages/branches/BranchesPage";
import BranchSettingsPage from "@/pages/branches/BranchSettingsPage";
import CRMPage from "@/pages/crm/CRMPage";
import NotFoundPage from "@/pages/NotFoundPage";
import PayablePage from "@/pages/payable/PayablePage";
import POSPage from "@/pages/pos/POSPage";
import POFormPage from "@/pages/purchase/POFormPage";
import PurchaseOrdersPage from "@/pages/purchase/PurchaseOrdersPage";
import SuppliersPage from "@/pages/purchase/SuppliersPage";
import ProductFormPage from "@/pages/products/ProductFormPage";
import ProductsPage from "@/pages/products/ProductsPage";
import ETaxPage from "@/pages/etax/ETaxPage";
import HRPage from "@/pages/hr/HRPage";
import IntegrationsPage from "@/pages/integrations/IntegrationsPage";
import ShipmentsPage from "@/pages/logistics/ShipmentsPage";
import SettingsPage from "@/pages/settings/SettingsPage";
import ReportsPage from "@/pages/reports/ReportsPage";
import ShiftHistoryPage from "@/pages/reports/ShiftHistoryPage";
import RolesPage from "@/pages/roles/RolesPage";
import MultiBranchStockPage from "@/pages/stock/MultiBranchStockPage";
import StockPage from "@/pages/stock/StockPage";
import CountingPage from "@/pages/stockCount/CountingPage";
import StockCountPage from "@/pages/stockCount/StockCountPage";
import TOFormPage from "@/pages/transfer/TOFormPage";
import TransferOrdersPage from "@/pages/transfer/TransferOrdersPage";
import UsersPage from "@/pages/users/UsersPage";
import FBSetupWizard from "@/pages/restaurant/FBSetupWizard";
import RestaurantIndexPage from "@/pages/restaurant/RestaurantIndexPage";
import RecipesPage from "@/pages/restaurant/RecipesPage";
import TableMapPage from "@/pages/restaurant/TableMapPage";
import KitchenDisplayPage from "@/pages/restaurant/KitchenDisplayPage";
import PickupDisplayPage from "@/pages/restaurant/PickupDisplayPage";
import CustomerMenuPage from "@/pages/restaurant/CustomerMenuPage";
import SessionCheckoutPage from "@/pages/restaurant/SessionCheckoutPage";
import FBSettingsPage from "@/pages/restaurant/FBSettingsPage";
import IngredientReportPage from "@/pages/restaurant/IngredientReportPage";
import FBOrdersPage from "@/pages/restaurant/FBOrdersPage";
import SessionDetailPage from "@/pages/restaurant/SessionDetailPage";
import QuickServicePage from "@/pages/restaurant/QuickServicePage";
import QRManagerPage from "@/pages/restaurant/QRManagerPage";
import { useEffect } from "react";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } }
});

export default function App(): JSX.Element {
  useEffect(() => {
    initAutoSync();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
          <Route path="/" element={<StorefrontPage />} />
          <Route path="/store" element={<StorefrontPage />} />
          <Route element={<ProtectedRoute permission="pos.sale.create" />}>
            <Route path="/pos" element={<POSPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route element={<ProtectedRoute permission="system.user.view" />}>
                <Route path="/users" element={<UsersPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="system.role.view" />}>
                <Route path="/roles" element={<RolesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="system.branch.view" />}>
                <Route path="/branches" element={<BranchesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="accounting.report.view" />}>
                <Route path="/accounting" element={<AccountingPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="accounting.payment.view" />}>
                <Route path="/payable" element={<PayablePage />} />
              </Route>
              <Route element={<ProtectedRoute permission="accounting.invoice.view" />}>
                <Route path="/etax" element={<ETaxPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="hr.employee.view" />}>
                <Route path="/hr" element={<HRPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="system.company.edit" />}>
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="pos.sale.view" />}>
                <Route path="/crm" element={<CRMPage />} />
                <Route path="/logistics" element={<ShipmentsPage />} />
              </Route>
              <Route path="/branches/:id/settings" element={<BranchSettingsPage />} />
              <Route element={<ProtectedRoute permission="inventory.product.view" />}>
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/products/new" element={<ProductFormPage />} />
                <Route path="/products/:id/edit" element={<ProductFormPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="inventory.stock.view" />}>
                <Route path="/stock" element={<StockPage />} />
                <Route path="/stock/multi-branch" element={<MultiBranchStockPage />} />
                <Route path="/stock-count" element={<StockCountPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="inventory.stock.adjust" />}>
                <Route path="/stock-count/:id" element={<CountingPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="inventory.transfer.view" />}>
                <Route path="/transfer/orders" element={<TransferOrdersPage />} />
                <Route path="/transfer/orders/:id" element={<TOFormPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="inventory.transfer.create" />}>
                <Route path="/transfer/orders/new" element={<TOFormPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="pos.report.view" />}>
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/shift-history" element={<ShiftHistoryPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="inventory.purchase.view" />}>
                <Route path="/purchase/suppliers" element={<SuppliersPage />} />
                <Route path="/purchase/orders" element={<PurchaseOrdersPage />} />
                <Route path="/purchase/orders/:id" element={<POFormPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="inventory.purchase.create" />}>
                <Route path="/purchase/orders/new" element={<POFormPage />} />
              </Route>
              {/* F&B Module */}
              {/* Public routes — no login required */}
              <Route path="/menu/:token" element={<CustomerMenuPage />} />
              <Route path="/order/:token" element={<QuickServicePage />} />
              {/* F&B setup wizard — no AppShell */}
              <Route path="/restaurant/setup" element={<FBSetupWizard />} />
              {/* Kitchen & Pickup — fullscreen, no AppShell */}
              <Route element={<ProtectedRoute permission="pos.sale.view" />}>
                <Route path="/restaurant/kitchen" element={<KitchenDisplayPage />} />
                <Route path="/restaurant/pickup" element={<PickupDisplayPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="pos.sale.view" />}>
                <Route element={<AppShell />}>
                  <Route path="/restaurant" element={<RestaurantIndexPage />} />
                  <Route path="/restaurant/tables" element={<TableMapPage />} />
                  <Route path="/restaurant/orders" element={<FBOrdersPage />} />
                  <Route path="/restaurant/recipes" element={<RecipesPage />} />
                  <Route path="/restaurant/qr" element={<QRManagerPage />} />
                  <Route path="/restaurant/reports/ingredients" element={<IngredientReportPage />} />
                  <Route path="/restaurant/settings" element={<FBSettingsPage />} />
                  <Route path="/restaurant/session/:sessionId/checkout" element={<SessionCheckoutPage />} />
                  <Route path="/restaurant/session/:sessionId/detail" element={<SessionDetailPage />} />
                </Route>
              </Route>
              <Route path="/403" element={<NotFoundPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
