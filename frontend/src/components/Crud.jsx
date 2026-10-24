import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { fmt, toMinor, toMajorStr, toBps, pctStr } from "@/lib/money";
import { DataTable, Field, useFetch } from "@/components/common";

// fields: {key, label, type: text|number|money|pct|color|bool|select|multi, options:[[v,l]], table?: bool}
const show = (f, r, c) => {
  const v = r[f.key];
  if (f.type === "money") return fmt(v || 0, c);
  if (f.type === "pct") return pctStr(v);
  if (f.type === "color") return <span className="inline-flex items-center gap-2"><span className="w-4 h-4 rounded" style={{ background: v }} />{v}</span>;
  if (f.type === "bool") return v ? "yes" : "no";
  if (f.type === "select") return f.options.find((o) => o[0] === v)?.[1] || "—";
  if (f.type === "multi") return (v || []).length ? (v || []).map((x) => f.options.find((o) => o[0] === x)?.[1] || x).join(", ") : "—";
  return v ?? "—";
};
const toForm = (f, v, c) => (f.type === "money" ? toMajorStr(v || 0, c) : f.type === "pct" ? String((v || 0) / 100) : v ?? (f.type === "multi" ? [] : f.type === "bool" ? false : ""));
const fromForm = (f, v, c) => (f.type === "money" ? toMinor(v, c) : f.type === "pct" ? toBps(v) : f.type === "number" ? parseInt(v || "0", 10) : v);

function Input2({ f, v, set }) {
  if (f.type === "bool") return <Switch checked={!!v} onCheckedChange={set} data-testid={`crud-field-${f.key}`} />;
  if (f.type === "select") return (
    <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={v || ""} onChange={(e) => set(e.target.value)} data-testid={`crud-field-${f.key}`}>
      <option value="">—</option>{f.options.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
    </select>);
  if (f.type === "multi") return (
    <div className="flex flex-wrap gap-1.5" data-testid={`crud-field-${f.key}`}>{f.options.map(([o, l]) => (
      <Button key={o} type="button" size="sm" variant={(v || []).includes(o) ? "default" : "outline"} onClick={() => set((v || []).includes(o) ? v.filter((x) => x !== o) : [...(v || []), o])}>{l}</Button>))}</div>);
  return <Input type={f.type === "color" ? "color" : "text"} value={v} onChange={(e) => set(e.target.value)} className={f.type === "color" ? "h-9 w-20 p-1" : ""} data-testid={`crud-field-${f.key}`} />;
}

export default function Crud({ endpoint, fields, title, hint, defaults = {}, readOnly }) {
  const { business } = useAuth();
  const c = business.currency;
  const { data, reload } = useFetch(`/${endpoint}`, [endpoint]);
  const [edit, setEdit] = useState(null);
  const open = (r) => setEdit({ id: r.id, ...Object.fromEntries(fields.map((f) => [f.key, toForm(f, r[f.key], c)])) });
  const save = async () => {
    const body = { ...defaults, ...Object.fromEntries(fields.map((f) => [f.key, fromForm(f, edit[f.key], c)])) };
    try {
      edit.id ? await api.put(`/${endpoint}/${edit.id}`, body) : await api.post(`/${endpoint}`, body);
      toast.success("Saved"); setEdit(null); reload();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const cols = [...fields.filter((f) => f.table !== false).map((f) => ({ key: f.key, label: f.label, render: (r) => show(f, r, c) })),
    ...(readOnly ? [] : [{ key: "_x", label: "", render: (r) => <Button size="icon" variant="ghost" onClick={async (e) => { e.stopPropagation(); if (!window.confirm(`Remove ${r[fields[0].key]}?`)) return; await api.delete(`/${endpoint}/${r.id}`); reload(); }} data-testid={`crud-delete-${r.id}`}><Trash2 className="w-4 h-4 text-destructive" /></Button> }])];
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        {hint && <p className="text-sm text-muted-foreground max-w-2xl">{hint}</p>}
        {!readOnly && <Button onClick={() => open({ ...defaults })} data-testid={`crud-add-${endpoint}`}><Plus className="w-4 h-4 me-1" />Add {title}</Button>}
      </div>
      <DataTable columns={cols} rows={(data || []).filter((r) => Object.entries(defaults).every(([k, v]) => r[k] === v))} currency={c} testid={`crud-table-${endpoint}`} onRow={readOnly ? undefined : open} />
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="crud-dialog">
          <DialogHeader><DialogTitle className="font-display">{edit?.id ? "Edit" : "New"} {title}</DialogTitle></DialogHeader>
          {edit && <div className="space-y-3">
            {fields.map((f) => <Field key={f.key} label={f.label}><Input2 f={f} v={edit[f.key]} set={(v) => setEdit({ ...edit, [f.key]: v })} /></Field>)}
            <Button className="w-full" onClick={save} disabled={!edit[fields[0].key]} data-testid="crud-save-btn">Save</Button>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
