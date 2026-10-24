import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { LS } from "@/lib/offline";

export function usePosData(bid, outletId) {
  const key = `poshub.boot.${bid}`;
  const [data, setData] = useState(() => LS.get(key, null));
  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const { data: d } = await api.get("/pos/bootstrap", { params: { outlet_id: outletId || undefined } });
      LS.set(key, d);
      setData(d);
    } catch (e) {
      if (!LS.get(key, null)) toast.error(errMsg(e));
    }
  }, [key, outletId]);
  useEffect(() => { refresh(); }, [refresh]);
  const update = useCallback((fn) => setData((d) => { const nd = fn(d); LS.set(key, nd); return nd; }), [key]);
  const patchStock = useCallback((lines) => update((d) => ({
    ...d, products: d.products.map((p) => {
      const q = lines.filter((l) => l.product_id === p.id).reduce((s, l) => s + l.qty, 0);
      return q ? { ...p, stock: (p.stock || 0) - q } : p;
    }),
  })), [update]);
  return { data, refresh, update, patchStock };
}

export const shiftKey = (bid, uid, oid) => `poshub.shift.${bid}.${uid}.${oid}`;

export function localVoucherCheck(v, { outlet_id, customer_id, subtotal }) {
  const today = new Date().toISOString().slice(0, 10);
  if (!v || v.active === false) return "No voucher with this code";
  if (v.end_date && today > v.end_date) return `Expired on ${v.end_date}`;
  if (v.start_date && today < v.start_date) return `Not valid until ${v.start_date}`;
  if (v.outlet_ids?.length && !v.outlet_ids.includes(outlet_id)) return "Not valid at this branch";
  if (v.quota && (v.used || 0) >= v.quota) return "Redemption quota used up";
  if (v.customer_ids?.length && !v.customer_ids.includes(customer_id)) return "Not for this customer";
  if (subtotal < (v.min_spend || 0)) return "Minimum spend not reached";
  return null;
}
