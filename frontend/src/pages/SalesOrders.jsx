import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { fmt, toMinor, toMajorStr } from "@/lib/money";
import { DataTable, Field, useFetch, Pill, PrintBtn, OutletFilter } from "@/components/common";
import { Sel } from "@/pages/Purchasing";

const STATUS = [["booked", "Booked"], ["in_production", "In production"], ["ready", "Ready"], ["delivered", "Delivered / picked up"], ["cancelled", "Cancelled"]];
const tone = { booked: "info", in_production: "warn", ready: "ok", delivered: "muted", cancelled: "bad" };
const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({ customer_id: "", customer_name: "", phone: "", email: "", bill_name: "", order_date: today(), delivery_date: "", delivery_time: "", delivery_mode: "pickup",
  location: "", outlet_id: "", status: "booked", note: "", advance: "", method: "cash", lines: [{ k: 1, product_id: "", name: "", qty: "1", price: "" }] });

function Lines({ f, setF, prods, c }) {
  const set = (i, patch) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const pick = (i, id) => { const p = prods.find((x) => x.id === id); set(i, { product_id: id, name: p?.name || "", price: p ? toMajorStr(p.price, c) : "" }); };
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">Products</div>
      {f.lines.map((l, i) => (
        <div key={l.k} className="grid grid-cols-[1fr_1fr_70px_100px_36px] gap-2">
          <Sel value={l.product_id} onChange={(v) => pick(i, v)} options={prods} testid={`so-line-product-${i}`} placeholder="From catalogue…" />
          <Input placeholder="Item name" value={l.name} onChange={(e) => set(i, { name: e.target.value })} data-testid={`so-line-name-${i}`} />
          <Input placeholder="Qty" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} data-testid={`so-line-qty-${i}`} />
          <Input placeholder="Rate" value={l.price} onChange={(e) => set(i, { price: e.target.value })} data-testid={`so-line-price-${i}`} />
          <Button size="icon" variant="ghost" onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} data-testid={`so-line-remove-${i}`}><Trash2 className="w-4 h-4" /></Button>
        </div>))}
      <Button size="sm" variant="outline" onClick={() => setF({ ...f, lines: [...f.lines, { k: Date.now(), product_id: "", name: "", qty: "1", price: "" }] })} data-testid="so-add-line-btn"><Plus className="w-4 h-4 me-1" />Product</Button>
    </div>
  );
}

