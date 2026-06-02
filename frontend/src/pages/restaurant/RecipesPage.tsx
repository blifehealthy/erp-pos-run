import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, Plus, Trash2, TrendingUp, UtensilsCrossed, X } from "lucide-react";
import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useAuthStore } from "@/stores/auth.store";
import { authApi } from "@/lib/api";
import type { ProductListItem } from "@/types/product";

type RecipeIngredientDraft = {
  ingredient_id: string;
  ingredient_name: string;
  quantity: string;
  unit: string;
};

type RecipeListItem = {
  id: string;
  product_id: string;
  product_name: string;
  name: string;
  yield_unit: string;
  is_active: boolean;
  total_cost: number;
  selling_price: number;
  gross_margin_pct: number;
};

type RecipeRead = RecipeListItem & {
  yield_qty: number;
  notes: string | null;
  ingredients: {
    id: string;
    ingredient_id: string;
    ingredient_name: string;
    ingredient_sku: string;
    quantity: number;
    unit: string;
    latest_unit_cost: number;
    cost_per_recipe: number;
  }[];
  cost_per_yield: number;
};

const api = authApi;

async function fetchRecipes(branchId?: string): Promise<RecipeListItem[]> {
  const params = branchId ? `?branch_id=${branchId}` : "";
  const res = await api.get(`/restaurant/recipes${params}`);
  return res.data.data as RecipeListItem[];
}

async function fetchRecipe(id: string): Promise<RecipeRead> {
  const res = await api.get(`/restaurant/recipes/${id}`);
  return res.data.data as RecipeRead;
}

async function fetchMenuProducts(): Promise<ProductListItem[]> {
  const res = await api.get("/products?product_type=menu_item&is_active=true&limit=200");
  return res.data.data as ProductListItem[];
}

async function fetchRawMaterials(): Promise<ProductListItem[]> {
  const res = await api.get("/products?product_type=raw_material&is_active=true&limit=200");
  return res.data.data as ProductListItem[];
}

function MarginBadge({ pct }: { pct: number }): JSX.Element {
  const color = pct >= 60 ? "bg-emerald-100 text-emerald-700" : pct >= 40 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{pct.toFixed(1)}%</span>;
}

