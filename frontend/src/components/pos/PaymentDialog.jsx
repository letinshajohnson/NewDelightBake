import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { fmt, toMinor, toMajorStr, CURRENCIES } from "@/lib/money";
import { useI18n } from "@/lib/i18n";

export default function PaymentDialog({ open, onOpenChange, total, currency, methods, customer, onPay, busy }) {
  const { t } = useI18n();
  const [pays, setPays] = useState([]);
  const [method, setMethod] = useState("cash");
  const [amt, setAmt] = useState("");
  const dec = CURRENCIES[currency]?.decimals ?? 2;
  const paid = pays.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(total - paid, 0);
  const change = Math.max(paid - total, 0);

  useEffect(() => {
    if (open) { setPays([]); setMethod("cash"); setAmt(toMajorStr(total, currency)); }
  }, [open, total, currency]);
  useEffect(() => { setAmt(toMajorStr(remaining, currency)); }, [remaining, currency]);

  const add = (minor) => {
    if (minor <= 0) return;
    if (method !== "cash" && minor > remaining) return;
    setPays((ps) => [...ps, { method, amount: minor }]);
  };
  const unit = 10 ** dec;
  const quick = [...new Set([remaining, Math.ceil(remaining / (100 * unit)) * 100 * unit, Math.ceil(remaining / (500 * unit)) * 500 * unit, Math.ceil(remaining / (2000 * unit)) * 2000 * unit])].filter((v) => v > 0).slice(0, 4);
  const canFinish = remaining === 0 || (customer && paid >= 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="payment-dialog">
        <DialogHeader><DialogTitle className="font-display text-2xl">{t("pay")} · <span className="tabular" data-testid="payment-total">{fmt(total, currency)}</span></DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {methods.map((m) => (
            <Button key={m.code} variant={method === m.code ? "default" : "outline"} className="h-12" onClick={() => setMethod(m.code)} data-testid={`pay-method-${m.code}`}>{m.name}</Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" className="h-12 text-lg tabular" data-testid="pay-amount-input" />
          <Button className="h-12 px-6" onClick={() => add(toMinor(amt, currency))} disabled={remaining === 0} data-testid="pay-add-btn">Add</Button>
        </div>
        {method === "cash" && remaining > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {quick.map((q, i) => (
              <Button key={q} variant="outline" className="h-12 tactile tabular active:scale-95" onClick={() => add(q)} data-testid={`quick-cash-${i}`}>{i === 0 ? "Exact" : fmt(q, currency)}</Button>
            ))}
          </div>
        )}
        <div className="space-y-1 border-t pt-3">
          {pays.map((p, i) => (
            <div key={i} className="flex items-center justify-between text-sm" data-testid={`payment-line-${i}`}>
              <span className="uppercase">{p.method}</span>
              <span className="flex items-center gap-2 tabular">{fmt(p.amount, currency)}
                <button onClick={() => setPays(pays.filter((_, j) => j !== i))} data-testid={`remove-payment-${i}`}><X className="w-4 h-4 text-muted-foreground" /></button></span>
            </div>
          ))}
          <div className="flex justify-between font-medium pt-2"><span>{t("remaining")}</span><span className="tabular" data-testid="payment-remaining">{fmt(remaining, currency)}</span></div>
          {change > 0 && <div className="flex justify-between font-display text-2xl text-success"><span>{t("change")}</span><span className="tabular" data-testid="payment-change">{fmt(change, currency)}</span></div>}
          {remaining > 0 && customer && <div className="text-xs text-warning" data-testid="partial-payment-note">{fmt(remaining, currency)} will go on {customer.name}'s account</div>}
        </div>
        <Button className="h-14 text-lg active:scale-[0.98]" disabled={!canFinish || busy || (remaining > 0 && !customer)} onClick={() => onPay(pays)} data-testid="complete-sale-btn">
          {busy ? "…" : t("complete")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
