from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timedelta, timezone
from core import db, require, get_business, MANAGERS
from sales import points_balances

router = APIRouter()


def bounds(b, start, end):
    tz = timedelta(minutes=b.get("tz_offset_min", 0))
    today = (datetime.now(timezone.utc) + tz).date()
    s = datetime.fromisoformat(start).date() if start else today - timedelta(days=29)
    e = datetime.fromisoformat(end).date() if end else today
    to_utc = lambda d: (datetime(d.year, d.month, d.day, tzinfo=timezone.utc) - tz).isoformat()
    return to_utc(s), to_utc(e + timedelta(days=1)), s, e


def local_day(iso, b):
    return (datetime.fromisoformat(iso.replace("Z", "+00:00")) + timedelta(minutes=b.get("tz_offset_min", 0))).strftime("%Y-%m-%d")


async def load(bid, coll, s, e, outlet_id, field="created_at"):
    f = {"business_id": bid, field: {"$gte": s, "$lt": e}}
    if outlet_id:
        f["outlet_id"] = outlet_id
    return await db[coll].find(f, {"_id": 0}).to_list(100000)


@router.get("/dashboard")
async def dashboard(outlet_id: str = None, user=Depends(require(*MANAGERS))):
    bid = user["business_id"]
    b = await get_business(bid)
    s, e, sd, ed = bounds(b, None, None)
    sales = [x for x in await load(bid, "sales", s, e, outlet_id) if x["status"] == "completed"]
    today = ed.isoformat()
    td = [x for x in sales if local_day(x["created_at"], b) == today]
    trend = {}
    for i in range(14):
        trend[(ed - timedelta(days=13 - i)).isoformat()] = {"revenue": 0, "profit": 0, "count": 0}
    prods = {}
    for x in sales:
        d = local_day(x["created_at"], b)
        if d in trend:
            trend[d]["revenue"] += x["total"]
            trend[d]["profit"] += x["subtotal"] - x["order_discount"] - (x["tax"] if x.get("tax_inclusive") else 0) - x["cogs"]
            trend[d]["count"] += 1
        for l in x["lines"]:
            p = prods.setdefault(l["product_id"], {"name": l["name"], "qty": 0, "revenue": 0})
            p["qty"] += l["qty"]
            p["revenue"] += l["line_total"]
    low = 0
    levels = {l["product_id"]: l["qty"] for l in await db.stock_levels.find({"business_id": bid, **({"outlet_id": outlet_id} if outlet_id else {})}).to_list(100000)}
    async for p in db.products.find({"business_id": bid, "archived": {"$ne": True}, "track_stock": {"$ne": False}}):
        if levels.get(p["id"], 0) <= (p.get("low_stock") or 0):
            low += 1
    open_orders = await db.open_orders.count_documents({"business_id": bid, "status": "open"})
    mism = len([x for x in sales if x.get("totals_mismatch")])
    return {"today": {"revenue": sum(x["total"] for x in td), "count": len(td),
                      "avg": (sum(x["total"] for x in td) // len(td)) if td else 0,
                      "profit": sum(x["subtotal"] - x["order_discount"] - (x["tax"] if x.get("tax_inclusive") else 0) - x["cogs"] for x in td)},
            "trend": [{"date": k, **v} for k, v in trend.items()],
            "top_products": sorted(prods.values(), key=lambda p: -p["revenue"])[:6],
            "low_stock": low, "open_orders": open_orders, "offline_sales_30d": len([x for x in sales if x.get("offline")]),
            "totals_mismatch_30d": mism}


def net_rev(x):
    return x["subtotal"] - x["order_discount"] - (x["tax"] if x.get("tax_inclusive") else 0)


@router.get("/reports/{name}")
async def report(name: str, start: str = None, end: str = None, outlet_id: str = None, user=Depends(require(*MANAGERS))):
    bid = user["business_id"]
    b = await get_business(bid)
    s, e, sd, ed = bounds(b, start, end)
    sales = await load(bid, "sales", s, e, outlet_id)
    ok = [x for x in sales if x["status"] == "completed"]
    rets = await load(bid, "returns", s, e, outlet_id)
    meta = {"start": sd.isoformat(), "end": ed.isoformat(), "currency": b["currency"]}
    if name == "summary":
        gross = sum(x["gross"] for x in ok)
        disc = sum(x["line_discount"] + x["order_discount"] for x in ok)
        rows = [["Transactions", len(ok)], ["Gross sales", gross], ["Discounts", -disc], ["Tax", sum(x["tax"] for x in ok)],
                ["Service charges", sum(x["service"] for x in ok)], ["Rounding", sum(x["rounding"] for x in ok)],
                ["Total collected + due", sum(x["total"] for x in ok)], ["Returns", -sum(r["amount"] for r in rets)],
                ["Voided sales", len([x for x in sales if x["status"] == "voided"])]]
        return {**meta, "columns": [{"key": "metric", "label": "Metric"}, {"key": "value", "label": "Value", "money": True}],
                "rows": [{"metric": r[0], "value": r[1], "_count": r[0] in ("Transactions", "Voided sales")} for r in rows]}
    if name == "transactions":
        return {**meta, "columns": [{"key": "receipt_no", "label": "Receipt"}, {"key": "created_at", "label": "Time", "date": True},
                                    {"key": "cashier_name", "label": "Cashier"}, {"key": "customer_name", "label": "Customer"},
                                    {"key": "status", "label": "Status"}, {"key": "total", "label": "Total", "money": True}],
                "rows": sorted(sales, key=lambda x: x["created_at"], reverse=True)}
    if name in ("products", "profit"):
        agg = {}
        for x in ok:
            for l in x["lines"]:
                a = agg.setdefault(l["product_id"], {"name": l["name"], "qty": 0, "revenue": 0, "cogs": 0})
                a["qty"] += l["qty"]
                a["revenue"] += l["taxable"] - (l["tax"] if x.get("tax_inclusive") else 0)
                a["cogs"] += l["cogs"]
        for r in rets:
            for l in r["lines"]:
                a = agg.setdefault(l["product_id"], {"name": l["name"], "qty": 0, "revenue": 0, "cogs": 0})
                a["qty"] -= l["qty"]
                a["cogs"] -= l["unit_cost"] * l["qty"]
        rows = sorted(agg.values(), key=lambda a: -a["revenue"])
        for a in rows:
            a["profit"] = a["revenue"] - a["cogs"]
            a["margin"] = f"{(a['profit'] * 100 / a['revenue']):.1f}%" if a["revenue"] else "-"
        return {**meta, "columns": [{"key": "name", "label": "Product"}, {"key": "qty", "label": "Qty"}, {"key": "revenue", "label": "Net revenue", "money": True},
                                    {"key": "cogs", "label": "Cost of goods", "money": True}, {"key": "profit", "label": "Profit", "money": True}, {"key": "margin", "label": "Margin"}],
                "rows": rows}
    if name == "payments":
        agg = {}
        for x in ok:
            for p in x["payments"]:
                a = agg.setdefault(p["method"], {"method": p["method"], "count": 0, "amount": 0})
                a["count"] += 1
                a["amount"] += p["amount"]
        due = sum(x["amount_due"] for x in ok)
        rows = list(agg.values()) + ([{"method": "on account (due)", "count": len([x for x in ok if x["amount_due"]]), "amount": due}] if due else [])
        return {**meta, "columns": [{"key": "method", "label": "Method"}, {"key": "count", "label": "Payments"}, {"key": "amount", "label": "Amount", "money": True}], "rows": rows}
    if name == "trend":
        days = {}
        d = sd
        while d <= ed:
            days[d.isoformat()] = {"date": d.isoformat(), "count": 0, "revenue": 0, "profit": 0}
            d += timedelta(days=1)
        for x in ok:
            k = local_day(x["created_at"], b)
            if k in days:
                days[k]["count"] += 1
                days[k]["revenue"] += x["total"]
                days[k]["profit"] += net_rev(x) - x["cogs"]
        return {**meta, "chart": True, "columns": [{"key": "date", "label": "Date"}, {"key": "count", "label": "Sales"}, {"key": "revenue", "label": "Revenue", "money": True},
                                                   {"key": "profit", "label": "Gross profit", "money": True}], "rows": list(days.values())}
    if name == "cashiers":
        agg = {}
        for x in ok:
            a = agg.setdefault(x["cashier_id"], {"name": x["cashier_name"], "count": 0, "revenue": 0, "discounts": 0})
            a["count"] += 1
            a["revenue"] += x["total"]
            a["discounts"] += x["line_discount"] + x["order_discount"]
        for a in agg.values():
            a["avg"] = a["revenue"] // a["count"] if a["count"] else 0
        return {**meta, "columns": [{"key": "name", "label": "Cashier"}, {"key": "count", "label": "Sales"}, {"key": "revenue", "label": "Revenue", "money": True},
                                    {"key": "avg", "label": "Avg ticket", "money": True}, {"key": "discounts", "label": "Discounts given", "money": True}], "rows": list(agg.values())}
    if name == "returns":
        return {**meta, "columns": [{"key": "receipt_no", "label": "Receipt"}, {"key": "created_at", "label": "Time", "date": True}, {"key": "by_name", "label": "By"},
                                    {"key": "refund_method", "label": "Refund"}, {"key": "reason", "label": "Reason"}, {"key": "amount", "label": "Amount", "money": True}], "rows": rets}
    if name == "cash":
        rows = await load(bid, "cash_entries", s, e, outlet_id)
        return {**meta, "columns": [{"key": "created_at", "label": "Time", "date": True}, {"key": "type", "label": "Type"}, {"key": "category", "label": "Category"},
                                    {"key": "note", "label": "Note"}, {"key": "user_name", "label": "By"}, {"key": "amount", "label": "Amount", "money": True}], "rows": rows}
    if name == "profit_loss":
        rev = sum(net_rev(x) for x in ok)
        ret_amt = sum(r["amount"] for r in rets)
        cogs = sum(x["cogs"] for x in ok) - sum(r["cogs"] for r in rets)
        cash = await load(bid, "cash_entries", s, e, outlet_id)
        exp = sum(c["amount"] for c in cash if c["type"] == "out")
        oth = sum(c["amount"] for c in cash if c["type"] == "in")
        gp = rev - ret_amt - cogs
        rows = [["Net sales (excl. tax)", rev], ["Returns", -ret_amt], ["Cost of goods sold", -cogs], ["Gross profit", gp],
                ["Other income (cash in)", oth], ["Expenses (cash out)", -exp], ["Net profit", gp + oth - exp]]
        return {**meta, "columns": [{"key": "metric", "label": "Line"}, {"key": "value", "label": "Amount", "money": True}],
                "rows": [{"metric": r[0], "value": r[1]} for r in rows]}
    if name == "stock_movement":
        rows = await load(bid, "stock_ledger", s, e, outlet_id)
        names = {p["id"]: p["name"] for p in await db.products.find({"business_id": bid}, {"id": 1, "name": 1}).to_list(10000)}
        for r in rows:
            r["product_name"] = names.get(r["product_id"], "?")
            r["value"] = r["qty"] * r["unit_cost"]
        rows.sort(key=lambda r: r["created_at"], reverse=True)
        return {**meta, "columns": [{"key": "created_at", "label": "Time", "date": True}, {"key": "product_name", "label": "Product"}, {"key": "ref_type", "label": "Movement"},
                                    {"key": "qty", "label": "Qty"}, {"key": "balance", "label": "Balance"}, {"key": "unit_cost", "label": "Unit cost", "money": True},
                                    {"key": "value", "label": "Value", "money": True}], "rows": rows}
    if name == "shifts":
        rows = await load(bid, "shifts", s, e, outlet_id, field="opened_at")
        return {**meta, "columns": [{"key": "cashier_name", "label": "Cashier"}, {"key": "opened_at", "label": "Opened", "date": True}, {"key": "closed_at", "label": "Closed", "date": True},
                                    {"key": "opening_cash", "label": "Opening", "money": True}, {"key": "expected_cash", "label": "Expected", "money": True},
                                    {"key": "counted_cash", "label": "Counted", "money": True}, {"key": "difference", "label": "Difference", "money": True}], "rows": rows}
    if name == "restaurant":
        agg = {}
        for x in ok:
            if x.get("channel") != "table":
                continue
            k = x.get("table_id") or "-"
            a = agg.setdefault(k, {"table": x.get("table_name") or k, "count": 0, "revenue": 0})
            a["count"] += 1
            a["revenue"] += x["total"]
        tbls = {t["id"]: t["name"] for t in await db.tables.find({"business_id": bid}).to_list(1000)}
        for k, a in agg.items():
            a["table"] = tbls.get(k, a["table"])
        return {**meta, "columns": [{"key": "table", "label": "Table"}, {"key": "count", "label": "Orders"}, {"key": "revenue", "label": "Revenue", "money": True}], "rows": list(agg.values())}
    if name == "branches":
        outlets = {o["id"]: o["name"] for o in await db.outlets.find({"business_id": bid}).to_list(100)}
        agg = {}
        for x in ok:
            a = agg.setdefault(x["outlet_id"], {"branch": outlets.get(x["outlet_id"], "?"), "count": 0, "revenue": 0, "profit": 0})
            a["count"] += 1
            a["revenue"] += x["total"]
            a["profit"] += net_rev(x) - x["cogs"]
        return {**meta, "columns": [{"key": "branch", "label": "Branch"}, {"key": "count", "label": "Sales"}, {"key": "revenue", "label": "Revenue", "money": True},
                                    {"key": "profit", "label": "Gross profit", "money": True}], "rows": list(agg.values())}
    if name == "loyalty":
        pb = await points_balances(bid)
        cs = await db.customers.find({"business_id": bid, "archived": {"$ne": True}}, {"_id": 0}).to_list(5000)
        return {**meta, "columns": [{"key": "name", "label": "Customer"}, {"key": "level", "label": "Level"}, {"key": "points", "label": "Points balance"}],
                "rows": sorted([{"name": c["name"], "level": c.get("level") or "-", "points": pb.get(c["id"], 0)} for c in cs], key=lambda r: -r["points"])}
    raise HTTPException(404, "Unknown report")
