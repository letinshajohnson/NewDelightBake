import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClipboardPaste } from "lucide-react";
import { api } from "@/lib/api";
import { fmt, pctStr, toMinor, toBps } from "@/lib/money";
import { manualAmount } from "@/lib/pricing";
import { localVoucherCheck } from "./usePosData";
import PinDialog from "./PinDialog";

export default function DiscountDialog({ open, onOpenChange, presets, subtotal, currency, user, cart, setCart, outlet, vouchers, loyalty }) {
  const [custom, setCustom] = useState({ type: "percent", value: "" });
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState(null);
  const [pts, setPts] = useState("");

  const applyDiscount = (d) => {
    const amt = manualAmount(d, subtotal);
    const limit = Math.floor((subtotal * (user.discount_limit_bps || 0)) / 10000);
    if (amt > limit) { setPending(d); return; }
    setCart((c) => ({ ...c, order_discount: d }));
    onOpenChange(false);
  };
  const supervisorOk = async (pin) => {
    try {
      const { data } = await api.post("/auth/supervisor", { pin });
      setCart((c) => ({ ...c, order_discount: { ...pending, approval: data.approval } }));
      toast.success(`Approved by ${data.name}`);
      setPending(null);
      onOpenChange(false);
    } catch { toast.error(navigator.onLine ? "Supervisor PIN not recognised" : "Supervisor approval needs a connection"); }
  };

  const applyVoucher = async (raw) => {
    const c = (raw ?? code).trim().toUpperCase();
    if (!c) return;
    const ctx = { outlet_id: outlet.id, customer_id: cart.customer?.id, subtotal };
    if (navigator.onLine) {
      try {
        const { data } = await api.get("/vouchers/validate", { params: { code: c, ...ctx } });
        if (!data.ok) { setMsg(data.reason); return; }
        setCart((x) => ({ ...x, voucher: data.voucher }));
      } catch { setMsg("Could not check the voucher"); return; }
    } else {
      const v = vouchers.find((x) => x.code === c);
      const reason = localVoucherCheck(v, ctx);
      if (reason) { setMsg(reason); return; }
      setCart((x) => ({ ...x, voucher: v }));
    }
    setMsg(null); setCode(""); onOpenChange(false);
  };
  const paste = async () => {
    try { const s = await navigator.clipboard.readText(); setCode(s.trim()); applyVoucher(s); } catch { toast.error("Clipboard not available"); }
  };

  const bal = cart.customer?.points || 0;
  const pv = loyalty?.point_value || 0;
  const maxPts = pv ? Math.min(bal, Math.floor(subtotal / pv)) : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md" data-testid="discount-dialog">
          <DialogHeader><DialogTitle className="font-display">Discounts & rewards</DialogTitle></DialogHeader>
          <Tabs defaultValue="cashier">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="cashier" data-testid="discount-tab-cashier">Discount</TabsTrigger>
              <TabsTrigger value="voucher" data-testid="discount-tab-voucher">Voucher</TabsTrigger>
              <TabsTrigger value="points" data-testid="discount-tab-points">Points</TabsTrigger>
            </TabsList>
            <TabsContent value="cashier" className="space-y-3">
              <div className="text-xs text-muted-foreground">Your limit: {pctStr(user.discount_limit_bps)} of subtotal — above that needs a supervisor PIN.</div>
              <div className="grid grid-cols-2 gap-2">
                {presets.map((p) => (
                  <Button key={p.id} variant="outline" className="h-auto py-3 flex-col items-start" onClick={() => applyDiscount({ type: p.type, value: p.value, name: p.name })} data-testid={`discount-preset-${p.id}`}>
                    <span className="text-sm">{p.name}</span><span className="text-xs text-muted-foreground">{p.type === "percent" ? pctStr(p.value) : fmt(p.value, currency)}</span>
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant={custom.type === "percent" ? "default" : "outline"} onClick={() => setCustom({ ...custom, type: "percent" })} data-testid="custom-discount-percent">%</Button>
                <Button variant={custom.type === "fixed" ? "default" : "outline"} onClick={() => setCustom({ ...custom, type: "fixed" })} data-testid="custom-discount-fixed">Amount</Button>
                <Input value={custom.value} onChange={(e) => setCustom({ ...custom, value: e.target.value })} inputMode="decimal" placeholder="Value" data-testid="custom-discount-input" />
                <Button onClick={() => applyDiscount({ type: custom.type, value: custom.type === "percent" ? toBps(custom.value) : toMinor(custom.value, currency), name: "Custom" })} data-testid="custom-discount-apply">Apply</Button>
              </div>
              {cart.order_discount && <Button variant="ghost" className="text-destructive" onClick={() => { setCart((c) => ({ ...c, order_discount: null })); onOpenChange(false); }} data-testid="remove-discount-btn">Remove discount</Button>}
            </TabsContent>
            <TabsContent value="voucher" className="space-y-3">
              <div className="flex gap-2">
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" className="uppercase" data-testid="voucher-code-input" />
                <Button variant="outline" size="icon" onClick={paste} data-testid="voucher-paste-btn" aria-label="Paste"><ClipboardPaste className="w-4 h-4" /></Button>
                <Button onClick={() => applyVoucher()} data-testid="voucher-apply-btn">Apply</Button>
              </div>
              {msg && <div className="text-sm text-destructive" data-testid="voucher-error">{msg}</div>}
              {cart.voucher && <Button variant="ghost" className="text-destructive" onClick={() => setCart((c) => ({ ...c, voucher: null }))} data-testid="remove-voucher-btn">Remove {cart.voucher.code}</Button>}
            </TabsContent>
            <TabsContent value="points" className="space-y-3">
              {!cart.customer ? <div className="text-sm text-muted-foreground">Select a customer to redeem points.</div> : (
                <>
                  <div className="text-sm" data-testid="points-balance">{cart.customer.name}: <b>{bal}</b> points · 1 point = {fmt(pv, currency)}</div>
                  <div className="text-xs text-muted-foreground">Up to {maxPts} points usable on this sale.</div>
                  <div className="flex gap-2">
                    <Input value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, ""))} placeholder="Points" data-testid="points-input" />
                    <Button disabled={!pts || +pts > maxPts} onClick={() => { setCart((c) => ({ ...c, points: +pts })); setPts(""); onOpenChange(false); }} data-testid="points-apply-btn">Redeem</Button>
                  </div>
                  {cart.points > 0 && <Button variant="ghost" className="text-destructive" onClick={() => setCart((c) => ({ ...c, points: 0 }))} data-testid="points-cancel-btn">Cancel redemption ({cart.points} pts)</Button>}
                </>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      <PinDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)} title="Supervisor approval" onSubmit={supervisorOk} testid="supervisor-pin-dialog" />
    </>
  );
}
