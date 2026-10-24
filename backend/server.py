from core import db, uid, now_iso, hash_pw, verify_pw, set_auth_cookies, public_user, get_user, require, get_business, MANAGERS, CURRENCIES, make_token
import os
import httpx
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends, Body
from starlette.middleware.cors import CORSMiddleware
from seed import seed_all
import sales
import reports
import backoffice

app = FastAPI(title="POSHub")
api = APIRouter(prefix="/api")


# ---------------- Auth ----------------
async def _start_business(name, currency="INR"):
    bid = uid("biz_")
    await db.businesses.insert_one({
        "id": bid, "name": name, "currency": currency if currency in CURRENCIES else "INR", "tz_offset_min": 330,
        "tax_inclusive": False, "service_bps": 0, "rounding_unit": 0, "restaurant_mode": False, "allow_price_edit": False,
        "loyalty": {"enabled": True, "earn_per": 10000, "min_subtotal": 0, "point_value": 100, "expiry_days": 365},
        "levels": ["Silver", "Gold"],
        "payment_methods": [{"code": "cash", "name": "Cash"}, {"code": "card", "name": "Card"}, {"code": "upi", "name": "UPI"}],
        "receipt_footer": "Thank you!", "subscription": {"plan": "Trial", "status": "trial",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()}, "created_at": now_iso()})
    await db.outlets.insert_one({"id": uid("out_"), "business_id": bid, "name": "Main Branch", "code": "MAIN",
                                 "allow_negative_stock": False, "hide_out_of_stock": False, "created_at": now_iso()})
    return bid


@api.post("/auth/register")
async def register(response: Response, data: dict = Body(...)):
    email = (data.get("email") or "").strip().lower()
    if not email or len(data.get("password") or "") < 6:
        raise HTTPException(400, "Email and a password of at least 6 characters are required")
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "This email is already registered")
    bid = await _start_business(data.get("business_name") or "My Shop", data.get("currency", "INR"))
    user = {"id": uid("usr_"), "business_id": bid, "email": email, "name": data.get("name") or email.split("@")[0],
            "role": "owner", "outlet_id": None, "password_hash": hash_pw(data["password"]), "discount_limit_bps": 10000,
            "active": True, "created_at": now_iso()}
    await db.users.insert_one(user)
    set_auth_cookies(response, user["id"])
    return public_user(user)


@api.post("/auth/login")
async def login(request: Request, response: Response, data: dict = Body(...)):
    email = (data.get("email") or "").strip().lower()
    ident = f"{(request.headers.get('x-forwarded-for') or '').split(',')[0].strip() or (request.client.host if request.client else 'x')}:{email}"
    att = await db.login_attempts.find_one({"identifier": ident})
    if att and att.get("count", 0) >= 5 and att.get("locked_until", "") > now_iso():
        raise HTTPException(429, "Too many failed attempts. Try again in 15 minutes.")
    user = await db.users.find_one({"email": email, "active": {"$ne": False}}, {"_id": 0})
    if not user or not user.get("password_hash") or not verify_pw(data.get("password") or "", user["password_hash"]):
        lock = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
        await db.login_attempts.update_one({"identifier": ident}, {"$inc": {"count": 1}, "$set": {"locked_until": lock}}, upsert=True)
        raise HTTPException(401, "Invalid email or password")
    await db.login_attempts.delete_many({"identifier": ident})
    set_auth_cookies(response, user["id"])
    return public_user(user)


