from fastapi import APIRouter, Body, Depends, HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from datetime import datetime, timezone, timedelta
import os
import jwt
from core import db, uid, now_iso, get_user, require, get_business, settings_of, verify_pw, MANAGERS
from pricing import compute, rdiv, local_parts, manual_amount

router = APIRouter()


async def move_stock(bid, oid, pid, delta, ref_type, ref_id, cost=None, strict=False, note=None, ts=None):
    key = {"business_id": bid, "outlet_id": oid, "product_id": pid}
    await db.stock_levels.update_one(key, {"$setOnInsert": {"qty": 0, "avg_cost": 0}}, upsert=True)
    if delta < 0:
        cond = dict(key)
        if strict:
            cond["qty"] = {"$gte": -delta}
        lvl = await db.stock_levels.find_one_and_update(cond, {"$inc": {"qty": delta}}, return_document=ReturnDocument.AFTER)
        if not lvl:
            return None
        unit_cost = lvl["avg_cost"]
    else:
        lvl = await db.stock_levels.find_one(key)
        upd = {"$inc": {"qty": delta}}
        if cost is not None:
            oq = max(lvl["qty"], 0)
            upd["$set"] = {"avg_cost": rdiv(oq * lvl["avg_cost"] + delta * cost, oq + delta) if oq + delta else cost}
        lvl = await db.stock_levels.find_one_and_update(key, upd, return_document=ReturnDocument.AFTER)
        unit_cost = cost if cost is not None else lvl["avg_cost"]
    await db.stock_ledger.insert_one({"id": uid("stl_"), "business_id": bid, "outlet_id": oid, "product_id": pid, "qty": delta,
                                      "unit_cost": unit_cost, "balance": lvl["qty"], "ref_type": ref_type, "ref_id": ref_id,
                                      "note": note, "created_at": ts or now_iso()})
    return unit_cost


def voucher_reason(v, outlet_id, customer_id, date_str):
    if not v or not v.get("active", True) or v.get("archived"):
        return "No voucher with this code"
    if v.get("end_date") and date_str > v["end_date"]:
        return f"Expired on {v['end_date']}"
    if v.get("start_date") and date_str < v["start_date"]:
        return f"Not valid until {v['start_date']}"
    if v.get("outlet_ids") and outlet_id not in v["outlet_ids"]:
        return "Not valid at this branch"
    if v.get("quota") and v.get("used", 0) >= v["quota"]:
        return "Redemption quota used up"
    if v.get("customer_ids") and customer_id not in v["customer_ids"]:
        return "Not for this customer"
    return None


