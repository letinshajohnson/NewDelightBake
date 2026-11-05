"""POSHub pricing engine. Mirrors frontend/src/lib/pricing.js exactly. All money = integer minor units, percents = basis points."""
from datetime import datetime, timedelta


def rdiv(num: int, den: int) -> int:
    return (2 * num + den) // (2 * den)


def local_parts(ts: str, tz_min: int) -> tuple:
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00")) + timedelta(minutes=tz_min)
    return dt.strftime("%Y-%m-%d"), dt.isoweekday() % 7, dt.hour * 60 + dt.minute


def _hm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def _in_window(rule: dict, date: str, wd: int, mins: int) -> bool:
    if rule.get("start_date") and date < rule["start_date"]:
        return False
    if rule.get("end_date") and date > rule["end_date"]:
        return False
    if rule.get("weekdays") and wd not in rule["weekdays"]:
        return False
    if not (rule.get("time_start") and rule.get("time_end")):
        return True
    s, e = _hm(rule["time_start"]), _hm(rule["time_end"])
    return (s <= mins < e) if s <= e else (mins >= s or mins < e)


AUDIENCE = {
    "members": lambda rule, cust: bool(cust),
    "levels": lambda rule, cust: bool(cust) and cust.get("level") in (rule.get("levels") or []),
    "customers": lambda rule, cust: bool(cust) and cust.get("id") in (rule.get("customer_ids") or []),
}


def rule_active(rule: dict, ctx: dict) -> bool:
    if not rule.get("active", True) or not _in_window(rule, *local_parts(ctx["ts"], ctx.get("tz_min", 0))):
        return False
    if rule.get("outlet_ids") and ctx.get("outlet_id") not in rule["outlet_ids"]:
        return False
    check = AUDIENCE.get(rule.get("audience", "all"))
    return check(rule, ctx.get("customer")) if check else True


def _pct(base: int, bps: int, cap: int) -> int:
    v = rdiv(base * bps, 10000)
    return min(v, cap) if cap else v


def product_rule_amount(rule: dict, line: dict) -> int:
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


def manual_amount(d: dict, base: int) -> int:
    if not d or not d.get("value"):
        return 0
    if d.get("type") == "percent":
        return _pct(base, d["value"], 0)
    return min(d["value"], base)


def subtotal_rule_amount(rule: dict, subtotal: int) -> int:
    th = rule.get("threshold") or 0
    if subtotal < th or subtotal <= 0:
        return 0
    if rule.get("type") == "percent":
        return _pct(subtotal, rule["value"], rule.get("max_amount") or 0)
    times = (subtotal // th) if (rule.get("repeat") and th) else 1
    return rule["value"] * times


def voucher_amount(v: dict, subtotal: int) -> int:
    if not v or subtotal < (v.get("min_spend") or 0):
        return 0
    if v.get("type") == "percent":
        return _pct(subtotal, v["value"], v.get("max_amount") or 0)
    return v["value"]


def _discount_line(ln: dict, prod_rules: list, applied: dict) -> dict:
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
    return {**ln, "gross": gross, "discount": disc, "discount_source": src, "net": gross - disc}


def _order_parts(cart: dict, sub_rules: list, subtotal: int) -> list:
    parts = []
    best_sub, best_sub_rule = 0, None
    for r in sub_rules:
        a = subtotal_rule_amount(r, subtotal)
        if a > best_sub:
            best_sub, best_sub_rule = a, r
    if best_sub_rule:
        parts.append({"source": best_sub_rule["id"], "name": best_sub_rule.get("name"), "amount": best_sub})
    va = voucher_amount(cart.get("voucher"), subtotal)
    if va:
        parts.append({"source": "voucher", "name": cart["voucher"].get("code"), "amount": va})
    ca = manual_amount(cart.get("order_discount"), subtotal)
    if ca:
        parts.append({"source": "cashier", "name": "Cashier discount", "amount": ca})
    pv = cart.get("points_value") or 0
    if pv:
        parts.append({"source": "points", "name": "Points", "amount": pv})
    return parts


def _allocate_and_tax(lines: list, order_disc: int, subtotal: int, inclusive: bool) -> int:
    remaining, tax_total = order_disc, 0
    for i, l in enumerate(lines):
        alloc = remaining if i == len(lines) - 1 else ((order_disc * l["net"] // subtotal) if subtotal else 0)
        remaining -= alloc
        taxable = l["net"] - alloc
        bps = l.get("tax_bps") or 0
        tax = taxable - rdiv(taxable * 10000, 10000 + bps) if inclusive else rdiv(taxable * bps, 10000)
        l.update({"order_alloc": alloc, "taxable": taxable, "tax": tax, "line_total": taxable + (0 if inclusive else tax)})
        tax_total += tax
    return tax_total


def compute(cart: dict, rules: list, settings: dict, ctx: dict) -> dict:
    """discount -> tax -> fees -> rounding"""
    active = [r for r in rules if rule_active(r, ctx)]
    prod_rules = [r for r in active if r.get("kind") == "product_auto"]
    sub_rules = [r for r in active if r.get("kind") == "subtotal_auto"]
    applied = {}
    out_lines = [_discount_line(ln, prod_rules, applied) for ln in cart.get("lines", [])]
    subtotal = sum(l["net"] for l in out_lines)
    order_parts = _order_parts(cart, sub_rules, subtotal)
    order_disc = min(sum(p["amount"] for p in order_parts), subtotal)
    inclusive = bool(settings.get("tax_inclusive"))
    tax_total = _allocate_and_tax(out_lines, order_disc, subtotal, inclusive)
    after = subtotal - order_disc
    service = rdiv((after - (tax_total if inclusive else 0)) * (settings.get("service_bps") or 0), 10000)
    raw = after + (0 if inclusive else tax_total) + service
    unit = settings.get("rounding_unit") or 0
    rounded = rdiv(raw, unit) * unit if unit > 1 else raw
    for r in prod_rules:
        if r["id"] in applied:
            order_parts.insert(0, {"source": r["id"], "name": r.get("name"), "amount": applied[r["id"]], "line": True})
    return {
        "lines": out_lines,
        "gross": sum(l["gross"] for l in out_lines),
        "line_discount": sum(l["discount"] for l in out_lines),
        "subtotal": subtotal,
        "order_discount": order_disc,
        "applied": order_parts,
        "tax": tax_total,
        "service": service,
        "rounding": rounded - raw,
        "total": rounded,
    }
