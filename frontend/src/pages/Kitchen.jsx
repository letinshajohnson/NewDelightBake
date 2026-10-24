import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChefHat, Coffee, ArrowLeft, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { ThemeToggle } from "@/components/common";

const NEXT = { new: "preparing", preparing: "ready", ready: "served" };
const ACTION = { new: "Start", preparing: "Ready", ready: "Served" };

function Ticket({ tk, onAdvance }) {
  const mins = Math.floor((Date.now() - Date.parse(tk.created_at)) / 60000);
  const tone = mins >= 20 ? "bg-destructive" : mins >= 10 ? "bg-warning" : "bg-success";
  return (
    <div className="bg-card border fade-up" data-testid={`ticket-${tk.id}`}>
      <div className={`${tone} text-black px-3 py-2 flex justify-between items-center`}>
        <span className="font-display font-bold text-lg">{tk.table_name}</span>
        <span className="flex items-center gap-1 text-sm font-medium tabular"><Clock className="w-3.5 h-3.5" />{mins}m</span>
      </div>
      <div className="px-3 py-1 text-xs text-muted-foreground flex justify-between"><span>Round {tk.round} · {tk.station}</span><span>{tk.waiter}</span></div>
      <ul className="px-3 py-2 space-y-1">
        {tk.items.map((it, i) => (
          <li key={i} className="text-base"><b className="tabular">{it.qty}×</b> {it.name}{it.note && <div className="text-sm text-warning ps-6">{it.note}</div>}</li>
        ))}
      </ul>
      <Button className="w-full rounded-none h-12" variant={tk.status === "ready" ? "secondary" : "default"} onClick={() => onAdvance(tk)} data-testid={`ticket-advance-${tk.id}`}>{ACTION[tk.status]}</Button>
    </div>
  );
}

export default function Kitchen() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [outlets, setOutlets] = useState([]);
  const [outletId, setOutletId] = useState(user.outlet_id);
  const [station, setStation] = useState("");
  const [tickets, setTickets] = useState([]);
  const [live, setLive] = useState(true);

  useEffect(() => { api.get("/outlets").then(({ data }) => { setOutlets(data); if (!outletId && data[0]) setOutletId(data[0].id); }); }, [outletId]);
  const load = useCallback(async () => {
    if (!outletId) return;
    try { const { data } = await api.get("/kitchen/tickets", { params: { outlet_id: outletId, station: station || undefined } }); setTickets(data); setLive(true); }
    catch { setLive(false); }
  }, [outletId, station]);
  useEffect(() => { load(); const i = setInterval(load, 4000); return () => clearInterval(i); }, [load]);

  const advance = async (tk) => {
    setTickets((ts) => ts.map((x) => (x.id === tk.id ? { ...x, status: NEXT[tk.status] } : x)).filter((x) => x.status !== "served"));
    await api.patch(`/kitchen/tickets/${tk.id}`, { status: NEXT[tk.status] }).catch(() => load());
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-14 border-b bg-card flex items-center gap-3 px-4">
        {user.role !== "kitchen" && <Button size="icon" variant="ghost" onClick={() => nav(-1)} data-testid="kitchen-back-btn"><ArrowLeft className="w-5 h-5 rtl-flip" /></Button>}
        <ChefHat className="w-5 h-5 text-primary" /><span className="font-display font-semibold text-lg">{t("kitchen")}</span>
        <span className={`text-xs px-2 py-0.5 rounded ${live ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`} data-testid="kitchen-live-status">{live ? "Live · polling 4s" : "Reconnecting…"}</span>
        <div className="flex-1" />
        {outlets.length > 1 && (
          <select className="bg-muted rounded-md h-9 px-2 text-sm" value={outletId || ""} onChange={(e) => setOutletId(e.target.value)} data-testid="kitchen-outlet-select">
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        <div className="flex bg-muted rounded-md p-0.5">
          {[["", "All", null], ["kitchen", "Kitchen", ChefHat], ["bar", "Bar", Coffee]].map(([k, l, I]) => (
            <Button key={k} size="sm" variant={station === k ? "default" : "ghost"} className="h-8" onClick={() => setStation(k)} data-testid={`station-${k || "all"}`}>{I && <I className="w-4 h-4 me-1" />}{l}</Button>
          ))}
        </div>
        <ThemeToggle />
        {user.role === "kitchen" && <Button size="sm" variant="ghost" onClick={async () => { await logout(); nav("/login"); }} data-testid="kitchen-logout-btn">{t("logout")}</Button>}
      </header>
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-px bg-border">
        {["new", "preparing", "ready"].map((s) => {
          const list = tickets.filter((x) => x.status === s);
          return (
            <div key={s} className="bg-background p-4 space-y-3" data-testid={`kds-column-${s}`}>
              <div className="flex justify-between items-center"><span className="text-xs uppercase tracking-widest text-muted-foreground">{t(s)}</span><span className="font-display text-2xl font-bold tabular">{list.length}</span></div>
              {list.map((tk) => <Ticket key={tk.id} tk={tk} onAdvance={advance} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
