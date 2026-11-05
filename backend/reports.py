from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional
from fastapi import APIRouter, Depends, HTTPException
from core import db, require, get_business, MANAGERS
from sales import points_balances

router = APIRouter()


def bounds(b: dict, start: Optional[str], end: Optional[str]) -> tuple:
    tz = timedelta(minutes=b.get("tz_offset_min", 0))
    today = (datetime.now(timezone.utc) + tz).date()
    s = datetime.fromisoformat(start).date() if start else today - timedelta(days=29)
    e = datetime.fromisoformat(end).date() if end else today

    def to_utc(d: date) -> str:
        return (datetime(d.year, d.month, d.day, tzinfo=timezone.utc) - tz).isoformat()
    return to_utc(s), to_utc(e + timedelta(days=1)), s, e


def local_day(iso: str, b: dict) -> str:
    return (datetime.fromisoformat(iso.replace("Z", "+00:00")) + timedelta(minutes=b.get("tz_offset_min", 0))).strftime("%Y-%m-%d")


async def load(bid: str, coll: str, s: str, e: str, outlet_id: Optional[str], field: str = "created_at") -> list:
    f = {"business_id": bid, field: {"$gte": s, "$lt": e}}
    if outlet_id:
        f["outlet_id"] = outlet_id
    return await db[coll].find(f, {"_id": 0}).to_list(100000)


def sale_profit(x: dict) -> int:
    return net_rev(x) - x["cogs"]


def net_rev(x: dict) -> int:
    return x["subtotal"] - x["order_discount"] - (x["tax"] if x.get("tax_inclusive") else 0)


async def _low_stock_count(bid: str, outlet_id: Optional[str]) -> int:
    levels = {l["product_id"]: l["qty"] for l in await db.stock_levels.find({"business_id": bid, **({"outlet_id": outlet_id} if outlet_id else {})}).to_list(100000)}
    low = 0
    async for p in db.products.find({"business_id": bid, "archived": {"$ne": True}, "track_stock": {"$ne": False}}):
        if levels.get(p["id"], 0) <= (p.get("low_stock") or 0):
            low += 1
    return low


def _dashboard_trend(sales: list, b: dict, ed: date) -> tuple:
    trend = {(ed - timedelta(days=13 - i)).isoformat(): {"revenue": 0, "profit": 0, "count": 0} for i in range(14)}
    prods = {}
    for x in sales:
        d = local_day(x["created_at"], b)
        if d in trend:
            trend[d]["revenue"] += x["total"]
            trend[d]["profit"] += sale_profit(x)
            trend[d]["count"] += 1
        for l in x["lines"]:
            p = prods.setdefault(l["product_id"], {"name": l["name"], "qty": 0, "revenue": 0})
            p["qty"] += l["qty"]
            p["revenue"] += l["line_total"]
    return trend, prods


