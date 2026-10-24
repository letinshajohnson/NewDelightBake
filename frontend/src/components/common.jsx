import { useCallback, useEffect, useRef, useState } from "react";
import { Moon, Sun, Languages, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errMsg } from "@/lib/api";
import { fmt } from "@/lib/money";
import { LANGS, useI18n } from "@/lib/i18n";
import { useTheme } from "@/context/AuthContext";
import { toast } from "sonner";

export function useFetch(url, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    if (!url) return;
    const id = ++latest.current;
    setLoading(true);
    try { const r = await api.get(url); if (id === latest.current) setData(r.data); }
    catch (e) { if (id === latest.current) toast.error(errMsg(e)); }
    finally { if (id === latest.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, reload, setData };
}

export function PageHeader({ title, sub, children }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-8 fade-up">
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight" data-testid="page-title">{title}</h1>
        {sub && <p className="text-muted-foreground mt-1 text-sm max-w-2xl">{sub}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}><Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>{children}</div>
);

export const Stat = ({ label, value, hint, testid, accent }) => (
  <div className="bg-card border p-5 fade-up" data-testid={testid}>
    <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
    <div className={`font-display text-3xl font-semibold tabular mt-2 ${accent || ""}`}>{value}</div>
    {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
  </div>
);

const cell = (c, r, currency) => {
  const v = r[c.key];
  if (c.render) return c.render(r);
  if (c.money) return r._count ? v : fmt(v, currency);
  if (c.date) return v ? new Date(v).toLocaleString() : "—";
  return v ?? "—";
};

export function exportCSV(name, columns, rows, currency) {
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = [columns.map((c) => esc(c.label)).join(",")].concat(
    rows.map((r) => columns.map((c) => esc(c.money && !r._count ? (r[c.key] || 0) / 10 ** (currency === "IDR" ? 0 : currency === "KWD" ? 3 : 2) : c.date ? r[c.key] : r[c.key])).join(",")));
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
}

export function DataTable({ columns, rows, currency, testid, onRow, empty = "Nothing here yet" }) {
  return (
    <div className="border bg-card overflow-x-auto" data-testid={testid}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap ${c.money || c.num ? "text-end" : "text-start"}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={r.id || i} onClick={onRow ? () => onRow(r) : undefined}
              className={`border-b last:border-0 ${onRow ? "cursor-pointer hover:bg-accent/60" : ""}`} data-testid={`${testid}-row-${i}`}>
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 whitespace-nowrap ${c.money || c.num ? "text-end tabular" : ""}`}>{cell(c, r, currency)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const ExportBtn = ({ onClick, testid = "export-csv-btn" }) => (
  <Button variant="outline" onClick={onClick} data-testid={testid}><Download className="w-4 h-4 me-2" />Export CSV</Button>
);

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} data-testid="theme-toggle" aria-label="Toggle theme">
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

export function LangSelect({ compact }) {
  const { lang, setLang } = useI18n();
  return (
    <Select value={lang} onValueChange={setLang}>
      <SelectTrigger className={compact ? "w-[72px] h-9" : "w-full"} data-testid="language-select">
        <Languages className="w-4 h-4 me-1 shrink-0" />{compact ? lang.toUpperCase() : <SelectValue />}
      </SelectTrigger>
      <SelectContent>
        {LANGS.map((l) => <SelectItem key={l.code} value={l.code} data-testid={`lang-${l.code}`}>{l.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export const Pill = ({ children, tone = "muted", testid }) => {
  const tones = { muted: "bg-muted text-muted-foreground", ok: "bg-success/15 text-success", warn: "bg-warning/15 text-warning",
    bad: "bg-destructive/15 text-destructive", info: "bg-primary/15 text-primary" };
  return <span data-testid={testid} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tones[tone]}`}>{children}</span>;
};