def approval_ok(token, bid):
    try:
        p = jwt.decode(token or "", os.environ["JWT_SECRET"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    return p if p.get("type") == "approval" and p.get("bid") == bid else None


async def points_balances(bid):
    rows = await db.points_ledger.aggregate([{"$match": {"business_id": bid}},
                                             {"$group": {"_id": "$customer_id", "p": {"$sum": "$points"}}}]).to_list(100000)
    return {r["_id"]: r["p"] for r in rows}


@router.get("/pos/bootstrap")
async def bootstrap(outlet_id: str = None, user=Depends(get_user)):
    bid = user["business_id"]
    b = await get_business(bid)
    outlets = await db.outlets.find({"business_id": bid, "archived": {"$ne": True}}, {"_id": 0}).to_list(100)
    oid = outlet_id or user.get("outlet_id") or outlets[0]["id"]
    outlet = next((o for o in outlets if o["id"] == oid), outlets[0])
    q = {"business_id": bid, "archived": {"$ne": True}}
    prods = await db.products.find(q, {"_id": 0, "cost": 0}).sort("name", 1).to_list(10000)
    levels = {l["product_id"]: l["qty"] for l in await db.stock_levels.find({"business_id": bid, "outlet_id": outlet["id"]}).to_list(100000)}
    for p in prods:
        p["stock"] = levels.get(p["id"], 0)
    pb = await points_balances(bid)
    customers = await db.customers.find(q, {"_id": 0}).sort("name", 1).to_list(5000)
    for c in customers:
        c["points"] = pb.get(c["id"], 0)
    return {"business": b, "outlet": outlet, "outlets": outlets, "products": prods,
            "categories": await db.categories.find(q, {"_id": 0}).sort("name", 1).to_list(500),
            "rules": await db.rules.find(q, {"_id": 0}).to_list(500),
            "vouchers": await db.vouchers.find({**q, "active": {"$ne": False}}, {"_id": 0}).to_list(500),
            "customers": customers,
            "tables": await db.tables.find({**q, "outlet_id": outlet["id"]}, {"_id": 0}).sort("name", 1).to_list(500),
            "server_time": now_iso()}


# ---------------- Stock ----------------
@router.get("/stock")
async def stock(outlet_id: str, user=Depends(require(*MANAGERS))):
    bid = user["business_id"]
    prods = await db.products.find({"business_id": bid, "archived": {"$ne": True}}, {"_id": 0}).sort("name", 1).to_list(10000)
    levels = {l["product_id"]: l for l in await db.stock_levels.find({"business_id": bid, "outlet_id": outlet_id}, {"_id": 0}).to_list(100000)}
    return [{"product_id": p["id"], "name": p["name"], "sku": p.get("sku"), "track_stock": p.get("track_stock", True),
             "low_stock": p.get("low_stock", 0), "qty": levels.get(p["id"], {}).get("qty", 0),
             "avg_cost": levels.get(p["id"], {}).get("avg_cost", 0)} for p in prods]


@router.get("/stock/ledger")
async def ledger(outlet_id: str = None, product_id: str = None, user=Depends(require(*MANAGERS))):
    q = {"business_id": user["business_id"]}
    if outlet_id:
        q["outlet_id"] = outlet_id
    if product_id:
        q["product_id"] = product_id
    rows = await db.stock_ledger.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    names = {p["id"]: p["name"] for p in await db.products.find({"business_id": user["business_id"]}, {"id": 1, "name": 1}).to_list(10000)}
    for r in rows:
        r["product_name"] = names.get(r["product_id"], "?")
    return rows


@router.post("/stock/adjust")
async def adjust(data: dict = Body(...), user=Depends(require(*MANAGERS))):
    qty = int(data.get("qty", 0))
    if not qty:
        raise HTTPException(400, "Quantity cannot be zero")
    reason = data.get("reason", "adjustment")
    aid = uid("adj_")
    cost = int(data["cost"]) if qty > 0 and data.get("cost") not in (None, "") else None
    await move_stock(user["business_id"], data["outlet_id"], data["product_id"], qty, f"adjust:{reason}", aid, cost=cost, note=data.get("note"))
    return {"ok": True, "id": aid}


@router.post("/stock/check")
async def stock_check(data: dict = Body(...), user=Depends(get_user)):
    bid = user["business_id"]
    outlet = await db.outlets.find_one({"id": data["outlet_id"], "business_id": bid})
    if not outlet or outlet.get("allow_negative_stock"):
        return {"ok": True, "short": []}
    need = {}
    for ln in data.get("lines", []):
        need[ln["product_id"]] = need.get(ln["product_id"], 0) + ln["qty"]
    prods = {p["id"]: p for p in await db.products.find({"business_id": bid, "id": {"$in": list(need)}}).to_list(1000)}
    levels = {l["product_id"]: l["qty"] for l in await db.stock_levels.find({"business_id": bid, "outlet_id": data["outlet_id"], "product_id": {"$in": list(need)}}).to_list(1000)}
    short = [{"product_id": pid, "name": prods[pid]["name"], "available": levels.get(pid, 0), "requested": q}
             for pid, q in need.items() if pid in prods and prods[pid].get("track_stock", True) and levels.get(pid, 0) < q]
    return {"ok": not short, "short": short}


# ---------------- Purchasing ----------------
@router.post("/purchases")
async def purchase(data: dict = Body(...), user=Depends(require(*MANAGERS))):
    bid = user["business_id"]
    pid = uid("po_")
    lines = [{"product_id": l["product_id"], "qty": int(l["qty"]), "cost": int(l["cost"])} for l in data.get("lines", []) if int(l.get("qty", 0)) > 0]
    if not lines:
        raise HTTPException(400, "Add at least one item")
    total = sum(l["qty"] * l["cost"] for l in lines)
    for l in lines:
        await move_stock(bid, data["outlet_id"], l["product_id"], l["qty"], "purchase", pid, cost=l["cost"])
    doc = {"id": pid, "business_id": bid, "outlet_id": data["outlet_id"], "supplier_id": data.get("supplier_id"),
           "lines": lines, "total": total, "paid": int(data.get("paid", 0)), "due_date": data.get("due_date"),
           "status": "received", "created_by": user["id"], "created_at": now_iso()}
    await db.purchases.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/purchases")
async def purchases(user=Depends(require(*MANAGERS))):
    return await db.purchases.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


# ---------------- Sync queue ----------------
async def process_sale(user, p, offline):
    bid = user["business_id"]
    existing = await db.sales.find_one({"business_id": bid, "client_id": p["client_id"]}, {"_id": 0})
    if existing:
        return {"status": "duplicate", "sale": existing}
    b = await get_business(bid)
    outlet = await db.outlets.find_one({"id": p["outlet_id"], "business_id": bid}, {"_id": 0})
    if not outlet:
        raise HTTPException(400, "Unknown outlet")
    rules = await db.rules.find({"business_id": bid, "archived": {"$ne": True}}, {"_id": 0}).to_list(500)
    customer = await db.customers.find_one({"id": p.get("customer_id"), "business_id": bid}, {"_id": 0}) if p.get("customer_id") else None
    voucher = None
    if p.get("voucher_code"):
        voucher = await db.vouchers.find_one({"business_id": bid, "code": p["voucher_code"]}, {"_id": 0})
        reason = voucher_reason(voucher, outlet["id"], p.get("customer_id"), local_parts(p["created_at"], b.get("tz_offset_min", 0))[0])
        if reason:
            if not offline:
                raise HTTPException(400, f"Voucher rejected: {reason}")
            voucher = None
    loyalty = b.get("loyalty") or {}
    pts_red = int(p.get("points_redeemed") or 0)
    if pts_red:
        if not customer:
            raise HTTPException(400, "Points need a customer")
        bal = (await points_balances(bid)).get(customer["id"], 0)
        if bal < pts_red:
            raise HTTPException(400, "Not enough points")
    prods = {x["id"]: x for x in await db.products.find({"business_id": bid, "id": {"$in": [l["product_id"] for l in p["lines"]]}}, {"_id": 0}).to_list(1000)}
    lines = []
    for l in p["lines"]:
        pr = prods.get(l["product_id"])
        if not pr:
            raise HTTPException(400, "Unknown product in sale")
        price = int(l["unit_price"]) if (b.get("allow_price_edit") or offline) else pr["price"]
        if int(l["qty"]) <= 0 or price < 0:
            raise HTTPException(400, "Invalid quantity or price")
        lines.append({"product_id": pr["id"], "name": pr["name"], "category_id": pr.get("category_id"), "qty": int(l["qty"]),
                      "unit_price": price, "price_override": price != pr["price"], "tax_bps": pr.get("tax_bps", 0), "manual_discount": l.get("manual_discount"),
                      "note": l.get("note"), "track_stock": pr.get("track_stock", True), "image": pr.get("image")})
    ctx = {"ts": p["created_at"], "tz_min": b.get("tz_offset_min", 0), "outlet_id": outlet["id"], "customer": customer}
    cart = {"lines": lines, "voucher": voucher, "order_discount": p.get("order_discount"),
            "points_value": pts_red * (loyalty.get("point_value") or 0)}
    t = compute(cart, rules, settings_of(b), ctx)
    approved_by = None
    manual_total = manual_amount(p.get("order_discount"), t["subtotal"]) + sum(
        l["discount"] for l in t["lines"] if l["discount_source"] == "manual")
    if manual_total > (t["subtotal"] + t["line_discount"]) * (user.get("discount_limit_bps") or 0) // 10000:
        appr = approval_ok((p.get("order_discount") or {}).get("approval"), bid)
        if not appr:
            raise HTTPException(403, "Discount above your limit needs supervisor approval")
        approved_by = appr["sub"]
    payments = [{"method": x["method"], "amount": int(x["amount"])} for x in p.get("payments", []) if int(x.get("amount", 0)) > 0]
    paid = sum(x["amount"] for x in payments)
    change = max(paid - t["total"], 0)
    if change:
        cash = next((x for x in payments if x["method"] == "cash"), None)
        if not cash or cash["amount"] < change:
            raise HTTPException(400, "Overpayment is only allowed in cash")
        cash["tendered"] = cash["amount"]
        cash["amount"] -= change
    due = max(t["total"] - paid, 0)
    if due and not customer:
        raise HTTPException(400, "Partial payment needs a named customer")
    if due and customer and customer.get("credit_limit") and not offline:
        rec = sum(s.get("amount_due", 0) for s in await db.sales.find({"business_id": bid, "customer_id": customer["id"], "status": {"$ne": "voided"}}, {"amount_due": 1}).to_list(5000))
        if rec + due > customer["credit_limit"]:
            raise HTTPException(400, "Credit limit exceeded for this customer")
    sale_id = uid("sal_")
    strict = not outlet.get("allow_negative_stock") and not offline
    moved = []
    for l in t["lines"]:
        if not l["track_stock"]:
            l["unit_cost"] = 0
            continue
        c = await move_stock(bid, outlet["id"], l["product_id"], -l["qty"], "sale", sale_id, strict=strict, ts=p["created_at"])
        if c is None:
            for pid, q in moved:
                await db.stock_levels.update_one({"business_id": bid, "outlet_id": outlet["id"], "product_id": pid}, {"$inc": {"qty": q}})
            await db.stock_ledger.delete_many({"ref_id": sale_id})
            raise HTTPException(409, f"Not enough stock for {l['name']}")
        moved.append((l["product_id"], l["qty"]))
        l["unit_cost"] = c
    for l in t["lines"]:
        l["cogs"] = l["unit_cost"] * l["qty"]
    earned = 0
    if customer and loyalty.get("enabled"):
        if t["subtotal"] >= (loyalty.get("min_subtotal") or 0) and loyalty.get("earn_per"):
            earned += t["total"] // loyalty["earn_per"]
        earned += sum((prods[l["product_id"]].get("points") or 0) * l["qty"] for l in t["lines"])
    sale = {"id": sale_id, "business_id": bid, "client_id": p["client_id"], "receipt_no": p["receipt_no"], "outlet_id": outlet["id"],
            "shift_id": p.get("shift_id"), "cashier_id": user["id"], "cashier_name": user["name"],
            "customer_id": customer["id"] if customer else None, "customer_name": customer["name"] if customer else None,
            "order_id": p.get("order_id"), "table_id": p.get("table_id"), "channel": p.get("channel", "retail"),
            "lines": t["lines"], "gross": t["gross"], "line_discount": t["line_discount"], "subtotal": t["subtotal"],
            "order_discount": t["order_discount"], "applied": t["applied"], "tax": t["tax"], "service": t["service"],
            "rounding": t["rounding"], "total": t["total"], "cogs": sum(l["cogs"] for l in t["lines"]),
            "payments": payments, "change": change, "amount_due": due, "voucher_code": p.get("voucher_code"),
            "points_redeemed": pts_red, "points_earned": earned, "currency": b["currency"], "status": "completed",
            "offline": offline, "client_total": p.get("client_total"),
            "totals_mismatch": p.get("client_total") is not None and p["client_total"] != t["total"],
            "tax_inclusive": b.get("tax_inclusive", False), "discount_approved_by": approved_by,
            "created_at": p["created_at"], "synced_at": now_iso()}
    try:
        await db.sales.insert_one(sale)
    except DuplicateKeyError:
        await db.stock_ledger.delete_many({"ref_id": sale_id})
        for pid, q in moved:
            await db.stock_levels.update_one({"business_id": bid, "outlet_id": outlet["id"], "product_id": pid}, {"$inc": {"qty": q}})
        ex = await db.sales.find_one({"business_id": bid, "client_id": p["client_id"]}, {"_id": 0})
        if ex:
            return {"status": "duplicate", "sale": ex}
        raise HTTPException(409, "Receipt number already used")
    sale.pop("_id", None)
    if customer:
        exp = (datetime.now(timezone.utc) + timedelta(days=loyalty.get("expiry_days") or 3650)).isoformat()
        if earned:
            await db.points_ledger.insert_one({"id": uid("pts_"), "business_id": bid, "customer_id": customer["id"], "type": "earned",
                                               "points": earned, "ref_id": sale_id, "expires_at": exp, "created_at": p["created_at"]})
        if pts_red:
            await db.points_ledger.insert_one({"id": uid("pts_"), "business_id": bid, "customer_id": customer["id"], "type": "redeemed",
                                               "points": -pts_red, "ref_id": sale_id, "created_at": p["created_at"]})
    if voucher:
        await db.vouchers.update_one({"id": voucher["id"]}, {"$inc": {"used": 1}})
    if p.get("order_id"):
        await db.open_orders.update_one({"id": p["order_id"], "business_id": bid}, {"$set": {"status": "paid", "sale_id": sale_id}})
    return {"status": "created", "sale": sale}


async def shift_summary(bid, shift):
    sl = await db.sales.find({"business_id": bid, "shift_id": shift["id"]}, {"_id": 0}).to_list(10000)
    rets = await db.returns.find({"business_id": bid, "shift_id": shift["id"]}, {"_id": 0}).to_list(5000)
    cash = await db.cash_entries.find({"business_id": bid, "shift_id": shift["id"]}, {"_id": 0}).to_list(5000)
    methods, products, returned = {}, {}, {}
    for s in sl:
        if s["status"] == "voided":
            continue
        for p in s["payments"]:
            methods[p["method"]] = methods.get(p["method"], 0) + p["amount"]
        for l in s["lines"]:
            e = products.setdefault(l["product_id"], {"name": l["name"], "image": l.get("image"), "qty": 0, "amount": 0})
            e["qty"] += l["qty"]
            e["amount"] += l["line_total"]
    refunds_cash = 0
    for r in rets:
        if r["refund_method"] == "cash":
            refunds_cash += r["amount"]
        for l in r["lines"]:
            e = returned.setdefault(l["product_id"], {"name": l["name"], "qty": 0, "amount": 0})
            e["qty"] += l["qty"]
            e["amount"] += l["amount"]
    cin = sum(c["amount"] for c in cash if c["type"] == "in")
    cout = sum(c["amount"] for c in cash if c["type"] == "out")
    expected = shift["opening_cash"] + methods.get("cash", 0) - refunds_cash + cin - cout
    return {"sales_count": len([s for s in sl if s["status"] != "voided"]), "sales_total": sum(s["total"] for s in sl if s["status"] != "voided"),
            "methods": methods, "products": list(products.values()), "returned": list(returned.values()),
            "refunds_cash": refunds_cash, "cash_in": cin, "cash_out": cout, "expected_cash": expected}


async def process_op(user, op):
    bid = user["business_id"]
    t, p = op["type"], op["payload"]
    if t == "sale":
        offline = bool(op.get("offline", False))
        if offline:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(p["created_at"].replace("Z", "+00:00"))
            offline = age > timedelta(seconds=30)
        return await process_sale(user, p, offline)
    seen = await db.sync_ops.find_one({"business_id": bid, "client_id": op["client_id"]})
    if seen:
        return {"status": "duplicate"}
    if t == "shift_open":
        doc = {"id": p["client_id"], "business_id": bid, "outlet_id": p["outlet_id"], "cashier_id": user["id"], "cashier_name": user["name"],
               "opening_cash": int(p.get("opening_cash", 0)), "status": "open", "opened_at": p["created_at"]}
        await db.shifts.insert_one(doc)
    elif t == "shift_close":
        sh = await db.shifts.find_one({"id": p["shift_id"], "business_id": bid}, {"_id": 0})
        if not sh:
            raise HTTPException(400, "Unknown shift")
        summ = await shift_summary(bid, sh)
        counted = int(p.get("counted_cash", 0))
        await db.shifts.update_one({"id": sh["id"]}, {"$set": {"status": "closed", "closed_at": p["created_at"], "counted_cash": counted,
                                                              "expected_cash": summ["expected_cash"], "difference": counted - summ["expected_cash"], "summary": summ}})
    elif t == "cash":
        await db.cash_entries.insert_one({"id": p["client_id"], "business_id": bid, "outlet_id": p["outlet_id"], "shift_id": p.get("shift_id"),
                                          "type": p["type"], "category": p.get("category") or "Other", "amount": int(p["amount"]),
                                          "note": p.get("note"), "user_id": user["id"], "user_name": user["name"], "created_at": p["created_at"]})
    else:
        raise HTTPException(400, "Unknown operation")
    await db.sync_ops.insert_one({"business_id": bid, "client_id": op["client_id"], "type": t, "at": now_iso()})
    return {"status": "created"}


@router.post("/sync")
async def sync(data: dict = Body(...), user=Depends(get_user)):
    results = []
    for op in data.get("ops", []):
        try:
            r = await process_op(user, op)
            results.append({"client_id": op["client_id"], "ok": True, **r})
        except HTTPException as e:
            results.append({"client_id": op["client_id"], "ok": False, "error": e.detail, "code": e.status_code})
            if op["type"] != "sale" or not op.get("offline", False):
                break
    return {"results": results}


# ---------------- Sales ----------------
@router.get("/sales")
async def list_sales(outlet_id: str = None, q: str = None, limit: int = 200, user=Depends(get_user)):
    f = {"business_id": user["business_id"]}
    if outlet_id:
        f["outlet_id"] = outlet_id
    if user["role"] == "cashier":
        f["cashier_id"] = user["id"]
    if q:
        f["receipt_no"] = {"$regex": q, "$options": "i"}
    return await db.sales.find(f, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 1000))


@router.get("/sales/{sid}")
async def get_sale(sid: str, user=Depends(get_user)):
    s = await db.sales.find_one({"id": sid, "business_id": user["business_id"]}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Sale not found")
    s["returns"] = await db.returns.find({"sale_id": sid}, {"_id": 0}).to_list(100)
    return s


async def _authorize_supervisor(user, pin):
    if user["role"] in MANAGERS:
        return user["id"]
    async for u in db.users.find({"business_id": user["business_id"], "role": {"$in": list(MANAGERS)}, "pin_hash": {"$exists": True}}):
        if pin and verify_pw(str(pin), u["pin_hash"]):
            return u["id"]
    raise HTTPException(403, "Supervisor PIN required")


@router.post("/sales/{sid}/void")
async def void_sale(sid: str, data: dict = Body(...), user=Depends(get_user)):
    bid = user["business_id"]
    sup = await _authorize_supervisor(user, data.get("supervisor_pin"))
    s = await db.sales.find_one({"id": sid, "business_id": bid}, {"_id": 0})
    if not s or s["status"] != "completed":
        raise HTTPException(400, "Only completed sales can be voided")
    if await db.returns.find_one({"sale_id": sid}):
        raise HTTPException(400, "Sale has returns and cannot be voided")
    vid = uid("void_")
    for l in s["lines"]:
        if l.get("track_stock", True):
            await move_stock(bid, s["outlet_id"], l["product_id"], l["qty"], "void", vid, cost=None)
    if s.get("customer_id"):
        net = s.get("points_redeemed", 0) - s.get("points_earned", 0)
        if net:
            await db.points_ledger.insert_one({"id": uid("pts_"), "business_id": bid, "customer_id": s["customer_id"], "type": "adjusted",
                                               "points": net, "ref_id": vid, "note": f"Void {s['receipt_no']}", "created_at": now_iso()})
    await db.voids.insert_one({"id": vid, "business_id": bid, "sale_id": sid, "receipt_no": s["receipt_no"], "reason": data.get("reason"),
                               "amount": s["total"], "by": user["id"], "approved_by": sup, "created_at": now_iso()})
    await db.sales.update_one({"id": sid}, {"$set": {"status": "voided", "void_id": vid, "voided_at": now_iso()}})
    return {"ok": True, "void_id": vid}


@router.post("/sales/{sid}/return")
async def return_sale(sid: str, data: dict = Body(...), user=Depends(get_user)):
    bid = user["business_id"]
    await _authorize_supervisor(user, data.get("supervisor_pin"))
    s = await db.sales.find_one({"id": sid, "business_id": bid}, {"_id": 0})
    if not s or s["status"] != "completed":
        raise HTTPException(400, "Only completed sales can be returned")
    b = await get_business(bid)
    prev = await db.returns.find({"sale_id": sid}).to_list(100)
    done = {}
    for r in prev:
        for l in r["lines"]:
            done[l["index"]] = done.get(l["index"], 0) + l["qty"]
    rid = uid("ret_")
    out, amount = [], 0
    for item in data.get("lines", []):
        i, q = int(item["index"]), int(item["qty"])
        if q <= 0:
            continue
        sl = s["lines"][i]
        if q > sl["qty"] - done.get(i, 0):
            raise HTTPException(400, f"Cannot return more {sl['name']} than was sold")
        amt = rdiv(sl["line_total"] * q, sl["qty"])
        out.append({"index": i, "product_id": sl["product_id"], "name": sl["name"], "qty": q, "amount": amt, "unit_cost": sl.get("unit_cost", 0)})
        amount += amt
        if sl.get("track_stock", True):
            await move_stock(bid, s["outlet_id"], sl["product_id"], q, "return", rid, cost=sl.get("unit_cost", 0))
    if not out:
        raise HTTPException(400, "Choose at least one item to return")
    method = data.get("refund_method", "cash")
    unit = b.get("rounding_unit") or 0
    if method == "cash" and unit > 1:
        amount = rdiv(amount, unit) * unit
    if method == "store_credit":
        if not s.get("customer_id"):
            raise HTTPException(400, "Store credit needs a customer on the sale")
        await db.customers.update_one({"id": s["customer_id"]}, {"$inc": {"store_credit": amount}})
    doc = {"id": rid, "business_id": bid, "sale_id": sid, "receipt_no": s["receipt_no"], "outlet_id": s["outlet_id"],
           "shift_id": data.get("shift_id"), "customer_id": s.get("customer_id"), "lines": out, "amount": amount,
           "cogs": sum(l["unit_cost"] * l["qty"] for l in out), "refund_method": method, "reason": data.get("reason"),
           "by": user["id"], "by_name": user["name"], "created_at": now_iso()}
    await db.returns.insert_one(doc)
    doc.pop("_id", None)
    if s.get("customer_id") and s.get("points_earned") and s["total"]:
        back = s["points_earned"] * amount // s["total"]
        if back:
            await db.points_ledger.insert_one({"id": uid("pts_"), "business_id": bid, "customer_id": s["customer_id"], "type": "adjusted",
                                               "points": -back, "ref_id": rid, "note": f"Return on {s['receipt_no']}", "created_at": now_iso()})
    return doc


# ---------------- Shifts & cash ----------------
@router.get("/shifts")
async def list_shifts(user=Depends(get_user)):
    f = {"business_id": user["business_id"]}
    if user["role"] not in MANAGERS:
        f["cashier_id"] = user["id"]
    return await db.shifts.find(f, {"_id": 0}).sort("opened_at", -1).to_list(500)


@router.get("/shifts/current")
async def current_shift(outlet_id: str, user=Depends(get_user)):
    return await db.shifts.find_one({"business_id": user["business_id"], "outlet_id": outlet_id, "cashier_id": user["id"], "status": "open"}, {"_id": 0})


@router.get("/shifts/{sid}")
async def shift_detail(sid: str, user=Depends(get_user)):
    sh = await db.shifts.find_one({"id": sid, "business_id": user["business_id"]}, {"_id": 0})
    if not sh:
        raise HTTPException(404, "Shift not found")
    if sh["status"] == "open":
        sh["summary"] = await shift_summary(user["business_id"], sh)
    return sh


@router.get("/cash")
async def list_cash(user=Depends(get_user)):
    return await db.cash_entries.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)


# ---------------- Restaurant: open orders & kitchen ----------------
@router.get("/orders")
async def list_orders(outlet_id: str, user=Depends(get_user)):
    return await db.open_orders.find({"business_id": user["business_id"], "outlet_id": outlet_id, "status": "open"}, {"_id": 0}).sort("created_at", 1).to_list(500)


ORDER_FIELDS = ("lines", "table_id", "table_name", "customer_id", "label", "guests")


@router.post("/orders")
async def create_order(data: dict = Body(...), user=Depends(get_user)):
    doc = {k: data.get(k) for k in ORDER_FIELDS}
    doc.update({"id": uid("ord_"), "business_id": user["business_id"], "outlet_id": data["outlet_id"], "type": data.get("type", "hold"),
                "lines": data.get("lines") or [], "round": 0, "status": "open", "created_by": user["name"], "created_at": now_iso()})
    if doc["table_id"] and await db.open_orders.find_one({"business_id": user["business_id"], "table_id": doc["table_id"], "status": "open"}):
        raise HTTPException(400, "This table already has an open order")
    await db.open_orders.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/orders/{oid}")
async def update_order(oid: str, data: dict = Body(...), user=Depends(get_user)):
    upd = {k: data[k] for k in ORDER_FIELDS if k in data}
    if upd.get("table_id"):
        other = await db.open_orders.find_one({"business_id": user["business_id"], "table_id": upd["table_id"], "status": "open", "id": {"$ne": oid}})
        if other:
            raise HTTPException(400, "Target table is occupied — merge instead")
    r = await db.open_orders.find_one_and_update({"id": oid, "business_id": user["business_id"], "status": "open"}, {"$set": upd},
                                                 projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not r:
        raise HTTPException(404, "Order not found")
    if upd.get("table_name"):
        await db.kitchen_tickets.update_many({"business_id": user["business_id"], "order_id": oid}, {"$set": {"table_name": upd["table_name"]}})
    return r


@router.post("/orders/{oid}/send")
async def send_kitchen(oid: str, user=Depends(get_user)):
    bid = user["business_id"]
    o = await db.open_orders.find_one({"id": oid, "business_id": bid, "status": "open"}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    stations = {}
    for l in o["lines"]:
        new = l["qty"] - l.get("sent_qty", 0)
        if new > 0:
            stations.setdefault(l.get("station") or "kitchen", []).append({"name": l["name"], "qty": new, "note": l.get("note")})
            l["sent_qty"] = l["qty"]
    if not stations:
        raise HTTPException(400, "Nothing new to send")
    rnd = o.get("round", 0) + 1
    for st, items in stations.items():
        await db.kitchen_tickets.insert_one({"id": uid("tkt_"), "business_id": bid, "outlet_id": o["outlet_id"], "order_id": oid,
                                             "table_name": o.get("table_name") or o.get("label") or "Takeaway", "station": st, "round": rnd,
                                             "items": items, "status": "new", "waiter": user["name"], "created_at": now_iso()})
    await db.open_orders.update_one({"id": oid}, {"$set": {"lines": o["lines"], "round": rnd}})
    return {"ok": True, "round": rnd, "stations": list(stations)}


@router.post("/orders/{oid}/merge")
async def merge_orders(oid: str, data: dict = Body(...), user=Depends(get_user)):
    bid = user["business_id"]
    a = await db.open_orders.find_one({"id": oid, "business_id": bid, "status": "open"}, {"_id": 0})
    b = await db.open_orders.find_one({"id": data.get("from_id"), "business_id": bid, "status": "open"}, {"_id": 0})
    if not a or not b or a["id"] == b["id"]:
        raise HTTPException(400, "Choose two different open orders")
    await db.open_orders.update_one({"id": oid}, {"$set": {"lines": a["lines"] + b["lines"]}})
    await db.open_orders.update_one({"id": b["id"]}, {"$set": {"status": "merged", "merged_into": oid}})
    await db.kitchen_tickets.update_many({"business_id": bid, "order_id": b["id"]},
                                         {"$set": {"order_id": oid, "table_name": a.get("table_name") or a.get("label") or "Takeaway"}})
    return {"ok": True}


@router.post("/orders/{oid}/cancel")
async def cancel_order(oid: str, user=Depends(get_user)):
    r = await db.open_orders.update_one({"id": oid, "business_id": user["business_id"], "status": "open"}, {"$set": {"status": "cancelled", "cancelled_by": user["name"]}})
    if not r.matched_count:
        raise HTTPException(404, "Order not found")
    return {"ok": True}


@router.get("/kitchen/tickets")
async def tickets(outlet_id: str, station: str = None, user=Depends(get_user)):
    f = {"business_id": user["business_id"], "outlet_id": outlet_id, "status": {"$in": ["new", "preparing", "ready"]}}
    if station:
        f["station"] = station
    return await db.kitchen_tickets.find(f, {"_id": 0}).sort("created_at", 1).to_list(500)


@router.patch("/kitchen/tickets/{tid}")
async def ticket_status(tid: str, data: dict = Body(...), user=Depends(get_user)):
    if data.get("status") not in ("new", "preparing", "ready", "served"):
        raise HTTPException(400, "Bad status")
    await db.kitchen_tickets.update_one({"id": tid, "business_id": user["business_id"]}, {"$set": {"status": data["status"], f"{data['status']}_at": now_iso()}})
    return {"ok": True}
