import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { api, errMsg } from "@/lib/api";
import { toMinor } from "@/lib/money";
import { PageHeader, DataTable, Field, useFetch, Pill } from "@/components/common";

const REASONS = ["opening", "breakage", "loss", "sample", "stocktake", "other"];

function Adjust({ row, outletId, currency, onDone, onClose }) {
  const [f, setF] = useState({ qty: "", reason: "breakage", cost: "", note: "" });
  if (!row) return null;
  const save = async () => {
    try {
      await api.post("/stock/adjust", { outlet_id: outletId, product_id: row.product_id, qty: parseInt(f.qty, 10), reason: f.reason, cost: f.cost ? toMinor(f.cost, currency) : null, note: f.note });
      toast.success("Stock adjusted"); onDone(); onClose();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="adjust-dialog">
        <DialogHeader><DialogTitle className="font-display">Adjust · {row.name}</DialogTitle></DialogHeader>
        <div className="text-sm text-muted-foreground">On hand: <b className="tabular">{row.qty}</b>. Use a negative number to remove stock.</div>
        <Field label="Quantity (+/-)"><Input value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="numeric" data-testid="adjust-qty-input" /></Field>
        <Field label="Reason">
          <Select value={f.reason} onValueChange={(v) => setF({ ...f, reason: v })}>
            <SelectTrigger data-testid="adjust-reason-select"><SelectValue /></SelectTrigger>
            <SelectContent>{REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {parseInt(f.qty, 10) > 0 && <Field label="Unit cost (optional, updates average)"><Input value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} data-testid="adjust-cost-input" /></Field>}
        <Input placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} data-testid="adjust-note-input" />
        <Button disabled={!parseInt(f.qty, 10)} onClick={save} data-testid="adjust-save-btn">Save adjustment</Button>
      </DialogContent>
    </Dialog>
  );
}

function Receive({ outletId, products, currency, onDone }) {
  const { data: sups } = useFetch("/suppliers");
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState([{ product_id: "", qty: "", cost: "" }]);
  const set = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const save = async () => {
    try {
      await api.post("/purchases", { outlet_id: outletId, supplier_id: supplier || null, lines: lines.filter((l) => l.product_id && l.qty).map((l) => ({ product_id: l.product_id, qty: parseInt(l.qty, 10), cost: toMinor(l.cost, currency) })) });
      toast.success("Goods received — stock and moving-average cost updated");
      setLines([{ product_id: "", qty: "", cost: "" }]); onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="bg-card border p-6 space-y-4 max-w-3xl" data-testid="receive-form">
      <Field label="Supplier">
        <Select value={supplier} onValueChange={setSupplier}>
          <SelectTrigger className="max-w-xs" data-testid="receive-supplier-select"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
          <SelectContent>{(sups || []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_100px_140px_40px] gap-2">
          <Select value={l.product_id} onValueChange={(v) => set(i, "product_id", v)}>
            <SelectTrigger data-testid={`receive-product-${i}`}><SelectValue placeholder="Product" /></SelectTrigger>
            <SelectContent>{products.filter((p) => p.track_stock).map((p) => <SelectItem key={p.product_id} value={p.product_id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Qty" value={l.qty} onChange={(e) => set(i, "qty", e.target.value)} data-testid={`receive-qty-${i}`} />
          <Input placeholder="Unit cost" value={l.cost} onChange={(e) => set(i, "cost", e.target.value)} data-testid={`receive-cost-${i}`} />
          <Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setLines([...lines, { product_id: "", qty: "", cost: "" }])} data-testid="receive-add-line"><Plus className="w-4 h-4 me-1" />Line</Button>
        <Button onClick={save} data-testid="receive-save-btn">Receive goods</Button>
      </div>
    </div>
  );
}

export default function Inventory() {
  const { business } = useAuth();
  const { t } = useI18n();
  const c = business.currency;
  const { data: outlets } = useFetch("/outlets");
  const [oid, setOid] = useState(null);
  const outletId = oid || outlets?.[0]?.id;
  const { data: stock, reload } = useFetch(outletId ? `/stock?outlet_id=${outletId}` : null, [outletId]);
  const { data: ledger, reload: reloadLedger } = useFetch(outletId ? `/stock/ledger?outlet_id=${outletId}` : null, [outletId]);
  const [adj, setAdj] = useState(null);
  const done = () => { reload(); reloadLedger(); };
  const cols = [
    { key: "name", label: "Product" }, { key: "sku", label: "SKU" },
    { key: "qty", label: "On hand", num: true, render: (r) => !r.track_stock ? <Pill>service</Pill> : <span className={r.qty <= r.low_stock ? "text-warning font-medium" : ""}>{r.qty}</span> },
    { key: "avg_cost", label: "Avg cost", money: true }, { key: "value", label: "Stock value", money: true },
  ];
  const rows = (stock || []).map((r) => ({ ...r, id: r.product_id, value: Math.max(r.qty, 0) * r.avg_cost }));
  const lcols = [
    { key: "created_at", label: "Time", date: true }, { key: "product_name", label: "Product" }, { key: "ref_type", label: "Movement" },
    { key: "qty", label: "Qty", num: true, render: (r) => <span className={r.qty < 0 ? "text-destructive" : "text-success"}>{r.qty > 0 ? `+${r.qty}` : r.qty}</span> },
    { key: "balance", label: "Balance", num: true }, { key: "unit_cost", label: "Unit cost", money: true },
  ];
  return (
    <div>
      <PageHeader title={t("inventory")} sub="Stock only moves through the ledger. Every row ties back to the sale, purchase, return or adjustment behind it.">
        <Select value={outletId || ""} onValueChange={setOid}>
          <SelectTrigger className="w-48" data-testid="inventory-outlet-select"><SelectValue /></SelectTrigger>
          <SelectContent>{(outlets || []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
        </Select>
      </PageHeader>
      <Tabs defaultValue="levels">
        <TabsList className="mb-4">
          <TabsTrigger value="levels" data-testid="inv-tab-levels">Stock levels</TabsTrigger>
          <TabsTrigger value="ledger" data-testid="inv-tab-ledger">Stock ledger</TabsTrigger>
          <TabsTrigger value="receive" data-testid="inv-tab-receive">Receive purchase</TabsTrigger>
        </TabsList>
        <TabsContent value="levels"><DataTable columns={cols} rows={rows} currency={c} testid="stock-table" onRow={(r) => r.track_stock && setAdj(r)} /></TabsContent>
        <TabsContent value="ledger"><DataTable columns={lcols} rows={ledger || []} currency={c} testid="ledger-table" /></TabsContent>
        <TabsContent value="receive"><Receive outletId={outletId} products={stock || []} currency={c} onDone={done} /></TabsContent>
      </Tabs>
      <Adjust row={adj} outletId={outletId} currency={c} onDone={done} onClose={() => setAdj(null)} />
    </div>
  );
}
