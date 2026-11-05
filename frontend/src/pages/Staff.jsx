import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { fmt, toMinor } from "@/lib/money";
import { DataTable, Field, useFetch, Pill, OutletFilter, exportCSV } from "@/components/common";

const ST = [["present", "Present"], ["half_day", "Half day"], ["absent", "Absent"], ["leave", "Leave"]];
const tone = { present: "ok", half_day: "warn", absent: "bad", leave: "muted" };

export function Attendance() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [of, setOf] = useState("");
  const { data: staff } = useFetch("/staff");
  const { data: outlets } = useFetch("/outlets");
  const { data: att, reload } = useFetch(`/attendance?date=${date}`, [date]);
  const byStaff = Object.fromEntries((att || []).map((a) => [a.staff_id, a]));
  const oname = Object.fromEntries((outlets || []).map((o) => [o.id, o.name]));
  const people = (staff || []).filter((s) => s.role !== "owner" && s.active !== false && (!of || s.outlet_id === of));
  const mark = async (s, status, extra = {}) => {
    try { await api.post("/attendance", { staff_id: s.id, date, status, check_in: byStaff[s.id]?.check_in, check_out: byStaff[s.id]?.check_out, ...extra }); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="att-date" /></Field>
        <OutletFilter value={of} onChange={setOf} />
        <span className="text-sm text-muted-foreground" data-testid="att-summary">{(att || []).filter((a) => a.status === "present").length} present · {(att || []).filter((a) => a.status === "absent").length} absent · {people.length - people.filter((p) => byStaff[p.id]).length} not marked</span>
      </div>
      <DataTable columns={[{ key: "name", label: "Staff" }, { key: "role", label: "Role", render: (s) => <Pill tone="info">{s.role === "helper" ? "helping staff" : s.role}</Pill> }, { key: "o", label: "Outlet / unit", render: (s) => oname[s.outlet_id] || "All" },
        { key: "st", label: "Status", render: (s) => <div className="flex gap-1">{ST.map(([k, l]) => <Button key={k} size="sm" variant={byStaff[s.id]?.status === k ? "default" : "outline"} onClick={() => mark(s, k)} data-testid={`att-${k}-${s.id}`}>{l}</Button>)}</div> },
        { key: "in", label: "In", render: (s) => <Input type="time" className="h-8 w-28" defaultValue={byStaff[s.id]?.check_in || ""} disabled={!byStaff[s.id]} onBlur={(e) => byStaff[s.id] && mark(s, byStaff[s.id].status, { check_in: e.target.value })} data-testid={`att-in-${s.id}`} /> },
        { key: "out", label: "Out", render: (s) => <Input type="time" className="h-8 w-28" defaultValue={byStaff[s.id]?.check_out || ""} disabled={!byStaff[s.id]} onBlur={(e) => byStaff[s.id] && mark(s, byStaff[s.id].status, { check_out: e.target.value })} data-testid={`att-out-${s.id}`} /> }]}
        rows={people} testid="attendance-table" />
    </div>
  );
}

export function Salary() {
  const { business } = useAuth();
  const c = business.currency;
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [of, setOf] = useState("");
  const { data, reload } = useFetch(`/attendance/salary?month=${month}${of ? `&outlet_id=${of}` : ""}`, [month, of]);
  const pay = async (r) => {
    const v = window.prompt(`Pay ${r.name} for ${month} — balance ${fmt(r.balance, c)}`, (r.balance / 100).toFixed(2));
    if (!v) return;
    try { await api.post("/attendance/salary/pay", { staff_id: r.staff_id, month, amount: toMinor(v, c) }); toast.success("Salary paid — recorded under Other expenses"); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const cols = [{ key: "name", label: "Staff" }, { key: "role", label: "Role" }, { key: "salary", label: "Salary", money: true }, { key: "period", label: "Per" },
    { key: "present", label: "Present", num: true }, { key: "half_days", label: "Half days", num: true }, { key: "absent", label: "Absent", num: true }, { key: "leave", label: "Leave", num: true },
    { key: "due", label: "Earned", money: true }, { key: "paid", label: "Paid", money: true }, { key: "balance", label: "Balance", money: true }];
  return (
    <div className="space-y-4 print-area print-wide">
      <h2 className="print-only font-bold text-lg">{business.name} — salary report {month}</h2>
      <div className="flex flex-wrap items-end gap-3 no-print">
        <Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="salary-month" /></Field>
        <OutletFilter value={of} onChange={setOf} />
        <Button variant="outline" onClick={() => exportCSV(`salary-${month}`, cols, data || [], c, "xlsx")} data-testid="salary-export-btn">Export Excel</Button>
        <Button variant="outline" onClick={() => window.print()} data-testid="salary-print-btn">Print</Button>
      </div>
      <p className="text-xs text-muted-foreground no-print">Monthly salary is reduced by absent days (half day = half), daily salary is paid per present day, weekly salary counts 6 working days. Click a row to pay.</p>
      <DataTable columns={cols} rows={data || []} currency={c} testid="salary-table" onRow={pay} />
    </div>
  );
}
