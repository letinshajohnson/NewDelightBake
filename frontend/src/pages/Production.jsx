import { useState } from "react";
import { toast } from "sonner";
import { Upload, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { fmt } from "@/lib/money";
import { DataTable, Field, useFetch, exportCSV } from "@/components/common";
import { Sel, LineEditor } from "@/pages/Purchasing";

export function Recipes({ kits }) {
  const { data: prods, reload } = useFetch("/products");
  const [pid, setPid] = useState("");
  const [lines, setLines] = useState([]);
  const [yieldQty, setYield] = useState("");
  const p = (prods || []).find((x) => x.id === pid);
  const pick = (id) => {
    const x = prods.find((y) => y.id === id);
    setPid(id);
    setLines((x?.recipe || []).map((r) => ({ product_id: r.product_id, qty: String(r.qty) })));
    setYield(String(x?.batch_yield || (kits ? 1 : "")));
  };
  const save = async () => {
    const recipe = lines.filter((l) => l.product_id && +l.qty > 0).map((l) => ({ product_id: l.product_id, qty: parseInt(l.qty, 10), name: prods.find((x) => x.id === l.product_id)?.name }));
    try { await api.put(`/products/${pid}`, { recipe, batch_yield: parseInt(yieldQty || "1", 10), is_kit: !!kits, ...(kits ? { track_stock: false } : {}) }); toast.success("Saved"); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const targets = (prods || []).filter((x) => !x.is_raw);
  const parts = (prods || []).filter((x) => (kits ? !x.is_raw && x.id !== pid : x.is_raw || x.id !== pid));
  return (
    <div className="grid lg:grid-cols-[1fr_1fr] gap-8">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{kits ? "A gift pack is a product made of other products. When a pack is sold, each item inside it leaves stock (the pack itself has no stock of its own)." : "List the raw materials (and how much) one batch of this item uses, and how many pieces a batch gives."}</p>
        <Field label={kits ? "Kit product" : "Item made"}><Sel value={pid} onChange={pick} options={targets} testid="recipe-product-select" /></Field>
        {p && <>
          <Field label={kits ? "Packs made from these items" : "Pieces per batch"}><Input value={yieldQty} onChange={(e) => setYield(e.target.value)} className="w-32" data-testid="recipe-yield-input" /></Field>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">{kits ? "Items inside the pack" : "Raw materials per batch (qty in the material's unit)"}</div>
          <LineEditor lines={lines} setLines={setLines} products={parts} />
          <Button onClick={save} data-testid="recipe-save-btn">Save {kits ? "kit" : "recipe"}</Button>
        </>}
      </div>
      <DataTable columns={[{ key: "name", label: kits ? "Kit" : "Item" }, { key: "batch_yield", label: kits ? "Packs" : "Per batch", num: true },
        { key: "r", label: "Contents", render: (x) => (x.recipe || []).map((r) => `${r.name} ×${r.qty}`).join(", ") }]}
        rows={(prods || []).filter((x) => x.recipe?.length && !!x.is_kit === !!kits)} testid={kits ? "kits-table" : "recipes-table"} onRow={(x) => pick(x.id)} />
    </div>
  );
}

export function ProductionRuns() {
  const { business } = useAuth();
  const c = business.currency;
  const { data, reload } = useFetch("/production");
  const { data: prods } = useFetch("/products");
  const { data: outlets } = useFetch("/outlets");
  const [f, setF] = useState({ product_id: "", outlet_id: "", batches: "1", produced_qty: "", date: "", note: "" });
  const p = (prods || []).find((x) => x.id === f.product_id);
  const save = async () => {
    try { const { data: r } = await api.post("/production", f); toast.success(`${r.produced_qty} × ${r.product_name} added · ${fmt(r.unit_cost, c)}/pc`); reload(); setF({ ...f, produced_qty: "", note: "" }); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const cols = [{ key: "date", label: "Date" }, { key: "product_name", label: "Product made" }, { key: "batches", label: "Batches", num: true },
    { key: "materials_text", label: "Raw materials taken" }, { key: "expected_qty", label: "Expected", num: true }, { key: "produced_qty", label: "Got", num: true },
    { key: "sold_same_day", label: "Sold (day)", num: true }, { key: "returned_same_day", label: "Returned (day)", num: true },
    { key: "material_cost", label: "Material cost", money: true }, { key: "unit_cost", label: "Cost / pc", money: true }];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end">
        <Field label="Outlet / unit"><Sel value={f.outlet_id} onChange={(v) => setF({ ...f, outlet_id: v })} options={outlets || []} testid="prod-outlet-select" /></Field>
        <Field label="Product" className="md:col-span-2"><Sel value={f.product_id} onChange={(v) => setF({ ...f, product_id: v })} options={(prods || []).filter((x) => x.recipe?.length && !x.is_kit)} testid="prod-product-select" /></Field>
        <Field label="Batches"><Input value={f.batches} onChange={(e) => setF({ ...f, batches: e.target.value })} data-testid="prod-batches-input" /></Field>
        <Field label={`Got (expected ${p ? (p.batch_yield || 0) * (+f.batches || 0) : "—"})`}><Input value={f.produced_qty} onChange={(e) => setF({ ...f, produced_qty: e.target.value })} data-testid="prod-qty-input" /></Field>
        <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="prod-date-input" /></Field>
        <Button onClick={save} disabled={!f.product_id || !f.outlet_id || !f.produced_qty} data-testid="prod-save-btn">Record production</Button>
      </div>
      <div className="flex justify-end"><Button variant="outline" onClick={() => exportCSV("production", cols, data || [], c)} data-testid="prod-export-btn"><Download className="w-4 h-4 me-2" />Export CSV</Button></div>
      <DataTable columns={cols} rows={data || []} currency={c} testid="production-table" />
      <p className="text-xs text-muted-foreground">For sold and returned totals over any period, see Reports → Sales by product and Sales returns by product.</p>
    </div>
  );
}

const TEMPLATES = {
  purchase: ["supplier", "supplier_gstin", "invoice_no", "date", "due_date", "item", "hsn", "mrp", "qty", "rate", "gst"],
  products: ["name", "category", "unit", "raw_material", "sku", "barcode", "hsn", "price", "cost", "gst"],
  customers: ["name", "phone", "gstin"],
  suppliers: ["name", "type", "phone", "gstin", "terms_days"],
  expenses: ["date", "category", "amount", "method", "note"],
};
const SAMPLES = {
  purchase: [["LACHMANDAS ENTERPRISES", "32AAJFL3539N1Z0", "LE/26-27/039769", "2026-10-31", "2026-11-15", "SAMPLE ITEM 50G", "19053100", "35.00", "10", "29.76", "5"]],
  products: [["Maida flour", "Raw materials", "kg", "yes", "", "", "1101", "0", "42.00", "0"]],
  expenses: [["2026-11-01", "Staff salary", "15000", "cash", "[Staff name] October salary"]],
};
const LABELS = { purchase: "Purchase bills", products: "Products & raw materials", customers: "Customers", suppliers: "Suppliers & agents", expenses: "Expenses" };

async function readSheet(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true, dateNF: "yyyy-mm-dd" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false, dateNF: "yyyy-mm-dd" });
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/^\ufeff/, "").trim().toLowerCase(), String(v).trim()])));
}

