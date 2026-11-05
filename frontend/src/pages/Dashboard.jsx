import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Link } from "react-router-dom";
import { AlertTriangle, CloudOff, Scale } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/money";
import { PageHeader, Stat, useFetch } from "@/components/common";

function Group({ title, groups, tid }) {
  return (
    <div className="bg-card border p-6" data-testid={tid}>
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{title}</div>
      {groups.length === 0 && <div className="text-sm text-muted-foreground">All stocked up.</div>}
      {groups.map((g) => (
        <details key={g.name} className="border-b last:border-0 py-2 text-sm">
          <summary className="flex justify-between cursor-pointer"><span>{g.name}</span><b className="text-warning tabular">{g.count}</b></summary>
          {g.items.map((x) => <div key={x.id} className="flex justify-between text-xs text-muted-foreground ps-3 py-0.5"><span>{x.name}</span><span className="tabular">{x.qty} / min {x.min}</span></div>)}
        </details>))}
    </div>);
}

function Alerts({ c }) {
  const { data: a } = useFetch("/dashboard/alerts");
  if (!a) return null;
  return (
    <div className="space-y-6 mt-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border">
        <Stat label="We owe suppliers" value={fmt(a.payables.total, c)} hint={`${a.payables.count} bills, overdue ${fmt(a.payables.overdue, c)}`} testid="dash-payables" accent="text-warning" />
        <Stat label="Customers owe us" value={fmt(a.receivables.total, c)} hint={`${a.receivables.count} bills, 30+ days ${fmt(a.receivables.overdue, c)}`} testid="dash-receivables" accent="text-primary" />
        <Stat label="Open customer orders" value={a.open_orders.count} hint={`balance to collect ${fmt(a.open_orders.balance, c)}`} testid="dash-orders" />
        <Stat label="Low-stock items" value={a.low_stock.length} hint={`${a.low_stock.filter((x) => x.raw).length} raw materials`} testid="dash-low-stock" accent="text-destructive" />
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Group title="Low stock by brand" groups={a.by_brand} tid="low-by-brand" />
        <Group title="Low stock by category" groups={a.by_category} tid="low-by-category" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { business } = useAuth();
  const { t } = useI18n();
  const c = business.currency;
  const { data } = useFetch("/dashboard");
  if (!data) return <div className="text-muted-foreground" data-testid="dashboard-loading">Loading…</div>;
  const d = data.today;
  return (
    <div>
      <PageHeader title={t("dashboard")} sub={`Today at ${business.name}. Profit uses the cost snapshotted on each sale.`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border mb-8">
        <Stat label="Revenue today" value={fmt(d.revenue, c)} testid="kpi-revenue" />
        <Stat label="Sales today" value={d.count} testid="kpi-count" />
        <Stat label="Average ticket" value={fmt(d.avg, c)} testid="kpi-avg" />
        <Stat label="Gross profit" value={fmt(d.profit, c)} testid="kpi-profit" accent="text-success" />
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card border p-6" data-testid="trend-chart">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Revenue · last 14 days</div>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={data.trend}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => fmt(v, c).replace(/\.\d+$/, "")} width={70} />
                <Tooltip formatter={(v) => fmt(v, c)} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" />
                <Bar dataKey="profit" fill="hsl(var(--success))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="space-y-6">
          <div className="bg-card border p-6" data-testid="top-products">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Best sellers · 30 days</div>
            {data.top_products.length === 0 && <div className="text-sm text-muted-foreground">No sales yet — open the till.</div>}
            {data.top_products.map((p, i) => (
              <div key={i} className="flex justify-between py-2 border-b last:border-0 text-sm"><span>{p.name} <span className="text-muted-foreground">×{p.qty}</span></span><span className="tabular">{fmt(p.revenue, c)}</span></div>
            ))}
          </div>
          <div className="grid gap-px bg-border border">
            <Link to="/app/stock/balances" className="bg-card p-4 flex items-center gap-3 hover:bg-accent" data-testid="alert-low-stock"><AlertTriangle className="w-4 h-4 text-warning" /><span className="text-sm flex-1">Low-stock items</span><b className="tabular">{data.low_stock}</b></Link>
            <div className="bg-card p-4 flex items-center gap-3" data-testid="alert-offline-sales"><CloudOff className="w-4 h-4 text-muted-foreground" /><span className="text-sm flex-1">Sales made offline (30d)</span><b className="tabular">{data.offline_sales_30d}</b></div>
            <div className="bg-card p-4 flex items-center gap-3" data-testid="alert-mismatch"><Scale className="w-4 h-4 text-muted-foreground" /><span className="text-sm flex-1">Till ≠ server totals (30d)</span><b className="tabular">{data.totals_mismatch_30d}</b></div>
          </div>
        </div>
      </div>
      <Alerts c={c} />
    </div>
  );
}
