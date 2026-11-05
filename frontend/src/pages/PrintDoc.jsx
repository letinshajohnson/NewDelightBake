import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { fmt } from "@/lib/money";
import { fileUrl } from "@/components/common";

const TITLE = { sale: ["Tax invoice", "Receipt"], sale_return: ["Credit note", "Return receipt"], purchase: ["Purchase invoice", "Purchase note"],
  purchase_return: ["Debit note", "Purchase return note"], sales_order: ["Order confirmation", "Order slip"] };

function rowsOf(kind, d) {
  return (d.lines || []).map((l) => {
    if (kind === "sale") return { name: l.name, hsn: l.hsn, qty: l.qty, rate: l.unit_price, taxable: l.taxable - (d.tax_inclusive ? l.tax : 0), tax: l.tax, bps: l.tax_bps, amount: l.line_total };
    if (kind === "purchase") { const q = l.received || l.qty; const t = Math.round(q * l.cost * (l.gst_bps || 0) / 10000); return { name: l.name, hsn: l.hsn, qty: q, rate: l.cost, taxable: q * l.cost, tax: t, bps: l.gst_bps || 0, amount: q * l.cost + t }; }
    const rate = l.cost ?? l.price ?? (l.qty ? Math.round(l.amount / l.qty) : 0);
    return { name: l.name, hsn: l.hsn, qty: l.qty, rate, taxable: l.amount, tax: 0, bps: 0, amount: l.amount };
  });
}

export default function PrintDoc() {
  const { kind, id } = useParams();
  const [sp] = useSearchParams();
  const gst = sp.get("mode") === "gst";
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.get(`/print/${kind}/${id}`).then(({ data }) => setD(data)).catch((e) => setErr(errMsg(e))); }, [kind, id]);
  useEffect(() => { if (d) { const t = setTimeout(() => window.print(), 600); return () => clearTimeout(t); } return undefined; }, [d]);
  if (err) return <div className="p-8" data-testid="print-error">{err}</div>;
  if (!d) return <div className="p-8">Loading…</div>;
  const { doc, outlet: o, business: b } = d;
  const c = b.currency;
  const rows = rowsOf(kind, doc);
  const tax = rows.reduce((s, r) => s + r.tax, 0);
  const total = doc.total ?? doc.amount ?? rows.reduce((s, r) => s + r.amount, 0);
  const party = doc.supplier_name || doc.customer_name || doc.bill_name || doc.sale?.customer_name;
  const no = doc.receipt_no || doc.number;
  return (
    <div className={`print-area mx-auto bg-white text-black p-6 ${gst ? "print-wide max-w-3xl" : "max-w-[80mm] text-xs"}`} data-testid="print-doc">
      <div className="flex items-start gap-3 border-b border-black pb-2">
        {b.logo_file && <img src={fileUrl(b.logo_file)} alt="" className={gst ? "w-16 h-16 object-contain" : "w-10 h-10 object-contain"} />}
        <div className="flex-1">
          <div className="font-bold text-lg">{b.name}</div>
          <div>{o.name}{o.address ? ` · ${o.address}` : b.address ? ` · ${b.address}` : ""}</div>
          <div>{[o.phone1, o.phone2, b.support_phone].filter(Boolean).join(" / ")}{b.support_email ? ` · ${b.support_email}` : ""}</div>
          {gst && <div>GSTIN: <b data-testid="print-gstin">{o.gstin || b.gstin || "—"}</b>{(o.fssai || b.fssai) ? <> · FSSAI: <b data-testid="print-fssai">{o.fssai || b.fssai}</b></> : null}</div>}
          {!gst && (o.fssai || b.fssai) && <div>FSSAI: {o.fssai || b.fssai}</div>}
        </div>
        <div className="text-end"><div className="font-bold uppercase" data-testid="print-title">{TITLE[kind][gst ? 0 : 1]}</div><div>No. {no}</div><div>{new Date(doc.created_at).toLocaleDateString()}</div></div>
      </div>
      <div className="py-2">{kind.startsWith("purchase") ? "Supplier" : "Customer"}: <b>{party || "Walk-in"}</b>{gst && doc.supplier?.gstin ? ` · GSTIN ${doc.supplier.gstin}` : ""}{doc.po_number ? ` · against ${doc.po_number}` : ""}{doc.sale?.receipt_no ? ` · against receipt ${doc.sale.receipt_no}` : ""}{doc.supplier_invoice ? ` · supplier bill ${doc.supplier_invoice}` : ""}</div>
      {kind === "sales_order" && <div className="pb-2">{doc.delivery_mode} on {doc.delivery_date} {doc.delivery_time || ""} · {doc.location} · {doc.phone}</div>}
      <table className="w-full border-collapse">
        <thead><tr className="border-b border-black text-start">
          <th className="text-start">Item</th>{gst && <th className="text-start">HSN</th>}<th className="text-end">Qty</th><th className="text-end">Rate</th>
          {gst && <><th className="text-end">Taxable</th><th className="text-end">GST %</th><th className="text-end">CGST</th><th className="text-end">SGST</th></>}<th className="text-end">Amount</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={`${r.name}-${r.qty}-${r.rate}`} className="border-b border-gray-300">
            <td>{r.name}</td>{gst && <td>{r.hsn || ""}</td>}<td className="text-end">{r.qty}</td><td className="text-end">{fmt(r.rate, c)}</td>
            {gst && <><td className="text-end">{fmt(r.taxable, c)}</td><td className="text-end">{r.bps / 100}</td><td className="text-end">{fmt(Math.floor(r.tax / 2), c)}</td><td className="text-end">{fmt(r.tax - Math.floor(r.tax / 2), c)}</td></>}
            <td className="text-end">{fmt(r.amount, c)}</td></tr>))}
        </tbody>
      </table>
      <div className="mt-2 space-y-0.5 text-end">
        {gst && tax > 0 && <div>Total GST: {fmt(tax, c)} (CGST {fmt(Math.floor(tax / 2), c)} + SGST {fmt(tax - Math.floor(tax / 2), c)})</div>}
        {(doc.applied || []).map((a) => <div key={a.source}>{a.name}: -{fmt(a.amount, c)}</div>)}
        <div className="font-bold text-base" data-testid="print-total">Total: {fmt(total, c)}</div>
        {kind === "sales_order" && <div>Advance received {fmt(doc.received, c)} · Balance {fmt(doc.total - doc.received, c)}</div>}
        {(doc.payments || []).map((p) => <div key={`${p.method}-${p.amount}-${p.at || ""}`}>{p.method}: {fmt(p.amount, c)}</div>)}
        {doc.reason && <div>Reason: {doc.reason}</div>}
        {doc.refund_method && <div>Refunded as: {doc.refund_method.replace("_", " ")}</div>}
      </div>
      <div className="mt-6 text-center border-t border-black pt-2">{b.receipt_footer || "Thank you!"}</div>
      <button className="no-print mt-4 border px-3 py-1" onClick={() => window.print()} data-testid="print-again-btn">Print</button>
    </div>
  );
}
