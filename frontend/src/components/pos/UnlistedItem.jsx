import { useState } from "react";
import { toast } from "sonner";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errMsg } from "@/lib/api";
import { fmt, toMinor } from "@/lib/money";

export function UnlistedItem({ currency, onAdd }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", qty: "1", amount: "" });
  const add = () => {
    onAdd({ name: f.name.trim(), qty: Math.max(parseInt(f.qty, 10) || 1, 1), unit_price: toMinor(f.amount, currency) });
    setF({ name: "", qty: "1", amount: "" }); setOpen(false);
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="pos-unlisted-btn"><PackagePlus className="w-4 h-4 me-1" />Item not listed</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" data-testid="unlisted-dialog">
          <DialogHeader><DialogTitle className="font-display">Add an item that is not in the list</DialogTitle></DialogHeader>
          <Input placeholder="Item name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="unlisted-name" />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Qty" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} data-testid="unlisted-qty" />
            <Input placeholder={`Price each (${currency})`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="unlisted-amount" />
          </div>
          <Button onClick={add} disabled={!f.name.trim() || !toMinor(f.amount, currency)} data-testid="unlisted-add-btn">Add to bill</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NewItemsDialog({ items, currency, onClose }) {
  const [sel, setSel] = useState(() => Object.fromEntries((items || []).map((l) => [l.key, true])));
  if (!items?.length) return null;
  const save = async () => {
    try {
      const { data } = await api.post("/products/from-pos", { items: items.filter((l) => sel[l.key]).map((l) => ({ name: l.name, price: l.unit_price })) });
      toast.success(data.added.length ? `Added to products: ${data.added.join(", ")}` : "Nothing new to add"); onClose();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="new-items-dialog">
        <DialogHeader><DialogTitle className="font-display">Add these new items to products?</DialogTitle></DialogHeader>
        {items.map((l) => (
          <label key={l.key} className="flex items-center gap-3 text-sm"><input type="checkbox" checked={!!sel[l.key]} onChange={(e) => setSel({ ...sel, [l.key]: e.target.checked })} data-testid={`new-item-check-${l.key}`} />
            <span className="flex-1">{l.name}</span><span className="tabular">{fmt(l.unit_price, currency)}</span></label>))}
        <div className="flex gap-2"><Button onClick={save} data-testid="new-items-confirm-btn">Add selected</Button><Button variant="ghost" onClick={onClose} data-testid="new-items-skip-btn">Not now</Button></div>
      </DialogContent>
    </Dialog>
  );
}
