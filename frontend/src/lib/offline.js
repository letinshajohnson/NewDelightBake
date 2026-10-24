import { useEffect, useState, useCallback } from "react";
import { api } from "./api";

export const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function device() {
  let d = LS.get("poshub.device");
  if (!d) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    d = { code: Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""), seq: {} };
    LS.set("poshub.device", d);
  }
  return d;
}

export const deviceCode = () => device().code;

// Receipt numbers: OUTLET-DEVICE-SEQ, unique per outlet even when created offline.
export function nextReceipt(outletCode) {
  const d = device();
  d.seq[outletCode] = (d.seq[outletCode] || 0) + 1;
  LS.set("poshub.device", d);
  return `${outletCode}-${d.code}-${String(d.seq[outletCode]).padStart(5, "0")}`;
}

const QK = "poshub.queue";
const FK = "poshub.failed";
const emit = () => window.dispatchEvent(new Event("poshub:queue"));

export const queue = {
  all: () => LS.get(QK, []),
  failed: () => LS.get(FK, []),
  push(op) { LS.set(QK, [...queue.all(), op]); emit(); },
  clearFailed() { LS.set(FK, []); emit(); },
};

let flushing = null;

export function flush(businessId) {
  if (flushing) return flushing;
  flushing = (async () => {
    const all = queue.all();
    const ops = all.filter((o) => o.business_id === businessId);
    if (!ops.length || !navigator.onLine) return { sent: 0 };
    const { data } = await api.post("/sync", { ops });
    const done = new Set();
    const fails = [];
    for (const r of data.results) {
      if (r.ok) done.add(r.client_id);
      else if (r.code !== 401) {
        const op = ops.find((o) => o.client_id === r.client_id);
        if (op?.type === "sale") { done.add(r.client_id); fails.push({ ...op, error: r.error }); }
      }
    }
    LS.set(QK, queue.all().filter((o) => !done.has(o.client_id)));
    if (fails.length) LS.set(FK, [...queue.failed(), ...fails]);
    emit();
    return { sent: done.size - fails.length, failed: fails.length };
  })().finally(() => { flushing = null; });
  return flushing;
}

export function useSync(businessId) {
  const [state, setState] = useState({ pending: 0, failed: 0, online: navigator.onLine, syncing: false });
  const refresh = useCallback(() => {
    setState((s) => ({ ...s, pending: queue.all().filter((o) => o.business_id === businessId).length,
      failed: queue.failed().length, online: navigator.onLine }));
  }, [businessId]);
  const syncNow = useCallback(async () => {
    setState((s) => ({ ...s, syncing: true }));
    try { return await flush(businessId); } catch (e) { return { error: e }; }
    finally { setState((s) => ({ ...s, syncing: false })); refresh(); }
  }, [businessId, refresh]);
  useEffect(() => {
    refresh();
    const onOnline = () => { refresh(); syncNow(); };
    window.addEventListener("poshub:queue", refresh);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", refresh);
    const t = setInterval(() => { if (navigator.onLine && queue.all().length) syncNow(); }, 20000);
    return () => {
      window.removeEventListener("poshub:queue", refresh);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", refresh);
      clearInterval(t);
    };
  }, [refresh, syncNow]);
  return { ...state, syncNow };
}
