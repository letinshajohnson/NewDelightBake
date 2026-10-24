import { Minus, Plus, Trash2, UserRound, BadgePercent, Send, PauseCircle, ArrowLeftRight, Merge, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt, pctStr } from "@/lib/money";
import { useI18n } from "@/lib/i18n";

function Line({ l, i, currency, onQty, onNote, sent }) {
  return (
    <div className="px-4 py-3 border-b" data-testid={`cart-line-${i}`}>
      <div className="flex justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{l.name}</div>
          <div className="text-xs text-muted-foreground tabular">{fmt(l.unit_price, currency)}{sent > 0 && <span className="ms-2 text-primary">sent {sent}</span>}</div>
          {l.note && <div className="text-xs text-warning truncate">“{l.note}”</div>}
        </div>
        <div className="text-end">
          <div className="text-sm font-semibold tabular" data-testid={`cart-line-total-${i}`}>{fmt(l.gross - l.discount, currency)}</div>
          {l.discount > 0 && <div className="text-xs text-success tabular line-through decoration-muted-foreground/50">{fmt(l.gross, currency)}</div>}
        </div>
      </div>
      <div className="flex items-center gap-1 mt-2">
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => onQty(i, l.qty - 1)} data-testid={`cart-line-dec-${i}`}><Minus className="w-3.5 h-3.5" /></Button>
        <span className="w-8 text-center tabular text-sm" data-testid={`cart-line-qty-${i}`}>{l.qty}</span>
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => onQty(i, l.qty + 1)} data-testid={`cart-line-inc-${i}`}><Plus className="w-3.5 h-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 ms-auto" onClick={() => onNote(i)} data-testid={`cart-line-note-${i}`}><MessageSquare className="w-3.5 h-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onQty(i, 0)} disabled={sent > 0} data-testid={`cart-line-remove-${i}`}><Trash2 className="w-3.5 h-3.5" /></Button>
      </div>
    </div>
  );
}

const Row = ({ l, v, testid, tone }) => (
  <div className={`flex justify-between text-sm ${tone || ""}`}><span>{l}</span><span className="tabular" data-testid={testid}>{v}</span></div>
);

export default function CartPanel({ cart, totals, currency, business, a, canPay }) {
  const { t } = useI18n();
  const order = cart.order;
  return (
    <div className="flex flex-col h-full min-h-0 bg-card">
      <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display font-semibold">{order?.table_name ? `Table ${order.table_name}` : order ? order.label || t("held") : t("cart")}</div>
          {order?.table_id && (
            <div className="flex gap-1 mt-1">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={a.moveTable} data-testid="move-table-btn"><ArrowLeftRight className="w-3 h-3 me-1" />Move</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={a.mergeTable} data-testid="merge-table-btn"><Merge className="w-3 h-3 me-1" />Merge</Button>
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={a.customer} className="max-w-[55%]" data-testid="select-customer-btn">
          <UserRound className="w-4 h-4 me-1 shrink-0" /><span className="truncate">{cart.customer ? `${cart.customer.name} · ${cart.customer.points || 0}pts` : t("walk_in")}</span>
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto" data-testid="cart-lines">
        {totals.lines.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground" data-testid="cart-empty">{t("empty_cart")}</div>}
        {totals.lines.map((l, i) => <Line key={l.key} l={l} i={i} currency={currency} onQty={a.qty} onNote={a.note} sent={cart.lines[i]?.sent_qty || 0} />)}
      </div>
      <div className="border-t p-4 space-y-1.5">
        <Row l={t("subtotal")} v={fmt(totals.subtotal, currency)} testid="cart-subtotal" />
        {totals.applied.map((x, i) => (
          <Row key={i} l={`${x.name}${x.line ? " (auto)" : ""}`} v={`-${fmt(x.amount, currency)}`} tone="text-success" testid={`applied-discount-${i}`} />
        ))}
        <Row l={`${t("tax")}${business.tax_inclusive ? " (incl.)" : ""}`} v={fmt(totals.tax, currency)} testid="cart-tax" />
        {totals.service > 0 && <Row l={`${t("service")} ${pctStr(business.service_bps)}`} v={fmt(totals.service, currency)} testid="cart-service" />}
        {totals.rounding !== 0 && <Row l={t("rounding")} v={fmt(totals.rounding, currency)} testid="cart-rounding" />}
        <div className="flex justify-between items-baseline pt-2">
          <span className="font-display text-lg">{t("total")}</span>
          <span className="font-display text-3xl font-bold tabular" data-testid="cart-total">{fmt(totals.total, currency)}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-2">
          <Button variant="outline" onClick={a.discount} disabled={!totals.lines.length} data-testid="discount-btn"><BadgePercent className="w-4 h-4 me-1" />{t("discount")}</Button>
          {order?.table_id
            ? <Button variant="outline" onClick={a.send} disabled={!cart.lines.some((l) => l.qty > (l.sent_qty || 0))} data-testid="send-kitchen-btn"><Send className="w-4 h-4 me-1 rtl-flip" />Kitchen</Button>
            : <Button variant="outline" onClick={a.hold} disabled={!totals.lines.length} data-testid="hold-btn"><PauseCircle className="w-4 h-4 me-1" />{t("hold")}</Button>}
          <Button variant="outline" className="text-destructive border-destructive/40" onClick={a.clear} data-testid="clear-cart-btn">{order ? "Close" : t("clear")}</Button>
        </div>
        {canPay && (
          <Button className="w-full h-14 text-lg font-display active:scale-[0.98]" onClick={a.pay} disabled={!totals.lines.length} data-testid="pay-btn">
            {t("pay")} {fmt(totals.total, currency)} <span className="ms-2 text-xs opacity-60">F9</span>
          </Button>
        )}
      </div>
    </div>
  );
}