function download(name, head, body, format) {
  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body]), "data");
    XLSX.writeFile(wb, `${name}.xlsx`);
    return;
  }
  const blob = new Blob([[head, ...body].map((r) => r.join(",")).join("\n") + "\n"], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}.csv`; a.click();
}

export function ImportExport() {
  const { business } = useAuth();
  const { data: outlets } = useFetch("/outlets");
  const [kind, setKind] = useState("purchase");
  const [rows, setRows] = useState([]);
  const [outlet, setOutlet] = useState("");
  const [format, setFormat] = useState("xlsx");
  const template = () => download(`${kind}-template`, TEMPLATES[kind], SAMPLES[kind] || [], format);
  const needOutlet = kind === "purchase";
  const run = async () => {
    try { const { data } = await api.post(`/import/${kind}`, { rows, outlet_id: outlet }); toast.success(`Imported ${data.imported} ${kind === "purchase" ? "bills" : "records"}`); setRows([]); setFile(""); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const [file, setFile] = useState("");
  const MONEY = ["price", "cost", "total", "amount", "subtotal", "paid", "tax", "amount_due", "material_cost", "unit_cost", "received_value", "credit_limit", "gross", "line_discount", "order_discount_amount", "change"];
  const exp = async (url, name) => {
    const { data } = await api.get(url);
    const keys = [...new Set(data.flatMap((r) => Object.keys(r)))].filter((k) => data.every((r) => r[k] == null || typeof r[k] !== "object") && k !== "business_id");
    exportCSV(name, keys.map((k) => ({ key: k, label: k, money: MONEY.includes(k) })), data, business.currency, format);
  };
  return (
    <div className="grid lg:grid-cols-2 gap-10">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">File format</div>
          {[["xlsx", "Excel (.xlsx)"], ["csv", "CSV"]].map(([k, l]) => <Button key={k} size="sm" variant={format === k ? "default" : "outline"} onClick={() => setFormat(k)} data-testid={`format-${k}`}>{l}</Button>)}
        </div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground pt-2">Import</div>
        <div className="flex flex-wrap gap-2">{Object.keys(TEMPLATES).map((k) => <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => { setKind(k); setRows([]); setFile(""); }} data-testid={`import-kind-${k}`}>{LABELS[k]}</Button>)}</div>
        <p className="text-sm text-muted-foreground">Columns: <code>{TEMPLATES[kind].join(", ")}</code>. Dates as YYYY-MM-DD, amounts in rupees.{kind === "purchase" && " One row per bill line, like your GST invoices (HSN, MRP, Qty, Rate before GST, GST %). Rows with the same supplier + invoice no. become one received purchase; new items and suppliers are created automatically. Have a photo instead? Use the Scan purchase bill tab."}{kind === "products" && " Put yes in raw_material for flour, eggs, packing etc."}</p>
        {(needOutlet || kind === "expenses") && <Field label={needOutlet ? "Receive stock into" : "Outlet (optional)"}><Sel value={outlet} onChange={setOutlet} options={outlets || []} testid="import-outlet-select" /></Field>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={template} data-testid="import-template-btn"><Download className="w-4 h-4 me-2" />Template</Button>
          <label className="inline-flex items-center gap-2 px-4 h-9 border rounded-md text-sm cursor-pointer hover:bg-accent" data-testid="import-file-label"><Upload className="w-4 h-4" />{file || "Choose Excel or CSV"}
            <input type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files[0]; if (f) { try { setRows(await readSheet(f)); setFile(f.name); } catch { toast.error("Could not read this file"); } } e.target.value = ""; }} data-testid="import-file-input" /></label>
          <Button disabled={!rows.length || (needOutlet && !outlet)} onClick={run} data-testid="import-run-btn">Import {rows.length || ""} rows</Button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Export ({format === "xlsx" ? "Excel" : "CSV"})</div>
        {[["/products", "products"], ["/customers", "customers"], ["/suppliers", "suppliers"], ["/purchase-orders", "purchases"], ["/sales", "sales"], ["/cash", "expenses-and-cash"], ["/production", "production"], ["/stock/ledger", "stock-ledger"]].map(([u, n]) => (
          <Button key={n} variant="outline" className="me-2 mb-2" onClick={() => exp(u, n)} data-testid={`export-${n}`}><Download className="w-4 h-4 me-2" />{n}</Button>))}
      </div>
    </div>
  );
}