function OrderForm({ init, onClose, onDone }) {
  const { business } = useAuth();
  const c = business.currency;
  const { data: prods } = useFetch("/products");
  const { data: custs } = useFetch("/customers");
  const { data: outlets } = useFetch("/outlets");
  const [f, setF] = useState(init);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pickCust = (id) => { const x = (custs || []).find((y) => y.id === id); setF({ ...f, customer_id: id, customer_name: x?.name || "", phone: x?.phone || "", email: x?.email || "", bill_name: f.bill_name || x?.name || "" }); };
  const total = f.lines.reduce((s, l) => s + (+l.qty || 0) * toMinor(l.price || "0", c), 0);
  const save = async () => {
    const body = { ...f, advance: toMinor(f.advance || "0", c), lines: f.lines.map((l) => ({ ...l, price: toMinor(l.price || "0", c) })) };
    try { f.id ? await api.put(`/sales-orders/${f.id}`, body) : await api.post("/sales-orders", body); toast.success("Order saved — alert SMS prepared"); onDone(); onClose(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const sale = (prods || []).filter((p) => !p.is_raw);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="so-dialog">
        <DialogHeader><DialogTitle className="font-display">{f.id ? `Order ${f.number}` : "New customer order"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Existing customer"><Sel value={f.customer_id} onChange={pickCust} options={custs || []} testid="so-customer-select" placeholder="Pick or type below" /></Field>
          <Field label="Customer name *"><Input value={f.customer_name} onChange={set("customer_name")} data-testid="so-customer-name" /></Field>
          <Field label="Bill name *"><Input value={f.bill_name} onChange={set("bill_name")} data-testid="so-bill-name" /></Field>
          <Field label="Phone (phone or email *)"><Input value={f.phone} onChange={set("phone")} data-testid="so-phone" /></Field>
          <Field label="Email"><Input value={f.email} onChange={set("email")} data-testid="so-email" /></Field>
          <Field label="Outlet / unit *"><Sel value={f.outlet_id} onChange={(v) => setF({ ...f, outlet_id: v })} options={outlets || []} testid="so-outlet" /></Field>
          <Field label="Ordered date *"><Input type="date" value={f.order_date} onChange={set("order_date")} data-testid="so-order-date" /></Field>
          <Field label="Delivery date *"><Input type="date" value={f.delivery_date} onChange={set("delivery_date")} data-testid="so-delivery-date" /></Field>
          <Field label="Time"><Input type="time" value={f.delivery_time || ""} onChange={set("delivery_time")} data-testid="so-delivery-time" /></Field>
          <Field label="Pickup or delivery *"><select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={f.delivery_mode} onChange={set("delivery_mode")} data-testid="so-mode"><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select></Field>
          <Field label={f.delivery_mode === "delivery" ? "Delivery location *" : "Pickup location"} className="md:col-span-2"><Input value={f.location} onChange={set("location")} data-testid="so-location" /></Field>
          <Field label="Status"><select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={f.status} onChange={set("status")} data-testid="so-status">{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {!f.id && <Field label="Advance received"><Input value={f.advance} onChange={set("advance")} data-testid="so-advance" /></Field>}
          {!f.id && <Field label="Paid by"><select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={f.method} onChange={set("method")} data-testid="so-method">{(business.payment_methods || []).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>}
          <Field label="Note" className="md:col-span-3"><Input value={f.note} onChange={set("note")} data-testid="so-note" /></Field>
        </div>
        <Lines f={f} setF={setF} prods={sale} c={c} />
        <div className="flex flex-wrap items-center gap-4 text-sm"><span>Amount: <b data-testid="so-total">{fmt(total, c)}</b></span>{f.id && <span>Received: <b>{fmt(f.received, c)}</b> · Balance: <b>{fmt(total - f.received, c)}</b></span>}</div>
        <Button onClick={save} data-testid="so-save-btn">Save order</Button>
      </DialogContent>
    </Dialog>
  );
}

function OrderView({ o, onEdit, onClose, onDone }) {
  const { business } = useAuth();
  const c = business.currency;
  const [amt, setAmt] = useState("");
  const pay = async () => { try { await api.post(`/sales-orders/${o.id}/pay`, { amount: toMinor(amt, c) }); toast.success("Payment recorded"); setAmt(""); onDone(); onClose(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()}>
      <DialogContent className="max-w-xl" data-testid="so-view-dialog">
        <DialogHeader><DialogTitle className="font-display">{o.number} · {o.bill_name} <Pill tone={tone[o.status]}>{o.status.replace("_", " ")}</Pill></DialogTitle></DialogHeader>
        <div className="text-sm space-y-1"><div>{o.customer_name} · {o.phone || o.email}</div><div>Ordered {o.order_date} · {o.delivery_mode} on <b>{o.delivery_date}</b> {o.delivery_time} · {o.location}</div></div>
        <div className="border divide-y text-sm">{o.lines.map((l) => <div key={`${l.name}-${l.qty}-${l.price}`} className="flex px-3 py-1.5"><span className="flex-1">{l.qty} × {l.name}</span><span className="tabular">{fmt(l.amount, c)}</span></div>)}</div>
        <div className="text-sm">Total <b>{fmt(o.total, c)}</b> · received <b>{fmt(o.received, c)}</b> · balance <b data-testid="so-balance">{fmt(o.total - o.received, c)}</b></div>
        <div className="text-xs space-y-1 border p-2 bg-muted/30" data-testid="so-sms-log"><div className="uppercase tracking-widest text-muted-foreground">Order alert SMS</div>{o.sms_log.map((m) => <div key={m.at}>{m.at.slice(0, 16).replace("T", " ")} → {m.to || "no phone"}: {m.text} <i className="text-warning">({m.status})</i></div>)}</div>
        <div className="flex flex-wrap gap-2">
          {o.total > o.received && <><Input className="w-28" placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value)} data-testid="so-pay-input" /><Button variant="outline" onClick={pay} disabled={!amt} data-testid="so-pay-btn">Receive payment</Button></>}
          <Button variant="outline" onClick={onEdit} data-testid="so-edit-btn">Edit / change status</Button>
          <PrintBtn kind="sales_order" id={o.id} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SalesOrders() {
  const { business } = useAuth();
  const c = business.currency;
  const { data, reload } = useFetch("/sales-orders");
  const [form, setForm] = useState(null);
  const [view, setView] = useState(null);
  const [st, setSt] = useState("open");
  const [of, setOf] = useState("");
  const rows = (data || []).filter((o) => (st === "all" || (st === "open" ? !["delivered", "cancelled"].includes(o.status) : o.status === st)) && (!of || o.outlet_id === of));
  const edit = (o) => setForm({ ...o, lines: o.lines.map((l, i) => ({ ...l, k: i + 1, qty: String(l.qty), price: toMajorStr(l.price, c) })) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setForm(blank())} data-testid="new-so-btn"><Plus className="w-4 h-4 me-1" />New order</Button>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={st} onChange={(e) => setSt(e.target.value)} data-testid="so-filter-status"><option value="open">Open orders</option><option value="all">All</option>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <OutletFilter value={of} onChange={setOf} />
      </div>
      <DataTable columns={[{ key: "number", label: "Order" }, { key: "bill_name", label: "Bill name" }, { key: "phone", label: "Phone" }, { key: "order_date", label: "Ordered" }, { key: "delivery_date", label: "Deliver on" },
        { key: "delivery_mode", label: "Mode" }, { key: "status", label: "Status", render: (r) => <Pill tone={tone[r.status]}>{r.status.replace("_", " ")}</Pill> },
        { key: "total", label: "Amount", money: true }, { key: "received", label: "Received", money: true }, { key: "b", label: "Balance", num: true, render: (r) => fmt(r.total - r.received, c) }]}
        rows={rows} currency={c} testid="so-table" onRow={setView} />
      {form && <OrderForm init={form} onClose={() => setForm(null)} onDone={reload} />}
      {view && <OrderView o={view} onClose={() => setView(null)} onDone={reload} onEdit={() => { edit(view); setView(null); }} />}
    </div>
  );
}
