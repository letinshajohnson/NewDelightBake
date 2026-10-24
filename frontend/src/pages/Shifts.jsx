import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/money";
import { PageHeader, DataTable, useFetch, Pill } from "@/components/common";

function ShiftDetail({ id, onClose, currency, business }) {
  const { data: s } = useFetch(id ? `/shifts/${id}` : null, [id]);
  if (!id) return null;
  const m = s?.summary;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="shift-detail-dialog">
        <DialogHeader><DialogTitle className="font-display">Shift close-out</DialogTitle></DialogHeader>
        {s && m && (
          <>
            <div className="print-area bg-white text-black p-4 font-mono text-xs space-y-1 border">
              <div className="text-center font-bold">{business.name}</div>
              <div>{s.cashier_name} · {new Date(s.opened_at).toLocaleString()} → {s.closed_at ? new Date(s.closed_at).toLocaleString() : "open"}</div>
              <div className="border-t border-dashed border-black my-1" />
              <div className="flex justify-between"><span>Opening cash</span><span>{fmt(s.opening_cash, currency)}</span></div>
              {Object.entries(m.methods).map(([k, v]) => <div key={k} className="flex justify-between"><span>{k.toUpperCase()}</span><span>{fmt(v, currency)}</span></div>)}
              <div className="flex justify-between"><span>Cash refunds</span><span>-{fmt(m.refunds_cash, currency)}</span></div>
              <div className="flex justify-between"><span>Cash in / out</span><span>{fmt(m.cash_in, currency)} / -{fmt(m.cash_out, currency)}</span></div>
              <div className="flex justify-between font-bold"><span>Expected</span><span data-testid="shift-expected">{fmt(m.expected_cash, currency)}</span></div>
              {s.counted_cash != null && <><div className="flex justify-between"><span>Counted</span><span>{fmt(s.counted_cash, currency)}</span></div>
                <div className="flex justify-between font-bold"><span>Difference</span><span data-testid="shift-difference">{fmt(s.difference, currency)}</span></div></>}
              <div className="border-t border-dashed border-black my-1" />
              <div className="font-bold">Products sold</div>
              {m.products.map((p, i) => <div key={i} className="flex justify-between"><span>{p.qty} × {p.name}</span><span>{fmt(p.amount, currency)}</span></div>)}
              {m.returned.length > 0 && <><div className="font-bold mt-1">Returned</div>{m.returned.map((p, i) => <div key={i} className="flex justify-between"><span>{p.qty} × {p.name}</span><span>-{fmt(p.amount, currency)}</span></div>)}</>}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {m.products.filter((p) => p.image).slice(0, 8).map((p, i) => <img key={i} src={p.image} alt={p.name} className="aspect-square object-cover rounded" />)}
            </div>
            <Button variant="outline" onClick={() => window.print()} data-testid="print-shift-btn"><Printer className="w-4 h-4 me-2" />Print close-out</Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Shifts() {
  const { business } = useAuth();
  const { t } = useI18n();
  const c = business.currency;
  const { data: shifts } = useFetch("/shifts");
  const { data: cash } = useFetch("/cash");
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const cashRows = (cash || []).filter((x) => (!q || `${x.category} ${x.note || ""}`.toLowerCase().includes(q.toLowerCase()))
    && (!range.from || x.created_at.slice(0, 10) >= range.from) && (!range.to || x.created_at.slice(0, 10) <= range.to));
  return (
    <div>
      <PageHeader title={t("shifts")} sub="Shifts, sales and cash movements made offline keep the device time and sync in order, so the close-out stays right." />
      <Tabs defaultValue="shifts">
        <TabsList className="mb-4"><TabsTrigger value="shifts" data-testid="tab-shifts">Shifts</TabsTrigger><TabsTrigger value="cash" data-testid="tab-cash">Cash in / out</TabsTrigger></TabsList>
        <TabsContent value="shifts">
          <DataTable columns={[{ key: "cashier_name", label: "Cashier" }, { key: "opened_at", label: "Opened", date: true }, { key: "closed_at", label: "Closed", date: true },
            { key: "status", label: "Status", render: (r) => <Pill tone={r.status === "open" ? "info" : "muted"}>{r.status}</Pill> },
            { key: "opening_cash", label: "Opening", money: true }, { key: "expected_cash", label: "Expected", money: true }, { key: "counted_cash", label: "Counted", money: true },
            { key: "difference", label: "Difference", money: true, render: (r) => r.difference == null ? "—" : <span className={r.difference ? "text-warning" : "text-success"}>{fmt(r.difference, c)}</span> }]}
            rows={shifts || []} currency={c} testid="shifts-table" onRow={(r) => setSel(r.id)} />
        </TabsContent>
        <TabsContent value="cash" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Search category or note" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" data-testid="cash-search-input" />
            <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-40" data-testid="cash-from-date" />
            <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-40" data-testid="cash-to-date" />
          </div>
          <DataTable columns={[{ key: "created_at", label: "Time", date: true }, { key: "type", label: "Type", render: (r) => <Pill tone={r.type === "in" ? "ok" : "warn"}>{r.type}</Pill> },
            { key: "category", label: "Category" }, { key: "note", label: "Note" }, { key: "user_name", label: "By" }, { key: "amount", label: "Amount", money: true }]} rows={cashRows} currency={c} testid="cash-table" />
        </TabsContent>
      </Tabs>
      <ShiftDetail id={sel} onClose={() => setSel(null)} currency={c} business={business} />
    </div>
  );
}
