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
    return await extra_report(name, bid, b, s, e, sd, ed, outlet_id, meta, ok, rets)


def C(key, label, money=False, date=False):
    return {"key": key, "label": label, "money": money, "date": date}


def agg(rows, key, fields):
    out = {}
    for r in rows:
        a = out.setdefault(r[key], {key: r[key], **{f: 0 for f in fields}})
        for f in fields:
            a[f] += r.get(f, 1 if f == "count" else 0)
    return sorted(out.values(), key=lambda x: -x[fields[-1]])


async def extra_report(name, bid, b, s, e, sd, ed, outlet_id, meta, ok, rets):
    prods = {p["id"]: p for p in await db.products.find({"business_id": bid}, {"_id": 0}).to_list(10000)}
    cats = {c["id"]: c["name"] for c in await db.categories.find({"business_id": bid}).to_list(1000)}
    brands = {c["id"]: c["name"] for c in await db.brands.find({"business_id": bid}).to_list(1000)}
    lines = [{"product": l["name"], "qty": l["qty"], "revenue": l["line_total"], "month": local_day(x["created_at"], b)[:7], "day": local_day(x["created_at"], b),
              "category": cats.get(prods.get(l["product_id"], {}).get("category_id"), "—"), "brand": brands.get(prods.get(l["product_id"], {}).get("brand_id"), "—")}
             for x in ok for l in x["lines"]]
    rlines = [{"product": l["name"], "qty": l["qty"], "amount": l["amount"]} for r in rets for l in r["lines"]]
    pos = await load(bid, "purchase_orders", s, e, outlet_id)
    pos_ok = [p for p in pos if p["status"] != "cancelled"]
    prets = await load(bid, "purchase_returns", s, e, outlet_id)
    mm = await db.money_moves.find({"business_id": bid, "created_at": {"$gte": s, "$lt": e}}, {"_id": 0}).to_list(10000)
    if name == "returns_by_product":
        return {**meta, "columns": [C("product", "Product"), C("qty", "Qty returned"), C("amount", "Refunded", True)], "rows": agg(rlines, "product", ["qty", "amount"])}
    if name in ("monthly_trend", "daily_trend"):
        k = "month" if name == "monthly_trend" else "day"
        rows = {}
        for l in lines:
            r = rows.setdefault((l["product"], l[k]), {"product": l["product"], "period": l[k], "qty": 0, "revenue": 0})
            r["qty"] += l["qty"]
            r["revenue"] += l["revenue"]
        return {**meta, "columns": [C("period", "Period"), C("product", "Product"), C("qty", "Qty"), C("revenue", "Revenue", True)],
                "rows": sorted(rows.values(), key=lambda r: (r["period"], -r["revenue"]), reverse=True)}
    if name == "sales_by_category":
        return {**meta, "columns": [C("category", "Category"), C("qty", "Qty"), C("revenue", "Revenue", True)], "rows": agg(lines, "category", ["qty", "revenue"])}
    if name == "sales_by_brand":
        return {**meta, "columns": [C("brand", "Brand"), C("qty", "Qty"), C("revenue", "Revenue", True)], "rows": agg(lines, "brand", ["qty", "revenue"])}
    if name == "best_sellers":
        return {**meta, "columns": [C("product", "Product"), C("revenue", "Revenue", True), C("qty", "Qty sold")], "rows": agg(lines, "product", ["revenue", "qty"])}
    if name == "purchases_by_product":
        pl = [{"product": l["name"], "qty": l["received"], "value": l["received"] * l["cost"]} for p in pos_ok for l in p["lines"]]
        return {**meta, "columns": [C("product", "Product"), C("qty", "Qty received"), C("value", "Value", True)], "rows": agg(pl, "product", ["qty", "value"])}
    if name == "purchases_by_transaction":
        return {**meta, "columns": [C("number", "PO"), C("created_at", "Date", date=True), C("supplier_name", "Supplier"), C("status", "Status"),
                                    C("total", "Ordered", True), C("received_value", "Received", True), C("paid", "Paid", True)], "rows": pos}
    if name == "purchase_returns_by_product":
        pl = [{"product": l["name"], "qty": l["qty"], "amount": l["amount"]} for r in prets for l in r["lines"]]
        return {**meta, "columns": [C("product", "Product"), C("qty", "Qty"), C("amount", "Value", True)], "rows": agg(pl, "product", ["qty", "amount"])}
    if name == "purchase_returns_by_transaction":
        return {**meta, "columns": [C("number", "Return"), C("po_number", "Original PO"), C("created_at", "Date", date=True), C("supplier_name", "Supplier"),
                                    C("amount", "Value", True), C("collected", "Collected", True)], "rows": prets}
    if name in ("cash_in", "cash_out"):
        cash = [c for c in await load(bid, "cash_entries", s, e, outlet_id) if c["type"] == ("in" if name == "cash_in" else "out")]
        return {**meta, "columns": [C("category", "Category"), C("count", "Entries"), C("amount", "Amount", True)], "rows": agg(cash, "category", ["count", "amount"])}
    if name in ("purchase_payments", "sale_payments", "purchase_return_refunds"):
        rows = [m | {"amount": abs(m["amount"])} for m in mm if m["kind"] == {"purchase_payments": "purchase_payment", "sale_payments": "sale_payment", "purchase_return_refunds": "purchase_return_refund"}[name]]
        if name == "sale_payments":
            rows += [{"ref": x["receipt_no"], "party": x.get("customer_name"), "method": p["method"], "amount": p["amount"], "created_at": x["created_at"]} for x in ok for p in x["payments"]]
        return {**meta, "columns": [C("created_at", "Date", date=True), C("ref", "Document"), C("party", "Party"), C("method", "Method"), C("amount", "Amount", True)],
                "rows": sorted(rows, key=lambda r: r["created_at"], reverse=True)}
    if name == "sale_return_refunds":
        return {**meta, "columns": [C("created_at", "Date", date=True), C("receipt_no", "Receipt"), C("refund_method", "Method"), C("amount", "Amount", True)], "rows": rets}
    if name in ("stock_alerts", "product_stock"):
        lv = await db.stock_levels.find({"business_id": bid, **({"outlet_id": outlet_id} if outlet_id else {})}, {"_id": 0}).to_list(100000)
        tot = {}
        for l in lv:
            t = tot.setdefault(l["product_id"], {"qty": 0, "value": 0})
            t["qty"] += l["qty"]
            t["value"] += max(l["qty"], 0) * l["avg_cost"]
        rows = [{"product": p["name"], "min": p.get("low_stock") or 0, **tot.get(pid, {"qty": 0, "value": 0})} for pid, p in prods.items()
                if not p.get("archived") and p.get("track_stock", True)]
        if name == "stock_alerts":
            rows = [r for r in rows if r["qty"] <= r["min"]]
        return {**meta, "columns": [C("product", "Product"), C("qty", "On hand"), C("min", "Minimum"), C("value", "Value at cost", True)], "rows": rows}
    if name == "stocktakes":
        rows = await load(bid, "stocktakes", s, e, outlet_id)
        return {**meta, "columns": [C("number", "Count"), C("created_at", "Date", date=True), C("created_by", "By"), C("diff_value", "Difference value", True)], "rows": rows}
    if name == "transfers":
        rows = await db.transfers.find({"business_id": bid, "created_at": {"$gte": s, "$lt": e}}, {"_id": 0}).to_list(5000)
        outs = {o["id"]: o["name"] for o in await db.outlets.find({"business_id": bid}).to_list(100)}
        for r in rows:
            r.update({"from": outs.get(r["from_outlet_id"]), "to": outs.get(r["to_outlet_id"]), "items": sum(l["qty"] for l in r["lines"]),
                      "value": sum(l["qty"] * l["unit_cost"] for l in r["lines"])})
        return {**meta, "columns": [C("number", "Transfer"), C("created_at", "Sent", date=True), C("from", "From"), C("to", "To"), C("status", "Status"),
                                    C("items", "Units"), C("value", "Value", True)], "rows": rows}
    if name == "waiters":
        rows = [{"waiter": x.get("waiter") or "—", "count": 1, "revenue": x["total"]} for x in ok if x.get("channel") == "table"]
        return {**meta, "columns": [C("waiter", "Waiter"), C("count", "Bills"), C("revenue", "Revenue", True)], "rows": agg(rows, "waiter", ["count", "revenue"])}
    if name == "busy_hours":
        hrs = {h: {"hour": f"{h:02d}:00", "count": 0, "revenue": 0} for h in range(24)}
        for x in ok:
            h = (datetime.fromisoformat(x["created_at"].replace("Z", "+00:00")) + timedelta(minutes=b.get("tz_offset_min", 0))).hour
            hrs[h]["count"] += 1
            hrs[h]["revenue"] += x["total"]
        return {**meta, "columns": [C("hour", "Hour"), C("count", "Sales"), C("revenue", "Revenue", True)], "rows": [r for r in hrs.values() if r["count"]]}
    if name == "kitchen_time":
        tk = await db.kitchen_tickets.find({"business_id": bid, "created_at": {"$gte": s, "$lt": e}, "ready_at": {"$exists": True}}, {"_id": 0}).to_list(10000)
        items = {}
        for t in tk:
            mins = (datetime.fromisoformat(t["ready_at"]) - datetime.fromisoformat(t["created_at"])).total_seconds() / 60
            for it in t["items"]:
                a = items.setdefault(it["name"], {"item": it["name"], "tickets": 0, "total": 0.0})
                a["tickets"] += 1
                a["total"] += mins
        rows = [{"item": a["item"], "tickets": a["tickets"], "avg": f"{a['total'] / a['tickets']:.1f} min"} for a in items.values()]
        return {**meta, "columns": [C("item", "Item"), C("tickets", "Tickets"), C("avg", "Avg kitchen time")], "rows": rows}
    if name == "outlet_pl":
        outs = await db.outlets.find({"business_id": bid}, {"_id": 0}).to_list(100)
        cash = await load(bid, "cash_entries", s, e, None)
        rows = []
        for o in outs:
            xs = [x for x in ok if x["outlet_id"] == o["id"]]
            rv = sum(net_rev(x) for x in xs)
            cg = sum(x["cogs"] for x in xs) - sum(r["cogs"] for r in rets if r["outlet_id"] == o["id"])
            ra = sum(r["amount"] for r in rets if r["outlet_id"] == o["id"])
            ex = sum(c["amount"] for c in cash if c.get("outlet_id") == o["id"] and c["type"] == "out")
            rows.append({"outlet": o["name"], "revenue": rv, "returns": ra, "cogs": cg, "gross": rv - ra - cg, "expenses": ex, "net": rv - ra - cg - ex})
        return {**meta, "columns": [C("outlet", "Outlet"), C("revenue", "Net sales", True), C("returns", "Returns", True), C("cogs", "COGS", True),
                                    C("gross", "Gross profit", True), C("expenses", "Expenses", True), C("net", "Net profit", True)], "rows": rows}
    raise HTTPException(404, "Unknown report")
