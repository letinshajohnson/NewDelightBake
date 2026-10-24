"""POSHub pricing engine. Mirrors frontend/src/lib/pricing.js exactly. All money = integer minor units, percents = basis points."""
from datetime import datetime, timedelta


def rdiv(num: int, den: int) -> int:
    return (2 * num + den) // (2 * den)


def local_parts(ts: str, tz_min: int):
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00")) + timedelta(minutes=tz_min)
    return dt.strftime("%Y-%m-%d"), dt.isoweekday() % 7, dt.hour * 60 + dt.minute


def _hm(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def rule_active(rule, ctx) -> bool:
    if not rule.get("active", True):
        return False
    date, wd, mins = local_parts(ctx["ts"], ctx.get("tz_min", 0))
    if rule.get("start_date") and date < rule["start_date"]:
        return False
    if rule.get("end_date") and date > rule["end_date"]:
        return False
    if rule.get("weekdays") and wd not in rule["weekdays"]:
        return False
    if rule.get("time_start") and rule.get("time_end"):
        s, e = _hm(rule["time_start"]), _hm(rule["time_end"])
        ok = (s <= mins < e) if s <= e else (mins >= s or mins < e)
        if not ok:
            return False
    if rule.get("outlet_ids") and ctx.get("outlet_id") not in rule["outlet_ids"]:
        return False
    aud = rule.get("audience", "all")
    cust = ctx.get("customer")
    if aud == "members" and not cust:
        return False
    if aud == "levels" and (not cust or cust.get("level") not in (rule.get("levels") or [])):
        return False
    if aud == "customers" and (not cust or cust.get("id") not in (rule.get("customer_ids") or [])):
        return False
    return True


def _pct(base, bps, cap):
    v = rdiv(base * bps, 10000)
    return min(v, cap) if cap else v


def product_rule_amount(rule, line) -> int:
    t = rule.get("target", "all")
    ids = rule.get("target_ids") or []
    if t == "category" and line.get("category_id") not in ids:
        return 0
    if t == "products" and line.get("product_id") not in ids:
        return 0
    if rule.get("min_item_price") and line["unit_price"] < rule["min_item_price"]:
        return 0
    mq = rule.get("min_qty") or 0
    if mq and line["qty"] < mq:
        return 0
    gross = line["unit_price"] * line["qty"]
    if rule.get("type") == "percent":
        return _pct(gross, rule["value"], rule.get("max_amount") or 0)
    times = (line["qty"] // max(mq, 1)) if rule.get("repeat") else 1
    return min(rule["value"] * times, gross)


def manual_amount(d, base) -> int:
    if not d or not d.get("value"):
        return 0
    if d.get("type") == "percent":
        return _pct(base, d["value"], 0)
    return min(d["value"], base)


def subtotal_rule_amount(rule, subtotal) -> int:
    th = rule.get("threshold") or 0
    if subtotal < th or subtotal <= 0:
        return 0
    if rule.get("type") == "percent":
        return _pct(subtotal, rule["value"], rule.get("max_amount") or 0)
    times = (subtotal // th) if (rule.get("repeat") and th) else 1
    return rule["value"] * times


def voucher_amount(v, subtotal) -> int:
    if not v or subtotal < (v.get("min_spend") or 0):
        return 0
    if v.get("type") == "percent":
        return _pct(subtotal, v["value"], v.get("max_amount") or 0)
    return v["value"]


def compute(cart: dict, rules: list, settings: dict, ctx: dict) -> dict:
    """discount -> tax -> fees -> rounding"""
    active = [r for r in rules if rule_active(r, ctx)]
    prod_rules = [r for r in active if r.get("kind") == "product_auto"]
    sub_rules = [r for r in active if r.get("kind") == "subtotal_auto"]
    applied = {}
    out_lines = []
    for ln in cart.get("lines", []):
        gross = ln["unit_price"] * ln["qty"]
        best, best_rule = 0, None
        for r in prod_rules:
            a = product_rule_amount(r, ln)
            if a > best:
                best, best_rule = a, r
        man = manual_amount(ln.get("manual_discount"), gross)
        if man > best:
            disc, src = man, "manual"
        else:
            disc, src = best, (best_rule["id"] if best_rule else None)
            if best_rule and best:
                applied[best_rule["id"]] = applied.get(best_rule["id"], 0) + best
        disc = min(disc, gross)
        out_lines.append({**ln, "gross": gross, "discount": disc, "discount_source": src, "net": gross - disc})
    subtotal = sum(l["net"] for l in out_lines)
    order_parts = []
    best_sub, best_sub_rule = 0, None
    for r in sub_rules:
        a = subtotal_rule_amount(r, subtotal)
        if a > best_sub:
            best_sub, best_sub_rule = a, r
    if best_sub_rule:
        order_parts.append({"source": best_sub_rule["id"], "name": best_sub_rule.get("name"), "amount": best_sub})
    va = voucher_amount(cart.get("voucher"), subtotal)
    if va:
        order_parts.append({"source": "voucher", "name": cart["voucher"].get("code"), "amount": va})
    ca = manual_amount(cart.get("order_discount"), subtotal)
    if ca:
        order_parts.append({"source": "cashier", "name": "Cashier discount", "amount": ca})
    pv = cart.get("points_value") or 0
    if pv:
        order_parts.append({"source": "points", "name": "Points", "amount": pv})
    order_disc = min(sum(p["amount"] for p in order_parts), subtotal)
    remaining = order_disc
    inclusive = bool(settings.get("tax_inclusive"))
    tax_total = 0
    for i, l in enumerate(out_lines):
        if i == len(out_lines) - 1:
            alloc = remaining
        else:
            alloc = (order_disc * l["net"] // subtotal) if subtotal else 0
        remaining -= alloc
        taxable = l["net"] - alloc
        bps = l.get("tax_bps") or 0
        if inclusive:
            tax = taxable - rdiv(taxable * 10000, 10000 + bps)
        else:
            tax = rdiv(taxable * bps, 10000)
        l["order_alloc"] = alloc
        l["taxable"] = taxable
        l["tax"] = tax
        l["line_total"] = taxable + (0 if inclusive else tax)
        tax_total += tax
    after = subtotal - order_disc
    base = after - (tax_total if inclusive else 0)
    service = rdiv(base * (settings.get("service_bps") or 0), 10000)
    raw = after + (0 if inclusive else tax_total) + service
    unit = settings.get("rounding_unit") or 0
    rounded = rdiv(raw, unit) * unit if unit > 1 else raw
    line_disc = sum(l["discount"] for l in out_lines)
    for r in prod_rules:
        if r["id"] in applied:
            order_parts.insert(0, {"source": r["id"], "name": r.get("name"), "amount": applied[r["id"]], "line": True})
    return {
        "lines": out_lines,
        "gross": sum(l["gross"] for l in out_lines),
        "line_discount": line_disc,
        "subtotal": subtotal,
        "order_discount": order_disc,
        "applied": order_parts,
        "tax": tax_total,
        "service": service,
        "rounding": rounded - raw,
        "total": rounded,
    }
