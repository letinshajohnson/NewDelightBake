import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { api, errMsg } from "@/lib/api";
import { fmt, toMinor, toMajorStr, pctStr, toBps } from "@/lib/money";
import { PageHeader, DataTable, Field, useFetch, ExportBtn, exportCSV } from "@/components/common";

const blank = { name: "", sku: "", barcode: "", category_id: "", price: "", cost: "", tax: "5", image: "", station: "none", track_stock: true, low_stock: "10", points: "0", brand_id: "", unit_id: "", rack_id: "", wholesale: "" };

const Pick = ({ url, value, onChange, testid }) => {
  const { data } = useFetch(url);
  return <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testid}><option value="">—</option>{(data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>;
};

function ProductForm({ edit, setEdit, cats, currency, onSaved }) {
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });
  const save = async () => {
    const body = { ...edit, price: toMinor(edit.price, currency), cost: toMinor(edit.cost, currency), tax_bps: toBps(edit.tax), station: edit.station === "none" ? null : edit.station,
      level_prices: edit.wholesale ? { wholesale: toMinor(edit.wholesale, currency) } : {} };
    try {
      edit.id ? await api.put(`/products/${edit.id}`, body) : await api.post("/products", body);
      toast.success("Product saved"); setEdit(null); onSaved();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
      <DialogContent className="max-w-xl" data-testid="product-form-dialog">
        <DialogHeader><DialogTitle className="font-display">{edit?.id ? "Edit product" : "New product"}</DialogTitle></DialogHeader>
        {edit && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" className="col-span-2"><Input value={edit.name} onChange={set("name")} data-testid="product-name-input" /></Field>
            <Field label="Category">
              <Select value={edit.category_id || ""} onValueChange={(v) => setEdit({ ...edit, category_id: v })}>
                <SelectTrigger data-testid="product-category-select"><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Kitchen station">
              <Select value={edit.station || "none"} onValueChange={(v) => setEdit({ ...edit, station: v })}>
                <SelectTrigger data-testid="product-station-select"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="kitchen">Kitchen</SelectItem><SelectItem value="bar">Bar</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Selling price"><Input value={edit.price} onChange={set("price")} inputMode="decimal" data-testid="product-price-input" /></Field>
            <Field label="Cost (opening)"><Input value={edit.cost} onChange={set("cost")} inputMode="decimal" data-testid="product-cost-input" /></Field>
            <Field label="Wholesale price (customer type)"><Input value={edit.wholesale} onChange={set("wholesale")} inputMode="decimal" data-testid="product-wholesale-input" /></Field>
            <Field label="Brand"><Pick url="/brands" value={edit.brand_id} onChange={(v) => setEdit({ ...edit, brand_id: v })} testid="product-brand-select" /></Field>
            <Field label="Unit"><Pick url="/units" value={edit.unit_id} onChange={(v) => setEdit({ ...edit, unit_id: v })} testid="product-unit-select" /></Field>
            <Field label="Rack"><Pick url="/racks" value={edit.rack_id} onChange={(v) => setEdit({ ...edit, rack_id: v })} testid="product-rack-select" /></Field>
            <Field label="Tax %"><Input value={edit.tax} onChange={set("tax")} inputMode="decimal" data-testid="product-tax-input" /></Field>
            <Field label="Loyalty points per unit"><Input value={edit.points} onChange={set("points")} inputMode="numeric" data-testid="product-points-input" /></Field>
            <Field label="Barcode"><Input value={edit.barcode} onChange={set("barcode")} data-testid="product-barcode-input" /></Field>
            <Field label="SKU"><Input value={edit.sku} onChange={set("sku")} data-testid="product-sku-input" /></Field>
            <Field label="Image URL" className="col-span-2"><Input value={edit.image || ""} onChange={set("image")} placeholder="/img/latte.jpg or https://…" data-testid="product-image-input" /></Field>
            <Field label="Low-stock alert at"><Input value={edit.low_stock} onChange={set("low_stock")} inputMode="numeric" data-testid="product-lowstock-input" /></Field>
            <label className="flex items-center gap-3 pt-6 text-sm"><Switch checked={edit.track_stock} onCheckedChange={(v) => setEdit({ ...edit, track_stock: v })} data-testid="product-track-stock-switch" />Track stock</label>
            <Button className="col-span-2 h-11" onClick={save} disabled={!edit.name || !edit.price} data-testid="product-save-btn">Save product</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Products() {
  const { business } = useAuth();
  const { t } = useI18n();
  const c = business.currency;
  const { data: prods, reload } = useFetch("/products");
  const { data: cats, reload: reloadCats } = useFetch("/categories");
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState("");
  const [newCat, setNewCat] = useState("");
  const catName = Object.fromEntries((cats || []).map((x) => [x.id, x.name]));
  const rows = (prods || []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.barcode?.includes(q));
  const cols = [
    { key: "image", label: "", render: (p) => p.image ? <img src={p.image} alt="" className="w-10 h-10 object-cover rounded" /> : <div className="w-10 h-10 bg-muted rounded" /> },
    { key: "name", label: "Name" }, { key: "cat", label: "Category", render: (p) => <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: (cats || []).find((x) => x.id === p.category_id)?.color }} />{catName[p.category_id] || "—"}</span> },
    { key: "barcode", label: "Barcode" }, { key: "tax_bps", label: "Tax", render: (p) => pctStr(p.tax_bps) },
    { key: "cost", label: "Cost", money: true }, { key: "price", label: "Price", money: true },
    { key: "x", label: "", render: (p) => <Button size="icon" variant="ghost" onClick={async (e) => { e.stopPropagation(); await api.delete(`/products/${p.id}`); reload(); }} data-testid={`delete-product-${p.id}`}><Trash2 className="w-4 h-4 text-destructive" /></Button> },
  ];
  const open = (p) => setEdit({ ...blank, ...p, price: toMajorStr(p.price, c), cost: toMajorStr(p.cost || 0, c), tax: String((p.tax_bps || 0) / 100), low_stock: String(p.low_stock || 0), points: String(p.points || 0), wholesale: p.level_prices?.wholesale ? toMajorStr(p.level_prices.wholesale, c) : "" });
  return (
    <div>
      <PageHeader title={t("products")} sub="Catalogue shared by every branch. Cost here seeds the moving average; purchases update it.">
        <ExportBtn onClick={() => exportCSV("products", [{ key: "name", label: "Name" }, { key: "sku", label: "SKU" }, { key: "barcode", label: "Barcode" }, { key: "price", label: "Price", money: true }, { key: "cost", label: "Cost", money: true }, { key: "tax_bps", label: "Tax bps" }], rows, c)} />
        <Button onClick={() => setEdit({ ...blank, category_id: cats?.[0]?.id })} data-testid="add-product-btn"><Plus className="w-4 h-4 me-1" />New product</Button>
      </PageHeader>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" data-testid="products-search-input" />
        <div className="flex-1" />
        {(cats || []).map((x) => <span key={x.id} className="text-xs px-2 py-1 bg-muted rounded">{x.name}</span>)}
        <Input placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} className="w-40 h-9" data-testid="new-category-input" />
        <Button size="sm" variant="outline" disabled={!newCat} onClick={async () => { await api.post("/categories", { name: newCat }); setNewCat(""); reloadCats(); }} data-testid="add-category-btn">Add</Button>
      </div>
      <DataTable columns={cols} rows={rows} currency={c} testid="products-table" onRow={open} />
      <ProductForm edit={edit} setEdit={setEdit} cats={cats || []} currency={c} onSaved={reload} />
      <div className="text-xs text-muted-foreground mt-3">{rows.length} products · prices in {c} ({fmt(100, c)} = 100 minor units)</div>
    </div>
  );
}
