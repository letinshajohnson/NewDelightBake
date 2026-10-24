import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ScanBarcode, ImageOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fmt } from "@/lib/money";
import { useI18n } from "@/lib/i18n";

function Tile({ p, currency, onAdd, i, color }) {
  const out = p.track_stock !== false && (p.stock || 0) <= 0;
  return (
    <button onClick={() => onAdd(p)} data-testid={`product-tile-${p.id}`}
      className="group relative text-start bg-card border-e border-b p-0 min-h-[9rem] flex flex-col active:scale-[0.97] transition-transform hover:bg-accent/40 fade-up"
      style={{ animationDelay: `${Math.min(i, 20) * 15}ms`, borderTop: color ? `3px solid ${color}` : undefined }}>
      <div className="aspect-[4/3] w-full overflow-hidden bg-muted">
        {p.image ? <img src={p.image} alt={p.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          : <div className="w-full h-full grid place-items-center text-muted-foreground"><ImageOff className="w-6 h-6" /></div>}
      </div>
      <div className="p-2.5 flex-1 flex flex-col justify-between gap-1">
        <div className="text-sm font-medium leading-tight line-clamp-2">{p.name}</div>
        <div className="flex items-center justify-between">
          <span className="font-display font-semibold tabular">{fmt(p.price, currency)}</span>
          {p.track_stock !== false && <span className={`text-[11px] tabular ${out ? "text-destructive" : (p.stock || 0) < 10 ? "text-warning" : "text-muted-foreground"}`}>{p.stock || 0}</span>}
        </div>
      </div>
    </button>
  );
}

export default function ProductGrid({ products, categories, currency, hideOut, onAdd, onScan, searchRef }) {
  const { t } = useI18n();
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(48);
  const sentinel = useRef(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => (cat === "all" || p.category_id === cat)
      && (!hideOut || p.track_stock === false || (p.stock || 0) > 0)
      && (!s || p.name.toLowerCase().includes(s) || p.barcode?.includes(s) || p.sku?.toLowerCase().includes(s)));
  }, [products, cat, q, hideOut]);

  useEffect(() => { setLimit(48); }, [cat, q]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return undefined;
    const ob = new IntersectionObserver((e) => { if (e[0].isIntersecting) setLimit((l) => l + 48); });
    ob.observe(el);
    return () => ob.disconnect();
  }, [list.length]);

  const onKey = (e) => {
    if (e.key === "Enter" && q.trim()) {
      if (onScan(q.trim())) setQ("");
    }
    if (e.key === "Escape") setQ("");
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={`${t("search")}  (F2)`}
            className="ps-9 h-11" data-testid="pos-search-input" />
        </div>
        <ScanBarcode className="w-5 h-5 text-muted-foreground hidden sm:block" />
      </div>
      <div className="flex gap-1 px-3 py-2 border-b overflow-x-auto">
        {[{ id: "all", name: t("all") }, ...categories].map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)} data-testid={`category-tab-${c.id}`}
            className={`px-4 h-9 text-sm whitespace-nowrap rounded-md transition-colors ${cat === c.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`} style={c.color && cat !== c.id ? { boxShadow: `inset 3px 0 0 ${c.color}` } : undefined}>{c.name}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 border-s border-t" data-testid="product-grid">
          {list.slice(0, limit).map((p, i) => <Tile key={p.id} p={p} i={i} currency={currency} onAdd={onAdd} color={categories.find((c) => c.id === p.category_id)?.color} />)}
        </div>
        {list.length === 0 && <div className="p-10 text-center text-muted-foreground" data-testid="product-grid-empty">No products match</div>}
        {limit < list.length && <div ref={sentinel} className="h-10" />}
      </div>
    </div>
  );
}
