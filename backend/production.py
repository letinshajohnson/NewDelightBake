import os
import re
import json
from fastapi import APIRouter, Body, Depends, HTTPException
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
from core import db, uid, now_iso, require, get_business, MANAGERS
from sales import move_stock
from backoffice import next_no

router = APIRouter()


@router.post("/production")
async def produce(data: dict = Body(...), user=Depends(require(*MANAGERS))):
    bid = user["business_id"]
    p = await db.products.find_one({"id": data.get("product_id"), "business_id": bid}, {"_id": 0})
    batches, made = int(data.get("batches") or 0), int(data.get("produced_qty") or 0)
    if not data.get("outlet_id") or not await db.outlets.find_one({"id": data["outlet_id"], "business_id": bid}):
        raise HTTPException(400, "Choose the outlet / unit")
    if not p or not p.get("recipe") or p.get("is_kit") or batches <= 0 or made <= 0:
        raise HTTPException(400, "Pick a product with a recipe, batches and quantity produced")
    rid = uid("prod_")
    ts = f"{data['date']}T06:30:00+00:00" if data.get("date") else now_iso()
    used, cost = [], 0
    for it in p["recipe"]:
        q = int(it["qty"]) * batches
        c = await move_stock(bid, data["outlet_id"], it["product_id"], -q, "production_use", rid, note=p["name"], ts=ts)
        used.append({"product_id": it["product_id"], "name": it.get("name"), "qty": q, "cost": c * q})
        cost += c * q
    await move_stock(bid, data["outlet_id"], p["id"], made, "production", rid, cost=cost // made, note=f"{batches} batch(es)", ts=ts)
    doc = {"id": rid, "business_id": bid, "product_id": p["id"], "product_name": p["name"], "outlet_id": data["outlet_id"], "batches": batches,
           "expected_qty": batches * int(p.get("batch_yield") or made), "produced_qty": made, "materials": used, "material_cost": cost,
           "unit_cost": cost // made, "date": ts[:10], "note": data.get("note"), "by": user["name"], "created_at": ts}
    await db.production.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/production")
async def runs(user=Depends(require(*MANAGERS))):
    bid = user["business_id"]
    rows = await db.production.find({"business_id": bid}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    sold, ret = {}, {}
    async for s in db.sales.find({"business_id": bid, "status": "completed"}, {"lines": 1, "created_at": 1}):
        for l in s["lines"]:
            sold[(l["product_id"], s["created_at"][:10])] = sold.get((l["product_id"], s["created_at"][:10]), 0) + l["qty"]
    async for r in db.returns.find({"business_id": bid}, {"lines": 1, "created_at": 1}):
        for l in r["lines"]:
            ret[(l["product_id"], r["created_at"][:10])] = ret.get((l["product_id"], r["created_at"][:10]), 0) + l["qty"]
    for r in rows:
        r["sold_same_day"] = sold.get((r["product_id"], r["date"]), 0)
        r["returned_same_day"] = ret.get((r["product_id"], r["date"]), 0)
        r["materials_text"] = ", ".join(f"{m['name']} {m['qty']}" for m in r["materials"])
    return rows


async def _find_or_make(bid, coll, name, extra=None):
    d = await db[coll].find_one({"business_id": bid, "name": {"$regex": f"^{re.escape(name.strip())}$", "$options": "i"}}, {"_id": 0})
    if d:
        return d
    d = {"id": uid(coll[:3] + "_"), "business_id": bid, "name": name.strip(), "created_at": now_iso(), **(extra or {})}
    await db[coll].insert_one(d)
    d.pop("_id", None)
    return d


def money(v):
    s = str(v or "0").replace(",", "").strip()
    i, _, f = s.partition(".")
    return int(i or 0) * 100 + int((f + "00")[:2] or 0)


NUMS = ("qty", "rate", "mrp", "gst", "price", "cost", "amount", "terms_days")


def _clean(rows):
    out = []
    for i, r in enumerate(rows, start=2):
        r = {k.strip().lower(): (v or "").strip() if isinstance(v, str) else ("" if v is None else str(v)) for k, v in r.items()}
        for k in NUMS:
            if r.get(k):
                r[k] = r[k].replace(",", "").replace("%", "").replace("₹", "").strip()
                try:
                    float(r[k])
                except ValueError:
                    raise HTTPException(400, f"Row {i}: {k} must be a number (got {r[k]})")
        for k in ("date", "due_date"):
            if r.get(k) and not re.match(r"^\d{4}-\d{2}-\d{2}$", r[k]):
                raise HTTPException(400, f"Row {i}: {k} must be YYYY-MM-DD (got {r[k]})")
        out.append(r)
    return out


@router.post("/import/{kind}")
async def import_rows(kind: str, data: dict = Body(...), user=Depends(require(*MANAGERS))):
    bid = user["business_id"]
    rows = _clean(data.get("rows", []))
    n = 0
    if kind in ("customers", "suppliers"):
        for r in rows:
            if r.get("name"):
                await db[kind].insert_one({"id": uid(kind[:3] + "_"), "business_id": bid, "name": r["name"], "phone": r.get("phone"), "gstin": r.get("gstin") or None,
                                           "type": r.get("type") or ("supplier" if kind == "suppliers" else None), "terms_days": int(float(r.get("terms_days") or 0)), "created_at": now_iso()})
                n += 1
    elif kind == "products":
        for r in rows:
            if not r.get("name"):
                continue
            cat = await _find_or_make(bid, "categories", r.get("category") or "Imported")
            unit = await _find_or_make(bid, "units", r["unit"]) if r.get("unit") else None
            await db.products.insert_one({"id": uid("prd_"), "business_id": bid, "name": r["name"], "sku": r.get("sku"), "barcode": r.get("barcode"), "hsn": r.get("hsn"),
                                          "category_id": cat["id"], "price": money(r.get("price")), "cost": money(r.get("cost")), "tax_bps": int(float(r.get("gst") or 0) * 100),
                                          "unit_id": unit and unit["id"], "is_raw": str(r.get("raw_material") or "").lower() in ("yes", "y", "1", "true"),
                                          "track_stock": True, "low_stock": 5, "created_at": now_iso()})
            n += 1
    elif kind == "expenses":
        for r in rows:
            amt = money(r.get("amount"))
            if amt <= 0:
                continue
            await db.cash_entries.insert_one({"id": uid("cash_"), "business_id": bid, "outlet_id": data.get("outlet_id") or None, "shift_id": None, "type": "out",
                                              "category": r.get("category") or "Other", "method": r.get("method") or "cash", "amount": amt, "note": r.get("note"),
                                              "user_id": user["id"], "user_name": user["name"], "created_at": f"{r['date']}T06:30:00+00:00" if r.get("date") else now_iso()})
            n += 1
    elif kind == "purchase":
        b = await get_business(bid)
        outlet = data.get("outlet_id")
        if not outlet or not await db.outlets.find_one({"id": outlet, "business_id": bid}):
            raise HTTPException(400, "Choose the outlet that receives the stock")
        groups = {}
        for r in rows:
            if r.get("item") and r.get("invoice_no"):
                groups.setdefault((r.get("supplier") or "Unknown supplier", r["invoice_no"]), []).append(r)
        for (sname, inv), items in groups.items():
            sup = await _find_or_make(bid, "suppliers", sname, {"gstin": items[0].get("supplier_gstin") or None, "type": "supplier"})
            if items[0].get("supplier_gstin") and not sup.get("gstin"):
                await db.suppliers.update_one({"id": sup["id"]}, {"$set": {"gstin": items[0]["supplier_gstin"]}})
            brand = await _find_or_make(bid, "brands", "[Other brand]")
            cat = await _find_or_make(bid, "categories", "Other Brands")
            lines = []
            for r in items:
                gst = int(float(r.get("gst") or 0) * 100)
                price = money(r.get("mrp")) or money(r.get("rate")) * (10000 + gst) // 10000
                p = await _match_product(bid, r) or await _find_or_make(bid, "products", r["item"], {"category_id": cat["id"], "brand_id": brand["id"], "hsn": r.get("hsn"), "price": price,
                                                                     "sku": r.get("sku") or None, "barcode": r.get("barcode") or None,
                                                                     "cost": money(r.get("rate")), "tax_bps": gst, "track_stock": True, "low_stock": 5})
                q = int(float(r.get("qty") or 0))
                await move_stock(bid, outlet, p["id"], q, "purchase", inv, cost=money(r.get("rate")), note=f"{sname} {inv}")
                lines.append({"product_id": p["id"], "name": p["name"], "qty": q, "cost": money(r.get("rate")), "received": q, "hsn": r.get("hsn"), "gst_bps": int(float(r.get("gst") or 0) * 100)})
            total = sum(l["qty"] * l["cost"] for l in lines)
            tax = sum(l["qty"] * l["cost"] * l["gst_bps"] // 10000 for l in lines)
            await db.purchase_orders.insert_one({"id": uid("po_"), "business_id": bid, "number": await next_no(b, "po"), "supplier_invoice": inv, "outlet_id": outlet,
                                                 "supplier_id": sup["id"], "supplier_name": sup["name"], "lines": lines, "total": total + tax, "tax": tax, "received_value": total + tax,
                                                 "paid": 0, "payments": [], "due_date": items[0].get("due_date") or None, "status": "received", "created_by": user["name"],
                                                 "created_at": f"{items[0]['date']}T06:30:00+00:00" if items[0].get("date") else now_iso()})
            n += 1
    elif kind == "stock":
        outlet = data.get("outlet_id")
        if not outlet or not await db.outlets.find_one({"id": outlet, "business_id": bid}):
            raise HTTPException(400, "Choose the outlet for this stock")
        for i, r in enumerate(rows, start=2):
            p = await _match_product(bid, {**r, "item": r.get("product")})
            if not p:
                raise HTTPException(400, f"Row {i}: product '{r.get('product')}' not found")
            q = int(float(r.get("qty") or 0))
            if q:
                await move_stock(bid, outlet, p["id"], q, "adjustment", uid("imp_"), cost=money(r.get("cost")) or None, note="Opening stock import")
                n += 1
    elif kind == "recipes":
        found = {}
        for i, r in enumerate(rows, start=2):
            p = await _match_product(bid, {"item": r.get("product")})
            m = await _match_product(bid, {"item": r.get("raw_material")})
            if not p or not m:
                raise HTTPException(400, f"Row {i}: '{r.get('product') if not p else r.get('raw_material')}' not found in products")
            e = found.setdefault(p["id"], {"recipe": [], "batch_yield": int(float(r.get("pieces_per_batch") or 1))})
            e["recipe"].append({"product_id": m["id"], "name": m["name"], "qty": int(float(r.get("qty_per_batch") or 0))})
        for pid, e in found.items():
            await db.products.update_one({"id": pid}, {"$set": {**e, "made_in_house": True}})
            n += 1
    else:
        raise HTTPException(404, "Unknown import type")
    return {"ok": True, "imported": n}


async def _match_product(bid: str, r: dict) -> dict | None:
    for k in ("barcode", "sku"):
        if r.get(k):
            p = await db.products.find_one({"business_id": bid, k: r[k], "archived": {"$ne": True}}, {"_id": 0})
            if p:
                return p
    if r.get("item"):
        return await db.products.find_one({"business_id": bid, "archived": {"$ne": True}, "name": {"$regex": f"^{re.escape(r['item'].strip())}$", "$options": "i"}}, {"_id": 0})
    return None


SCAN_PROMPT = """You read Indian GST purchase invoices (tax invoices) from photos. Reply with JSON only, no prose:
{"supplier": str, "supplier_gstin": str, "invoice_no": str, "date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD" or "",
 "items": [{"item": str, "hsn": str, "qty": number, "rate": number, "mrp": number, "gst": number}], "net_total": number}
Rules: supplier is the seller (not the buyer). qty = billed qty + free qty. rate = the line's taxable amount (after discounts, before GST) divided by qty.
gst = total GST percent for the line (CGST+SGST or IGST, e.g. 5). mrp = 0 if not printed. net_total = final amount payable. Use "" for unreadable text."""


@router.post("/purchase-bills/scan")
async def scan_bill(data: dict = Body(...), user=Depends(require(*MANAGERS))):
    img = (data.get("image_base64") or "").split(",")[-1]
    if len(img) < 100:
        raise HTTPException(400, "Attach a photo of the bill")
    chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=uid("scan_"), system_message=SCAN_PROMPT).with_model("gemini", "gemini-3.1-pro-preview")
    try:
        txt = await chat.send_message(UserMessage(text="Read this purchase bill.", file_contents=[ImageContent(image_base64=img)]))
        bill = json.loads(re.search(r"\{.*\}", txt, re.S).group(0))
    except Exception:
        raise HTTPException(502, "Could not read this bill. Try a clearer, straight photo.")
    head = {k: str(bill.get(k) or "") for k in ("supplier", "supplier_gstin", "invoice_no", "date", "due_date")}
    items = [{"item": str(i.get("item") or ""), "hsn": str(i.get("hsn") or ""), "qty": str(i.get("qty") or 0), "rate": f"{float(i.get('rate') or 0):.2f}",
              "mrp": f"{float(i.get('mrp') or 0):.2f}", "gst": str(i.get("gst") or 0)} for i in bill.get("items") or []]
    return {**head, "items": items, "net_total": bill.get("net_total")}