export default function RecipesPage(): JSX.Element {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const branchId = useAuthStore((s) => s.branchId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formProductId, setFormProductId] = useState("");
  const [formName, setFormName] = useState("");
  const [formYieldQty, setFormYieldQty] = useState("1");
  const [formYieldUnit, setFormYieldUnit] = useState("แก้ว");
  const [formNotes, setFormNotes] = useState("");
  const [formIngredients, setFormIngredients] = useState<RecipeIngredientDraft[]>([]);

  const listQuery = useQuery({
    queryKey: ["recipes", branchId],
    queryFn: () => fetchRecipes(branchId ?? undefined),
  });

  const detailQuery = useQuery({
    queryKey: ["recipe", selectedId],
    queryFn: () => fetchRecipe(selectedId!),
    enabled: Boolean(selectedId),
  });

  const menuQuery = useQuery({
    queryKey: ["products", "menu_item"],
    queryFn: fetchMenuProducts,
    enabled: showForm,
  });

  const rawQuery = useQuery({
    queryKey: ["products", "raw_material"],
    queryFn: fetchRawMaterials,
    enabled: showForm,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await api.post("/restaurant/recipes", {
        product_id: formProductId,
        branch_id: branchId ?? null,
        name: formName,
        yield_qty: Number(formYieldQty),
        yield_unit: formYieldUnit,
        notes: formNotes || null,
        ingredients: formIngredients
          .filter((i) => i.ingredient_id && Number(i.quantity) > 0)
          .map((i, idx) => ({
            ingredient_id: i.ingredient_id,
            quantity: Number(i.quantity),
            unit: i.unit,
            sort_order: idx,
          })),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      toast({ title: "บันทึกสูตรแล้ว" });
      resetForm();
    },
    onError: () => toast({ title: "บันทึกไม่สำเร็จ กรุณาลองใหม่" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/restaurant/recipes/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setSelectedId(null);
      toast({ title: "ลบสูตรแล้ว" });
    },
  });

  function resetForm(): void {
    setShowForm(false);
    setFormProductId("");
    setFormName("");
    setFormYieldQty("1");
    setFormYieldUnit("แก้ว");
    setFormNotes("");
    setFormIngredients([]);
  }

  function addIngredient(): void {
    setFormIngredients((prev) => [...prev, { ingredient_id: "", ingredient_name: "", quantity: "1", unit: "g" }]);
  }

  function updateIngredient(index: number, key: keyof RecipeIngredientDraft, value: string): void {
    setFormIngredients((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [key]: value } : item))
    );
  }

  function removeIngredient(index: number): void {
    setFormIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  const recipes = listQuery.data ?? [];
  const selected = detailQuery.data ?? null;
  const rawMaterials = rawQuery.data ?? [];
  const menuItems = menuQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="สูตรอาหาร / เครื่องดื่ม"
        subtitle="จัดการสูตร ต้นทุนวัตถุดิบ และ Gross Margin"
        actions={
          <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            สร้างสูตรใหม่
          </Button>
        }
      />

      <div className="flex gap-6 p-6">
        {/* Recipe List */}
        <div className="flex w-72 flex-shrink-0 flex-col gap-2">
          {listQuery.isLoading && <p className="text-sm text-slate-500">กำลังโหลด...</p>}
          {recipes.length === 0 && !listQuery.isLoading && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
              <ChefHat className="mx-auto mb-2 h-8 w-8" />
              <p className="text-sm">ยังไม่มีสูตร</p>
              <p className="mt-1 text-xs">กดปุ่ม "สร้างสูตรใหม่" ด้านบน</p>
            </div>
          )}
          {recipes.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={`rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 ${selectedId === r.id ? "border-orange-400 bg-orange-50 shadow-md" : "border-slate-200 bg-white hover:border-slate-300"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{r.product_name}</p>
                  <p className="text-xs text-slate-500">{r.name}</p>
                </div>
                <MarginBadge pct={r.gross_margin_pct} />
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                <span>ต้นทุน ฿{Number(r.total_cost).toFixed(2)}</span>
                <span>ขาย ฿{Number(r.selling_price).toFixed(2)}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Recipe Detail */}
        {selected && !showForm && (
          <div className="flex-1 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">{selected.product_name}</h2>
                <p className="mt-0.5 text-sm text-slate-500">{selected.name} • {selected.yield_qty} {selected.yield_unit}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => window.confirm("ลบสูตรนี้หรือไม่?") && deleteMutation.mutate(selected.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Cost Summary */}
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="rounded-2xl bg-slate-50 p-4 text-center">
                <p className="text-xs uppercase tracking-wider text-slate-500">ต้นทุนรวม</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">฿{Number(selected.cost_per_yield).toFixed(2)}</p>
                <p className="text-xs text-slate-400">ต่อ {selected.yield_unit}</p>
              </div>
              <div className="rounded-2xl bg-blue-50 p-4 text-center">
                <p className="text-xs uppercase tracking-wider text-blue-600">ราคาขาย</p>
                <p className="mt-1 text-2xl font-bold text-blue-700">฿{Number(selected.selling_price).toFixed(2)}</p>
              </div>
              <div className={`rounded-2xl p-4 text-center ${selected.gross_margin_pct >= 60 ? "bg-emerald-50" : selected.gross_margin_pct >= 40 ? "bg-amber-50" : "bg-red-50"}`}>
                <p className={`text-xs uppercase tracking-wider ${selected.gross_margin_pct >= 60 ? "text-emerald-600" : selected.gross_margin_pct >= 40 ? "text-amber-600" : "text-red-600"}`}>
                  <TrendingUp className="mr-1 inline h-3 w-3" />
                  Gross Margin
                </p>
                <p className={`mt-1 text-2xl font-bold ${selected.gross_margin_pct >= 60 ? "text-emerald-700" : selected.gross_margin_pct >= 40 ? "text-amber-700" : "text-red-700"}`}>
                  {Number(selected.gross_margin_pct).toFixed(1)}%
                </p>
              </div>
            </div>

            {/* Ingredients Table */}
            <div className="mt-6">
              <h3 className="mb-3 font-semibold text-slate-800">วัตถุดิบ</h3>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">วัตถุดิบ</th>
                      <th className="px-4 py-3 text-right">ปริมาณ</th>
                      <th className="px-4 py-3 text-right">ราคา/หน่วย</th>
                      <th className="px-4 py-3 text-right">ต้นทุน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selected.ingredients.map((ing) => (
                      <tr key={ing.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {ing.ingredient_name}
                          <span className="ml-2 text-xs text-slate-400">{ing.ingredient_sku}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          {ing.quantity} {ing.unit}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          ฿{Number(ing.latest_unit_cost).toFixed(4)}/{ing.unit}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800">
                          ฿{Number(ing.cost_per_recipe).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-semibold">
                      <td colSpan={3} className="px-4 py-3 text-right text-slate-700">รวมต้นทุน</td>
                      <td className="px-4 py-3 text-right text-orange-700">฿{Number(selected.total_cost).toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {selected.notes && (
              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{selected.notes}</p>
            )}
          </div>
        )}

        {/* Create Form */}
        {showForm && (
          <div className="flex-1 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">สร้างสูตรใหม่</h2>
              <Button variant="ghost" size="icon" onClick={resetForm}><X className="h-5 w-5" /></Button>
            </div>

            <div className="mt-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>เมนู (menu_item)</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm"
                    value={formProductId}
                    onChange={(e) => {
                      const p = menuItems.find((m) => m.id === e.target.value);
                      setFormProductId(e.target.value);
                      if (p && !formName) setFormName(`สูตร${p.name}`);
                    }}
                  >
                    <option value="">-- เลือกเมนู --</option>
                    {menuItems.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  {menuItems.length === 0 && (
                    <p className="mt-1 text-xs text-amber-600">ยังไม่มีสินค้าประเภท menu_item — เพิ่มสินค้าก่อน</p>
                  )}
                </div>
                <div>
                  <Label>ชื่อสูตร</Label>
                  <Input className="mt-1" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="เช่น Latte Standard" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>ปริมาณที่ได้ต่อครั้ง (yield)</Label>
                  <Input type="number" className="mt-1" value={formYieldQty} onChange={(e) => setFormYieldQty(e.target.value)} min="0.01" step="0.01" />
                </div>
                <div>
                  <Label>หน่วย yield</Label>
                  <Input className="mt-1" value={formYieldUnit} onChange={(e) => setFormYieldUnit(e.target.value)} placeholder="แก้ว / ชิ้น / จาน" />
                </div>
              </div>

              {/* Ingredients */}
              <div>
                <div className="flex items-center justify-between">
                  <Label>วัตถุดิบ</Label>
                  <Button variant="outline" size="sm" onClick={addIngredient}>
                    <Plus className="mr-1 h-3 w-3" />
                    เพิ่มวัตถุดิบ
                  </Button>
                </div>
                <div className="mt-3 space-y-2">
                  {formIngredients.length === 0 && (
                    <p className="text-sm text-slate-400">กดปุ่ม "เพิ่มวัตถุดิบ" เพื่อเริ่มต้น</p>
                  )}
                  {formIngredients.map((ing, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_100px_80px_32px] items-end gap-2">
                      <div>
                        {idx === 0 && <Label className="text-xs">วัตถุดิบ (raw_material)</Label>}
                        <select
                          className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm"
                          value={ing.ingredient_id}
                          onChange={(e) => {
                            const p = rawMaterials.find((r) => r.id === e.target.value);
                            updateIngredient(idx, "ingredient_id", e.target.value);
                            if (p) updateIngredient(idx, "ingredient_name", p.name);
                          }}
                        >
                          <option value="">-- เลือกวัตถุดิบ --</option>
                          {rawMaterials.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                        {rawMaterials.length === 0 && idx === 0 && (
                          <p className="text-xs text-amber-600">ยังไม่มีสินค้าประเภท raw_material</p>
                        )}
                      </div>
                      <div>
                        {idx === 0 && <Label className="text-xs">ปริมาณ</Label>}
                        <Input
                          type="number"
                          className="mt-1"
                          value={ing.quantity}
                          onChange={(e) => updateIngredient(idx, "quantity", e.target.value)}
                          min="0.001"
                          step="0.001"
                        />
                      </div>
                      <div>
                        {idx === 0 && <Label className="text-xs">หน่วย</Label>}
                        <Input
                          className="mt-1"
                          value={ing.unit}
                          onChange={(e) => updateIngredient(idx, "unit", e.target.value)}
                          placeholder="g/ml/ชิ้น"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeIngredient(idx)}
                        className={`flex h-10 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 ${idx === 0 ? "mt-6" : "mt-1"}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label>หมายเหตุ (ไม่บังคับ)</Label>
                <textarea
                  className="mt-1 min-h-16 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="เช่น ใช้นม oat แทน full cream ได้"
                />
              </div>

              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={resetForm}>ยกเลิก</Button>
                <Button
                  className="bg-orange-500 hover:bg-orange-600"
                  disabled={!formProductId || !formName || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? "กำลังบันทึก..." : "บันทึกสูตร"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
