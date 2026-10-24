import os
from datetime import datetime, timezone, timedelta
from core import db, uid, now_iso, hash_pw, verify_pw
from sales import move_stock

SEED_KEY = "newdelight"
COLLS = ["outlets", "categories", "products", "rules", "vouchers", "customers", "tables", "suppliers", "stock_levels", "stock_ledger", "sales", "returns",
         "voids", "shifts", "cash_entries", "points_ledger", "open_orders", "kitchen_tickets", "purchases", "sync_ops", "units", "racks", "brands",
         "levels", "rewards", "cash_categories", "taxes", "charges", "roles", "purchase_orders", "purchase_returns", "transfers", "stocktakes",
         "money_moves", "counters"]

# Prices/costs below are SAMPLE placeholders (paise) for the owner to edit.
CATALOG = {
    "Bread & Buns": ("#D97706", "pcs", [("Sandwich bread", 4500), ("Milk bread", 4000), ("Burger buns (4 pcs)", 4000), ("Hot dog buns (4 pcs)", 4000),
                                          ("Dinner rolls (6 pcs)", 5000), ("Other bread varieties", 5000)]),
    "Cookies & Biscuits": ("#92400E", "pack", [("Butter cookies", 9000), ("Chocolate cookies", 10000), ("Coconut cookies", 8000), ("Cream biscuits", 6000),
                                                ("Other biscuits & cookies", 8000)]),
    "Puffs & Savouries": ("#B45309", "pcs", [("Vegetable puffs", 2000), ("Egg puffs", 2500), ("Chicken puffs", 3500), ("Other savouries", 3000)]),
    "Cakes & Pastries": ("#DB2777", "pcs", [("Basic sponge cake (500 g)", 25000), ("Cream cake (500 g)", 35000), ("Birthday cake (1 kg)", 80000),
                                             ("Pastries", 6000), ("Cupcakes", 4000), ("Cake fillings & decorations", 15000)]),
    "Other Brands": ("#2563EB", "pcs", [("[Other brand product]", 10000)]),
}


async def wipe(seed):
    b = await db.businesses.find_one({"seed": seed})
    if not b:
        return
    for c in COLLS:
        await db[c].delete_many({"business_id": b["id"]})
    await db.users.delete_many({"business_id": b["id"]})
    await db.businesses.delete_one({"id": b["id"]})


