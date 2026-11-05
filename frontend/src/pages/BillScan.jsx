import { useState } from "react";
import { toast } from "sonner";
import { Camera, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errMsg } from "@/lib/api";
import { Field, useFetch } from "@/components/common";
import { Sel } from "@/pages/Purchasing";

const HEAD = [["supplier", "Supplier"], ["supplier_gstin", "Supplier GSTIN"], ["invoice_no", "Invoice no."], ["date", "Bill date"], ["due_date", "Due date"]];
const COLS = [["item", "Item", "min-w-[200px]"], ["hsn", "HSN", "w-28"], ["qty", "Qty", "w-20"], ["rate", "Rate (before GST)", "w-28"], ["mrp", "MRP", "w-24"], ["gst", "GST %", "w-20"]];

const shrink = (file) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 1800 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = img.width * k; cv.height = img.height * k;
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    res(cv.toDataURL("image/jpeg", 0.85));
  };
  img.onerror = rej;
  img.src = URL.createObjectURL(file);
});

function ItemsEditor({ items, setItems }) {
  const set = (i, k, v) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="border overflow-x-auto" data-testid="scan-items-table">
      <table className="w-full text-sm">
        <thead><tr className="bg-muted/50">{COLS.map(([k, l]) => <th key={k} className="text-left font-medium px-2 py-2 text-xs">{l}</th>)}<th /></tr></thead>
        <tbody>{items.map((it, i) => (
          <tr key={i} className="border-t">
            {COLS.map(([k, , w]) => <td key={k} className="p-1"><Input className={`h-8 ${w}`} value={it[k]} onChange={(e) => set(i, k, e.target.value)} data-testid={`scan-item-${k}-${i}`} /></td>)}
            <td className="p-1"><Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))} data-testid={`scan-item-remove-${i}`}><Trash2 className="w-4 h-4" /></Button></td>
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

export default function BillScan() {
  const { data: outlets } = useFetch("/outlets");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const [head, setHead] = useState(null);
  const [items, setItems] = useState([]);
  const [outlet, setOutlet] = useState("");
  const read = async (file) => {
    if (!file) return;
    setBusy(true); setHead(null);
    try {
      const b64 = await shrink(file);
      setPreview(b64);
      const { data } = await api.post("/purchase-bills/scan", { image_base64: b64 });
      setHead({ ...data, net_total: data.net_total }); setItems(data.items);
      toast.success(`Read ${data.items.length} items — please check before saving`);
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const save = async () => {
    const rows = items.filter((x) => x.item).map((x) => ({ ...x, supplier: head.supplier, supplier_gstin: head.supplier_gstin, invoice_no: head.invoice_no, date: head.date, due_date: head.due_date }));
    try { await api.post("/import/purchase", { rows, outlet_id: outlet }); toast.success("Purchase bill saved and stock received"); setHead(null); setItems([]); setPreview(""); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const sum = items.reduce((s, x) => s + (+x.qty || 0) * (+x.rate || 0) * (1 + (+x.gst || 0) / 100), 0);
  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-8">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Take or upload a clear, straight photo of a supplier's GST bill. AI reads the supplier, GSTIN, invoice number and every line; you check and correct it, then save it as a received purchase.</p>
        <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed h-40 cursor-pointer hover:bg-accent transition-colors ${busy ? "opacity-60 pointer-events-none" : ""}`} data-testid="scan-upload-label">
          {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
          <span className="text-sm">{busy ? "Reading the bill…" : "Choose or take a photo"}</span>
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => read(e.target.files[0])} data-testid="scan-file-input" />
        </label>
        {preview && <img src={preview} alt="Bill" className="w-full border" data-testid="scan-preview-img" />}
      </div>
      {head && (
        <div className="space-y-4" data-testid="scan-result">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {HEAD.map(([k, l]) => <Field key={k} label={l}><Input value={head[k]} onChange={(e) => setHead({ ...head, [k]: e.target.value })} data-testid={`scan-${k}-input`} /></Field>)}
          </div>
          <ItemsEditor items={items} setItems={setItems} />
          <Button variant="outline" size="sm" onClick={() => setItems([...items, { item: "", hsn: "", qty: "1", rate: "0", mrp: "0", gst: "5" }])} data-testid="scan-add-item-btn"><Plus className="w-4 h-4 me-1" />Add line</Button>
          <div className="text-sm" data-testid="scan-totals">Lines + GST: <b>₹{sum.toFixed(2)}</b>{head.net_total ? <> · Bill says: <b>₹{(+head.net_total).toFixed(2)}</b></> : null}</div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Receive stock into"><Sel value={outlet} onChange={setOutlet} options={outlets || []} testid="scan-outlet-select" /></Field>
            <Button onClick={save} disabled={!outlet || !head.invoice_no || !items.length} data-testid="scan-save-btn">Save purchase bill</Button>
          </div>
          <p className="text-xs text-muted-foreground">New items are created under "Other Brands" and new suppliers are added with their GSTIN.</p>
        </div>
      )}
    </div>
  );
}
