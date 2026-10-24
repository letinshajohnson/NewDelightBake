from fastapi import APIRouter, Body, Depends, HTTPException
from pymongo import ReturnDocument
from datetime import datetime, timezone, timedelta
from core import db, uid, now_iso, get_user, require, get_business, MANAGERS
from sales import move_stock

router = APIRouter()
DEFAULT_PREFIX = {"sale": "INV", "po": "PO", "pr": "PR", "tr": "TR", "st": "ST", "ret": "RET"}


async def next_no(b, kind):
    pre = (b.get("prefixes") or {}).get(kind) or DEFAULT_PREFIX[kind]
    c = await db.counters.find_one_and_update({"business_id": b["id"], "kind": kind}, {"$inc": {"n": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    return f"{pre}-{c['n']:05d}"


async def names(bid):
    return {p["id"]: p for p in await db.products.find({"business_id": bid}, {"_id": 0, "id": 1, "name": 1, "category_id": 1, "brand_id": 1}).to_list(10000)}


def today(b):
    return (datetime.now(timezone.utc) + timedelta(minutes=b.get("tz_offset_min", 0))).strftime("%Y-%m-%d")


@router.get("/returns")
async def list_returns(user=Depends(get_user)):
    return await db.returns.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.get("/voids")
async def list_voids(user=Depends(require(*MANAGERS))):
    return await db.voids.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(2000)


# ---------------- Purchase orders ----------------
@router.get("/purchase-orders")
async def list_pos(user=Depends(require(*MANAGERS))):
    return await db.purchase_orders.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.post("/purchase-orders")
async def create_po(data: dict = Body(...), user=Depends(require(*MANAGERS))):
    bid = user["business_id"]
    b = await get_business(bid)
    nm = await names(bid)
    lines = [{"product_id": l["product_id"], "name": nm[l["product_id"]]["name"], "qty": int(l["qty"]), "cost": int(l["cost"]), "received": 0}
             for l in data.get("lines", []) if l.get("product_id") in nm and int(l.get("qty") or 0) > 0]
    if not lines or not data.get("outlet_id"):
        raise HTTPException(400, "Choose an outlet and at least one item")
    sup = await db.suppliers.find_one({"id": data.get("supplier_id"), "business_id": bid}, {"_id": 0})
    due = data.get("due_date") or (sup and sup.get("terms_days") and (datetime.now(timezone.utc) + timedelta(days=int(sup["terms_days"]))).strftime("%Y-%m-%d"))
    doc = {"id": uid("po_"), "business_id": bid, "number": await next_no(b, "po"), "outlet_id": data["outlet_id"], "supplier_id": data.get("supplier_id"),
           "supplier_name": sup["name"] if sup else None, "lines": lines, "total": sum(l["qty"] * l["cost"] for l in lines), "received_value": 0,
           "paid": 0, "payments": [], "due_date": due, "status": "ordered", "note": data.get("note"), "created_by": user["name"], "created_at": now_iso()}
    await db.purchase_orders.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _po(user, pid):
    po = await db.purchase_orders.find_one({"id": pid, "business_id": user["business_id"]}, {"_id": 0})
    if not po:
        raise HTTPException(404, "Purchase order not found")
    return po


@router.post("/purchase-orders/{pid}/receive")
async def receive_po(pid: str, data: dict = Body(...), user=Depends(require(*MANAGERS))):
    po = await _po(user, pid)
    if po["status"] in ("cancelled", "received"):
        raise HTTPException(400, f"Order is {po['status']}")
    want = {l["product_id"]: int(l["qty"]) for l in data.get("lines", []) if int(l.get("qty") or 0) > 0}
    value = 0
    for l in po["lines"]:
        q = min(want.get(l["product_id"], 0), l["qty"] - l["received"])
        if q > 0:
            await move_stock(po["business_id"], po["outlet_id"], l["product_id"], q, "purchase", po["id"], cost=l["cost"], note=po["number"])
            l["received"] += q
            value += q * l["cost"]
    if not value:
        raise HTTPException(400, "Nothing to receive")
    status = "received" if all(l["received"] >= l["qty"] for l in po["lines"]) else "partial"
    await db.purchase_orders.update_one({"id": pid}, {"$set": {"lines": po["lines"], "status": status}, "$inc": {"received_value": value}})
    return {"ok": True, "status": status, "value": value}


@router.post("/purchase-orders/{pid}/cancel")
async def cancel_po(pid: str, data: dict = Body(default={}), user=Depends(require(*MANAGERS))):
    po = await _po(user, pid)
    if po["status"] != "ordered":
        raise HTTPException(400, "Only orders with nothing received can be cancelled")
    await db.purchase_orders.update_one({"id": pid}, {"$set": {"status": "cancelled", "cancel_reason": data.get("reason"), "cancelled_at": now_iso(), "cancelled_by": user["name"]}})
    return {"ok": True}


@router.post("/purchase-orders/{pid}/pay")
async def pay_po(pid: str, data: dict = Body(...), user=Depends(require(*MANAGERS))):
    po = await _po(user, pid)
    amt = int(data.get("amount") or 0)
    if amt <= 0 or amt > po["received_value"] - po["paid"]:
        raise HTTPException(400, "Amount must be between 0 and the unpaid balance")
    pay = {"amount": amt, "method": data.get("method", "cash"), "at": now_iso(), "by": user["name"]}
    await db.purchase_orders.update_one({"id": pid}, {"$inc": {"paid": amt}, "$push": {"payments": pay}})
    await db.money_moves.insert_one({"id": uid("mm_"), "business_id": po["business_id"], "kind": "purchase_payment", "ref": po["number"], "party": po.get("supplier_name"),
                                     "method": pay["method"], "amount": -amt, "created_at": pay["at"]})
    return {"ok": True}


# ---------------- Purchase returns ----------------
@router.get("/purchase-returns")
async def list_preturns(user=Depends(require(*MANAGERS))):
    return await db.purchase_returns.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.post("/purchase-returns")
async def create_preturn(data: dict = Body(...), user=Depends(require(*MANAGERS))):
    po = await _po(user, data.get("po_id"))
    b = await get_business(user["business_id"])
    rid = uid("prt_")
    lines, amount = [], 0
    for item in data.get("lines", []):
        l = next((x for x in po["lines"] if x["product_id"] == item["product_id"]), None)
        q = int(item.get("qty") or 0)
        if not l or q <= 0:
            continue
        if q > l["received"] - l.get("returned", 0):
            raise HTTPException(400, f"Cannot return more {l['name']} than was received")
        await move_stock(po["business_id"], po["outlet_id"], l["product_id"], -q, "purchase_return", rid, note=po["number"])
        l["returned"] = l.get("returned", 0) + q
        lines.append({"product_id": l["product_id"], "name": l["name"], "qty": q, "cost": l["cost"], "amount": q * l["cost"]})
        amount += q * l["cost"]
    if not lines:
        raise HTTPException(400, "Choose at least one item")
    await db.purchase_orders.update_one({"id": po["id"]}, {"$set": {"lines": po["lines"]}})
    doc = {"id": rid, "business_id": po["business_id"], "number": await next_no(b, "pr"), "po_id": po["id"], "po_number": po["number"],
           "supplier_name": po.get("supplier_name"), "outlet_id": po["outlet_id"], "lines": lines, "amount": amount, "collected": 0,
           "reason": data.get("reason"), "created_by": user["name"], "created_at": now_iso()}
    await db.purchase_returns.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/purchase-returns/{rid}/collect")
async def collect_preturn(rid: str, data: dict = Body(...), user=Depends(require(*MANAGERS))):
    r = await db.purchase_returns.find_one({"id": rid, "business_id": user["business_id"]}, {"_id": 0})
    amt = int(data.get("amount") or 0)
    if not r or amt <= 0 or amt > r["amount"] - r["collected"]:
        raise HTTPException(400, "Amount must be between 0 and what is still owed")
    await db.purchase_returns.update_one({"id": rid}, {"$inc": {"collected": amt}})
    await db.money_moves.insert_one({"id": uid("mm_"), "business_id": r["business_id"], "kind": "purchase_return_refund", "ref": r["number"], "party": r.get("supplier_name"),
                                     "method": data.get("method", "cash"), "amount": amt, "created_at": now_iso()})
    return {"ok": True}


# ---------------- Receivables & payables ----------------
@router.get("/payables")
async def payables(user=Depends(require(*MANAGERS))):
    b = await get_business(user["business_id"])
    t = today(b)
    pos = await db.purchase_orders.find({"business_id": b["id"], "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(5000)
    rows = [{"id": p["id"], "number": p["number"], "party": p.get("supplier_name"), "date": p["created_at"], "due_date": p.get("due_date"),
             "amount": p["received_value"], "paid": p["paid"], "balance": p["received_value"] - p["paid"],
             "overdue": bool(p.get("due_date") and p["due_date"] < t)} for p in pos if p["received_value"] - p["paid"] > 0]
    return sorted(rows, key=lambda r: r["due_date"] or "9")


@router.get("/receivables")
async def receivables(user=Depends(require(*MANAGERS))):
    b = await get_business(user["business_id"])
    now = datetime.now(timezone.utc)
    sales = await db.sales.find({"business_id": b["id"], "status": "completed", "amount_due": {"$gt": 0}}, {"_id": 0, "lines": 0}).to_list(5000)
    out = []
    for s in sales:
        age = (now - datetime.fromisoformat(s["created_at"].replace("Z", "+00:00"))).days
        out.append({"id": s["id"], "number": s["receipt_no"], "party": s.get("customer_name"), "date": s["created_at"], "amount": s["total"],
                    "paid": s["total"] - s["amount_due"], "balance": s["amount_due"], "age_days": age,
                    "bucket": "0-30" if age <= 30 else "31-60" if age <= 60 else "60+"})
    return out


@router.post("/sales/{sid}/pay")
async def pay_sale(sid: str, data: dict = Body(...), user=Depends(require(*MANAGERS))):
    s = await db.sales.find_one({"id": sid, "business_id": user["business_id"]}, {"_id": 0})
    amt = int(data.get("amount") or 0)
    if not s or amt <= 0 or amt > s["amount_due"]:
        raise HTTPException(400, "Amount must be between 0 and the amount due")
    await db.sales.update_one({"id": sid}, {"$inc": {"amount_due": -amt}, "$push": {"debt_payments": {"amount": amt, "method": data.get("method", "cash"), "at": now_iso()}}})
    await db.money_moves.insert_one({"id": uid("mm_"), "business_id": s["business_id"], "kind": "sale_payment", "ref": s["receipt_no"], "party": s.get("customer_name"),
                                     "method": data.get("method", "cash"), "amount": amt, "created_at": now_iso()})
    return {"ok": True}


# ---------------- Cash (back office) ----------------
@router.post("/cash")
async def add_cash(data: dict = Body(...), user=Depends(require(*MANAGERS))):
    amt = int(data.get("amount") or 0)
    if data.get("type") not in ("in", "out") or amt <= 0:
        raise HTTPException(400, "Choose in/out and a positive amount")
    doc = {"id": uid("cash_"), "business_id": user["business_id"], "outlet_id": data.get("outlet_id"), "shift_id": None, "type": data["type"],
           "category": data.get("category") or "Other", "method": data.get("method", "cash"), "amount": amt, "note": data.get("note"),
           "user_id": user["id"], "user_name": user["name"], "created_at": data.get("date") and f"{data['date']}T06:30:00+00:00" or now_iso()}
    await db.cash_entries.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------------- Stock: adjustments, takes, transfers ----------------
@router.get("/adjustments")
async def adjustments(user=Depends(require(*MANAGERS))):
    nm = await names(user["business_id"])
    rows = await db.stock_ledger.find({"business_id": user["business_id"], "ref_type": {"$regex": "^adjust"}}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    for r in rows:
        r["product_name"] = nm.get(r["product_id"], {}).get("name", "?")
        r["reason"] = r["ref_type"].split(":")[-1]
        r["value"] = r["qty"] * r["unit_cost"]
    return rows


@router.get("/stocktakes")
async def stocktakes(user=Depends(require(*MANAGERS))):
    return await db.stocktakes.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("/stocktakes")
async def post_stocktake(data: dict = Body(...), user=Depends(require(*MANAGERS))):
    bid = user["business_id"]
    b = await get_business(bid)
    nm = await names(bid)
    sid = uid("stk_")
    lines = []
    for c in data.get("counts", []):
        if c.get("counted") in (None, "") or c["product_id"] not in nm:
            continue
        lvl = await db.stock_levels.find_one({"business_id": bid, "outlet_id": data["outlet_id"], "product_id": c["product_id"]}) or {"qty": 0, "avg_cost": 0}
        diff = int(c["counted"]) - lvl["qty"]
        if diff:
            await move_stock(bid, data["outlet_id"], c["product_id"], diff, "stocktake", sid)
        lines.append({"product_id": c["product_id"], "name": nm[c["product_id"]]["name"], "system": lvl["qty"], "counted": int(c["counted"]),
                      "diff": diff, "value": diff * lvl["avg_cost"]})
    if not lines:
        raise HTTPException(400, "Enter at least one count")
    doc = {"id": sid, "business_id": bid, "number": await next_no(b, "st"), "outlet_id": data["outlet_id"], "lines": lines,
           "diff_value": sum(l["value"] for l in lines), "note": data.get("note"), "created_by": user["name"], "created_at": now_iso()}
    await db.stocktakes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/transfers")
async def transfers(user=Depends(require(*MANAGERS))):
    return await db.transfers.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@router.post("/transfers")
async def send_transfer(data: dict = Body(...), user=Depends(require(*MANAGERS))):
    bid = user["business_id"]
    b = await get_business(bid)
    src, dst = data.get("from_outlet_id"), data.get("to_outlet_id")
    if not src or not dst or src == dst:
        raise HTTPException(400, "Choose two different outlets")
    nm = await names(bid)
    tid = uid("trf_")
    lines, sent = [], []
    for l in data.get("lines", []):
        q = int(l.get("qty") or 0)
        if q <= 0 or l.get("product_id") not in nm:
            continue
        c = await move_stock(bid, src, l["product_id"], -q, "transfer_out", tid, strict=True)
        if c is None:
            for pid, qq in sent:
                await db.stock_levels.update_one({"business_id": bid, "outlet_id": src, "product_id": pid}, {"$inc": {"qty": qq}})
            await db.stock_ledger.delete_many({"ref_id": tid})
            raise HTTPException(409, f"Not enough {nm[l['product_id']]['name']} at the sending outlet")
        sent.append((l["product_id"], q))
        lines.append({"product_id": l["product_id"], "name": nm[l["product_id"]]["name"], "qty": q, "unit_cost": c})
    if not lines:
        raise HTTPException(400, "Add at least one item")
    doc = {"id": tid, "business_id": bid, "number": await next_no(b, "tr"), "from_outlet_id": src, "to_outlet_id": dst, "lines": lines,
           "status": "in_transit", "sent_by": user["name"], "created_at": now_iso()}
    await db.transfers.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/transfers/{tid}/receive")
async def receive_transfer(tid: str, user=Depends(require(*MANAGERS))):
    t = await db.transfers.find_one({"id": tid, "business_id": user["business_id"]}, {"_id": 0})
    if not t or t["status"] != "in_transit":
        raise HTTPException(400, "Transfer is not in transit")
    for l in t["lines"]:
        await move_stock(t["business_id"], t["to_outlet_id"], l["product_id"], l["qty"], "transfer_in", tid, cost=l["unit_cost"], note=t["number"])
    await db.transfers.update_one({"id": tid}, {"$set": {"status": "received", "received_by": user["name"], "received_at": now_iso()}})
    return {"ok": True}
