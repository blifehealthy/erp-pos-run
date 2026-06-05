import { Outlet, useLocation } from "react-router-dom";
import { useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";

const titleMap: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/users": "ผู้ใช้งาน",
  "/roles": "บทบาทและสิทธิ์",
  "/branches": "สาขา",
  "/403": "ไม่มีสิทธิ์เข้าถึง"
};

export default function AppShell(): JSX.Element {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();

  const title = titleMap[location.pathname] ?? "ERP-POS";

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar isSidebarOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      {isSidebarOpen ? (
        <button
          aria-label="Close sidebar"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          type="button"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar onMenuClick={() => setIsSidebarOpen(true)} title={title} />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
