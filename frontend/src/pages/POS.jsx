import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { LayoutGrid, Armchair, PauseCircle, MoreVertical, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, useTheme, isManager } from "@/context/AuthContext";
import { useI18n, LANGS } from "@/lib/i18n";
import { api, errMsg } from "@/lib/api";
import { compute } from "@/lib/pricing";
import { fmt } from "@/lib/money";
import { LS, uuid, nextReceipt, queue, flush, useSync } from "@/lib/offline";
import { usePosData, shiftKey } from "@/components/pos/usePosData";
import ProductGrid from "@/components/pos/ProductGrid";
import CartPanel from "@/components/pos/CartPanel";
import SyncBadge from "@/components/pos/SyncBadge";
import PaymentDialog from "@/components/pos/PaymentDialog";
import CustomerDialog from "@/components/pos/CustomerDialog";
import DiscountDialog from "@/components/pos/DiscountDialog";
import ReceiptDialog from "@/components/pos/ReceiptDialog";
import PinDialog from "@/components/pos/PinDialog";
import TablesView from "@/components/pos/TablesView";
import { OpenShiftDialog, CloseShiftDialog, CashDialog } from "@/components/pos/ShiftDialogs";

const EMPTY = { lines: [], customer: null, voucher: null, order_discount: null, points: 0, order: null };

