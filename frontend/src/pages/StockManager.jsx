import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { DataTable, Field, useFetch, Pill } from "@/components/common";
import { Sel, LineEditor } from "@/pages/Purchasing";
import { Adjust } from "@/pages/Inventory";

export function Adjustments() {
  const { business } = useAuth();
  const c = business.currency;
  const { data, reload } = useFetch("/adjustments");
  const { data: outlets } = useFetch("/outlets");
  const { data: prods } = useFetch("/products");
  const [pick, setPick] = useState({ outlet_id: "", product_id: "" });
  const [row, setRow] = useState(null);
  const oname = Object.fromEntries((outlets || []).map((o) => [o.id, o.name]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end max-w-2xl">
        <Field label="Outlet" className="flex-1"><Sel value={pick.outlet_id} onChange={(v) => setPick({ ...pick, outlet_id: v })} options={outlets || []} testid="adj-outlet-select" /></Field>
        <Field label="Product" className="flex-1"><Sel value={pick.product_id} onChange={(v) => setPick({ ...pick, product_id: v })} options={prods || []} testid="adj-product-select" /></Field>
        <Button disabled={!pick.outlet_id || !pick.product_id} onClick={() => setRow({ product_id: pick.product_id, name: prods.find((p) => p.id === pick.product_id)?.name, qty: "?" })} data-testid="new-adjustment-btn"><Plus className="w-4 h-4 me-1" />New adjustment</Button>
      </div>
      <DataTable columns={[{ key: "created_at", label: "Date", date: true }, { key: "o", label: "Outlet", render: (r) => oname[r.outlet_id] }, { key: "product_name", label: "Product" },
        { key: "reason", label: "Reason", render: (r) => <Pill tone={r.qty > 0 ? "ok" : "warn"}>{r.reason}</Pill> }, { key: "qty", label: "Qty", num: true }, { key: "note", label: "Note" },
        { key: "value", label: "Value", money: true }]} rows={data || []} currency={c} testid="adjustments-table" />
      <Adjust row={row} outletId={pick.outlet_id} currency={c} onDone={reload} onClose={() => setRow(null)} />
    </div>
  );
}

export function StockTake() {
  const { business } = useAuth();
  const c = business.currency;
  const { data: outlets } = useFetch("/outlets");
  const [oid, setOid] = useState("");
  const { data: stock } = useFetch(oid ? `/stock?outlet_id=${oid}` : null, [oid]);
  const { data: takes, reload } = useFetch("/stocktakes");
  const [counts, setCounts] = useState({});
  const post = async () => {
    try {
      const { data } = await api.post("/stocktakes", { outlet_id: oid, counts: Object.entries(counts).map(([product_id, counted]) => ({ product_id, counted })) });
      toast.success(`${data.number} posted — ${data.lines.filter((l) => l.diff).length} differences corrected`); setCounts({}); reload();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      <div className="max-w-xs"><Field label="Outlet to count"><Sel value={oid} onChange={setOid} options={outlets || []} testid="stocktake-outlet-select" /></Field></div>
      {stock && (
        <>
          <DataTable columns={[{ key: "name", label: "Product" }, { key: "qty", label: "System", num: true },
            { key: "cnt", label: "Counted", render: (r) => <Input className="w-24 h-8" value={counts[r.product_id] ?? ""} onChange={(e) => setCounts({ ...counts, [r.product_id]: e.target.value.replace(/[^\d]/g, "") })} data-testid={`count-${r.product_id}`} /> },
            { key: "d", label: "Difference", num: true, render: (r) => (counts[r.product_id] !== undefined && counts[r.product_id] !== "" ? counts[r.product_id] - r.qty : "—") }]}
            rows={stock.filter((s) => s.track_stock).map((s) => ({ ...s, id: s.product_id }))} currency={c} testid="stocktake-count-table" />
          <Button onClick={post} disabled={!Object.values(counts).some((v) => v !== "")} data-testid="stocktake-post-btn">Post stock take</Button>
        </>
      )}
      <div className="text-xs uppercase tracking-widest text-muted-foreground pt-4">Previous counts</div>
      <DataTable columns={[{ key: "number", label: "Count" }, { key: "created_at", label: "Date", date: true }, { key: "created_by", label: "By" },
        { key: "n", label: "Items", render: (r) => r.lines.length }, { key: "diff_value", label: "Difference value", money: true }]} rows={takes || []} currency={c} testid="stocktakes-table" />
    </div>
  );
}

export function Transfers() {
  const { business } = useAuth();
  const c = business.currency;
  const { data, reload } = useFetch("/transfers");
  const { data: outlets } = useFetch("/outlets");
  const { data: prods } = useFetch("/products");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ from_outlet_id: "", to_outlet_id: "" });
  const [lines, setLines] = useState([{ product_id: "", qty: "" }]);
  const oname = Object.fromEntries((outlets || []).map((o) => [o.id, o.name]));
  const send = async () => {
    try { await api.post("/transfers", { ...f, lines }); toast.success("Dispatched — stock left the sending outlet"); setOpen(false); setLines([{ product_id: "", qty: "" }]); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const receive = async (t) => {
    if (t.status !== "in_transit" || !window.confirm(`Receive ${t.number} at ${oname[t.to_outlet_id]}?`)) return;
    try { await api.post(`/transfers/${t.id}/receive`); toast.success("Received"); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Send fresh goods from a manufacturing unit to a shop. Stock leaves on dispatch and arrives on receipt (click an in-transit row to receive).</p>
      <Button onClick={() => setOpen(true)} data-testid="new-transfer-btn"><Plus className="w-4 h-4 me-1" />New transfer</Button>
      <DataTable columns={[{ key: "number", label: "Transfer" }, { key: "created_at", label: "Sent", date: true }, { key: "f", label: "From", render: (r) => oname[r.from_outlet_id] },
        { key: "t", label: "To", render: (r) => oname[r.to_outlet_id] }, { key: "status", label: "Status", render: (r) => <Pill tone={r.status === "received" ? "ok" : "warn"}>{r.status.replace("_", " ")}</Pill> },
        { key: "u", label: "Units", num: true, render: (r) => r.lines.reduce((s, l) => s + l.qty, 0) }]} rows={data || []} currency={c} testid="transfers-table" onRow={receive} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl" data-testid="transfer-dialog">
          <DialogHeader><DialogTitle className="font-display">New stock transfer</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><Sel value={f.from_outlet_id} onChange={(v) => setF({ ...f, from_outlet_id: v })} options={outlets || []} testid="transfer-from-select" /></Field>
            <Field label="To"><Sel value={f.to_outlet_id} onChange={(v) => setF({ ...f, to_outlet_id: v })} options={outlets || []} testid="transfer-to-select" /></Field>
          </div>
          <LineEditor lines={lines} setLines={setLines} products={prods || []} />
          <Button onClick={send} disabled={!f.from_outlet_id || !f.to_outlet_id} data-testid="transfer-send-btn">Dispatch</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
