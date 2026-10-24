import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Delete } from "lucide-react";

export default function PinDialog({ open, onOpenChange, title, onSubmit, testid = "pin-dialog" }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const press = (d) => setPin((p) => (p.length < 6 ? p + d : p));
  const go = async () => {
    setBusy(true);
    try { await onSubmit(pin); setPin(""); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setPin(""); onOpenChange(o); }}>
      <DialogContent className="max-w-xs" data-testid={testid}>
        <DialogHeader><DialogTitle className="font-display">{title}</DialogTitle></DialogHeader>
        <div className="flex justify-center gap-2 py-3" data-testid="pin-dots">
          {Array.from({ length: 6 }).map((_, i) => <span key={i} className={`w-3 h-3 rounded-full border ${i < pin.length ? "bg-primary border-primary" : ""}`} />)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <Button key={d} variant="outline" className="h-14 text-xl tactile active:scale-95" onClick={() => press(d)} data-testid={`pin-key-${d}`}>{d}</Button>
          ))}
          <Button variant="outline" className="h-14" onClick={() => setPin((p) => p.slice(0, -1))} data-testid="pin-key-back"><Delete className="w-5 h-5 rtl-flip" /></Button>
          <Button variant="outline" className="h-14 text-xl tactile active:scale-95" onClick={() => press("0")} data-testid="pin-key-0">0</Button>
          <Button className="h-14" disabled={pin.length < 4 || busy} onClick={go} data-testid="pin-submit-btn">OK</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
