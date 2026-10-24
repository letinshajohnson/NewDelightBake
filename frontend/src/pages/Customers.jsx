import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, isManager } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { api, errMsg } from "@/lib/api";
import { fmt, toMinor, toMajorStr } from "@/lib/money";
import { PageHeader, DataTable, Field, Stat, useFetch, Pill } from "@/components/common";

function Detail({ id, onClose, currency, levels, canEdit, onSaved }) {
  const { data, reload } = useFetch(id ? `/customers/${id}/detail` : null, [id]);
  const [f, setF] = useState(null);
  const [pts, setPts] = useState("");
  if (!id) return null;
  const c = data?.customer;
  const form = f || (c && { name: c.name, phone: c.phone || "", email: c.email || "", level: c.level || "none", credit_limit: toMajorStr(c.credit_limit || 0, currency) });
  const save = async () => {
    try {
      await api.put(`/customers/${id}`, { ...form, level: form.level === "none" ? null : form.level, credit_limit: toMinor(form.credit_limit, currency) });
      toast.success("Customer saved"); setF(null); reload(); onSaved();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const adjust = async () => { await api.post(`/customers/${id}/points`, { points: parseInt(pts, 10), note: "Manual adjustment" }); setPts(""); reload(); };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="customer-detail-sheet">
        <SheetHeader><SheetTitle className="font-display text-2xl">{c?.name}</SheetTitle></SheetHeader>
        {data && (
          <div className="space-y-6 mt-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border">
              <Stat label="Transactions" value={data.transaction_count} testid="cust-tx-count" />
              <Stat label="Credit limit" value={fmt(c.credit_limit || 0, currency)} testid="cust-credit" />
              <Stat label="Points" value={data.points_balance} testid="cust-points" />
              <Stat label="Redeemed" value={data.points_redeemed} testid="cust-redeemed" />
            </div>
            {data.receivable > 0 && <div className="text-sm text-warning" data-testid="cust-receivable">Receivable: {fmt(data.receivable, currency)}{c.credit_limit && data.receivable > c.credit_limit ? " — over limit" : ""}</div>}
            {canEdit && form && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name"><Input value={form.name} onChange={(e) => setF({ ...form, name: e.target.value })} data-testid="cust-name-input" /></Field>
                <Field label="Phone"><Input value={form.phone} onChange={(e) => setF({ ...form, phone: e.target.value })} data-testid="cust-phone-input" /></Field>
                <Field label="Level">
                  <Select value={form.level} onValueChange={(v) => setF({ ...form, level: v })}>
                    <SelectTrigger data-testid="cust-level-select"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">None</SelectItem>{levels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Credit limit"><Input value={form.credit_limit} onChange={(e) => setF({ ...form, credit_limit: e.target.value })} data-testid="cust-credit-input" /></Field>
                <Button className="col-span-2" onClick={save} data-testid="cust-save-btn">Save</Button>
              </div>
            )}
            <Tabs defaultValue="points">
              <TabsList><TabsTrigger value="points" data-testid="cust-tab-points">Points ledger</TabsTrigger><TabsTrigger value="sales" data-testid="cust-tab-sales">Sales</TabsTrigger><TabsTrigger value="returns" data-testid="cust-tab-returns">Returns</TabsTrigger></TabsList>
              <TabsContent value="points" className="space-y-3">
                {canEdit && <div className="flex gap-2"><Input placeholder="+/- points" value={pts} onChange={(e) => setPts(e.target.value)} className="w-32" data-testid="cust-points-adjust-input" /><Button variant="outline" disabled={!parseInt(pts, 10)} onClick={adjust} data-testid="cust-points-adjust-btn">Adjust</Button></div>}
                <DataTable columns={[{ key: "created_at", label: "Date", date: true }, { key: "type", label: "Type", render: (r) => <Pill tone={r.points > 0 ? "ok" : "warn"}>{r.type}</Pill> }, { key: "note", label: "Note" }, { key: "points", label: "Points", num: true }]} rows={data.points_ledger} testid="cust-points-table" />
              </TabsContent>
              <TabsContent value="sales"><DataTable columns={[{ key: "receipt_no", label: "Receipt" }, { key: "created_at", label: "Date", date: true }, { key: "status", label: "Status" }, { key: "amount_due", label: "Due", money: true }, { key: "total", label: "Total", money: true }]} rows={data.sales} currency={currency} testid="cust-sales-table" /></TabsContent>
              <TabsContent value="returns"><DataTable columns={[{ key: "receipt_no", label: "Receipt" }, { key: "created_at", label: "Date", date: true }, { key: "refund_method", label: "Refund" }, { key: "amount", label: "Amount", money: true }]} rows={data.returns} currency={currency} testid="cust-returns-table" /></TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function Customers() {
  const { business, user } = useAuth();
  const { t } = useI18n();
  const c = business.currency;
  const { data, reload } = useFetch("/customers");
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [n, setN] = useState({ name: "", phone: "" });
  const add = async () => { try { await api.post("/customers", n); setN({ name: "", phone: "" }); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const rows = (data || []).filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()) || x.phone?.includes(q));
  return (
    <div>
      <PageHeader title={t("customers")} sub="The points ledger is the balance: earned, redeemed, expired and adjusted are rows — the balance is their sum." />
      <div className="flex flex-wrap gap-2 mb-4">
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" data-testid="customers-search-input" />
        <div className="flex-1" />
        <Input placeholder="Name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} className="w-40" data-testid="new-customer-name" />
        <Input placeholder="Phone" value={n.phone} onChange={(e) => setN({ ...n, phone: e.target.value })} className="w-40" data-testid="new-customer-phone" />
        <Button disabled={!n.name} onClick={add} data-testid="add-customer-btn"><Plus className="w-4 h-4 me-1" />Add</Button>
      </div>
      <DataTable columns={[{ key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "level", label: "Level", render: (r) => r.level ? <Pill tone="info">{r.level}</Pill> : "—" },
        { key: "store_credit", label: "Store credit", money: true }, { key: "credit_limit", label: "Credit limit", money: true }]} rows={rows} currency={c} testid="customers-table" onRow={(r) => setSel(r.id)} />
      <Detail id={sel} onClose={() => setSel(null)} currency={c} levels={business.levels || []} canEdit={isManager(user)} onSaved={reload} />
    </div>
  );
}
