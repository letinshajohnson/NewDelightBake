import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { fmt, toMinor, toBps, pctStr } from "@/lib/money";
import { DataTable, Field, useFetch, Pill, Stat } from "@/components/common";
import { Sel } from "@/pages/Purchasing";

export function CashList({ type }) {
  const { business } = useAuth();
  const c = business.currency;
  const { data, reload } = useFetch("/cash");
  const { data: cats } = useFetch("/cash-categories");
  const { data: outlets } = useFetch("/outlets");
  const [f, setF] = useState({ category: "", amount: "", note: "", outlet_id: "", date: "" });
  const [q, setQ] = useState("");
  const add = async () => {
    try { await api.post("/cash", { ...f, type, amount: toMinor(f.amount, c) }); toast.success("Recorded"); setF({ ...f, amount: "", note: "" }); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const rows = (data || []).filter((x) => x.type === type && (!q || `${x.category} ${x.note || ""}`.toLowerCase().includes(q.toLowerCase())));
  const catOpts = (cats || []).filter((x) => x.type === type).map((x) => ({ id: x.name, name: x.name }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
        <Field label="Outlet"><Sel value={f.outlet_id} onChange={(v) => setF({ ...f, outlet_id: v })} options={outlets || []} testid={`cash-${type}-outlet`} /></Field>
        <Field label="Category"><Sel value={f.category} onChange={(v) => setF({ ...f, category: v })} options={catOpts} testid={`cash-${type}-category`} /></Field>
        <Field label="Amount"><Input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid={`cash-${type}-amount`} /></Field>
        <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid={`cash-${type}-date`} /></Field>
        <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} data-testid={`cash-${type}-note`} /></Field>
        <Button onClick={add} disabled={!toMinor(f.amount, c) || !f.category} data-testid={`cash-${type}-save`}>Record cash {type}</Button>
      </div>
      <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" data-testid={`cash-${type}-search`} />
      <DataTable columns={[{ key: "created_at", label: "Date", date: true }, { key: "category", label: "Category" }, { key: "note", label: "Note" }, { key: "user_name", label: "By" },
        { key: "s", label: "Source", render: (r) => <Pill>{r.shift_id ? "till" : "back office"}</Pill> }, { key: "amount", label: "Amount", money: true }]} rows={rows} currency={c} testid={`cash-${type}-table`} />
    </div>
  );
}

export function PaymentMethods() {
  const { business, setBusiness, user } = useAuth();
  const [ms, setMs] = useState(business.payment_methods || []);
  const set = (i, k, v) => setMs(ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const save = async () => {
    try { const { data } = await api.put("/business", { payment_methods: ms.map((m) => ({ ...m, code: m.code || m.name.toLowerCase().replace(/\W+/g, "_"), fee_bps: typeof m.fee_bps === "string" ? toBps(m.fee_bps) : m.fee_bps || 0 })) }); setBusiness(data); toast.success("Saved"); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-3 max-w-xl">
      {ms.map((m, i) => (
        <div key={i} className="grid grid-cols-[1fr_120px_auto] gap-2 items-center">
          <Input value={m.name} onChange={(e) => set(i, "name", e.target.value)} data-testid={`pm-name-${i}`} />
          <Input value={typeof m.fee_bps === "string" ? m.fee_bps : String((m.fee_bps || 0) / 100)} onChange={(e) => set(i, "fee_bps", e.target.value)} placeholder="Fee %" data-testid={`pm-fee-${i}`} />
          <Button variant="ghost" onClick={() => setMs(ms.filter((_, j) => j !== i))} disabled={m.code === "cash"}>Remove</Button>
        </div>
      ))}
      <div className="flex gap-2"><Button variant="outline" onClick={() => setMs([...ms, { name: "", fee_bps: 0 }])} data-testid="pm-add-btn">Add method</Button>
        {user.role === "owner" && <Button onClick={save} data-testid="pm-save-btn">Save</Button>}</div>
      <p className="text-xs text-muted-foreground">Fees are shown per method ({ms.map((m) => `${m.name} ${pctStr(typeof m.fee_bps === "number" ? m.fee_bps : toBps(m.fee_bps))}`).join(", ")}).</p>
    </div>
  );
}

export function Payables() {
  const { business } = useAuth();
  const c = business.currency;
  const { data: pay, reload: rp } = useFetch("/payables");
  const { data: rec, reload: rr } = useFetch("/receivables");
  const settle = (kind) => async (r) => {
    const v = window.prompt(`${kind === "pay" ? "Pay supplier" : "Receive from customer"} — balance ${fmt(r.balance, c)}`, "");
    if (!v) return;
    try {
      await api.post(kind === "pay" ? `/purchase-orders/${r.id}/pay` : `/sales/${r.id}/pay`, { amount: toMinor(v, c) });
      toast.success("Payment recorded"); rp(); rr();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const sum = (rows) => (rows || []).reduce((s, r) => s + r.balance, 0);
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border">
        <Stat label="We owe suppliers" value={fmt(sum(pay), c)} testid="payables-total" accent="text-warning" />
        <Stat label="Overdue payables" value={(pay || []).filter((r) => r.overdue).length} testid="payables-overdue" />
        <Stat label="Customers owe us" value={fmt(sum(rec), c)} testid="receivables-total" accent="text-primary" />
        <Stat label="Receivables 60+ days" value={fmt(sum((rec || []).filter((r) => r.bucket === "60+")), c)} testid="receivables-old" />
      </div>
      <div><div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Payables — unpaid received purchases (click to pay)</div>
        <DataTable columns={[{ key: "number", label: "PO" }, { key: "party", label: "Supplier" }, { key: "due_date", label: "Due" },
          { key: "o", label: "", render: (r) => (r.overdue ? <Pill tone="bad">overdue</Pill> : null) }, { key: "amount", label: "Received", money: true },
          { key: "paid", label: "Paid", money: true }, { key: "balance", label: "Balance", money: true }]} rows={pay || []} currency={c} testid="payables-table" onRow={settle("pay")} /></div>
      <div><div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Receivables — credit sales (click to receive)</div>
        <DataTable columns={[{ key: "number", label: "Receipt" }, { key: "party", label: "Customer" }, { key: "date", label: "Date", date: true },
          { key: "bucket", label: "Age", render: (r) => <Pill tone={r.bucket === "60+" ? "bad" : r.bucket === "31-60" ? "warn" : "muted"}>{r.age_days}d</Pill> },
          { key: "amount", label: "Total", money: true }, { key: "paid", label: "Paid", money: true }, { key: "balance", label: "Balance", money: true }]} rows={rec || []} currency={c} testid="receivables-table" onRow={settle("rec")} /></div>
    </div>
  );
}

export function SalesReturns() {
  const { business } = useAuth();
  const { data } = useFetch("/returns");
  return <DataTable columns={[{ key: "receipt_no", label: "From receipt" }, { key: "created_at", label: "Date", date: true }, { key: "by_name", label: "By" },
    { key: "refund_method", label: "Refunded as", render: (r) => <Pill>{r.refund_method.replace("_", " ")}</Pill> }, { key: "reason", label: "Reason" },
    { key: "n", label: "Items", render: (r) => r.lines.map((l) => `${l.qty}× ${l.name}`).join(", ") }, { key: "amount", label: "Amount", money: true }]}
    rows={data || []} currency={business.currency} testid="sales-returns-table" />;
}

export function VoidedSales() {
  const { business } = useAuth();
  const { data } = useFetch("/voids");
  return <DataTable columns={[{ key: "receipt_no", label: "Receipt" }, { key: "created_at", label: "Voided", date: true }, { key: "reason", label: "Reason" },
    { key: "amount", label: "Amount", money: true }]} rows={data || []} currency={business.currency} testid="voided-sales-table" />;
}

export function BusinessObject({ field, items, note }) {
  const { business, setBusiness, user } = useAuth();
  const [v, setV] = useState(business[field] || {});
  const save = async () => { try { const { data } = await api.put("/business", { [field]: v }); setBusiness(data); toast.success("Saved"); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-3 max-w-xl">
      {items.map(([k, label, type]) => (
        type === "bool"
          ? <label key={k} className="flex items-center gap-3 text-sm"><Switch checked={!!v[k]} onCheckedChange={(x) => setV({ ...v, [k]: x })} data-testid={`${field}-${k}`} />{label}</label>
          : <Field key={k} label={label}><Input type={type === "secret" ? "password" : "text"} value={v[k] || ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} data-testid={`${field}-${k}`} /></Field>
      ))}
      {note && <p className="text-xs text-warning">{note}</p>}
      {user.role === "owner" ? <Button onClick={save} data-testid={`${field}-save-btn`}>Save</Button> : <p className="text-xs text-muted-foreground">Only the owner can change these.</p>}
    </div>
  );
}
