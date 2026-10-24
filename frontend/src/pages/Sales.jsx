import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, isManager } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { api, errMsg } from "@/lib/api";
import { fmt } from "@/lib/money";
import { queue } from "@/lib/offline";
import { PageHeader, DataTable, useFetch, Pill, ExportBtn, exportCSV } from "@/components/common";

function SaleDetail({ id, onClose, currency, user, onChanged }) {
  const { data: s, reload } = useFetch(id ? `/sales/${id}` : null, [id]);
  const [ret, setRet] = useState({});
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  if (!id) return null;
  const returned = {};
  (s?.returns || []).forEach((r) => r.lines.forEach((l) => { returned[l.index] = (returned[l.index] || 0) + l.qty; }));
  const doVoid = async () => {
    try { await api.post(`/sales/${id}/void`, { reason, supervisor_pin: pin }); toast.success("Sale voided — a void document was written"); reload(); onChanged(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const doReturn = async () => {
    const lines = Object.entries(ret).filter(([, q]) => q > 0).map(([index, qty]) => ({ index: +index, qty }));
    try { const { data } = await api.post(`/sales/${id}/return`, { lines, refund_method: method, reason }); toast.success(`Refunded ${fmt(data.amount, currency)}`); setRet({}); reload(); onChanged(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="sale-detail-dialog">
        <DialogHeader><DialogTitle className="font-display">Receipt #{s?.receipt_no}</DialogTitle></DialogHeader>
        {s && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Pill tone={s.status === "completed" ? "ok" : "bad"} testid="sale-status">{s.status}</Pill>
              {s.offline && <Pill tone="warn">made offline</Pill>}
              {s.totals_mismatch && <Pill tone="bad">till total {fmt(s.client_total, currency)} ≠ server</Pill>}
              <span className="text-muted-foreground">{new Date(s.created_at).toLocaleString()} · {s.cashier_name}{s.customer_name ? ` · ${s.customer_name}` : ""}</span>
            </div>
            <div className="border divide-y">
              {s.lines.map((l, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1">{l.qty} × {l.name}{returned[i] ? <span className="text-warning ms-2">({returned[i]} returned)</span> : null}
                    <div className="text-xs text-muted-foreground">cost snapshot {fmt(l.unit_cost, currency)}/unit · disc {fmt(l.discount + l.order_alloc, currency)} · tax {fmt(l.tax, currency)}</div></div>
                  <span className="tabular">{fmt(l.line_total, currency)}</span>
                  {s.status === "completed" && (
                    <Input type="number" min={0} max={l.qty - (returned[i] || 0)} value={ret[i] || ""} placeholder="0" onChange={(e) => setRet({ ...ret, [i]: Math.min(+e.target.value, l.qty - (returned[i] || 0)) })} className="w-16 h-8" data-testid={`return-qty-${i}`} />
                  )}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              <span>Subtotal</span><span className="text-end tabular">{fmt(s.subtotal, currency)}</span>
              {s.applied.map((a, i) => <Fragment key={`a${i}`}><span className="text-success">{a.name}</span><span className="text-end tabular text-success">-{fmt(a.amount, currency)}</span></Fragment>)}
              <span>Tax</span><span className="text-end tabular">{fmt(s.tax, currency)}</span>
              <span>Rounding</span><span className="text-end tabular">{fmt(s.rounding, currency)}</span>
              <span className="font-bold">Total</span><span className="text-end tabular font-bold" data-testid="sale-detail-total">{fmt(s.total, currency)}</span>
              {s.payments.map((p, i) => <Fragment key={`p${i}`}><span className="uppercase text-muted-foreground">{p.method}</span><span className="text-end tabular text-muted-foreground">{fmt(p.amount, currency)}</span></Fragment>)}
              <span className="text-muted-foreground">Cost of goods</span><span className="text-end tabular text-muted-foreground">{fmt(s.cogs, currency)}</span>
            </div>
            {s.status === "completed" && (
              <div className="border-t pt-4 space-y-3">
                <Input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="sale-reason-input" />
                <div className="flex flex-wrap gap-2">
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger className="w-40" data-testid="refund-method-select"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="cash">Refund cash</SelectItem><SelectItem value="store_credit">Store credit</SelectItem><SelectItem value="exchange">Exchange</SelectItem></SelectContent>
                  </Select>
                  <Button variant="outline" onClick={doReturn} disabled={!Object.values(ret).some((q) => q > 0)} data-testid="return-submit-btn">Return selected</Button>
                  <div className="flex-1" />
                  {!isManager(user) && <Input placeholder="Supervisor PIN" type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="w-36" data-testid="void-pin-input" />}
                  <Button variant="destructive" onClick={doVoid} disabled={!reason || (s.returns || []).length > 0} data-testid="void-submit-btn">Void sale</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Sales() {
  const { business, user } = useAuth();
  const { t } = useI18n();
  const c = business.currency;
  const [q, setQ] = useState("");
  const { data, reload } = useFetch(`/sales?q=${encodeURIComponent(q)}`, [q]);
  const [sel, setSel] = useState(null);
  const failed = queue.failed();
  const cols = [{ key: "receipt_no", label: "Receipt" }, { key: "created_at", label: "Time", date: true }, { key: "cashier_name", label: "Cashier" },
    { key: "customer_name", label: "Customer" }, { key: "status", label: "Status", render: (r) => <Pill tone={r.status === "completed" ? "ok" : "bad"}>{r.status}</Pill> },
    { key: "offline", label: "", render: (r) => r.offline ? <Pill tone="warn">offline</Pill> : null }, { key: "total", label: "Total", money: true }];
  return (
    <div>
      <PageHeader title={t("sales")} sub="Sales are never deleted. A void marks the sale and writes a new document; returns refund in cash, store credit or exchange.">
        <ExportBtn onClick={() => exportCSV("sales", cols.filter((x) => !x.render || x.key === "status"), data || [], c)} />
      </PageHeader>
      {failed.length > 0 && (
        <div className="border border-destructive/40 bg-destructive/10 p-4 mb-4 text-sm" data-testid="failed-sales-panel">
          <b>{failed.length} offline sale(s) rejected by the server on this device:</b>
          {failed.map((f) => <div key={f.client_id}>{f.payload.receipt_no} — {f.error}</div>)}
          <Button size="sm" variant="outline" className="mt-2" onClick={() => { queue.clearFailed(); reload(); }} data-testid="clear-failed-btn">Dismiss</Button>
        </div>
      )}
      <Input placeholder="Search receipt number…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs mb-4" data-testid="sales-search-input" />
      <DataTable columns={cols} rows={data || []} currency={c} testid="sales-table" onRow={(r) => setSel(r.id)} />
      <SaleDetail id={sel} onClose={() => setSel(null)} currency={c} user={user} onChanged={reload} />
    </div>
  );
}
