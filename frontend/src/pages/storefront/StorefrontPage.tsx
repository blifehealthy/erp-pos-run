import { useQuery } from "@tanstack/react-query";
import { Clock3, MapPin, Navigation, Phone, Search, ShoppingBag, Store } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { storefrontApi } from "@/lib/storefrontApi";
import { formatThaiCurrency } from "@/lib/cartUtils";
import type { StorefrontBranch, StorefrontProduct, StorefrontSummary } from "@/types/storefront";

type UserCoordinates = {
  latitude: number;
  longitude: number;
};

type BranchFilter = "all" | "pickup_only";

function todayWorkingHours(branch: StorefrontBranch): string {
  if (!branch.working_hours) return "ดูเวลาทำการที่ร้าน";
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayKey = keys[new Date().getDay()];
  const row = branch.working_hours[todayKey];
  if (!row) return "ดูเวลาทำการที่ร้าน";
  if (row.closed) return "วันนี้ปิด";
  if (row.open && row.close) return `วันนี้ ${row.open} - ${row.close}`;
  return "ดูเวลาทำการที่ร้าน";
}

function isBranchOpenNow(branch: StorefrontBranch): boolean | null {
  if (!branch.working_hours) return null;
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const now = new Date();
  const todayKey = keys[now.getDay()];
  const row = branch.working_hours[todayKey];
  if (!row) return null;
  if (row.closed) return false;
  if (!row.open || !row.close) return null;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [openHour, openMinute] = row.open.split(":").map(Number);
  const [closeHour, closeMinute] = row.close.split(":").map(Number);
  const openMinutes = openHour * 60 + openMinute;
  const closeMinutes = closeHour * 60 + closeMinute;
  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
}

function calculateDistanceKm(branch: StorefrontBranch, userCoordinates: UserCoordinates | null): number | null {
  if (!userCoordinates || branch.latitude === null || branch.longitude === null) {
    return null;
  }
  const toRadians = (value: number): number => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(branch.latitude - userCoordinates.latitude);
  const dLng = toRadians(branch.longitude - userCoordinates.longitude);
  const lat1 = toRadians(userCoordinates.latitude);
  const lat2 = toRadians(branch.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusKm * c * 10) / 10;
}

