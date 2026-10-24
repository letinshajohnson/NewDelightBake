// Mirrors backend/pricing.py exactly. Money = integer minor units, percents = basis points.
export const rdiv = (num, den) => Math.floor((2 * num + den) / (2 * den));

export function localParts(ts, tzMin) {
  const d = new Date(Date.parse(ts) + (tzMin || 0) * 60000);
  return [d.toISOString().slice(0, 10), d.getUTCDay(), d.getUTCHours() * 60 + d.getUTCMinutes()];
}

const hm = (s) => { const [h, m] = s.split(":"); return +h * 60 + +m; };

export function ruleActive(rule, ctx) {
  if (rule.active === false) return false;
  const [date, wd, mins] = localParts(ctx.ts, ctx.tz_min);
  if (rule.start_date && date < rule.start_date) return false;
  if (rule.end_date && date > rule.end_date) return false;
  if (rule.weekdays?.length && !rule.weekdays.includes(wd)) return false;
  if (rule.time_start && rule.time_end) {
    const s = hm(rule.time_start), e = hm(rule.time_end);
    const ok = s <= e ? s <= mins && mins < e : mins >= s || mins < e;
    if (!ok) return false;
  }
  if (rule.outlet_ids?.length && !rule.outlet_ids.includes(ctx.outlet_id)) return false;
  const aud = rule.audience || "all";
  const c = ctx.customer;
  if (aud === "members" && !c) return false;
  if (aud === "levels" && (!c || !(rule.levels || []).includes(c.level))) return false;
  if (aud === "customers" && (!c || !(rule.customer_ids || []).includes(c.id))) return false;
  return true;
}

const pct = (base, bps, cap) => { const v = rdiv(base * bps, 10000); return cap ? Math.min(v, cap) : v; };

export function productRuleAmount(rule, line) {
  const t = rule.target || "all";
  const ids = rule.target_ids || [];
  if (t === "category" && !ids.includes(line.category_id)) return 0;
  if (t === "products" && !ids.includes(line.product_id)) return 0;
  if (rule.min_item_price && line.unit_price < rule.min_item_price) return 0;
  const mq = rule.min_qty || 0;
  if (mq && line.qty < mq) return 0;
  const gross = line.unit_price * line.qty;
  if (rule.type === "percent") return pct(gross, rule.value, rule.max_amount || 0);
  const times = rule.repeat ? Math.floor(line.qty / Math.max(mq, 1)) : 1;
  return Math.min(rule.value * times, gross);
}

export function manualAmount(d, base) {
  if (!d || !d.value) return 0;
  if (d.type === "percent") return pct(base, d.value, 0);
  return Math.min(d.value, base);
}

export function subtotalRuleAmount(rule, subtotal) {
  const th = rule.threshold || 0;
  if (subtotal < th || subtotal <= 0) return 0;
  if (rule.type === "percent") return pct(subtotal, rule.value, rule.max_amount || 0);
  const times = rule.repeat && th ? Math.floor(subtotal / th) : 1;
  return rule.value * times;
}

export function voucherAmount(v, subtotal) {
  if (!v || subtotal < (v.min_spend || 0)) return 0;
  if (v.type === "percent") return pct(subtotal, v.value, v.max_amount || 0);
  return v.value;
}

export function compute(cart, rules, settings, ctx) {
  const active = rules.filter((r) => ruleActive(r, ctx));
  const prodRules = active.filter((r) => r.kind === "product_auto");
  const subRules = active.filter((r) => r.kind === "subtotal_auto");
  const applied = {};
  const lines = (cart.lines || []).map((ln) => {
    const gross = ln.unit_price * ln.qty;
    let best = 0, bestRule = null;
    for (const r of prodRules) {
      const a = productRuleAmount(r, ln);
      if (a > best) { best = a; bestRule = r; }
    }
    const man = manualAmount(ln.manual_discount, gross);
    let disc, src;
    if (man > best) { disc = man; src = "manual"; }
    else {
      disc = best; src = bestRule ? bestRule.id : null;
      if (bestRule && best) applied[bestRule.id] = (applied[bestRule.id] || 0) + best;
    }
    disc = Math.min(disc, gross);
    return { ...ln, gross, discount: disc, discount_source: src, net: gross - disc };
  });
  const subtotal = lines.reduce((s, l) => s + l.net, 0);
  const parts = [];
  let bestSub = 0, bestSubRule = null;
  for (const r of subRules) {
    const a = subtotalRuleAmount(r, subtotal);
    if (a > bestSub) { bestSub = a; bestSubRule = r; }
  }
  if (bestSubRule) parts.push({ source: bestSubRule.id, name: bestSubRule.name, amount: bestSub });
  const va = voucherAmount(cart.voucher, subtotal);
  if (va) parts.push({ source: "voucher", name: cart.voucher.code, amount: va });
  const ca = manualAmount(cart.order_discount, subtotal);
  if (ca) parts.push({ source: "cashier", name: "Cashier discount", amount: ca });
  const pv = cart.points_value || 0;
  if (pv) parts.push({ source: "points", name: "Points", amount: pv });
  const orderDisc = Math.min(parts.reduce((s, p) => s + p.amount, 0), subtotal);
  let remaining = orderDisc;
  const inclusive = !!settings.tax_inclusive;
  let taxTotal = 0;
  lines.forEach((l, i) => {
    const alloc = i === lines.length - 1 ? remaining : subtotal ? Math.floor((orderDisc * l.net) / subtotal) : 0;
    remaining -= alloc;
    const taxable = l.net - alloc;
    const bps = l.tax_bps || 0;
    const tax = inclusive ? taxable - rdiv(taxable * 10000, 10000 + bps) : rdiv(taxable * bps, 10000);
    Object.assign(l, { order_alloc: alloc, taxable, tax, line_total: taxable + (inclusive ? 0 : tax) });
    taxTotal += tax;
  });
  const after = subtotal - orderDisc;
  const base = after - (inclusive ? taxTotal : 0);
  const service = rdiv(base * (settings.service_bps || 0), 10000);
  const raw = after + (inclusive ? 0 : taxTotal) + service;
  const unit = settings.rounding_unit || 0;
  const rounded = unit > 1 ? rdiv(raw, unit) * unit : raw;
  for (const r of prodRules) {
    if (applied[r.id]) parts.unshift({ source: r.id, name: r.name, amount: applied[r.id], line: true });
  }
  return {
    lines,
    gross: lines.reduce((s, l) => s + l.gross, 0),
    line_discount: lines.reduce((s, l) => s + l.discount, 0),
    subtotal, order_discount: orderDisc, applied: parts,
    tax: taxTotal, service, rounding: rounded - raw, total: rounded,
  };
}
