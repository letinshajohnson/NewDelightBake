import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmt, toMinor } from "@/lib/money";
import { useI18n } from "@/lib/i18n";
import { Field } from "@/components/common";

export function OpenShiftDialog({ open, onOpen, currency, outlet }) {
  const { t } = useI18n();
  const [cash, setCash] = useState("");
  return (
    <Dialog open={open}>
      <DialogContent className="max-w-sm [&>button.absolute]:hidden" data-testid="open-shift-dialog">
        <DialogHeader><DialogTitle className="font-display text-2xl">{t("open_shift")}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{outlet?.name} — count the cash in the drawer to start.</p>
        <Field label="Starting cash"><Input value={cash} onChange={(e) => setCash(e.target.value)} inputMode="decimal" className="h-12 text-lg" autoFocus data-testid="opening-cash-input" /></Field>
        <Button className="h-12" onClick={() => onOpen(toMinor(cash, currency))} data-testid="open-shift-submit">{t("open_shift")}</Button>
      </DialogContent>
    </Dialog>
  );
}

export function CloseShiftDialog({ open, onOpenChange, onClose, summary, currency }) {
  const { t } = useI18n();
  const [cash, setCash] = useState("");
  const counted = toMinor(cash, currency);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="close-shift-dialog">
        <DialogHeader><DialogTitle className="font-display text-2xl">{t("close_shift")}</DialogTitle></DialogHeader>
        {summary ? (
          <div className="text-sm space-y-1 border p-3">
            <div className="flex justify-between"><span>Sales</span><span className="tabular">{summary.sales_count} · {fmt(summary.sales_total, currency)}</span></div>
            {Object.entries(summary.methods).map(([m, v]) => <div key={m} className="flex justify-between text-muted-foreground"><span className="uppercase">{m}</span><span className="tabular">{fmt(v, currency)}</span></div>)}
            <div className="flex justify-between"><span>Cash in / out</span><span className="tabular">{fmt(summary.cash_in, currency)} / {fmt(summary.cash_out, currency)}</span></div>
            <div className="flex justify-between font-medium"><span>Expected cash</span><span className="tabular" data-testid="expected-cash">{fmt(summary.expected_cash, currency)}</span></div>
            {cash && <div className={`flex justify-between font-medium ${counted - summary.expected_cash === 0 ? "text-success" : "text-warning"}`}><span>Difference</span><span className="tabular" data-testid="cash-difference">{fmt(counted - summary.expected_cash, currency)}</span></div>}
          </div>
        ) : <p className="text-sm text-muted-foreground">Summary will be calculated when the shift syncs.</p>}
        <Field label="Counted cash"><Input value={cash} onChange={(e) => setCash(e.target.value)} inputMode="decimal" className="h-12 text-lg" data-testid="counted-cash-input" /></Field>
        <Button className="h-12" variant="destructive" disabled={!cash} onClick={() => onClose(counted)} data-testid="close-shift-submit">{t("close_shift")}</Button>
      </DialogContent>
    </Dialog>
  );
}

const CATS = { in: ["Float top-up", "Tips", "Other"], out: ["Supplies", "Petty cash", "Delivery", "Other"] };

export function CashDialog({ open, onOpenChange, onSave, currency }) {
  const [f, setF] = useState({ type: "out", category: "Supplies", amount: "", note: "" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="cash-dialog">
        <DialogHeader><DialogTitle className="font-display">Cash in / out</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {["in", "out"].map((k) => <Button key={k} variant={f.type === k ? "default" : "outline"} onClick={() => setF({ ...f, type: k, category: CATS[k][0] })} data-testid={`cash-type-${k}`}>Cash {k}</Button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          {CATS[f.type].map((c) => <Button key={c} size="sm" variant={f.category === c ? "secondary" : "ghost"} onClick={() => setF({ ...f, category: c })} data-testid={`cash-cat-${c}`}>{c}</Button>)}
        </div>
        <Input placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" data-testid="cash-amount-input" />
        <Input placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} data-testid="cash-note-input" />
        <Button disabled={!toMinor(f.amount, currency)} onClick={() => { onSave({ ...f, amount: toMinor(f.amount, currency) }); setF({ ...f, amount: "", note: "" }); }} data-testid="cash-save-btn">Save</Button>
      </DialogContent>
    </Dialog>
  );
}
