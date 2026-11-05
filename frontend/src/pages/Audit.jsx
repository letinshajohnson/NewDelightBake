import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { DataTable, Field, useFetch, Pill, OutletFilter } from "@/components/common";

const tone = { danger: "bad", warning: "warn", info: "muted" };

export default function Audit({ level = "" }) {
  const { user } = useAuth();
  const [of, setOf] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [lv, setLv] = useState(level);
  const qs = new URLSearchParams(Object.entries({ outlet_id: of, start, end, level: lv }).filter(([, v]) => v)).toString();
  const { data } = useFetch(`/audit?${qs}`, [qs]);
  const { data: outlets } = useFetch("/outlets");
  const oname = Object.fromEntries((outlets || []).map((o) => [o.id, o.name]));
  const send = async () => { try { const { data: d } = await api.post("/daily-summary/send"); toast.success(`Daily report emailed to ${d.delivered} address(es)`); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <OutletFilter value={of} onChange={setOf} />
        <Field label="From"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="audit-start" /></Field>
        <Field label="To"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="audit-end" /></Field>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={lv} onChange={(e) => setLv(e.target.value)} data-testid="audit-level"><option value="">All levels</option><option value="danger">Danger</option><option value="warning">Warning</option><option value="info">Info</option></select>
        <div className="flex-1" />
        <a className="text-sm underline" href={`${process.env.REACT_APP_BACKEND_URL}/api/daily-summary/preview`} target="_blank" rel="noreferrer" data-testid="daily-preview-link">Preview today's report</a>
        {user.role === "owner" && <Button variant="outline" onClick={send} data-testid="daily-send-btn">Email daily report now</Button>}
      </div>
      <p className="text-xs text-muted-foreground">The daily report (sales, purchases, finance, attendance and this audit, with danger items) is emailed to the owner and managers every night at 9:30 pm.</p>
      <DataTable columns={[{ key: "created_at", label: "When", date: true }, { key: "user_name", label: "Who" }, { key: "role", label: "Role" },
        { key: "o", label: "Outlet / unit", render: (r) => oname[r.outlet_id] || "—" }, { key: "action", label: "Action" }, { key: "detail", label: "What" },
        { key: "level", label: "Level", render: (r) => <Pill tone={tone[r.level]}>{r.level}</Pill> }, { key: "ip", label: "IP" }]} rows={data || []} testid="audit-table" />
    </div>
  );
}