@router.get("/dashboard")
async def dashboard(outlet_id: str = None, user=Depends(require(*MANAGERS))) -> dict:
    bid = user["business_id"]
    b = await get_business(bid)
    s, e, _, ed = bounds(b, None, None)
    sales = [x for x in await load(bid, "sales", s, e, outlet_id) if x["status"] == "completed"]
    td = [x for x in sales if local_day(x["created_at"], b) == ed.isoformat()]
    trend, prods = _dashboard_trend(sales, b, ed)
    today_rev = sum(x["total"] for x in td)
    return {"today": {"revenue": today_rev, "count": len(td), "avg": today_rev // len(td) if td else 0, "profit": sum(sale_profit(x) for x in td)},
            "trend": [{"date": k, **v} for k, v in trend.items()],
            "top_products": sorted(prods.values(), key=lambda p: -p["revenue"])[:6],
            "low_stock": await _low_stock_count(bid, outlet_id),
            "open_orders": await db.open_orders.count_documents({"business_id": bid, "status": "open"}),
            "offline_sales_30d": len([x for x in sales if x.get("offline")]),
            "totals_mismatch_30d": len([x for x in sales if x.get("totals_mismatch")])}


# ---------------- Report context & registry ----------------
@dataclass
class Ctx:
    bid: str
    b: dict
    s: str
    e: str
    sd: date
    ed: date
    outlet_id: Optional[str]
    sales: list
    rets: list
    _cache: dict = field(default_factory=dict)

    @property
    def ok(self) -> list:
        return [x for x in self.sales if x["status"] == "completed"]

    def out(self, columns: list, rows: list, **extra) -> dict:
        return {"start": self.sd.isoformat(), "end": self.ed.isoformat(), "currency": self.b["currency"], **extra, "columns": columns, "rows": rows}

    async def load(self, coll: str, field: str = "created_at", outlet: bool = True) -> list:
        return await load(self.bid, coll, self.s, self.e, self.outlet_id if outlet else None, field)

    async def names(self, coll: str) -> dict:
        if coll not in self._cache:
            self._cache[coll] = {d["id"]: d for d in await db[coll].find({"business_id": self.bid}, {"_id": 0}).to_list(10000)}
        return self._cache[coll]

    async def sale_lines(self) -> list:
        prods, cats, brands = await self.names("products"), await self.names("categories"), await self.names("brands")

        def nm(m: dict, k: Optional[str]) -> str:
            return (m.get(k) or {}).get("name", "—")
        return [{"product": l["name"], "qty": l["qty"], "revenue": l["line_total"], "month": local_day(x["created_at"], self.b)[:7], "day": local_day(x["created_at"], self.b),
                 "category": nm(cats, prods.get(l["product_id"], {}).get("category_id")), "brand": nm(brands, prods.get(l["product_id"], {}).get("brand_id"))}
                for x in self.ok for l in x["lines"]]


Report = Callable[[Ctx], Awaitable[dict]]
REPORTS: dict = {}


def report_fn(*names: str) -> Callable[[Report], Report]:
    def deco(fn: Report) -> Report:
        for n in names:
            REPORTS[n] = fn
        return fn
    return deco


def C(key: str, label: str, money: bool = False, date: bool = False) -> dict:
    return {"key": key, "label": label, "money": money, "date": date}


def agg(rows: list, key: str, fields: list) -> list:
    out = {}
    for r in rows:
        a = out.setdefault(r[key], {key: r[key], **{f: 0 for f in fields}})
        for f in fields:
            a[f] += r.get(f, 1 if f == "count" else 0)
    return sorted(out.values(), key=lambda x: -x[fields[-1]])


@router.get("/reports/{name}")
async def report(name: str, start: str = None, end: str = None, outlet_id: str = None, user=Depends(require(*MANAGERS))) -> dict:
    fn = REPORTS.get(name)
    if not fn:
        raise HTTPException(404, "Unknown report")
    bid = user["business_id"]
    b = await get_business(bid)
    s, e, sd, ed = bounds(b, start, end)
    c = Ctx(bid, b, s, e, sd, ed, outlet_id, await load(bid, "sales", s, e, outlet_id), await load(bid, "returns", s, e, outlet_id))
    return await fn(c)


# ---------------- Sales reports ----------------
@report_fn("summary")
async def r_summary(c: Ctx) -> dict:
    ok = c.ok
    rows = [["Transactions", len(ok)], ["Gross sales", sum(x["gross"] for x in ok)], ["Discounts", -sum(x["line_discount"] + x["order_discount"] for x in ok)],
            ["Tax", sum(x["tax"] for x in ok)], ["Service charges", sum(x["service"] for x in ok)], ["Rounding", sum(x["rounding"] for x in ok)],
            ["Total collected + due", sum(x["total"] for x in ok)], ["Returns", -sum(r["amount"] for r in c.rets)],
            ["Voided sales", len([x for x in c.sales if x["status"] == "voided"])]]
    return c.out([{"key": "metric", "label": "Metric"}, {"key": "value", "label": "Value", "money": True}],
                 [{"metric": m, "value": v, "_count": m in ("Transactions", "Voided sales")} for m, v in rows])


@report_fn("transactions")
async def r_transactions(c: Ctx) -> dict:
    return c.out([{"key": "receipt_no", "label": "Receipt"}, {"key": "created_at", "label": "Time", "date": True}, {"key": "cashier_name", "label": "Cashier"},
                  {"key": "customer_name", "label": "Customer"}, {"key": "status", "label": "Status"}, {"key": "total", "label": "Total", "money": True}],
                 sorted(c.sales, key=lambda x: x["created_at"], reverse=True))


def _product_profit(ok: list, rets: list) -> list:
    acc = {}

    def row(l: dict) -> dict:
        return acc.setdefault(l["product_id"], {"name": l["name"], "qty": 0, "revenue": 0, "cogs": 0})
    for x in ok:
        for l in x["lines"]:
            a = row(l)
            a["qty"] += l["qty"]
            a["revenue"] += l["taxable"] - (l["tax"] if x.get("tax_inclusive") else 0)
            a["cogs"] += l["cogs"]
    for r in rets:
        for l in r["lines"]:
            a = row(l)
            a["qty"] -= l["qty"]
            a["cogs"] -= l["unit_cost"] * l["qty"]
    rows = sorted(acc.values(), key=lambda a: -a["revenue"])
    for a in rows:
        a["profit"] = a["revenue"] - a["cogs"]
        a["margin"] = f"{(a['profit'] * 100 / a['revenue']):.1f}%" if a["revenue"] else "-"
    return rows


@report_fn("products", "profit")
async def r_products(c: Ctx) -> dict:
    return c.out([{"key": "name", "label": "Product"}, {"key": "qty", "label": "Qty"}, {"key": "revenue", "label": "Net revenue", "money": True},
                  {"key": "cogs", "label": "Cost of goods", "money": True}, {"key": "profit", "label": "Profit", "money": True}, {"key": "margin", "label": "Margin"}],
                 _product_profit(c.ok, c.rets))


@report_fn("payments")
async def r_payments(c: Ctx) -> dict:
    ok = c.ok
    acc = {}
    for x in ok:
        for p in x["payments"]:
            a = acc.setdefault(p["method"], {"method": p["method"], "count": 0, "amount": 0})
            a["count"] += 1
            a["amount"] += p["amount"]
    due = sum(x["amount_due"] for x in ok)
    rows = list(acc.values()) + ([{"method": "on account (due)", "count": len([x for x in ok if x["amount_due"]]), "amount": due}] if due else [])
    return c.out([{"key": "method", "label": "Method"}, {"key": "count", "label": "Payments"}, {"key": "amount", "label": "Amount", "money": True}], rows)


@report_fn("trend")
async def r_trend(c: Ctx) -> dict:
    days = {}
    d = c.sd
    while d <= c.ed:
        days[d.isoformat()] = {"date": d.isoformat(), "count": 0, "revenue": 0, "profit": 0}
        d += timedelta(days=1)
    for x in c.ok:
        k = local_day(x["created_at"], c.b)
        if k in days:
            days[k]["count"] += 1
            days[k]["revenue"] += x["total"]
            days[k]["profit"] += sale_profit(x)
    return c.out([{"key": "date", "label": "Date"}, {"key": "count", "label": "Sales"}, {"key": "revenue", "label": "Revenue", "money": True},
                  {"key": "profit", "label": "Gross profit", "money": True}], list(days.values()), chart=True)


@report_fn("cashiers")
async def r_cashiers(c: Ctx) -> dict:
    acc = {}
    for x in c.ok:
        a = acc.setdefault(x["cashier_id"], {"name": x["cashier_name"], "count": 0, "revenue": 0, "discounts": 0})
        a["count"] += 1
        a["revenue"] += x["total"]
        a["discounts"] += x["line_discount"] + x["order_discount"]
    for a in acc.values():
        a["avg"] = a["revenue"] // a["count"] if a["count"] else 0
    return c.out([{"key": "name", "label": "Cashier"}, {"key": "count", "label": "Sales"}, {"key": "revenue", "label": "Revenue", "money": True},
                  {"key": "avg", "label": "Avg ticket", "money": True}, {"key": "discounts", "label": "Discounts given", "money": True}], list(acc.values()))


@report_fn("returns")
async def r_returns(c: Ctx) -> dict:
    return c.out([{"key": "receipt_no", "label": "Receipt"}, {"key": "created_at", "label": "Time", "date": True}, {"key": "by_name", "label": "By"},
                  {"key": "refund_method", "label": "Refund"}, {"key": "reason", "label": "Reason"}, {"key": "amount", "label": "Amount", "money": True}], c.rets)


@report_fn("cash")
async def r_cash(c: Ctx) -> dict:
    return c.out([{"key": "created_at", "label": "Time", "date": True}, {"key": "type", "label": "Type"}, {"key": "category", "label": "Category"},
                  {"key": "note", "label": "Note"}, {"key": "user_name", "label": "By"}, {"key": "amount", "label": "Amount", "money": True}], await c.load("cash_entries"))


@report_fn("profit_loss")
async def r_profit_loss(c: Ctx) -> dict:
    ok = c.ok
    rev = sum(net_rev(x) for x in ok)
    ret_amt = sum(r["amount"] for r in c.rets)
    cogs = sum(x["cogs"] for x in ok) - sum(r["cogs"] for r in c.rets)
    cash = await c.load("cash_entries")
    exp = sum(x["amount"] for x in cash if x["type"] == "out")
    oth = sum(x["amount"] for x in cash if x["type"] == "in")
    gp = rev - ret_amt - cogs
    rows = [["Net sales (excl. tax)", rev], ["Returns", -ret_amt], ["Cost of goods sold", -cogs], ["Gross profit", gp],
            ["Other income (cash in)", oth], ["Expenses (cash out)", -exp], ["Net profit", gp + oth - exp]]
    return c.out([{"key": "metric", "label": "Line"}, {"key": "value", "label": "Amount", "money": True}], [{"metric": m, "value": v} for m, v in rows])


@report_fn("stock_movement")
async def r_stock_movement(c: Ctx) -> dict:
    rows = await c.load("stock_ledger")
    prods = await c.names("products")
    for r in rows:
        r["product_name"] = prods.get(r["product_id"], {}).get("name", "?")
        r["value"] = r["qty"] * r["unit_cost"]
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    return c.out([{"key": "created_at", "label": "Time", "date": True}, {"key": "product_name", "label": "Product"}, {"key": "ref_type", "label": "Movement"},
                  {"key": "qty", "label": "Qty"}, {"key": "balance", "label": "Balance"}, {"key": "unit_cost", "label": "Unit cost", "money": True},
                  {"key": "value", "label": "Value", "money": True}], rows)


@report_fn("shifts")
async def r_shifts(c: Ctx) -> dict:
    return c.out([{"key": "cashier_name", "label": "Cashier"}, {"key": "opened_at", "label": "Opened", "date": True}, {"key": "closed_at", "label": "Closed", "date": True},
                  {"key": "opening_cash", "label": "Opening", "money": True}, {"key": "expected_cash", "label": "Expected", "money": True},
                  {"key": "counted_cash", "label": "Counted", "money": True}, {"key": "difference", "label": "Difference", "money": True}], await c.load("shifts", field="opened_at"))


@report_fn("restaurant")
async def r_restaurant(c: Ctx) -> dict:
    acc = {}
    for x in c.ok:
        if x.get("channel") != "table":
            continue
        k = x.get("table_id") or "-"
        a = acc.setdefault(k, {"table": x.get("table_name") or k, "count": 0, "revenue": 0})
        a["count"] += 1
        a["revenue"] += x["total"]
    tbls = await c.names("tables")
    for k, a in acc.items():
        a["table"] = tbls.get(k, {}).get("name", a["table"])
    return c.out([{"key": "table", "label": "Table"}, {"key": "count", "label": "Orders"}, {"key": "revenue", "label": "Revenue", "money": True}], list(acc.values()))


@report_fn("branches")
async def r_branches(c: Ctx) -> dict:
    outlets = await c.names("outlets")
    acc = {}
    for x in c.ok:
        a = acc.setdefault(x["outlet_id"], {"branch": outlets.get(x["outlet_id"], {}).get("name", "?"), "count": 0, "revenue": 0, "profit": 0})
        a["count"] += 1
        a["revenue"] += x["total"]
        a["profit"] += sale_profit(x)
    return c.out([{"key": "branch", "label": "Branch"}, {"key": "count", "label": "Sales"}, {"key": "revenue", "label": "Revenue", "money": True},
                  {"key": "profit", "label": "Gross profit", "money": True}], list(acc.values()))


@report_fn("loyalty")
async def r_loyalty(c: Ctx) -> dict:
    pb = await points_balances(c.bid)
    cs = await db.customers.find({"business_id": c.bid, "archived": {"$ne": True}}, {"_id": 0}).to_list(5000)
    return c.out([{"key": "name", "label": "Customer"}, {"key": "level", "label": "Level"}, {"key": "points", "label": "Points balance"}],
                 sorted([{"name": x["name"], "level": x.get("level") or "-", "points": pb.get(x["id"], 0)} for x in cs], key=lambda r: -r["points"]))


@report_fn("returns_by_product")
async def r_returns_by_product(c: Ctx) -> dict:
    rl = [{"product": l["name"], "qty": l["qty"], "amount": l["amount"]} for r in c.rets for l in r["lines"]]
    return c.out([C("product", "Product"), C("qty", "Qty returned"), C("amount", "Refunded", True)], agg(rl, "product", ["qty", "amount"]))


async def _period(c: Ctx, k: str) -> dict:
    rows = {}
    for l in await c.sale_lines():
        r = rows.setdefault((l["product"], l[k]), {"product": l["product"], "period": l[k], "qty": 0, "revenue": 0})
        r["qty"] += l["qty"]
        r["revenue"] += l["revenue"]
    return c.out([C("period", "Period"), C("product", "Product"), C("qty", "Qty"), C("revenue", "Revenue", True)],
                 sorted(rows.values(), key=lambda r: (r["period"], -r["revenue"]), reverse=True))


@report_fn("monthly_trend")
async def r_monthly_trend(c: Ctx) -> dict:
    return await _period(c, "month")


@report_fn("daily_trend")
async def r_daily_trend(c: Ctx) -> dict:
    return await _period(c, "day")


def _line_report(key: str, columns: list, fields: list) -> Report:
    async def fn(c: Ctx) -> dict:
        return c.out(columns, agg(await c.sale_lines(), key, fields))
    return fn


REPORTS["sales_by_category"] = _line_report("category", [C("category", "Category"), C("qty", "Qty"), C("revenue", "Revenue", True)], ["qty", "revenue"])
REPORTS["sales_by_brand"] = _line_report("brand", [C("brand", "Brand"), C("qty", "Qty"), C("revenue", "Revenue", True)], ["qty", "revenue"])
REPORTS["best_sellers"] = _line_report("product", [C("product", "Product"), C("revenue", "Revenue", True), C("qty", "Qty sold")], ["revenue", "qty"])


# ---------------- Purchasing & money reports ----------------
@report_fn("purchases_by_product")
async def r_purchases_by_product(c: Ctx) -> dict:
    pl = [{"product": l["name"], "qty": l["received"], "value": l["received"] * l["cost"]} for p in await c.load("purchase_orders") if p["status"] != "cancelled" for l in p["lines"]]
    return c.out([C("product", "Product"), C("qty", "Qty received"), C("value", "Value", True)], agg(pl, "product", ["qty", "value"]))


@report_fn("purchases_by_transaction")
async def r_purchases_by_transaction(c: Ctx) -> dict:
    return c.out([C("number", "PO"), C("created_at", "Date", date=True), C("supplier_name", "Supplier"), C("status", "Status"),
                  C("total", "Ordered", True), C("received_value", "Received", True), C("paid", "Paid", True)], await c.load("purchase_orders"))


@report_fn("purchase_returns_by_product")
async def r_purchase_returns_by_product(c: Ctx) -> dict:
    pl = [{"product": l["name"], "qty": l["qty"], "amount": l["amount"]} for r in await c.load("purchase_returns") for l in r["lines"]]
    return c.out([C("product", "Product"), C("qty", "Qty"), C("amount", "Value", True)], agg(pl, "product", ["qty", "amount"]))


@report_fn("purchase_returns_by_transaction")
async def r_purchase_returns_by_transaction(c: Ctx) -> dict:
    return c.out([C("number", "Return"), C("po_number", "Original PO"), C("created_at", "Date", date=True), C("supplier_name", "Supplier"),
                  C("amount", "Value", True), C("collected", "Collected", True)], await c.load("purchase_returns"))


@report_fn("cash_in")
async def r_cash_in(c: Ctx) -> dict:
    return await _cash_by_category(c, "in")


@report_fn("cash_out")
async def r_cash_out(c: Ctx) -> dict:
    return await _cash_by_category(c, "out")


async def _cash_by_category(c: Ctx, kind: str) -> dict:
    cash = [x for x in await c.load("cash_entries") if x["type"] == kind]
    return c.out([C("category", "Category"), C("count", "Entries"), C("amount", "Amount", True)], agg(cash, "category", ["count", "amount"]))


MOVE_KINDS = {"purchase_payments": "purchase_payment", "sale_payments": "sale_payment", "purchase_return_refunds": "purchase_return_refund"}


def _money_report(name: str) -> Report:
    async def fn(c: Ctx) -> dict:
        mm = await db.money_moves.find({"business_id": c.bid, "created_at": {"$gte": c.s, "$lt": c.e}}, {"_id": 0}).to_list(10000)
        rows = [m | {"amount": abs(m["amount"])} for m in mm if m["kind"] == MOVE_KINDS[name]]
        if name == "sale_payments":
            rows += [{"ref": x["receipt_no"], "party": x.get("customer_name"), "method": p["method"], "amount": p["amount"], "created_at": x["created_at"]} for x in c.ok for p in x["payments"]]
        return c.out([C("created_at", "Date", date=True), C("ref", "Document"), C("party", "Party"), C("method", "Method"), C("amount", "Amount", True)],
                      sorted(rows, key=lambda r: r["created_at"], reverse=True))
    return fn


for _n in MOVE_KINDS:
    REPORTS[_n] = _money_report(_n)


@report_fn("sale_return_refunds")
async def r_sale_return_refunds(c: Ctx) -> dict:
    return c.out([C("created_at", "Date", date=True), C("receipt_no", "Receipt"), C("refund_method", "Method"), C("amount", "Amount", True)], c.rets)


# ---------------- Stock reports ----------------
async def _stock_rows(c: Ctx) -> list:
    lv = await db.stock_levels.find({"business_id": c.bid, **({"outlet_id": c.outlet_id} if c.outlet_id else {})}, {"_id": 0}).to_list(100000)
    tot = {}
    for l in lv:
        t = tot.setdefault(l["product_id"], {"qty": 0, "value": 0})
        t["qty"] += l["qty"]
        t["value"] += max(l["qty"], 0) * l["avg_cost"]
    return [{"product": p["name"], "min": p.get("low_stock") or 0, **tot.get(pid, {"qty": 0, "value": 0})} for pid, p in (await c.names("products")).items()
            if not p.get("archived") and p.get("track_stock", True)]


STOCK_COLS = [C("product", "Product"), C("qty", "On hand"), C("min", "Minimum"), C("value", "Value at cost", True)]


@report_fn("product_stock")
async def r_product_stock(c: Ctx) -> dict:
    return c.out(STOCK_COLS, await _stock_rows(c))


@report_fn("stock_alerts")
async def r_stock_alerts(c: Ctx) -> dict:
    return c.out(STOCK_COLS, [r for r in await _stock_rows(c) if r["qty"] <= r["min"]])


@report_fn("stocktakes")
async def r_stocktakes(c: Ctx) -> dict:
    return c.out([C("number", "Count"), C("created_at", "Date", date=True), C("created_by", "By"), C("diff_value", "Difference value", True)], await c.load("stocktakes"))


@report_fn("transfers")
async def r_transfers(c: Ctx) -> dict:
    rows = await c.load("transfers", outlet=False)
    outs = await c.names("outlets")
    for r in rows:
        r.update({"from": outs.get(r["from_outlet_id"], {}).get("name"), "to": outs.get(r["to_outlet_id"], {}).get("name"), "items": sum(l["qty"] for l in r["lines"]),
                  "value": sum(l["qty"] * l["unit_cost"] for l in r["lines"])})
    return c.out([C("number", "Transfer"), C("created_at", "Sent", date=True), C("from", "From"), C("to", "To"), C("status", "Status"),
                  C("items", "Units"), C("value", "Value", True)], rows)


# ---------------- Restaurant & outlet reports ----------------
@report_fn("waiters")
async def r_waiters(c: Ctx) -> dict:
    rows = [{"waiter": x.get("waiter") or "—", "count": 1, "revenue": x["total"]} for x in c.ok if x.get("channel") == "table"]
    return c.out([C("waiter", "Waiter"), C("count", "Bills"), C("revenue", "Revenue", True)], agg(rows, "waiter", ["count", "revenue"]))


@report_fn("busy_hours")
async def r_busy_hours(c: Ctx) -> dict:
    hrs = {h: {"hour": f"{h:02d}:00", "count": 0, "revenue": 0} for h in range(24)}
    for x in c.ok:
        h = (datetime.fromisoformat(x["created_at"].replace("Z", "+00:00")) + timedelta(minutes=c.b.get("tz_offset_min", 0))).hour
        hrs[h]["count"] += 1
        hrs[h]["revenue"] += x["total"]
    return c.out([C("hour", "Hour"), C("count", "Sales"), C("revenue", "Revenue", True)], [r for r in hrs.values() if r["count"]])


@report_fn("kitchen_time")
async def r_kitchen_time(c: Ctx) -> dict:
    tk = await db.kitchen_tickets.find({"business_id": c.bid, "created_at": {"$gte": c.s, "$lt": c.e}, "ready_at": {"$exists": True}}, {"_id": 0}).to_list(10000)
    items = {}
    for t in tk:
        mins = (datetime.fromisoformat(t["ready_at"]) - datetime.fromisoformat(t["created_at"])).total_seconds() / 60
        for it in t["items"]:
            a = items.setdefault(it["name"], {"item": it["name"], "tickets": 0, "total": 0.0})
            a["tickets"] += 1
            a["total"] += mins
    rows = [{"item": a["item"], "tickets": a["tickets"], "avg": f"{a['total'] / a['tickets']:.1f} min"} for a in items.values()]
    return c.out([C("item", "Item"), C("tickets", "Tickets"), C("avg", "Avg kitchen time")], rows)


def _outlet_pl_row(o: dict, ok: list, rets: list, cash: list) -> dict:
    xs = [x for x in ok if x["outlet_id"] == o["id"]]
    rs = [r for r in rets if r["outlet_id"] == o["id"]]
    rv = sum(net_rev(x) for x in xs)
    cg = sum(x["cogs"] for x in xs) - sum(r["cogs"] for r in rs)
    ra = sum(r["amount"] for r in rs)
    ex = sum(x["amount"] for x in cash if x.get("outlet_id") == o["id"] and x["type"] == "out")
    return {"outlet": o["name"], "revenue": rv, "returns": ra, "cogs": cg, "gross": rv - ra - cg, "expenses": ex, "net": rv - ra - cg - ex}


@report_fn("outlet_pl")
async def r_outlet_pl(c: Ctx) -> dict:
    outs = await db.outlets.find({"business_id": c.bid}, {"_id": 0}).to_list(100)
    cash = await c.load("cash_entries", outlet=False)
    return c.out([C("outlet", "Outlet"), C("revenue", "Net sales", True), C("returns", "Returns", True), C("cogs", "COGS", True),
                  C("gross", "Gross profit", True), C("expenses", "Expenses", True), C("net", "Net profit", True)],
                 [_outlet_pl_row(o, c.ok, c.rets, cash) for o in outs])
