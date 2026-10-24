import { Users, Clock } from "lucide-react";
import { fmt } from "@/lib/money";

const orderTotal = (o) => o.lines.reduce((s, l) => s + l.unit_price * l.qty, 0);

export default function TablesView({ tables, orders, currency, onPick, activeOrderId }) {
  const zones = [...new Set(tables.map((t) => t.zone || "Floor"))];
  const byTable = Object.fromEntries(orders.filter((o) => o.table_id).map((o) => [o.table_id, o]));
  return (
    <div className="p-4 sm:p-6 overflow-y-auto h-full space-y-8" data-testid="tables-view">
      {zones.map((z) => (
        <div key={z}>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{z}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {tables.filter((t) => (t.zone || "Floor") === z).map((t) => {
              const o = byTable[t.id];
              const unsent = o?.lines.some((l) => l.qty > (l.sent_qty || 0));
              const mins = o ? Math.floor((Date.now() - Date.parse(o.created_at)) / 60000) : 0;
              return (
                <button key={t.id} onClick={() => onPick(t, o)} data-testid={`table-${t.name}`}
                  className={`relative text-start p-4 h-32 border-2 rounded-md transition-colors active:scale-[0.97] ${o ? (unsent ? "border-warning bg-warning/10" : "border-primary bg-primary/10") : "border-border bg-card hover:border-muted-foreground"} ${activeOrderId && o?.id === activeOrderId ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}>
                  {o && <span className="absolute top-3 end-3 w-2 h-2 rounded-full bg-primary animate-pulse" />}
                  <div className="font-display text-2xl font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Users className="w-3 h-3" />{t.seats}</div>
                  {o ? (
                    <div className="absolute bottom-3 inset-x-4 flex justify-between text-xs">
                      <span className="tabular font-medium">{fmt(orderTotal(o), currency)}</span>
                      <span className="flex items-center gap-1 text-muted-foreground"><Clock className="w-3 h-3" />{mins}m</span>
                    </div>
                  ) : <div className="absolute bottom-3 start-4 text-xs text-success">Free</div>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {tables.length === 0 && <div className="text-muted-foreground">No tables yet — add them in Settings → Tables.</div>}
    </div>
  );
}
