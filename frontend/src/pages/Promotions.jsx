import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { api, errMsg } from "@/lib/api";
import { fmt, pctStr, toMinor, toMajorStr, toBps } from "@/lib/money";
import { PageHeader, DataTable, Field, useFetch, Pill } from "@/components/common";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KINDS = { product_auto: "Automatic product", subtotal_auto: "Spend & save", cashier: "Cashier preset" };

const Sel = ({ value, onChange, options, testid }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger data-testid={testid}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
  </Select>
);

function RuleForm({ edit, setEdit, currency, cats, prods, outlets, levels, onSaved, voucher }) {
  if (!edit) return null;
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target?.value ?? e });
  const save = async () => {
    const pct = edit.type === "percent";
    const body = { ...edit, value: pct ? toBps(edit.value) : toMinor(edit.value, currency), max_amount: toMinor(edit.max_amount, currency),
      min_item_price: toMinor(edit.min_item_price, currency), threshold: toMinor(edit.threshold, currency), min_spend: toMinor(edit.min_spend, currency),
      min_qty: parseInt(edit.min_qty || "0", 10), quota: parseInt(edit.quota || "0", 10), code: edit.code?.toUpperCase() };
    const url = voucher ? "/vouchers" : "/rules";
    try {
      edit.id ? await api.put(`${url}/${edit.id}`, body) : await api.post(url, body);
      toast.success("Saved"); setEdit(null); onSaved();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const toggleArr = (k, v) => setEdit({ ...edit, [k]: (edit[k] || []).includes(v) ? edit[k].filter((x) => x !== v) : [...(edit[k] || []), v] });
  const k = edit.kind;
  return (
    <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="rule-form-dialog">
        <DialogHeader><DialogTitle className="font-display">{voucher ? "Voucher" : KINDS[k]}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {voucher ? <Field label="Code"><Input value={edit.code || ""} onChange={set("code")} className="uppercase" data-testid="rule-code-input" /></Field>
            : <Field label="Name"><Input value={edit.name || ""} onChange={set("name")} data-testid="rule-name-input" /></Field>}
          <Field label="Type"><Sel value={edit.type} onChange={set("type")} options={[["percent", "Percentage"], ["fixed", "Fixed amount"]]} testid="rule-type-select" /></Field>
          <Field label={edit.type === "percent" ? "Percent" : "Amount"}><Input value={edit.value} onChange={set("value")} data-testid="rule-value-input" /></Field>
          {edit.type === "percent" && k !== "cashier" && <Field label="Cap (max amount, 0 = none)"><Input value={edit.max_amount} onChange={set("max_amount")} data-testid="rule-cap-input" /></Field>}
          {k === "product_auto" && <>
            <Field label="Target"><Sel value={edit.target} onChange={(v) => setEdit({ ...edit, target: v, target_ids: [] })} options={[["all", "Everything"], ["category", "Categories"], ["products", "Named products"]]} testid="rule-target-select" /></Field>
            <Field label="Min quantity per line"><Input value={edit.min_qty} onChange={set("min_qty")} data-testid="rule-minqty-input" /></Field>
            <Field label="Min item price"><Input value={edit.min_item_price} onChange={set("min_item_price")} data-testid="rule-minprice-input" /></Field>
            {edit.type === "fixed" && <label className="flex items-center gap-2 text-sm pt-6"><Switch checked={!!edit.repeat} onCheckedChange={(v) => setEdit({ ...edit, repeat: v })} data-testid="rule-repeat-switch" />Repeat for every multiple</label>}
            {edit.target !== "all" && (
              <div className="col-span-2 flex flex-wrap gap-2">
                {(edit.target === "category" ? cats : prods).map((x) => (
                  <Button key={x.id} size="sm" variant={(edit.target_ids || []).includes(x.id) ? "default" : "outline"} onClick={() => toggleArr("target_ids", x.id)}>{x.name}</Button>
                ))}
              </div>
            )}
          </>}
          {k === "subtotal_auto" && <>
            <Field label="Spend threshold"><Input value={edit.threshold} onChange={set("threshold")} data-testid="rule-threshold-input" /></Field>
            {edit.type === "fixed" && <label className="flex items-center gap-2 text-sm pt-6"><Switch checked={!!edit.repeat} onCheckedChange={(v) => setEdit({ ...edit, repeat: v })} data-testid="rule-repeat-switch" />Repeat for every multiple</label>}
          </>}
          {voucher && <>
            <Field label="Minimum spend"><Input value={edit.min_spend} onChange={set("min_spend")} data-testid="voucher-minspend-input" /></Field>
            <Field label="Quota across branches (0 = unlimited)"><Input value={edit.quota} onChange={set("quota")} data-testid="voucher-quota-input" /></Field>
          </>}
          {k !== "cashier" && <>
            <Field label="Start date"><Input type="date" value={edit.start_date || ""} onChange={set("start_date")} data-testid="rule-start-date" /></Field>
            <Field label="End date"><Input type="date" value={edit.end_date || ""} onChange={set("end_date")} data-testid="rule-end-date" /></Field>
            {!voucher && <>
              <Field label="From time (can cross midnight)"><Input type="time" value={edit.time_start || ""} onChange={set("time_start")} data-testid="rule-time-start" /></Field>
              <Field label="To time"><Input type="time" value={edit.time_end || ""} onChange={set("time_end")} data-testid="rule-time-end" /></Field>
              <div className="col-span-2 flex gap-1">{DAYS.map((d, i) => <Button key={d} size="sm" variant={(edit.weekdays || []).includes(i) ? "default" : "outline"} onClick={() => toggleArr("weekdays", i)} data-testid={`rule-day-${d}`}>{d}</Button>)}</div>
              <Field label="Audience"><Sel value={edit.audience || "all"} onChange={set("audience")} options={[["all", "Everyone"], ["members", "Any named customer"], ["levels", "Customer levels"]]} testid="rule-audience-select" /></Field>
              {edit.audience === "levels" && <div className="flex flex-wrap gap-2 items-end">{levels.map((l) => <Button key={l} size="sm" variant={(edit.levels || []).includes(l) ? "default" : "outline"} onClick={() => toggleArr("levels", l)}>{l}</Button>)}</div>}
            </>}
            <div className="col-span-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Branches (none selected = all)</div>
              <div className="flex flex-wrap gap-2">{outlets.map((o) => <Button key={o.id} size="sm" variant={(edit.outlet_ids || []).includes(o.id) ? "default" : "outline"} onClick={() => toggleArr("outlet_ids", o.id)}>{o.name}</Button>)}</div>
            </div>
          </>}
          <label className="flex items-center gap-2 text-sm"><Switch checked={edit.active !== false} onCheckedChange={(v) => setEdit({ ...edit, active: v })} data-testid="rule-active-switch" />Active</label>
          <Button className="col-span-2 h-11" onClick={save} data-testid="rule-save-btn">Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Promotions() {
  const { business } = useAuth();
  const { t } = useI18n();
  const c = business.currency;
  const { data: rules, reload } = useFetch("/rules");
  const { data: vouchers, reload: reloadV } = useFetch("/vouchers");
  const { data: cats } = useFetch("/categories");
  const { data: prods } = useFetch("/products");
  const { data: outlets } = useFetch("/outlets");
  const [edit, setEdit] = useState(null);
  const [isV, setIsV] = useState(false);
  const toForm = (r) => ({ ...r, value: r.type === "percent" ? String((r.value || 0) / 100) : toMajorStr(r.value, c), max_amount: toMajorStr(r.max_amount || 0, c),
    min_item_price: toMajorStr(r.min_item_price || 0, c), threshold: toMajorStr(r.threshold || 0, c), min_spend: toMajorStr(r.min_spend || 0, c), min_qty: String(r.min_qty || 0), quota: String(r.quota || 0) });
  const startNew = (kind, v = false) => { setIsV(v); setEdit(toForm({ kind, type: "percent", value: 1000, target: "all", audience: "all", active: true })); };
  const val = (r) => (r.type === "percent" ? `${pctStr(r.value)}${r.max_amount ? ` (max ${fmt(r.max_amount, c)})` : ""}` : `${fmt(r.value, c)}${r.repeat ? " ×multiples" : ""}`);
  const when = (r) => [r.time_start && `${r.time_start}–${r.time_end}`, r.weekdays?.length && r.weekdays.map((d) => DAYS[d]).join(","), r.end_date && `until ${r.end_date}`].filter(Boolean).join(" · ") || "Always";
  const del = (url, fn) => async (e, id) => { e.stopPropagation(); await api.delete(`${url}/${id}`); fn(); };
  const delRule = del("/rules", reload);
  const cols = (extra) => [{ key: "name", label: "Name" }, { key: "v", label: "Value", render: val }, ...extra,
    { key: "active", label: "Status", render: (r) => <Pill tone={r.active !== false ? "ok" : "muted"}>{r.active !== false ? "active" : "off"}</Pill> },
    { key: "x", label: "", render: (r) => <Button size="icon" variant="ghost" onClick={(e) => delRule(e, r.id)} data-testid={`delete-rule-${r.id}`}><Trash2 className="w-4 h-4 text-destructive" /></Button> }];
  const list = (k) => (rules || []).filter((r) => r.kind === k);
  const open = (r) => { setIsV(false); setEdit(toForm(r)); };
  return (
    <div>
      <PageHeader title={t("promotions")} sub="Every discount is calculated in one place, in one order: discount → tax → fees → rounding. A line only ever takes its single largest discount." />
      <Tabs defaultValue="product">
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="product" data-testid="promo-tab-product">Automatic</TabsTrigger>
          <TabsTrigger value="subtotal" data-testid="promo-tab-subtotal">Spend & save</TabsTrigger>
          <TabsTrigger value="cashier" data-testid="promo-tab-cashier">Cashier presets</TabsTrigger>
          <TabsTrigger value="vouchers" data-testid="promo-tab-vouchers">Vouchers</TabsTrigger>
        </TabsList>
        <TabsContent value="product" className="space-y-3">
          <Button onClick={() => startNew("product_auto")} data-testid="add-product-rule-btn"><Plus className="w-4 h-4 me-1" />New automatic discount</Button>
          <DataTable columns={cols([{ key: "target", label: "Target" }, { key: "w", label: "When", render: when }, { key: "audience", label: "Audience" }])} rows={list("product_auto")} currency={c} testid="product-rules-table" onRow={open} />
        </TabsContent>
        <TabsContent value="subtotal" className="space-y-3">
          <Button onClick={() => startNew("subtotal_auto")} data-testid="add-subtotal-rule-btn"><Plus className="w-4 h-4 me-1" />New spend & save</Button>
          <DataTable columns={cols([{ key: "threshold", label: "Spend", money: true }, { key: "w", label: "When", render: when }])} rows={list("subtotal_auto")} currency={c} testid="subtotal-rules-table" onRow={open} />
        </TabsContent>
        <TabsContent value="cashier" className="space-y-3">
          <Button onClick={() => startNew("cashier")} data-testid="add-cashier-rule-btn"><Plus className="w-4 h-4 me-1" />New preset</Button>
          <DataTable columns={cols([])} rows={list("cashier")} currency={c} testid="cashier-rules-table" onRow={open} />
          <p className="text-xs text-muted-foreground">Each cashier has a discount limit (Settings → Staff). Going over it asks for a supervisor PIN at the till.</p>
        </TabsContent>
        <TabsContent value="vouchers" className="space-y-3">
          <Button onClick={() => startNew("voucher", true)} data-testid="add-voucher-btn"><Plus className="w-4 h-4 me-1" />New voucher</Button>
          <DataTable columns={[{ key: "code", label: "Code" }, { key: "v", label: "Value", render: val }, { key: "min_spend", label: "Min spend", money: true },
            { key: "q", label: "Used / quota", render: (v) => `${v.used || 0} / ${v.quota || "∞"}` }, { key: "end_date", label: "Expires" },
            { key: "x", label: "", render: (r) => <Button size="icon" variant="ghost" onClick={(e) => del("/vouchers", reloadV)(e, r.id)} data-testid={`delete-voucher-${r.id}`}><Trash2 className="w-4 h-4 text-destructive" /></Button> }]}
            rows={vouchers || []} currency={c} testid="vouchers-table" onRow={(v) => { setIsV(true); setEdit(toForm(v)); }} />
        </TabsContent>
      </Tabs>
      <RuleForm edit={edit} setEdit={setEdit} currency={c} cats={cats || []} prods={prods || []} outlets={outlets || []} levels={business.levels || []} voucher={isV} onSaved={() => { reload(); reloadV(); }} />
    </div>
  );
}