async def seed_all():
    owner_email = os.environ["ADMIN_EMAIL"].lower()
    owner_pw = os.environ["ADMIN_PASSWORD"]
    if await db.businesses.find_one({"seed": SEED_KEY}):
        u = await db.users.find_one({"email": owner_email})
        if u and (not u.get("password_hash") or not verify_pw(owner_pw, u["password_hash"])):
            await db.users.update_one({"email": owner_email}, {"$set": {"password_hash": hash_pw(owner_pw)}})
        return
    await wipe("poshub_demo")
    bid = uid("biz_")
    await db.businesses.insert_one({
        "id": bid, "seed": SEED_KEY, "name": "New Delight Food Products", "currency": "INR", "tz_offset_min": 330,
        "tax_inclusive": True, "service_bps": 0, "rounding_unit": 100, "restaurant_mode": False, "allow_price_edit": False,
        "loyalty": {"enabled": True, "earn_per": 10000, "min_subtotal": 0, "point_value": 100, "expiry_days": 365},
        "levels": ["Silver", "Gold"], "price_levels": ["retail", "wholesale"],
        "payment_methods": [{"code": "cash", "name": "Cash", "fee_bps": 0}, {"code": "upi", "name": "UPI", "fee_bps": 0}, {"code": "card", "name": "Card", "fee_bps": 200}],
        "prefixes": {"sale": "INV", "po": "PO", "pr": "PR", "tr": "TR", "st": "ST", "ret": "RET"},
        "receipt": {"header": "New Delight Food Products", "footer": "Thank you! Fresh from our own bakery.", "paper": "80", "show_logo": True},
        "receipt_footer": "Thank you! Fresh from our own bakery.",
        "notifications": {"low_stock": True, "shift_close": True, "large_void": True, "push": False},
        "subscription": {"plan": "Business", "status": "active", "expires_at": (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()},
        "created_at": now_iso()})
    fac, shop = uid("out_"), uid("out_")
    await db.outlets.insert_many([
        {"id": fac, "business_id": bid, "name": "Manufacturing Unit 1", "code": "MFG1", "type": "factory", "allow_negative_stock": False, "hide_out_of_stock": False, "shifts_enabled": False, "created_at": now_iso()},
        {"id": shop, "business_id": bid, "name": "Retail Shop 1", "code": "RS1", "type": "shop", "allow_negative_stock": False, "hide_out_of_stock": False, "created_at": now_iso()}])
    for name, email, pw, role, oid, pin, lim in [
        ("Letinsha Johnson", owner_email, owner_pw, "owner", None, "1111", 10000), ("Meera Manager", "manager@poshub.demo", "Manager@123", "manager", None, "9999", 5000),
        ("Priya Cashier", "cashier@poshub.demo", "Cashier@123", "cashier", shop, "1234", 1000), ("Arjun Waiter", "waiter@poshub.demo", "Waiter@123", "waiter", shop, "2222", 0),
        ("Kitchen Display", "kitchen@poshub.demo", "Kitchen@123", "kitchen", shop, None, 0)]:
        u = {"id": uid("usr_"), "business_id": bid, "email": email, "name": name, "role": role, "outlet_id": oid, "password_hash": hash_pw(pw),
             "discount_limit_bps": lim, "active": True, "created_at": now_iso()}
        if pin:
            u["pin_hash"] = hash_pw(pin)
        await db.users.insert_one(u)
    ins = lambda coll, rows: db[coll].insert_many([{"id": uid(coll[:3] + "_"), "business_id": bid, "created_at": now_iso(), **r} for r in rows])
    await ins("units", [{"name": n} for n in ("pcs", "kg", "pack", "box", "dozen")])
    await ins("brands", [{"name": "New Delight", "own": True}, {"name": "[Other brand]"}])
    await ins("racks", [{"name": "Bread shelf", "floor": "Ground", "room": "Shop front"}, {"name": "Cake chiller", "floor": "Ground", "room": "Shop front"},
                        {"name": "Finished goods store", "floor": "Ground", "room": "Factory"}])
    await ins("levels", [{"name": "Silver", "kind": "tiered", "min_points": 100}, {"name": "Gold", "kind": "tiered", "min_points": 500}, {"name": "Staff", "kind": "flat"}])
    await ins("rewards", [{"name": "Free cupcake", "kind": "custom", "points": 50, "description": "One cupcake of the day"},
                          {"name": "₹50 off", "kind": "discount", "type": "fixed", "value": 5000, "points": 50}])
    await ins("cash_categories", [{"name": n, "type": "in"} for n in ("Capital", "Refund received", "Other income")] +
              [{"name": n, "type": "out"} for n in ("Fuel", "Water", "Small repairs", "Packaging material", "Electricity")])
    await ins("taxes", [{"name": "GST 5%", "rate_bps": 500, "components": [{"name": "CGST", "rate_bps": 250}, {"name": "SGST", "rate_bps": 250}]},
                        {"name": "GST 18%", "rate_bps": 1800, "components": [{"name": "CGST", "rate_bps": 900}, {"name": "SGST", "rate_bps": 900}]}])
    await ins("charges", [{"name": "Packaging", "type": "fixed", "value": 1000, "taxable": False}, {"name": "Home delivery", "type": "fixed", "value": 4000, "taxable": False}])
    await ins("roles", [{"name": "Shop cashier", "base": "cashier", "permissions": ["pos", "sales.view", "customers", "shifts"]},
                        {"name": "Store keeper", "base": "manager", "permissions": ["catalog", "stock", "purchasing"]}])
    brands = {b["name"]: b["id"] for b in await db.brands.find({"business_id": bid}).to_list(10)}
    units = {u["name"]: u["id"] for u in await db.units.find({"business_id": bid}).to_list(10)}
    n = 0
    for cat, (color, unit, items) in CATALOG.items():
        cid = uid("cat_")
        await db.categories.insert_one({"id": cid, "business_id": bid, "name": cat, "color": color, "created_at": now_iso()})
        for name, price in items:
            n += 1
            pid = uid("prd_")
            own = cat != "Other Brands"
            await db.products.insert_one({"id": pid, "business_id": bid, "name": name, "sku": f"ND-{n:03d}", "barcode": f"89020{n:03d}", "category_id": cid,
                                          "brand_id": brands["New Delight" if own else "[Other brand]"], "unit_id": units[unit], "price": price,
                                          "level_prices": {"wholesale": price * 85 // 100}, "cost": price * 45 // 100, "tax_bps": 500, "track_stock": True,
                                          "low_stock": 10, "points": 0, "made_in_house": own, "created_at": now_iso()})
            if own:
                await move_stock(bid, fac, pid, 200, "adjust:production", "seed", cost=price * 45 // 100)
            await move_stock(bid, shop, pid, 30, "adjust:opening", "seed", cost=price * (45 if own else 70) // 100)
    for name, phone, level, ptype, cl in [("[Sample customer]", "+91 00000 00000", "Silver", "retail", 0), ("[Sample wholesale buyer]", "+91 00000 00001", None, "wholesale", 1000000)]:
        await db.customers.insert_one({"id": uid("cus_"), "business_id": bid, "name": name, "phone": phone, "level": level, "price_level": ptype,
                                       "credit_limit": cl, "store_credit": 0, "created_at": now_iso()})
    await db.suppliers.insert_many([{"id": uid("sup_"), "business_id": bid, "name": n, "phone": "", "terms_days": d, "created_at": now_iso()}
                                    for n, d in (("[Flour & raw material supplier]", 30), ("[Other brand distributor]", 15))])
