import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { fmt, toMinor } from "@/lib/money";
import { DataTable, Field, FileField, fileUrl, useFetch, useCatBrand, Pill, ReasonInput, PrintBtn } from "@/components/common";

export const Sel = ({ value, onChange, options, testid, placeholder = "Choose…" }) => (
  <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
    <option value="">{placeholder}</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
  </select>
);

export function LineEditor({ lines, setLines, products, withCost, currency }) {
  const cb = useCatBrand();
  const set = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const opts = (l) => products.filter((p) => cb.ok(p) || p.id === l.product_id);
  return (
    <div className="space-y-2">
      {cb.ui}
      {lines.map((l, i) => (
        <div key={l.key || i} className={`grid gap-2 ${withCost ? "grid-cols-[1fr_80px_110px_36px]" : "grid-cols-[1fr_90px_36px]"}`}>
          <Sel value={l.product_id} onChange={(v) => set(i, "product_id", v)} options={opts(l)} testid={`line-product-${i}`} placeholder="Product" />
          <Input placeholder="Qty" value={l.qty} onChange={(e) => set(i, "qty", e.target.value)} data-testid={`line-qty-${i}`} />
          {withCost && <Input placeholder={`Cost (${currency})`} value={l.cost} onChange={(e) => set(i, "cost", e.target.value)} data-testid={`line-cost-${i}`} />}
          <Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => setLines([...lines, { key: Date.now(), product_id: "", qty: "", cost: "" }])} data-testid="line-add-btn"><Plus className="w-4 h-4 me-1" />Line</Button>
      {withCost && <div className="text-sm text-end" data-testid="line-total">Total to pay: <b>{fmt(lines.reduce((s, l) => s + (+l.qty || 0) * toMinor(l.cost || "0", currency), 0), currency)}</b></div>}
    </div>
  );
}

const tone = { ordered: "info", partial: "warn", received: "ok", cancelled: "muted" };

function NewPO({ open, onClose, onDone, currency }) {
  const { data: outlets } = useFetch("/outlets");
  const { data: sups } = useFetch("/suppliers");
  const { data: prods } = useFetch("/products");
  const [f, setF] = useState({ outlet_id: "", supplier_id: "", due_date: "", note: "" });
  const [lines, setLines] = useState([{ product_id: "", qty: "", cost: "" }]);
  const save = async () => {
    try {
      await api.post("/purchase-orders", { ...f, lines: lines.map((l) => ({ ...l, cost: toMinor(l.cost, currency) })) });
      toast.success("Purchase order created"); setLines([{ product_id: "", qty: "", cost: "" }]); onDone(); onClose();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="po-dialog">
        <DialogHeader><DialogTitle className="font-display">New purchase order</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Deliver to"><Sel value={f.outlet_id} onChange={(v) => setF({ ...f, outlet_id: v })} options={outlets || []} testid="po-outlet-select" /></Field>
          <Field label="Supplier"><Sel value={f.supplier_id} onChange={(v) => setF({ ...f, supplier_id: v })} options={sups || []} testid="po-supplier-select" /></Field>
          <Field label="Due date (blank = supplier terms)"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} data-testid="po-due-date" /></Field>
        </div>
        <LineEditor lines={lines} setLines={setLines} products={prods || []} withCost currency={currency} />
        <Button onClick={save} disabled={!f.outlet_id} data-testid="po-save-btn">Create order</Button>
      </DialogContent>
    </Dialog>
  );
}

function PODetail({ po, onClose, onDone, currency }) {
  const [qty, setQty] = useState({});
  const [pay, setPay] = useState("");
  const [ret, setRet] = useState({});
  const [reason, setReason] = useState("");
  const [bill, setBill] = useState("");
  if (!po) return null;
  const act = (fn, msg) => async () => { try { await fn(); toast.success(msg); onDone(); onClose(); } catch (e) { toast.error(errMsg(e)); } };
  const open = !po.status || !["cancelled", "received"].includes(po.status);
  const net = po.received_value - (po.returned_value || 0);
  const bal = net - po.paid;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="po-detail-dialog">
        <DialogHeader><DialogTitle className="font-display">{po.number} · {po.supplier_name || "No supplier"} <Pill tone={tone[po.status]}>{po.status}</Pill></DialogTitle></DialogHeader>
        <div className="border divide-y text-sm">
          {po.lines.map((l, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1">{l.name}<span className="block text-xs text-muted-foreground">ordered {l.qty} · received {l.received}{l.returned ? ` · returned ${l.returned}` : ""} · {fmt(l.cost, currency)}/unit</span></span>
              {open && <Input className="w-20 h-8" placeholder="recv" value={qty[l.product_id] ?? ""} onChange={(e) => setQty({ ...qty, [l.product_id]: e.target.value })} data-testid={`po-receive-qty-${i}`} />}
              {l.received - (l.returned || 0) > 0 && <Input className="w-20 h-8" placeholder="return" value={ret[l.product_id] ?? ""} onChange={(e) => setRet({ ...ret, [l.product_id]: e.target.value })} data-testid={`po-return-qty-${i}`} />}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm" data-testid="po-money-summary">
          {[["Ordered value", po.total], ["Goods received", po.received_value], ["Returned to supplier", -(po.returned_value || 0)], ["Net payable", net], ["Paid", po.paid], ["Balance to pay", bal]].map(([l, v]) => (
            <div key={l} className={`border p-2 ${l === "Balance to pay" ? "border-primary" : ""}`}><div className="text-xs text-muted-foreground">{l}</div><div className="tabular font-semibold" data-testid={`po-sum-${l.toLowerCase().replace(/\W+/g, "-")}`}>{fmt(v, currency)}</div></div>))}
        </div>
        <div className="text-xs text-muted-foreground">Due {po.due_date || "—"}{po.supplier_invoice ? ` · supplier invoice ${po.supplier_invoice}` : ""}</div>
        {Object.values(ret).some((v) => +v > 0) && <ReasonInput value={reason} onChange={setReason} testid="po-return-reason" />}
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <FileField label="Original supplier bill" value={bill} onChange={setBill} testid="po-bill-file" />
          {bill && <Button size="sm" variant="outline" onClick={act(() => api.post(`/purchase-orders/${po.id}/bill`, { file_id: bill }), "Bill attached")} data-testid="po-bill-attach-btn">Attach to {po.number}</Button>}
          {(po.bills || []).map((b) => <a key={b.file_id} href={fileUrl(b.file_id)} target="_blank" rel="noreferrer" className="text-sm underline" data-testid={`po-bill-${b.file_id}`}>{b.name}</a>)}
          <div className="flex-1" />
          <PrintBtn kind="purchase" id={po.id} />
        </div>
        <div className="flex flex-wrap gap-2">
          {open && <Button onClick={act(() => api.post(`/purchase-orders/${po.id}/receive`, { lines: Object.entries(qty).map(([product_id, q]) => ({ product_id, qty: q })) }), "Goods received — stock & average cost updated")} data-testid="po-receive-btn">Receive</Button>}
          {po.status === "ordered" && <Button variant="outline" onClick={act(() => api.post(`/purchase-orders/${po.id}/cancel`, {}), "Order cancelled (kept on record)")} data-testid="po-cancel-btn">Cancel order</Button>}
          {Object.values(ret).some((v) => +v > 0) && <Button variant="outline" onClick={act(() => api.post("/purchase-returns", { po_id: po.id, reason, lines: Object.entries(ret).map(([product_id, q]) => ({ product_id, qty: q })) }), "Return to supplier recorded")} data-testid="po-return-btn">Return to supplier</Button>}
          {bal > 0 && <>
            <Input className="w-32" placeholder="Pay amount" value={pay} onChange={(e) => setPay(e.target.value)} data-testid="po-pay-input" />
            <Button variant="outline" onClick={act(() => api.post(`/purchase-orders/${po.id}/pay`, { amount: toMinor(pay, currency) }), "Payment recorded")} data-testid="po-pay-btn">Pay supplier</Button>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PurchaseOrders({ cancelled }) {
  const { business } = useAuth();
  const c = business.currency;
  const { data, reload } = useFetch("/purchase-orders");
  const [nw, setNw] = useState(false);
  const [sel, setSel] = useState(null);
  const rows = (data || []).filter((p) => (cancelled ? p.status === "cancelled" : p.status !== "cancelled"));
  return (
    <div className="space-y-4">
      {!cancelled && <Button onClick={() => setNw(true)} data-testid="new-po-btn"><Plus className="w-4 h-4 me-1" />New purchase order</Button>}
      <DataTable columns={[{ key: "number", label: "PO" }, { key: "created_at", label: "Date", date: true }, { key: "supplier_name", label: "Supplier" },
        { key: "status", label: "Status", render: (r) => <Pill tone={tone[r.status]}>{r.status}</Pill> }, { key: cancelled ? "cancel_reason" : "due_date", label: cancelled ? "Reason" : "Due" },
        { key: "total", label: "Ordered", money: true }, { key: "received_value", label: "Received", money: true }, { key: "paid", label: "Paid", money: true },
        { key: "bal", label: "To pay", num: true, render: (r) => fmt(r.received_value - (r.returned_value || 0) - r.paid, c) }]}
        rows={rows} currency={c} testid={cancelled ? "cancelled-po-table" : "po-table"} onRow={setSel} />
      <NewPO open={nw} onClose={() => setNw(false)} onDone={reload} currency={c} />
      <PODetail po={sel} onClose={() => setSel(null)} onDone={reload} currency={c} />
    </div>
  );
}

export function ReturnDetail({ r, onClose, currency, kind, children }) {
  if (!r) return null;
  const lines = r.lines || [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl" data-testid="return-detail-dialog">
        <DialogHeader><DialogTitle className="font-display">{r.number || r.receipt_no} · returned items</DialogTitle></DialogHeader>
        <div className="text-sm text-muted-foreground">{new Date(r.created_at).toLocaleString()} · {r.supplier_name || r.customer_name || ""} {r.by_name || r.created_by ? `· by ${r.by_name || r.created_by}` : ""}</div>
        <table className="w-full text-sm border" data-testid="return-lines-table">
          <thead><tr className="bg-muted/50"><th className="text-start p-2">Item</th><th className="text-end p-2">Qty returned</th><th className="text-end p-2">Amount</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={`${l.product_id}-${l.index ?? ""}`} className="border-t"><td className="p-2">{l.name}</td><td className="p-2 text-end tabular">{l.qty}</td><td className="p-2 text-end tabular">{fmt(l.amount ?? 0, currency)}</td></tr>)}</tbody>
          <tfoot><tr className="border-t font-semibold"><td className="p-2">Total</td><td className="p-2 text-end tabular" data-testid="return-total-qty">{lines.reduce((s, l) => s + l.qty, 0)}</td><td className="p-2 text-end tabular" data-testid="return-total-amount">{fmt(r.amount, currency)}</td></tr></tfoot>
        </table>
        <div className="text-sm">Reason: <b data-testid="return-reason">{r.reason || "—"}</b>{r.refund_method ? ` · refund: ${r.refund_method.replace("_", " ")}` : ""}{r.collected !== undefined ? ` · collected ${fmt(r.collected, currency)}` : ""}</div>
        <div className="flex flex-wrap gap-2">{children}<PrintBtn kind={kind} id={r.id} /></div>
      </DialogContent>
    </Dialog>
  );
}

export function PurchaseReturns() {
  const { business } = useAuth();
  const c = business.currency;
  const { data, reload } = useFetch("/purchase-returns");
  const [sel, setSel] = useState(null);
  const [amt, setAmt] = useState("");
  const collect = async () => {
    try { await api.post(`/purchase-returns/${sel.id}/collect`, { amount: toMinor(amt, c) }); toast.success("Collected"); setSel(null); setAmt(""); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Create a return from a received purchase order (open it under Purchase orders). Click a row to see items and record money collected.</p>
      <DataTable columns={[{ key: "number", label: "Return" }, { key: "po_number", label: "From PO" }, { key: "created_at", label: "Date", date: true }, { key: "supplier_name", label: "Supplier" },
        { key: "reason", label: "Reason" }, { key: "amount", label: "Worth", money: true }, { key: "collected", label: "Collected", money: true }]} rows={data || []} currency={c} testid="purchase-returns-table" onRow={setSel} />
      <ReturnDetail r={sel} onClose={() => setSel(null)} currency={c} kind="purchase_return">
        {sel && sel.amount > sel.collected && <><Input className="w-32" placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value)} data-testid="preturn-collect-input" /><Button variant="outline" onClick={collect} disabled={!amt} data-testid="preturn-collect-btn">Record money collected</Button></>}
      </ReturnDetail>
    </div>
  );
}
