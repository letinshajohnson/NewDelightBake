import { useState } from "react";
import { Printer } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/money";
import { PageHeader, DataTable, useFetch, ExportBtn, exportCSV } from "@/components/common";

const GROUPS = [
  ["Sales", [["products", "Sales by product"], ["transactions", "Sales by transaction"], ["returns_by_product", "Sales returns by product"], ["returns", "Sales returns by transaction"],
    ["monthly_trend", "Monthly product trend"], ["daily_trend", "Daily product trend"], ["trend", "Sales trend (chart)"], ["summary", "Sales summary"], ["cashiers", "Cashier performance"]]],
  ["Purchases", [["purchases_by_product", "Purchases by product"], ["purchases_by_transaction", "Purchases by transaction"], ["purchase_returns_by_product", "Purchase returns by product"],
    ["purchase_returns_by_transaction", "Purchase returns by transaction"]]],
  ["Finance", [["cash_in", "Cash in"], ["cash_out", "Cash out"], ["purchase_payments", "Purchase payments"], ["sale_payments", "Sale payments"],
    ["purchase_return_refunds", "Purchase return refunds"], ["sale_return_refunds", "Sale return refunds"], ["payments", "Payments by method"], ["profit_loss", "Profit & loss"], ["profit", "Profit by product"]]],
  ["Products", [["stock_movement", "Stock movement"], ["sales_by_category", "Sales by category"], ["sales_by_brand", "Sales by brand"], ["stock_alerts", "Stock alerts"],
    ["best_sellers", "Best sellers"], ["stocktakes", "Stock takes"], ["product_stock", "Product stock"], ["transfers", "Stock transfers"], ["loyalty", "Loyalty balances"]]],
  ["Restaurant", [["restaurant", "Sales per table"], ["waiters", "Sales per waiter"], ["busy_hours", "Busiest hours"], ["kitchen_time", "Kitchen time per item"]]],
  ["Store / outlet", [["outlet_pl", "Store profit & loss"], ["branches", "Branch comparison"], ["shifts", "Shift register"]]],
];

export default function Reports() {
  const { business } = useAuth();
  const { t } = useI18n();
  const c = business.currency;
  const [name, setName] = useState("summary");
  const [range, setRange] = useState({ start: "", end: "" });
  const [oid, setOid] = useState("all");
  const { data: outlets } = useFetch("/outlets");
  const qs = new URLSearchParams({ ...(range.start && { start: range.start }), ...(range.end && { end: range.end }), ...(oid !== "all" && { outlet_id: oid }) }).toString();
  const { data, loading } = useFetch(`/reports/${name}?${qs}`, [name, qs]);
  const title = GROUPS.flatMap((g) => g[1]).find((r) => r[0] === name)?.[1];
  return (
    <div>
      <PageHeader title={t("reports")} sub={data ? `${title} · ${data.start} → ${data.end}` : title}>
        {data && <ExportBtn onClick={() => exportCSV(name, data.columns, data.rows, c)} />}
        <Button variant="outline" onClick={() => window.print()} data-testid="print-report-btn"><Printer className="w-4 h-4 me-2" />PDF / print</Button>
      </PageHeader>
      <div className="grid lg:grid-cols-[220px_1fr] gap-8">
        <nav className="space-y-5" data-testid="report-list">
          {GROUPS.map(([g, items]) => (
            <div key={g}>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">{g}</div>
              {items.map(([k, l]) => (
                <button key={k} onClick={() => setName(k)} data-testid={`report-${k}`}
                  className={`block w-full text-start text-sm px-2 py-1.5 rounded ${name === k ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{l}</button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className="w-40" data-testid="report-start-date" />
            <Input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className="w-40" data-testid="report-end-date" />
            <Select value={oid} onValueChange={setOid}>
              <SelectTrigger className="w-48" data-testid="report-outlet-select"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All branches</SelectItem>{(outlets || []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {data?.chart && (
            <div className="bg-card border p-4 h-64" data-testid="report-chart">
              <ResponsiveContainer>
                <LineChart data={data.rows}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" width={70} tickFormatter={(v) => fmt(v, c).replace(/\.\d+$/, "")} />
                  <Tooltip formatter={(v) => fmt(v, c)} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                  <Line dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line dataKey="profit" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="print-area">
            {loading && !data ? <div className="text-muted-foreground">Loading…</div> : data && <DataTable columns={data.columns} rows={data.rows} currency={c} testid="report-table" />}
          </div>
        </div>
      </div>
    </div>
  );
}