@api.post("/auth/google/session")
async def google_session(response: Response, data: dict = Body(...)):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get("https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                        headers={"X-Session-ID": data.get("session_id", "")})
    if r.status_code != 200:
        raise HTTPException(401, "Google sign-in failed")
    info = r.json()
    email = info["email"].lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user and user.get("active") is False:
        raise HTTPException(403, "This account is disabled")
    if not user:
        bid = await _start_business(f"{info.get('name') or 'My'}'s Shop")
        user = {"id": uid("usr_"), "business_id": bid, "email": email, "name": info.get("name") or email,
                "picture": info.get("picture"), "role": "owner", "outlet_id": None, "discount_limit_bps": 10000,
                "active": True, "created_at": now_iso()}
        await db.users.insert_one(user)
        user.pop("_id", None)
    set_auth_cookies(response, user["id"])
    return public_user(user)


@api.post("/auth/refresh")
async def refresh(request: Request, response: Response):
    tok = request.cookies.get("refresh_token")
    if not tok:
        raise HTTPException(401, "No refresh token")
    try:
        p = jwt.decode(tok, os.environ["JWT_SECRET"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid refresh token")
    if p.get("type") != "refresh" or not await db.users.find_one({"id": p["sub"], "active": {"$ne": False}}):
        raise HTTPException(401, "Invalid refresh token")
    response.set_cookie("access_token", make_token(p["sub"], "access"), httponly=True, secure=True, samesite="none", max_age=900, path="/")
    return {"ok": True}


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/", secure=True, samesite="none")
    response.delete_cookie("refresh_token", path="/", secure=True, samesite="none")
    return {"ok": True}


@api.get("/auth/me")
async def me(user=Depends(get_user)):
    return {"user": public_user(user), "business": await get_business(user["business_id"])}


async def _find_by_pin(bid, pin):
    async for u in db.users.find({"business_id": bid, "active": {"$ne": False}, "pin_hash": {"$exists": True}}, {"_id": 0}):
        if verify_pw(pin, u["pin_hash"]):
            return u
    return None


@api.post("/auth/pin")
async def pin_switch(response: Response, data: dict = Body(...), user=Depends(get_user)):
    u = await _find_by_pin(user["business_id"], str(data.get("pin", "")))
    if not u:
        raise HTTPException(401, "Wrong PIN")
    set_auth_cookies(response, u["id"])
    return public_user(u)


@api.post("/auth/supervisor")
async def supervisor(data: dict = Body(...), user=Depends(get_user)):
    u = await _find_by_pin(user["business_id"], str(data.get("pin", "")))
    if not u or u["role"] not in MANAGERS:
        raise HTTPException(401, "Supervisor PIN not recognised")
    token = jwt.encode({"sub": u["id"], "bid": user["business_id"], "type": "approval", "for": user["id"],
                        "exp": datetime.now(timezone.utc) + timedelta(hours=24)}, os.environ["JWT_SECRET"], algorithm="HS256")
    return {"ok": True, "supervisor_id": u["id"], "name": u["name"], "approval": token}


# ---------------- Business settings ----------------
BUSINESS_FIELDS = ("name", "currency", "tz_offset_min", "tax_inclusive", "service_bps", "rounding_unit", "restaurant_mode",
                   "allow_price_edit", "loyalty", "payment_methods", "receipt_footer", "levels", "prefixes", "notifications", "realtime", "receipt", "price_levels")


@api.put("/business")
async def update_business(data: dict = Body(...), user=Depends(require("owner"))):
    upd = {k: v for k, v in data.items() if k in BUSINESS_FIELDS}
    if "currency" in upd and upd["currency"] not in CURRENCIES:
        raise HTTPException(400, "Unsupported currency")
    await db.businesses.update_one({"id": user["business_id"]}, {"$set": upd})
    return await get_business(user["business_id"])


# ---------------- Generic scoped CRUD ----------------
def crud(name, coll, prefix, write_roles=MANAGERS, sort="name"):
    @api.get(f"/{name}", name=f"list_{name}")
    async def _list(user=Depends(get_user)):
        return await db[coll].find({"business_id": user["business_id"], "archived": {"$ne": True}}, {"_id": 0}).sort(sort, 1).to_list(5000)

    @api.post(f"/{name}", name=f"create_{name}")
    async def _create(data: dict = Body(...), user=Depends(require(*write_roles))):
        doc = {k: v for k, v in data.items() if k not in ("id", "business_id", "_id")}
        doc.update({"id": uid(prefix), "business_id": user["business_id"], "created_at": now_iso()})
        await db[coll].insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.put(f"/{name}/{{item_id}}", name=f"update_{name}")
    async def _update(item_id: str, data: dict = Body(...), user=Depends(require(*write_roles))):
        upd = {k: v for k, v in data.items() if k not in ("id", "business_id", "_id", "created_at", "archived", "used")}
        r = await db[coll].find_one_and_update({"id": item_id, "business_id": user["business_id"]}, {"$set": upd},
                                               projection={"_id": 0}, return_document=True)
        if not r:
            raise HTTPException(404, "Not found")
        return r

    @api.delete(f"/{name}/{{item_id}}", name=f"delete_{name}")
    async def _delete(item_id: str, user=Depends(require(*write_roles))):
        await db[coll].update_one({"id": item_id, "business_id": user["business_id"]}, {"$set": {"archived": True}})
        return {"ok": True}


crud("outlets", "outlets", "out_", ("owner",))
crud("categories", "categories", "cat_")
crud("tables", "tables", "tbl_")
crud("suppliers", "suppliers", "sup_")
crud("rules", "rules", "rule_", sort="created_at")
crud("vouchers", "vouchers", "vch_", sort="code")
crud("customers", "customers", "cus_", ("owner", "manager", "cashier", "waiter"))
for _n in ("units", "racks", "brands", "levels", "rewards", "cash_categories", "taxes", "charges"):
    crud(_n.replace("_", "-"), _n, _n[:3] + "_")
crud("roles", "roles", "rol_", ("owner",))


# ---------------- Products ----------------
PRODUCT_FIELDS = ("name", "sku", "barcode", "category_id", "price", "cost", "tax_bps", "image", "station", "track_stock", "low_stock", "points",
                  "brand_id", "unit_id", "rack_id", "level_prices", "made_in_house")


def _product_data(data):
    d = {k: data[k] for k in PRODUCT_FIELDS if k in data}
    for k in ("price", "cost", "tax_bps", "low_stock", "points"):
        if k in d:
            d[k] = int(d[k] or 0)
    return d


@api.get("/products")
async def list_products(user=Depends(get_user)):
    prods = await db.products.find({"business_id": user["business_id"], "archived": {"$ne": True}}, {"_id": 0}).sort("name", 1).to_list(10000)
    if user["role"] not in MANAGERS:
        for p in prods:
            p.pop("cost", None)
    return prods


@api.post("/products")
async def create_product(data: dict = Body(...), user=Depends(require(*MANAGERS))):
    d = _product_data(data)
    if not d.get("name") or d.get("price", -1) < 0:
        raise HTTPException(400, "Name and price are required")
    d.update({"id": uid("prd_"), "business_id": user["business_id"], "created_at": now_iso(), "track_stock": d.get("track_stock", True)})
    await db.products.insert_one(d)
    d.pop("_id", None)
    return d


@api.put("/products/{pid}")
async def update_product(pid: str, data: dict = Body(...), user=Depends(require(*MANAGERS))):
    r = await db.products.find_one_and_update({"id": pid, "business_id": user["business_id"]}, {"$set": _product_data(data)},
                                              projection={"_id": 0}, return_document=True)
    if not r:
        raise HTTPException(404, "Product not found")
    return r


@api.delete("/products/{pid}")
async def delete_product(pid: str, user=Depends(require(*MANAGERS))):
    await db.products.update_one({"id": pid, "business_id": user["business_id"]}, {"$set": {"archived": True}})
    return {"ok": True}


# ---------------- Staff ----------------
@api.get("/staff")
async def list_staff(user=Depends(require(*MANAGERS))):
    us = await db.users.find({"business_id": user["business_id"]}, {"_id": 0}).sort("name", 1).to_list(1000)
    return [public_user(u) for u in us]


async def _pin_taken(bid, pin, exclude=None):
    u = await _find_by_pin(bid, pin)
    return u is not None and u["id"] != exclude


@api.post("/staff")
async def create_staff(data: dict = Body(...), user=Depends(require(*MANAGERS))):
    email = (data.get("email") or "").strip().lower()
    if not email or not data.get("name"):
        raise HTTPException(400, "Name and email are required")
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email already in use")
    role = data.get("role", "cashier")
    if role not in ("manager", "cashier", "waiter", "kitchen") or (user["role"] == "manager" and role == "manager"):
        raise HTTPException(403, "You cannot create this role")
    doc = {"id": uid("usr_"), "business_id": user["business_id"], "email": email, "name": data["name"], "role": role,
           "outlet_id": data.get("outlet_id") or None, "discount_limit_bps": int(data.get("discount_limit_bps") or 0), "role_id": data.get("role_id"),
           "active": True, "created_at": now_iso()}
    if data.get("password"):
        doc["password_hash"] = hash_pw(data["password"])
    if data.get("pin"):
        if await _pin_taken(user["business_id"], str(data["pin"])):
            raise HTTPException(400, "This PIN is already used by someone else")
        doc["pin_hash"] = hash_pw(str(data["pin"]))
    await db.users.insert_one(doc)
    return public_user(doc)


@api.put("/staff/{sid}")
async def update_staff(sid: str, data: dict = Body(...), user=Depends(require(*MANAGERS))):
    target = await db.users.find_one({"id": sid, "business_id": user["business_id"]}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Staff not found")
    if target["role"] == "owner" and user["role"] != "owner":
        raise HTTPException(403, "Only the owner can edit the owner")
    upd = {k: data[k] for k in ("name", "role", "outlet_id", "discount_limit_bps", "active", "role_id") if k in data}
    if "role" in upd and upd["role"] != target["role"] and (target["role"] == "owner" or upd["role"] == "owner"):
        raise HTTPException(403, "Owner role cannot be changed")
    if data.get("password"):
        upd["password_hash"] = hash_pw(data["password"])
    if data.get("pin"):
        if await _pin_taken(user["business_id"], str(data["pin"]), sid):
            raise HTTPException(400, "This PIN is already used by someone else")
        upd["pin_hash"] = hash_pw(str(data["pin"]))
    await db.users.update_one({"id": sid}, {"$set": upd})
    return public_user(await db.users.find_one({"id": sid}, {"_id": 0}))


# ---------------- Vouchers ----------------
@api.get("/vouchers/validate")
async def validate_voucher(code: str, outlet_id: str, subtotal: int = 0, customer_id: str = None, user=Depends(get_user)):
    v = await db.vouchers.find_one({"business_id": user["business_id"], "code": code.strip().upper(), "archived": {"$ne": True}}, {"_id": 0})
    b = await get_business(user["business_id"])
    today = (datetime.now(timezone.utc) + timedelta(minutes=b.get("tz_offset_min", 0))).strftime("%Y-%m-%d")
    reason = sales.voucher_reason(v, outlet_id, customer_id, today)
    if reason:
        return {"ok": False, "reason": reason}
    if subtotal < (v.get("min_spend") or 0):
        return {"ok": False, "reason": "Minimum spend not reached", "min_spend": v.get("min_spend")}
    return {"ok": True, "voucher": v}


# ---------------- Customers detail ----------------
@api.get("/customers/{cid}/detail")
async def customer_detail(cid: str, user=Depends(get_user)):
    bid = user["business_id"]
    c = await db.customers.find_one({"id": cid, "business_id": bid}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Customer not found")
    ledger = await db.points_ledger.find({"business_id": bid, "customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    sl = await db.sales.find({"business_id": bid, "customer_id": cid}, {"_id": 0, "lines": 0}).sort("created_at", -1).to_list(200)
    rets = await db.returns.find({"business_id": bid, "customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"customer": c, "points_ledger": ledger, "sales": sl, "returns": rets,
            "receivable": sum(s.get("amount_due", 0) for s in sl if s.get("status") != "voided"),
            "points_balance": sum(x["points"] for x in ledger),
            "points_redeemed": -sum(x["points"] for x in ledger if x["type"] == "redeemed"),
            "transaction_count": len([s for s in sl if s.get("status") != "voided"])}


@api.post("/customers/{cid}/points")
async def adjust_points(cid: str, data: dict = Body(...), user=Depends(require(*MANAGERS))):
    if not await db.customers.find_one({"id": cid, "business_id": user["business_id"]}):
        raise HTTPException(404, "Customer not found")
    await db.points_ledger.insert_one({"id": uid("pts_"), "business_id": user["business_id"], "customer_id": cid, "type": "adjusted",
                                       "points": int(data.get("points", 0)), "note": data.get("note"), "created_at": now_iso()})
    return {"ok": True}


@api.get("/")
async def root():
    return {"app": "POSHub", "ok": True}


api.include_router(sales.router)
api.include_router(reports.router)
api.include_router(backoffice.router)
app.include_router(api)

app.add_middleware(CORSMiddleware, allow_origins=[os.environ["FRONTEND_URL"]], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.sales.create_index([("business_id", 1), ("client_id", 1)], unique=True)
    await db.sales.create_index([("business_id", 1), ("receipt_no", 1)], unique=True)
    await db.stock_levels.create_index([("business_id", 1), ("outlet_id", 1), ("product_id", 1)], unique=True)
    await db.stock_ledger.create_index([("business_id", 1), ("created_at", -1)])
    await db.points_ledger.create_index([("business_id", 1), ("customer_id", 1)])
    await db.sync_ops.create_index([("business_id", 1), ("client_id", 1)], unique=True)
    await seed_all()