function PickDialog({ pick, onClose }) {
  if (!pick) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="pick-dialog">
        <DialogHeader><DialogTitle className="font-display">{pick.title}</DialogTitle></DialogHeader>
        <div className="max-h-80 overflow-y-auto divide-y border">
          {pick.items.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nothing to choose</div>}
          {pick.items.map((it) => (
            <button key={it.id} className="w-full text-start px-3 py-3 hover:bg-accent text-sm flex justify-between" onClick={() => { pick.onPick(it); onClose(); }} data-testid={`pick-option-${it.id}`}>
              <span>{it.label}</span><span className="text-muted-foreground tabular">{it.hint}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NoteDialog({ note, onClose, onSave }) {
  const [v, setV] = useState("");
  useEffect(() => { setV(note?.text || ""); }, [note]);
  return (
    <Dialog open={!!note} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="note-dialog">
        <DialogHeader><DialogTitle className="font-display">Note / modifiers</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-2">{["No sugar", "Extra hot", "Oat milk", "Less spicy", "Takeaway"].map((m) => (
          <Button key={m} size="sm" variant="outline" onClick={() => setV(v ? `${v}, ${m}` : m)} data-testid={`modifier-${m}`}>{m}</Button>))}</div>
        <Input value={v} onChange={(e) => setV(e.target.value)} data-testid="note-input" />
        <Button onClick={() => { onSave(v); onClose(); }} data-testid="note-save-btn">Save</Button>
      </DialogContent>
    </Dialog>
  );
}

export default function POS() {
  const { user, business, reload, logout } = useAuth();
  const { t, setLang, lang } = useI18n();
  const [, toggleTheme] = useTheme();
  const nav = useNavigate();
  const bid = business.id;
  const [outletId, setOutletId] = useState(() => LS.get(`poshub.outlet.${bid}`, null) || user.outlet_id);
  const { data, refresh, update, patchStock } = usePosData(bid, outletId);
  const sync = useSync(bid);
  const [cart, setCart] = useState(EMPTY);
  const [mode, setMode] = useState(user.role === "waiter" ? "tables" : "retail");
  const [dlg, setDlg] = useState(null);
  const [pick, setPick] = useState(null);
  const [note, setNote] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState([]);
  const [shiftSummary, setShiftSummary] = useState(null);
  const [mobileCart, setMobileCart] = useState(false);
  const [now, setNow] = useState(() => new Date().toISOString());
  const searchRef = useRef(null);

  const outlet = data?.outlet;
  const biz = data?.business || business;
  const currency = biz.currency;
  const sk = outlet ? shiftKey(bid, user.id, outlet.id) : null;
  const [shift, setShift] = useState(null);
  useEffect(() => { if (sk) setShift(LS.get(sk, null)); }, [sk]);
  const needShift = outlet && outlet.shifts_enabled !== false && user.role !== "waiter";

  useEffect(() => {
    if (!needShift || shift || !navigator.onLine) return;
    api.get("/shifts/current", { params: { outlet_id: outlet.id } }).then(({ data: s }) => {
      if (s) { const ls = { id: s.id, opening_cash: s.opening_cash, opened_at: s.opened_at }; LS.set(sk, ls); setShift(ls); }
    }).catch(() => {});
  }, [needShift, shift, outlet, sk]);

  useEffect(() => { const i = setInterval(() => setNow(new Date().toISOString()), 30000); return () => clearInterval(i); }, []);

  const loadOrders = useCallback(async () => {
    if (!outlet || !navigator.onLine) return;
    try { const { data: o } = await api.get("/orders", { params: { outlet_id: outlet.id } }); setOrders(o); } catch { /* offline */ }
  }, [outlet]);
  useEffect(() => {
    loadOrders();
    const i = setInterval(loadOrders, 8000);
    return () => clearInterval(i);
  }, [loadOrders]);

  const settings = { tax_inclusive: biz.tax_inclusive, service_bps: biz.service_bps, rounding_unit: biz.rounding_unit };
  const pv = biz.loyalty?.point_value || 0;
  const calc = useCallback((ts) => compute(
    { lines: cart.lines, voucher: cart.voucher, order_discount: cart.order_discount, points_value: cart.points * pv },
    data?.rules || [], settings, { ts, tz_min: biz.tz_offset_min, outlet_id: outlet?.id, customer: cart.customer }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [cart, data, biz, outlet, pv]);
  const totals = useMemo(() => calc(now), [calc, now]);

  const strict = outlet && !outlet.allow_negative_stock;
  const stockOk = (p, qty) => {
    if (!strict || p.track_stock === false) return true;
    const prod = data.products.find((x) => x.id === p.product_id || x.id === p.id) || p;
    if (qty > (prod.stock || 0)) { toast.warning(`Only ${prod.stock || 0} × ${prod.name} in stock at this branch`); return false; }
    return true;
  };

  const addProduct = (p) => {
    setCart((c) => {
      const idx = c.lines.findIndex((l) => l.product_id === p.id && !l.note);
      const qty = idx >= 0 ? c.lines[idx].qty + 1 : 1;
      if (!stockOk(p, qty)) return c;
      if (idx >= 0) return { ...c, lines: c.lines.map((l, i) => (i === idx ? { ...l, qty } : l)) };
      return { ...c, lines: [...c.lines, { key: uuid(), product_id: p.id, name: p.name, unit_price: p.price, qty: 1, category_id: p.category_id,
        tax_bps: p.tax_bps || 0, image: p.image, station: p.station, track_stock: p.track_stock !== false, sent_qty: 0 }] };
    });
  };
  const setQty = (i, q) => setCart((c) => {
    const l = c.lines[i];
    if (q < (l.sent_qty || 0)) { toast.warning("Items already sent to the kitchen can't be removed here"); return c; }
    if (q > l.qty && !stockOk(l, q)) return c;
    return { ...c, lines: q <= 0 ? c.lines.filter((_, j) => j !== i) : c.lines.map((x, j) => (j === i ? { ...x, qty: q } : x)) };
  });
  const onScan = (code) => {
    const p = data.products.find((x) => x.barcode === code || x.sku?.toLowerCase() === code.toLowerCase());
    if (p) { addProduct(p); return true; }
    return false;
  };

  const orderLines = () => cart.lines.map(({ key, product_id, name, unit_price, qty, category_id, tax_bps, note: n, image, station, track_stock, sent_qty }) =>
    ({ key, product_id, name, unit_price, qty, category_id, tax_bps, note: n, image, station, track_stock, sent_qty }));
  const saveOrder = async () => {
    if (!cart.order) return;
    await api.put(`/orders/${cart.order.id}`, { lines: orderLines(), customer_id: cart.customer?.id || null });
  };

  const a = {
    qty: setQty,
    note: (i) => setNote({ i, text: cart.lines[i].note }),
    customer: () => setDlg("customer"),
    discount: () => setDlg("discount"),
    pay: async () => {
      if (strict && navigator.onLine) {
        try {
          const { data: chk } = await api.post("/stock/check", { outlet_id: outlet.id, lines: cart.lines.filter((l) => l.track_stock) });
          if (!chk.ok) { toast.error(`Not enough stock: ${chk.short.map((s) => `${s.name} (${s.available} left)`).join(", ")}`); return; }
        } catch { /* go offline path */ }
      }
      setDlg("pay");
    },
    hold: async () => {
      try {
        if (cart.order) await saveOrder();
        else await api.post("/orders", { type: "hold", outlet_id: outlet.id, lines: orderLines(), customer_id: cart.customer?.id, label: `${cart.customer?.name || "Order"} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` });
        toast.success("Order held");
        setCart(EMPTY); loadOrders();
      } catch (e) { toast.error(navigator.onLine ? errMsg(e) : "Holding orders needs a connection"); }
    },
    clear: async () => {
      if (cart.order) {
        try {
          if (!cart.lines.length) await api.post(`/orders/${cart.order.id}/cancel`);
          else await saveOrder();
        } catch (e) { toast.error(errMsg(e)); return; }
        loadOrders();
        if (cart.order.table_id) setMode("tables");
      }
      setCart(EMPTY);
    },
    send: async () => {
      try {
        await saveOrder();
        const { data: r } = await api.post(`/orders/${cart.order.id}/send`);
        setCart((c) => ({ ...c, lines: c.lines.map((l) => ({ ...l, sent_qty: l.qty })) }));
        toast.success(`Round ${r.round} sent to ${r.stations.join(" & ")}`);
        loadOrders();
      } catch (e) { toast.error(errMsg(e)); }
    },
    moveTable: () => {
      const busyIds = new Set(orders.map((o) => o.table_id));
      setPick({ title: "Move to table", items: data.tables.filter((x) => !busyIds.has(x.id)).map((x) => ({ id: x.id, label: x.name, hint: x.zone })),
        onPick: async (x) => {
          try { await api.put(`/orders/${cart.order.id}`, { table_id: x.id, table_name: x.label, lines: orderLines() }); setCart((c) => ({ ...c, order: { ...c.order, table_id: x.id, table_name: x.label } })); loadOrders(); toast.success(`Moved to ${x.label}`); }
          catch (e) { toast.error(errMsg(e)); }
        } });
    },
    mergeTable: () => {
      setPick({ title: "Merge another table into this one", items: orders.filter((o) => o.table_id && o.id !== cart.order.id).map((o) => ({ id: o.id, label: o.table_name, hint: `${o.lines.length} items` })),
        onPick: async (x) => {
          try {
            await saveOrder();
            await api.post(`/orders/${cart.order.id}/merge`, { from_id: x.id });
            const { data: list } = await api.get("/orders", { params: { outlet_id: outlet.id } });
            setOrders(list);
            const o = list.find((y) => y.id === cart.order.id);
            setCart((c) => ({ ...c, lines: o.lines, order: o }));
            toast.success(`Merged ${x.label}`);
          } catch (e) { toast.error(errMsg(e)); }
        } });
    },
  };

  const pickTable = async (tbl, o) => {
    if (cart.order && cart.order.id !== o?.id) { try { await saveOrder(); } catch { /* ignore */ } }
    try {
      const order = o || (await api.post("/orders", { type: "table", table_id: tbl.id, table_name: tbl.name, outlet_id: outlet.id, lines: [] })).data;
      setCart({ ...EMPTY, lines: order.lines, order, customer: data.customers.find((c) => c.id === order.customer_id) || null });
      setMode("retail");
      loadOrders();
    } catch (e) { toast.error(navigator.onLine ? errMsg(e) : "Table service needs a connection"); }
  };

  const resumeHeld = (o) => { setCart({ ...EMPTY, lines: o.lines, order: o, customer: data.customers.find((c) => c.id === o.customer_id) || null }); setMode("retail"); };

  const completeSale = async (payments) => {
    setBusy(true);
    const ts = new Date().toISOString();
    const tt = calc(ts);
    const clientId = uuid();
    const payload = {
      client_id: clientId, receipt_no: nextReceipt(outlet.code), outlet_id: outlet.id, shift_id: shift?.id || null,
      customer_id: cart.customer?.id || null, lines: cart.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, manual_discount: l.manual_discount, note: l.note })),
      order_discount: cart.order_discount, voucher_code: cart.voucher?.code || null, points_redeemed: cart.points || 0, payments,
      created_at: ts, client_total: tt.total, order_id: cart.order?.id || null, table_id: cart.order?.table_id || null,
      channel: cart.order?.table_id ? "table" : "retail",
    };
    const op = { type: "sale", client_id: clientId, business_id: bid, payload };
    let offline = !navigator.onLine;
    if (!offline) {
      try {
        await flush(bid).catch(() => {});
        const { data: r } = await api.post("/sync", { ops: [{ ...op, offline: false }] });
        const res = r.results[0];
        if (!res.ok) { toast.error(res.error); setBusy(false); return; }
      } catch (e) {
        if (e.response && e.response.status !== 401) { toast.error(errMsg(e)); setBusy(false); return; }
        offline = true;
      }
    }
    if (offline) queue.push({ ...op, offline: true });
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    patchStock(cart.lines.filter((l) => l.track_stock));
    if (cart.customer && cart.points) update((d) => ({ ...d, customers: d.customers.map((c) => (c.id === cart.customer.id ? { ...c, points: c.points - cart.points } : c)) }));
    setReceipt({ ...payload, totals: tt, offline, change: Math.max(paid - tt.total, 0), due: Math.max(tt.total - paid, 0), customer: cart.customer, table_name: cart.order?.table_name });
    setCart(EMPTY); setDlg(null); setBusy(false); setMobileCart(false);
    loadOrders();
  };

  const openShift = (cash) => {
    const s = { id: uuid(), opening_cash: cash, opened_at: new Date().toISOString() };
    queue.push({ type: "shift_open", client_id: `open-${s.id}`, business_id: bid, payload: { client_id: s.id, outlet_id: outlet.id, opening_cash: cash, created_at: s.opened_at } });
    LS.set(sk, s); setShift(s);
    sync.syncNow();
  };
  const startClose = async () => {
    setShiftSummary(null);
    setDlg("close");
    if (navigator.onLine) {
      try { await flush(bid); const { data: s } = await api.get(`/shifts/${shift.id}`); setShiftSummary(s.summary); } catch { /* offline */ }
    }
  };
  const closeShift = async (counted) => {
    queue.push({ type: "shift_close", client_id: `close-${shift.id}`, business_id: bid, payload: { shift_id: shift.id, counted_cash: counted, created_at: new Date().toISOString() } });
    localStorage.removeItem(sk); setShift(null); setDlg(null);
    await sync.syncNow();
    toast.success("Register closed");
  };
  const saveCash = (f) => {
    const id = uuid();
    queue.push({ type: "cash", client_id: `cash-${id}`, business_id: bid, payload: { client_id: id, outlet_id: outlet.id, shift_id: shift?.id, ...f, created_at: new Date().toISOString() } });
    sync.syncNow(); setDlg(null); toast.success(`Cash ${f.type} recorded`);
  };
  const pinSwitch = async (pin) => {
    try { await api.post("/auth/pin", { pin }); await reload(); setDlg(null); toast.success("Switched user"); }
    catch (e) { toast.error(navigator.onLine ? errMsg(e) : "PIN switch needs a connection"); }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F9" && cart.lines.length && !dlg) { e.preventDefault(); a.pay(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!data || !outlet) return <div className="min-h-screen grid place-items-center text-muted-foreground" data-testid="pos-loading">Loading till…</div>;

  const held = orders.filter((o) => o.type === "hold");
  const canPay = user.role !== "waiter";

  return (
    <div className="h-[100dvh] flex flex-col bg-background">
      <header className="h-14 shrink-0 border-b bg-card flex items-center gap-2 px-3">
        <div className="font-display text-xl font-bold me-2 hidden sm:block">POS<span className="text-primary">Hub</span></div>
        {data.outlets.length > 1 && isManager(user) ? (
          <Select value={outlet.id} onValueChange={(v) => { LS.set(`poshub.outlet.${bid}`, v); setOutletId(v); setCart(EMPTY); }}>
            <SelectTrigger className="w-40 h-9" data-testid="outlet-select"><SelectValue /></SelectTrigger>
            <SelectContent>{data.outlets.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
          </Select>
        ) : <span className="text-sm text-muted-foreground" data-testid="outlet-name">{outlet.name}</span>}
        {biz.restaurant_mode && (
          <div className="flex bg-muted rounded-md p-0.5">
            <Button size="sm" variant={mode === "retail" ? "default" : "ghost"} className="h-8" onClick={() => setMode("retail")} data-testid="mode-retail"><LayoutGrid className="w-4 h-4 sm:me-1" /><span className="hidden sm:inline">{t("retail")}</span></Button>
            <Button size="sm" variant={mode === "tables" ? "default" : "ghost"} className="h-8" onClick={() => { setMode("tables"); loadOrders(); }} data-testid="mode-tables"><Armchair className="w-4 h-4 sm:me-1" /><span className="hidden sm:inline">{t("tables")}</span></Button>
          </div>
        )}
        <div className="flex-1" />
        <div className="hidden md:block"><SyncBadge sync={sync} /></div>
        {held.length > 0 && <Button size="sm" variant="outline" className="h-8" onClick={() => setPick({ title: t("held"), items: held.map((o) => ({ id: o.id, label: o.label, hint: `${o.lines.length} items`, o })), onPick: (x) => resumeHeld(x.o) })} data-testid="held-orders-btn"><PauseCircle className="w-4 h-4 me-1" />{held.length}</Button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" data-testid="pos-menu-btn"><MoreVertical className="w-5 h-5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5 text-xs text-muted-foreground" data-testid="pos-current-user">{user.name} · {user.role}</div>
            <DropdownMenuSeparator />
            {shift && <DropdownMenuItem onClick={() => setDlg("cash")} data-testid="menu-cash">Cash in / out</DropdownMenuItem>}
            {shift && <DropdownMenuItem onClick={startClose} data-testid="menu-close-shift">{t("close_shift")}</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => setDlg("pin")} data-testid="menu-switch-user">{t("switch_user")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => refresh()} data-testid="menu-refresh-catalog">Refresh catalogue</DropdownMenuItem>
            {biz.restaurant_mode && <DropdownMenuItem onClick={() => nav("/kitchen")} data-testid="menu-kitchen">{t("kitchen")}</DropdownMenuItem>}
            {(isManager(user) || user.role === "cashier") && <DropdownMenuItem onClick={() => nav(isManager(user) ? "/app/dashboard" : "/app/sales")} data-testid="menu-back-office">{t("panel")}</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={toggleTheme} data-testid="menu-theme">Light / dark</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLang(LANGS[(LANGS.findIndex((l) => l.code === lang) + 1) % LANGS.length].code)} data-testid="menu-language">Language: {lang.toUpperCase()}</DropdownMenuItem>
            <DropdownMenuItem onClick={async () => { await logout(); nav("/login"); }} data-testid="menu-logout">{t("logout")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="md:hidden border-b px-3 py-2 bg-card"><SyncBadge sync={sync} /></div>
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
        <section className={`lg:col-span-8 xl:col-span-9 min-h-0 ${mobileCart ? "hidden lg:block" : ""}`}>
          {mode === "tables"
            ? <TablesView tables={data.tables} orders={orders} currency={currency} onPick={pickTable} activeOrderId={cart.order?.id} />
            : <ProductGrid products={data.products} categories={data.categories} currency={currency} hideOut={outlet.hide_out_of_stock} onAdd={addProduct} onScan={onScan} searchRef={searchRef} />}
        </section>
        <aside className={`lg:col-span-4 xl:col-span-3 border-s min-h-0 ${mobileCart ? "" : "hidden lg:block"}`}>
          <CartPanel cart={cart} totals={totals} currency={currency} business={biz} a={a} canPay={canPay} />
        </aside>
      </div>
      <button onClick={() => setMobileCart(!mobileCart)} className="lg:hidden h-14 shrink-0 bg-primary text-primary-foreground flex items-center justify-between px-5 font-display" data-testid="mobile-cart-toggle">
        <span className="flex items-center gap-2"><ShoppingBag className="w-5 h-5" />{mobileCart ? "Back to products" : `${cart.lines.reduce((s, l) => s + l.qty, 0)} items`}</span>
        <span className="text-lg font-bold tabular">{fmt(totals.total, currency)}</span>
      </button>

      <OpenShiftDialog open={!!needShift && !shift} onOpen={openShift} currency={currency} outlet={outlet} />
      <CloseShiftDialog open={dlg === "close"} onOpenChange={(o) => !o && setDlg(null)} onClose={closeShift} summary={shiftSummary} currency={currency} />
      <CashDialog open={dlg === "cash"} onOpenChange={(o) => !o && setDlg(null)} onSave={saveCash} currency={currency} />
      <PaymentDialog open={dlg === "pay"} onOpenChange={(o) => !o && setDlg(null)} total={totals.total} currency={currency} methods={biz.payment_methods || []} customer={cart.customer} onPay={completeSale} busy={busy} />
      <CustomerDialog open={dlg === "customer"} onOpenChange={(o) => !o && setDlg(null)} customers={data.customers} selected={cart.customer} currency={currency}
        onSelect={(c) => setCart((x) => ({ ...x, customer: c, points: 0 }))}
        onSaved={(c) => update((d) => ({ ...d, customers: d.customers.some((x) => x.id === c.id) ? d.customers.map((x) => (x.id === c.id ? { ...x, ...c } : x)) : [...d.customers, c] }))} />
      <DiscountDialog open={dlg === "discount"} onOpenChange={(o) => !o && setDlg(null)} presets={data.rules.filter((r) => r.kind === "cashier" && r.active !== false)}
        subtotal={totals.subtotal} currency={currency} user={user} cart={cart} setCart={setCart} outlet={outlet} vouchers={data.vouchers} loyalty={biz.loyalty} />
      <PinDialog open={dlg === "pin"} onOpenChange={(o) => !o && setDlg(null)} title={t("switch_user")} onSubmit={pinSwitch} testid="switch-user-dialog" />
      <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} business={biz} outlet={outlet} />
      <PickDialog pick={pick} onClose={() => setPick(null)} />
      <NoteDialog note={note} onClose={() => setNote(null)} onSave={(v) => setCart((c) => ({ ...c, lines: c.lines.map((l, i) => (i === note.i ? { ...l, note: v } : l)) }))} />
    </div>
  );
}
