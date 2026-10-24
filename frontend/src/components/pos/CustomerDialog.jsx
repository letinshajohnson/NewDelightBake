import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserRound, Pencil, Plus } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { fmt } from "@/lib/money";
import { useI18n } from "@/lib/i18n";

export default function CustomerDialog({ open, onOpenChange, customers, selected, onSelect, onSaved, currency }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null);
  const list = customers.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.phone?.includes(q)).slice(0, 50);

  const save = async () => {
    try {
      const body = { name: edit.name, phone: edit.phone };
      const { data } = edit.id ? await api.put(`/customers/${edit.id}`, body) : await api.post("/customers", body);
      onSaved({ ...data, points: edit.points || 0 });
      onSelect({ ...data, points: edit.points || 0 });
      setEdit(null);
      onOpenChange(false);
    } catch (e) { toast.error(navigator.onLine ? errMsg(e) : "Adding customers needs a connection"); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setEdit(null); onOpenChange(o); }}>
      <DialogContent className="max-w-md" data-testid="customer-dialog">
        <DialogHeader><DialogTitle className="font-display">{t("customer")}</DialogTitle></DialogHeader>
        {edit ? (
          <div className="space-y-3">
            <Input placeholder="Name" value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="customer-name-input" />
            <Input placeholder="Phone" value={edit.phone || ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} data-testid="customer-phone-input" />
            <div className="flex gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Back</Button><Button className="flex-1" disabled={!edit.name} onClick={save} data-testid="customer-save-btn">Save</Button></div>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} data-testid="customer-search-input" />
              <Button variant="outline" size="icon" onClick={() => setEdit({ name: q })} data-testid="customer-add-btn"><Plus className="w-4 h-4" /></Button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y border">
              <button className="w-full text-start px-3 py-3 hover:bg-accent text-sm" onClick={() => { onSelect(null); onOpenChange(false); }} data-testid="customer-walkin-btn">{t("walk_in")}</button>
              {list.map((c) => (
                <div key={c.id} className={`flex items-center px-3 py-2.5 hover:bg-accent ${selected?.id === c.id ? "bg-accent" : ""}`}>
                  <button className="flex-1 text-start" onClick={() => { onSelect(c); onOpenChange(false); }} data-testid={`customer-option-${c.id}`}>
                    <div className="text-sm font-medium flex items-center gap-2"><UserRound className="w-4 h-4" />{c.name}{c.level && <span className="text-[10px] px-1.5 rounded bg-primary/15 text-primary">{c.level}</span>}</div>
                    <div className="text-xs text-muted-foreground">{c.phone} · {c.points || 0} pts{c.credit_limit ? ` · limit ${fmt(c.credit_limit, currency)}` : ""}</div>
                  </button>
                  <Button variant="ghost" size="icon" onClick={() => setEdit(c)} data-testid={`customer-edit-${c.id}`}><Pencil className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
