import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { api, errMsg } from "@/lib/api";
import { fmt, toMinor, toMajorStr, toBps, pctStr } from "@/lib/money";
import { PageHeader, DataTable, Field, useFetch, Pill } from "@/components/common";

const Toggle = ({ label, checked, onChange, testid, hint }) => (
  <label className="flex items-start gap-3 text-sm py-2"><Switch checked={!!checked} onCheckedChange={onChange} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>
);

export function BusinessTab() {
  const { business, user, setBusiness } = useAuth();
  const c = business.currency;
  const [f, setF] = useState(null);
  useEffect(() => {
    setF({ ...business, service: String((business.service_bps || 0) / 100), rounding: toMajorStr(business.rounding_unit || 0, c),
      earn_per: toMajorStr(business.loyalty?.earn_per || 0, c), point_value: toMajorStr(business.loyalty?.point_value || 0, c),
      expiry_days: String(business.loyalty?.expiry_days || 0), levels_str: (business.levels || []).join(", "),
      methods_str: (business.payment_methods || []).map((m) => m.name).join(", ") });
  }, [business, c]);
  if (!f) return null;
  const owner = user.role === "owner";
  const save = async () => {
    const body = { name: f.name, currency: f.currency, tax_inclusive: f.tax_inclusive, service_bps: toBps(f.service), rounding_unit: toMinor(f.rounding, f.currency),
      restaurant_mode: f.restaurant_mode, allow_price_edit: f.allow_price_edit, receipt_footer: f.receipt_footer, tz_offset_min: parseInt(f.tz_offset_min, 10) || 0,
      levels: f.levels_str.split(",").map((s) => s.trim()).filter(Boolean),
      payment_methods: f.methods_str.split(",").map((s) => s.trim()).filter(Boolean).map((n) => ({ code: n.toLowerCase().replace(/\W+/g, "_"), name: n })),
      loyalty: { ...business.loyalty, enabled: f.loyalty?.enabled, earn_per: toMinor(f.earn_per, f.currency), point_value: toMinor(f.point_value, f.currency), expiry_days: parseInt(f.expiry_days, 10) || 0 } };
    try { const { data } = await api.put("/business", body); setBusiness(data); toast.success("Settings saved"); } catch (e) { toast.error(errMsg(e)); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid md:grid-cols-2 gap-8 max-w-4xl">
      <div className="space-y-4">
        <Field label="Business name"><Input value={f.name} onChange={set("name")} disabled={!owner} data-testid="biz-name-input" /></Field>
        <Field label="Currency">
          <Select value={f.currency} onValueChange={(v) => setF({ ...f, currency: v })} disabled={!owner}>
            <SelectTrigger data-testid="biz-currency-select"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="INR">₹ INR (2 decimals)</SelectItem><SelectItem value="USD">$ USD (2 decimals)</SelectItem><SelectItem value="IDR">Rp IDR (0 decimals)</SelectItem><SelectItem value="KWD">KD KWD (3 decimals)</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Timezone offset (minutes from UTC)"><Input value={f.tz_offset_min} onChange={set("tz_offset_min")} disabled={!owner} data-testid="biz-tz-input" /></Field>
        <Field label="Service charge %"><Input value={f.service} onChange={set("service")} disabled={!owner} data-testid="biz-service-input" /></Field>
        <Field label={`Round totals to nearest (${c})`}><Input value={f.rounding} onChange={set("rounding")} disabled={!owner} data-testid="biz-rounding-input" /></Field>
        <Field label="Payment methods (comma separated)"><Input value={f.methods_str} onChange={set("methods_str")} disabled={!owner} data-testid="biz-methods-input" /></Field>
        <Field label="Receipt footer"><Input value={f.receipt_footer || ""} onChange={set("receipt_footer")} disabled={!owner} data-testid="biz-footer-input" /></Field>
      </div>
      <div className="space-y-2">
        <Toggle label="Prices include tax" hint="Tax is extracted from the shelf price instead of added on top" checked={f.tax_inclusive} onChange={(v) => setF({ ...f, tax_inclusive: v })} testid="biz-tax-inclusive-switch" />
        <Toggle label="Restaurant mode" hint="Tables, rounds and the kitchen display" checked={f.restaurant_mode} onChange={(v) => setF({ ...f, restaurant_mode: v })} testid="biz-restaurant-switch" />
        <Toggle label="Cashiers may edit prices at the till" checked={f.allow_price_edit} onChange={(v) => setF({ ...f, allow_price_edit: v })} testid="biz-price-edit-switch" />
        <Toggle label="Loyalty programme" checked={f.loyalty?.enabled} onChange={(v) => setF({ ...f, loyalty: { ...f.loyalty, enabled: v } })} testid="biz-loyalty-switch" />
        <div className="grid grid-cols-3 gap-3 pt-2">
          <Field label="1 point per"><Input value={f.earn_per} onChange={set("earn_per")} data-testid="biz-earn-input" /></Field>
          <Field label="1 point worth"><Input value={f.point_value} onChange={set("point_value")} data-testid="biz-pointvalue-input" /></Field>
          <Field label="Expire after days"><Input value={f.expiry_days} onChange={set("expiry_days")} data-testid="biz-expiry-input" /></Field>
        </div>
        <Field label="Customer levels"><Input value={f.levels_str} onChange={set("levels_str")} data-testid="biz-levels-input" /></Field>
        {owner ? <Button className="mt-4" onClick={save} data-testid="biz-save-btn">Save settings</Button> : <p className="text-xs text-muted-foreground">Only the owner can change business settings.</p>}
      </div>
    </div>
  );
}

export function OutletsTab() {
  const { data, reload } = useFetch("/outlets");
  const [n, setN] = useState({ name: "", code: "" });
  const upd = async (o, patch) => { try { await api.put(`/outlets/${o.id}`, patch); reload(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-4">
      <div className="flex gap-2 max-w-xl">
        <Input placeholder="Branch name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} data-testid="new-outlet-name" />
        <Input placeholder="Code (e.g. BLR)" value={n.code} onChange={(e) => setN({ ...n, code: e.target.value.toUpperCase() })} className="w-32" data-testid="new-outlet-code" />
        <Button disabled={!n.name || !n.code} onClick={async () => { try { await api.post("/outlets", { ...n, allow_negative_stock: false, hide_out_of_stock: false }); setN({ name: "", code: "" }); reload(); } catch (e) { toast.error(errMsg(e)); } }} data-testid="add-outlet-btn"><Plus className="w-4 h-4" /></Button>
      </div>
      <DataTable columns={[{ key: "name", label: "Branch" }, { key: "code", label: "Receipt prefix" },
        { key: "type", label: "Type", render: (o) => <select className="h-8 rounded border bg-background px-2 text-sm" value={o.type || "shop"} onChange={(e) => upd(o, { type: e.target.value })} data-testid={`outlet-type-${o.code}`}><option value="shop">Retail shop</option><option value="factory">Manufacturing unit</option><option value="restaurant">Restaurant</option></select> },
        { key: "neg", label: "Sell beyond stock", render: (o) => <Switch checked={!!o.allow_negative_stock} onCheckedChange={(v) => upd(o, { allow_negative_stock: v })} data-testid={`outlet-negative-${o.code}`} /> },
        { key: "hide", label: "Hide out of stock", render: (o) => <Switch checked={!!o.hide_out_of_stock} onCheckedChange={(v) => upd(o, { hide_out_of_stock: v })} data-testid={`outlet-hide-${o.code}`} /> },
        { key: "sh", label: "Shifts on", render: (o) => <Switch checked={o.shifts_enabled !== false} onCheckedChange={(v) => upd(o, { shifts_enabled: v })} data-testid={`outlet-shifts-${o.code}`} /> }]} rows={data || []} testid="outlets-table" />
    </div>
  );
}

export function StaffTab() {
  const { data, reload } = useFetch("/staff");
  const { data: outlets } = useFetch("/outlets");
  const { data: roles } = useFetch("/roles");
  const [edit, setEdit] = useState(null);
  const save = async () => {
    const body = { ...edit, discount_limit_bps: toBps(edit.limit), outlet_id: edit.outlet_id === "any" ? null : edit.outlet_id, role_id: edit.role_id || null };
    try { edit.id ? await api.put(`/staff/${edit.id}`, body) : await api.post("/staff", body); toast.success("Staff saved"); setEdit(null); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const oname = Object.fromEntries((outlets || []).map((o) => [o.id, o.name]));
  return (
    <div className="space-y-4">
      <Button onClick={() => setEdit({ name: "", email: "", password: "", pin: "", role: "cashier", outlet_id: "any", limit: "10" })} data-testid="add-staff-btn"><Plus className="w-4 h-4 me-1" />Add staff</Button>
      <DataTable columns={[{ key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "role", label: "Role", render: (u) => <Pill tone="info">{u.role}</Pill> },
        { key: "o", label: "Branch", render: (u) => oname[u.outlet_id] || "All" }, { key: "l", label: "Discount limit", render: (u) => pctStr(u.discount_limit_bps) },
        { key: "has_pin", label: "PIN", render: (u) => (u.has_pin ? "set" : "—") }, { key: "active", label: "Active", render: (u) => <Pill tone={u.active !== false ? "ok" : "muted"}>{u.active !== false ? "yes" : "no"}</Pill> }]}
        rows={data || []} testid="staff-table" onRow={(u) => u.role !== "owner" && setEdit({ ...u, password: "", pin: "", outlet_id: u.outlet_id || "any", limit: String((u.discount_limit_bps || 0) / 100) })} />
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-md" data-testid="staff-form-dialog">
          <DialogHeader><DialogTitle className="font-display">{edit?.id ? "Edit staff" : "New staff"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" className="col-span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="staff-name-input" /></Field>
              <Field label="Email" className="col-span-2"><Input value={edit.email} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, email: e.target.value })} data-testid="staff-email-input" /></Field>
              <Field label={edit.id ? "New password" : "Password"}><Input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} data-testid="staff-password-input" /></Field>
              <Field label="PIN (4–6 digits)"><Input value={edit.pin} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} data-testid="staff-pin-input" /></Field>
              <Field label="Role">
                <Select value={edit.role} onValueChange={(v) => setEdit({ ...edit, role: v })}>
                  <SelectTrigger data-testid="staff-role-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{["manager", "cashier", "waiter", "kitchen"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Branch">
                <Select value={edit.outlet_id} onValueChange={(v) => setEdit({ ...edit, outlet_id: v })}>
                  <SelectTrigger data-testid="staff-outlet-select"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="any">All branches</SelectItem>{(outlets || []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Discount limit %"><Input value={edit.limit} onChange={(e) => setEdit({ ...edit, limit: e.target.value })} data-testid="staff-limit-input" /></Field>
              <Field label="Custom role"><select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={edit.role_id || ""} onChange={(e) => setEdit({ ...edit, role_id: e.target.value })} data-testid="staff-customrole-select"><option value="">—</option>{(roles || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
              {edit.id && <label className="flex items-center gap-2 text-sm pt-6"><Switch checked={edit.active !== false} onCheckedChange={(v) => setEdit({ ...edit, active: v })} data-testid="staff-active-switch" />Active</label>}
              <Button className="col-span-2" onClick={save} disabled={!edit.name || !edit.email} data-testid="staff-save-btn">Save</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TablesTab() {
  const { data, reload } = useFetch("/tables");
  const { data: outlets } = useFetch("/outlets");
  const [n, setN] = useState({ name: "", zone: "Indoor", seats: "4", outlet_id: "" });
  const oid = n.outlet_id || outlets?.[0]?.id;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={oid || ""} onValueChange={(v) => setN({ ...n, outlet_id: v })}>
          <SelectTrigger className="w-44" data-testid="table-outlet-select"><SelectValue /></SelectTrigger>
          <SelectContent>{(outlets || []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
        </Select>
        <Input placeholder="Table name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} className="w-32" data-testid="new-table-name" />
        <Input placeholder="Zone" value={n.zone} onChange={(e) => setN({ ...n, zone: e.target.value })} className="w-32" data-testid="new-table-zone" />
        <Input placeholder="Seats" value={n.seats} onChange={(e) => setN({ ...n, seats: e.target.value })} className="w-20" data-testid="new-table-seats" />
        <Button disabled={!n.name} onClick={async () => { await api.post("/tables", { name: n.name, zone: n.zone, seats: parseInt(n.seats, 10) || 2, outlet_id: oid }); setN({ ...n, name: "" }); reload(); }} data-testid="add-table-btn"><Plus className="w-4 h-4" /></Button>
      </div>
      <DataTable columns={[{ key: "name", label: "Table" }, { key: "zone", label: "Zone" }, { key: "seats", label: "Seats", num: true },
        { key: "x", label: "", render: (tb) => <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { await api.delete(`/tables/${tb.id}`); reload(); }} data-testid={`delete-table-${tb.name}`}>Remove</Button> }]}
        rows={(data || []).filter((tb) => tb.outlet_id === oid)} testid="tables-table" />
    </div>
  );
}

export default function Settings() {
  const { t } = useI18n();
  const { business } = useAuth();
  return (
    <div>
      <PageHeader title={t("settings")} sub={`Subscription: ${business.subscription?.plan} · ${business.subscription?.status} · renews ${business.subscription?.expires_at?.slice(0, 10)}`} />
      <Tabs defaultValue="business">
        <TabsList className="mb-6 flex-wrap h-auto">
          <TabsTrigger value="business" data-testid="settings-tab-business">Business</TabsTrigger>
          <TabsTrigger value="outlets" data-testid="settings-tab-outlets">Branches</TabsTrigger>
          <TabsTrigger value="staff" data-testid="settings-tab-staff">Staff & PINs</TabsTrigger>
          <TabsTrigger value="tables" data-testid="settings-tab-tables">Tables</TabsTrigger>
        </TabsList>
        <TabsContent value="business"><BusinessTab /></TabsContent>
        <TabsContent value="outlets"><OutletsTab /></TabsContent>
        <TabsContent value="staff"><StaffTab /></TabsContent>
        <TabsContent value="tables"><TablesTab /></TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground mt-8">Amounts are stored as whole minor units (e.g. {fmt(12345, business.currency)} = 12345) — never as floating point.</p>
    </div>
  );
}