function buildDirectionsUrl(branch: StorefrontBranch, userCoordinates: UserCoordinates | null): string | null {
  if (branch.google_maps_url) {
    return branch.google_maps_url;
  }
  if (branch.latitude === null || branch.longitude === null) {
    return null;
  }
  const destination = `${branch.latitude},${branch.longitude}`;
  if (!userCoordinates) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
  }
  const origin = `${userCoordinates.latitude},${userCoordinates.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

function getBranchStatusBadge(branch: StorefrontBranch): { label: string; className: string } {
  const openNow = isBranchOpenNow(branch);
  if (openNow === true) {
    return { label: "เปิดอยู่ตอนนี้", className: "bg-emerald-100 text-emerald-700" };
  }
  if (openNow === false) {
    return { label: "ปิดอยู่ตอนนี้", className: "bg-rose-100 text-rose-700" };
  }
  return { label: "เช็กเวลาที่ร้าน", className: "bg-slate-100 text-slate-600" };
}

export default function StorefrontPage(): JSX.Element {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [branchSearch, setBranchSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState<BranchFilter>("all");
  const [userCoordinates, setUserCoordinates] = useState<UserCoordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const summaryQuery = useQuery({
    queryKey: ["storefront", "summary"],
    queryFn: async () => (await storefrontApi.summary()).data.data as StorefrontSummary,
  });

  const productsQuery = useQuery({
    queryKey: ["storefront", "products", debouncedSearch, selectedCategory],
    queryFn: async () =>
      (await storefrontApi.products({
        search: debouncedSearch || undefined,
        category_id: selectedCategory || undefined,
        in_stock_only: false,
        page: 1,
        limit: 24,
      })).data,
  });

  const company = summaryQuery.data?.company ?? null;
  const branches = summaryQuery.data?.branches ?? [];
  const featuredProducts = summaryQuery.data?.featured_products ?? [];
  const products = productsQuery.data?.data ?? [];
  const categoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    [...featuredProducts, ...products].forEach((product) => {
      if (product.category_id && product.category_name) {
        map.set(product.category_id, product.category_name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [featuredProducts, products]);

  const filteredBranches = useMemo(() => {
    const keyword = branchSearch.trim().toLowerCase();
    return [...branches]
      .filter((branch) => {
        if (branchFilter === "pickup_only" && !branch.is_pickup_available) {
          return false;
        }
        if (!keyword) {
          return true;
        }
        return [
          branch.name,
          branch.address ?? "",
          branch.landmark ?? "",
          branch.phone ?? "",
        ].some((value) => value.toLowerCase().includes(keyword));
      })
      .sort((left, right) => {
        const leftDistance = calculateDistanceKm(left, userCoordinates);
        const rightDistance = calculateDistanceKm(right, userCoordinates);
        if (leftDistance !== null && rightDistance !== null && leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }
        if (left.is_pickup_available !== right.is_pickup_available) {
          return left.is_pickup_available ? -1 : 1;
        }
        return left.name.localeCompare(right.name, "th");
      });
  }, [branchFilter, branchSearch, branches, userCoordinates]);

  const selectedBranch = useMemo(
    () => filteredBranches.find((branch) => branch.id === selectedBranchId) ?? filteredBranches[0] ?? null,
    [filteredBranches, selectedBranchId],
  );

  const openBranchCount = useMemo(
    () => branches.filter((branch) => isBranchOpenNow(branch) === true).length,
    [branches],
  );

  useEffect(() => {
    if (!selectedBranchId && filteredBranches[0]) {
      setSelectedBranchId(filteredBranches[0].id);
    }
    if (selectedBranchId && !filteredBranches.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId(filteredBranches[0]?.id ?? "");
    }
  }, [filteredBranches, selectedBranchId]);

  function handleLocateMe(): void {
    if (!navigator.geolocation) {
      setLocationError("อุปกรณ์นี้ยังไม่รองรับการแชร์ตำแหน่ง");
      return;
    }
    setIsLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setIsLocating(false);
      },
      () => {
        setLocationError("ไม่สามารถอ่านตำแหน่งปัจจุบันได้ กรุณาอนุญาต location หรือใช้ Google Maps แทน");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.20),_transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(37,99,235,0.18),_transparent_28%),linear-gradient(180deg,_#fff7ed_0%,_#f8fafc_45%,_#eef2ff_100%)] text-slate-900">
      <section className="mx-auto max-w-7xl px-6 py-8 md:px-10">
        <div className="rounded-[36px] border border-white/80 bg-white/80 p-6 shadow-[0_28px_100px_rgba(15,23,42,0.10)] backdrop-blur md:p-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full bg-amber-100 px-4 py-1 text-xs font-semibold uppercase tracking-[0.35em] text-amber-700">
                Storefront + Locator
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 md:text-6xl">
                {company?.name ?? "ERP-POS Store"}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 md:text-lg">
                ค้นหาสาขา ดูเวลาทำการ เรียงร้านใกล้ตัว และกดนำทางไปซื้อสินค้าหรือรับที่ร้านได้จากหน้าสาธารณะเดียวกัน
              </p>
              <div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-600">
                {company?.phone ? <span className="rounded-full bg-slate-100 px-4 py-2">{company.phone}</span> : null}
                {company?.address ? <span className="rounded-full bg-slate-100 px-4 py-2">{company.address}</span> : null}
                <Link className="rounded-full bg-slate-900 px-4 py-2 text-white" to="/store#locator">ไปที่ Store Locator</Link>
                <Link className="rounded-full border border-slate-200 bg-white px-4 py-2 text-slate-700" to="/login">เข้าสู่ระบบแอดมิน</Link>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="สาขาทั้งหมด" value={String(branches.length)} />
              <MetricCard label="เปิดอยู่ตอนนี้" value={String(openBranchCount)} />
              <MetricCard label="สินค้าแนะนำ" value={String(featuredProducts.length)} />
            </div>
          </div>
        </div>
      </section>

      <section id="locator" className="mx-auto grid max-w-7xl gap-8 px-6 pb-16 md:px-10 xl:grid-cols-[0.95fr_1.05fr]">
        <aside className="space-y-8">
          <div className="rounded-[32px] border border-white/80 bg-white/82 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-600">Store Locator</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">ค้นหาสาขาและวางแผนไปรับสินค้า</h2>
                </div>
                <button
                  type="button"
                  onClick={handleLocateMe}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  {isLocating ? "กำลังหาตำแหน่ง..." : "ใช้ตำแหน่งฉัน"}
                </button>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm"
                  placeholder="ค้นหาชื่อสาขา / ที่อยู่ / จุดสังเกต"
                  value={branchSearch}
                  onChange={(event) => setBranchSearch(event.target.value)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm ${branchFilter === "all" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                  onClick={() => setBranchFilter("all")}
                >
                  ทุกสาขา
                </button>
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm ${branchFilter === "pickup_only" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                  onClick={() => setBranchFilter("pickup_only")}
                >
                  พร้อมรับที่ร้าน
                </button>
              </div>

              {userCoordinates ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                  เรียงลำดับสาขาใกล้ตำแหน่งของคุณแล้ว
                </div>
              ) : null}
              {locationError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {locationError}
                </div>
              ) : null}

              <div className="grid gap-3">
                {filteredBranches.map((branch) => {
                  const distance = calculateDistanceKm(branch, userCoordinates);
                  const status = getBranchStatusBadge(branch);
                  return (
                    <button
                      key={branch.id}
                      type="button"
                      onClick={() => setSelectedBranchId(branch.id)}
                      className={`rounded-2xl border p-4 text-left transition ${selectedBranch?.id === branch.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{branch.name}</div>
                          <div className="mt-1 text-sm text-slate-500">{branch.landmark || branch.address || "ดูรายละเอียดสาขา"}</div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-medium ${status.className}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span className={`rounded-full px-3 py-1 font-medium ${branch.is_pickup_available ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {branch.is_pickup_available ? "พร้อมรับที่ร้าน" : "ยังไม่เปิดรับ"}
                        </span>
                        {distance !== null ? <span className="rounded-full bg-white px-3 py-1 font-medium text-slate-600">ประมาณ {distance} กม.</span> : null}
                        {branch.phone ? <span className="rounded-full bg-white px-3 py-1 font-medium text-slate-600">{branch.phone}</span> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {selectedBranch ? (
            <div className="rounded-[32px] border border-slate-200 bg-[linear-gradient(180deg,_#0f172a_0%,_#1e293b_100%)] p-6 text-white shadow-[0_20px_80px_rgba(15,23,42,0.22)]">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-blue-200">
                <Store className="h-4 w-4" />
                Selected Branch
              </div>
              <h3 className="mt-3 text-2xl font-semibold">{selectedBranch.name}</h3>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full px-3 py-1 font-medium ${getBranchStatusBadge(selectedBranch).className}`}>
                  {getBranchStatusBadge(selectedBranch).label}
                </span>
                {calculateDistanceKm(selectedBranch, userCoordinates) !== null ? (
                  <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-slate-100">
                    ห่างประมาณ {calculateDistanceKm(selectedBranch, userCoordinates)} กม.
                  </span>
                ) : null}
              </div>
              <div className="mt-5 space-y-3 text-sm text-slate-200">
                <div className="flex gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 flex-none" />
                  <div>
                    <div>{selectedBranch.address || "ยังไม่ได้ระบุที่อยู่"}</div>
                    {selectedBranch.landmark ? <div className="mt-1 text-slate-400">จุดสังเกต: {selectedBranch.landmark}</div> : null}
                  </div>
                </div>
                <div className="flex gap-3">
                  <Phone className="mt-0.5 h-4 w-4 flex-none" />
                  <div>{selectedBranch.phone || "ยังไม่ได้ระบุเบอร์โทร"}</div>
                </div>
                <div className="flex gap-3">
                  <Navigation className="mt-0.5 h-4 w-4 flex-none" />
                  <div>
                    {selectedBranch.latitude !== null && selectedBranch.longitude !== null
                      ? `${selectedBranch.latitude}, ${selectedBranch.longitude}`
                      : "ยังไม่ได้ระบุพิกัด"}
                  </div>
                </div>
                <div className="flex gap-3">
                  <Clock3 className="mt-0.5 h-4 w-4 flex-none" />
                  <div>{todayWorkingHours(selectedBranch)}</div>
                </div>
                <div className="rounded-2xl bg-white/10 p-4 text-slate-100">
                  {selectedBranch.latitude !== null && selectedBranch.longitude !== null
                    ? "พร้อมใช้พิกัดนี้เปิด Google Maps หรือนำทางจากตำแหน่งปัจจุบันของคุณ"
                    : "สาขานี้ยังไม่มีพิกัดแผนที่ แต่ยังดูข้อมูลติดต่อและที่อยู่ได้"}
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                {buildDirectionsUrl(selectedBranch, userCoordinates) ? (
                  <a
                    href={buildDirectionsUrl(selectedBranch, userCoordinates) as string}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900"
                  >
                    เปิดเส้นทางใน Google Maps
                  </a>
                ) : null}
                {selectedBranch.phone ? (
                  <a href={`tel:${selectedBranch.phone}`} className="rounded-full border border-white/25 px-4 py-2 text-sm font-medium text-white">
                    โทรหาสาขา
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </aside>

        <div className="space-y-8">
          <div className="rounded-[32px] border border-white/80 bg-white/82 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-blue-600">Browse Products</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">รายการสินค้าและหน้าร้าน</h2>
              </div>
              <div className="relative md:w-[24rem]">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm"
                  placeholder="ค้นหาสินค้า / SKU / barcode"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm ${selectedCategory === "" ? "bg-blue-600 text-white" : "border border-slate-200 bg-slate-50 text-slate-700"}`}
                onClick={() => setSelectedCategory("")}
              >
                ทั้งหมด
              </button>
              {categoryOptions.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm ${selectedCategory === category.id ? "bg-blue-600 text-white" : "border border-slate-200 bg-slate-50 text-slate-700"}`}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {(products.length > 0 ? products : featuredProducts).map((product) => (
                <article key={product.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex h-48 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,_#e0f2fe,_#fff7ed)]">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} className="h-full w-full rounded-2xl object-cover" />
                    ) : (
                      <ShoppingBag className="h-10 w-10 text-slate-400" />
                    )}
                  </div>
                  <div className="mt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{product.name}</h3>
                        <p className="mt-1 text-xs text-slate-500">{product.sku}{product.barcode ? ` • ${product.barcode}` : ""}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${product.in_stock ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {product.in_stock ? "พร้อมขาย" : "สินค้าหมด"}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-2 min-h-[2.75rem] text-sm text-slate-600">{product.description || "รายละเอียดสินค้าจะถูกแสดงที่นี่"}</p>
                    <div className="mt-4 flex items-end justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">ราคา</div>
                        <div className="mt-1 text-xl font-semibold text-blue-700">{formatThaiCurrency(Number(product.selling_price))}</div>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <div>{product.category_name || "สินค้า"}</div>
                        <div>{product.vat_type === "included" ? `รวม VAT ${product.vat_rate}%` : product.vat_type === "excluded" ? `VAT ${product.vat_rate}% แยกนอก` : "ยกเว้น VAT"}</div>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
      <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}
