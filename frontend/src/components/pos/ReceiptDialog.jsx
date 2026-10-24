import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, CloudOff, CheckCircle2 } from "lucide-react";
import { fmt } from "@/lib/money";
import { useI18n } from "@/lib/i18n";

const Row = ({ l, v, bold }) => (
  <div className={`flex justify-between ${bold ? "font-bold text-base" : ""}`}><span>{l}</span><span className="tabular">{v}</span></div>
);

export default function ReceiptDialog({ receipt, onClose, business, outlet }) {
  const { t } = useI18n();
  if (!receipt) return null;
  const c = business.currency;
  const r = receipt;
  return (
    <Dialog open={!!receipt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="receipt-dialog">
        <div className="flex items-center gap-2 text-success font-medium">
          <CheckCircle2 className="w-5 h-5" />Sale complete
          {r.offline && <span className="ms-auto inline-flex items-center gap-1 text-xs text-warning" data-testid="receipt-offline-flag"><CloudOff className="w-3.5 h-3.5" />Saved offline — will sync</span>}
        </div>
        <div className="print-area bg-white text-black p-4 font-mono text-xs space-y-1 border" data-testid="receipt-paper">
          <div className="text-center font-bold text-sm">{business.name}</div>
          <div className="text-center">{outlet?.name}</div>
          <div className="text-center" data-testid="receipt-number">#{r.receipt_no}</div>
          <div className="text-center">{new Date(r.created_at).toLocaleString()}</div>
          {r.table_name && <div className="text-center">Table {r.table_name}</div>}
          <div className="border-t border-dashed border-black my-2" />
          {r.totals.lines.map((l, i) => (
            <div key={i}>
              <Row l={`${l.qty} × ${l.name}`} v={fmt(l.gross, c)} />
              {l.discount > 0 && <Row l="  discount" v={`-${fmt(l.discount, c)}`} />}
            </div>
          ))}
          <div className="border-t border-dashed border-black my-2" />
          <Row l={t("subtotal")} v={fmt(r.totals.subtotal, c)} />
          {r.totals.applied.filter((a) => !a.line).map((a, i) => <Row key={i} l={a.name} v={`-${fmt(a.amount, c)}`} />)}
          <Row l={`${t("tax")}${business.tax_inclusive ? " (incl.)" : ""}`} v={fmt(r.totals.tax, c)} />
          {r.totals.service > 0 && <Row l={t("service")} v={fmt(r.totals.service, c)} />}
          {r.totals.rounding !== 0 && <Row l={t("rounding")} v={fmt(r.totals.rounding, c)} />}
          <Row l={t("total")} v={fmt(r.totals.total, c)} bold />
          {r.payments.map((p, i) => <Row key={i} l={p.method.toUpperCase()} v={fmt(p.amount, c)} />)}
          {r.change > 0 && <Row l={t("change")} v={fmt(r.change, c)} />}
          {r.due > 0 && <Row l="On account" v={fmt(r.due, c)} />}
          {r.customer && <div>Customer: {r.customer.name}</div>}
          <div className="border-t border-dashed border-black my-2" />
          <div className="text-center">{business.receipt_footer}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => window.print()} data-testid="print-receipt-btn"><Printer className="w-4 h-4 me-2" />{t("print")}</Button>
          <Button onClick={onClose} data-testid="new-sale-btn">{t("new_sale")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
