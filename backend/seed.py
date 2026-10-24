import os
from datetime import datetime, timezone, timedelta
from core import db, uid, now_iso, hash_pw, verify_pw
from sales import move_stock

SEED_KEY = "poshub_demo"


async def seed_all():
    owner_email = os.environ["ADMIN_EMAIL"].lower()
    owner_pw = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": owner_email})
    if existing:
        if not existing.get("password_hash") or not verify_pw(owner_pw, existing["password_hash"]):
            await db.users.update_one({"email": owner_email}, {"$set": {"password_hash": hash_pw(owner_pw)}})
        return
    if await db.businesses.find_one({"seed": SEED_KEY}):
        return
    bid = uid("biz_")
    await db.businesses.insert_one({
        "id": bid, "seed": SEED_KEY, "name": "Chai & Co. Café", "currency": "INR", "tz_offset_min": 330,
        "tax_inclusive": False, "service_bps": 0, "rounding_unit": 100, "restaurant_mode": True, "allow_price_edit": False,
        "loyalty": {"enabled": True, "earn_per": 10000, "min_subtotal": 0, "point_value": 100, "expiry_days": 365},
        "levels": ["Silver", "Gold", "Platinum"],
        "payment_methods": [{"code": "cash", "name": "Cash"}, {"code": "card", "name": "Card"}, {"code": "upi", "name": "UPI"}],
        "receipt_footer": "Thank you for visiting Chai & Co.!",
        "subscription": {"plan": "Growth", "status": "active", "expires_at": (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()},
        "created_at": now_iso()})
    o1, o2 = uid("out_"), uid("out_")
    await db.outlets.insert_many([
        {"id": o1, "business_id": bid, "name": "MG Road", "code": "MGR", "allow_negative_stock": False, "hide_out_of_stock": False, "created_at": now_iso()},
        {"id": o2, "business_id": bid, "name": "Indiranagar", "code": "IND", "allow_negative_stock": True, "hide_out_of_stock": False, "created_at": now_iso()}])
    users = [
        ("Letinsha Johnson", owner_email, owner_pw, "owner", None, "1111", 10000),
        ("Meera Manager", "manager@poshub.demo", "Manager@123", "manager", o1, "9999", 5000),
        ("Priya Cashier", "cashier@poshub.demo", "Cashier@123", "cashier", o1, "1234", 1000),
        ("Arjun Waiter", "waiter@poshub.demo", "Waiter@123", "waiter", o1, "2222", 0),
        ("Kitchen Display", "kitchen@poshub.demo", "Kitchen@123", "kitchen", o1, None, 0)]
    for name, email, pw, role, oid, pin, lim in users:
        u = {"id": uid("usr_"), "business_id": bid, "email": email, "name": name, "role": role, "outlet_id": oid,
             "password_hash": hash_pw(pw), "discount_limit_bps": lim, "active": True, "created_at": now_iso()}
        if pin:
            u["pin_hash"] = hash_pw(pin)
        await db.users.insert_one(u)
    cats = {n: uid("cat_") for n in ("Coffee", "Tea", "Bakery", "Retail")}
    await db.categories.insert_many([{"id": i, "business_id": bid, "name": n, "created_at": now_iso()} for n, i in cats.items()])
    P = [("Espresso", "Coffee", 12000, 3500, "espresso", "bar", 500, "8901001"), ("Cappuccino", "Coffee", 18000, 5500, "cappuccino", "bar", 500, "8901002"),
         ("Café Latte", "Coffee", 19000, 6000, "latte", "bar", 500, "8901003"), ("Flat White", "Coffee", 20000, 6500, "flatwhite", "bar", 500, "8901004"),
         ("Mocha", "Coffee", 22000, 7500, "mocha", "bar", 500, "8901005"), ("Masala Chai", "Tea", 8000, 2000, "masala-chai", "bar", 500, "8901006"),
         ("Kulhad Chai", "Tea", 9000, 2500, "kulhad-chai", "bar", 500, "8901007"), ("Butter Croissant", "Bakery", 15000, 6000, "croissant", "kitchen", 500, "8901008"),
         ("Croissant Sandwich", "Bakery", 26000, 11000, "croissant-sandwich", "kitchen", 500, "8901009"),
         ("Pain au Chocolat", "Bakery", 17000, 7000, "pain-chocolat", "kitchen", 500, "8901010"), ("Veg Croissant Melt", "Bakery", 24000, 10000, "veg-melt", "kitchen", 500, "8901011"),
         ("Coffee Beans 250g", "Retail", 65000, 38000, None, None, 0, "8901012")]
    pids = {}
    for name, cat, price, cost, img, station, tax, bc in P:
        pid = uid("prd_")
        pids[name] = pid
        await db.products.insert_one({"id": pid, "business_id": bid, "name": name, "sku": f"SKU-{bc[-3:]}", "barcode": bc,
                                      "category_id": cats[cat], "price": price, "cost": cost, "tax_bps": tax if tax else 1800,
                                      "image": f"/img/{img}.jpg" if img else None, "station": station, "track_stock": True,
                                      "low_stock": 10, "points": 5 if cat == "Retail" else 0, "created_at": now_iso()})
        for oid, qty in ((o1, 60), (o2, 40)):
            await move_stock(bid, oid, pid, 8 if name == "Pain au Chocolat" and oid == o1 else qty, "adjust:opening", "seed", cost=cost)
    await db.products.insert_one({"id": uid("prd_"), "business_id": bid, "name": "Gift Wrapping", "sku": "SVC-001", "barcode": "8901099",
                                  "category_id": cats["Retail"], "price": 5000, "cost": 0, "tax_bps": 1800, "image": None,
                                  "track_stock": False, "created_at": now_iso()})
    await db.rules.insert_many([
        {"id": uid("rule_"), "business_id": bid, "kind": "product_auto", "name": "Chai Happy Hour 20%", "type": "percent", "value": 2000,
         "max_amount": 0, "target": "category", "target_ids": [cats["Tea"]], "time_start": "16:00", "time_end": "19:00", "audience": "all", "active": True, "created_at": now_iso()},
        {"id": uid("rule_"), "business_id": bid, "kind": "product_auto", "name": "Buy 3 coffees, ₹30 off each 3", "type": "fixed", "value": 3000,
         "repeat": True, "min_qty": 3, "target": "category", "target_ids": [cats["Coffee"]], "audience": "all", "active": True, "created_at": now_iso()},
        {"id": uid("rule_"), "business_id": bid, "kind": "product_auto", "name": "Members: 10% off beans", "type": "percent", "value": 1000,
         "max_amount": 10000, "target": "products", "target_ids": [pids["Coffee Beans 250g"]], "audience": "members", "active": True, "created_at": now_iso()},
        {"id": uid("rule_"), "business_id": bid, "kind": "subtotal_auto", "name": "₹50 off every ₹1,000", "type": "fixed", "value": 5000,
         "threshold": 100000, "repeat": True, "audience": "all", "active": True, "created_at": now_iso()},
        {"id": uid("rule_"), "business_id": bid, "kind": "cashier", "name": "Staff meal 10%", "type": "percent", "value": 1000, "active": True, "created_at": now_iso()},
        {"id": uid("rule_"), "business_id": bid, "kind": "cashier", "name": "Complaint ₹50", "type": "fixed", "value": 5000, "active": True, "created_at": now_iso()},
        {"id": uid("rule_"), "business_id": bid, "kind": "cashier", "name": "Manager 25%", "type": "percent", "value": 2500, "active": True, "created_at": now_iso()}])
    await db.vouchers.insert_many([
        {"id": uid("vch_"), "business_id": bid, "code": "WELCOME10", "type": "percent", "value": 1000, "max_amount": 10000, "min_spend": 20000,
         "quota": 100, "used": 0, "active": True, "created_at": now_iso()},
        {"id": uid("vch_"), "business_id": bid, "code": "FLAT75", "type": "fixed", "value": 7500, "min_spend": 50000, "quota": 50, "used": 0,
         "outlet_ids": [o2], "active": True, "created_at": now_iso()},
        {"id": uid("vch_"), "business_id": bid, "code": "MONSOON", "type": "fixed", "value": 10000, "min_spend": 0, "end_date": "2025-09-30",
         "quota": 0, "used": 0, "active": True, "created_at": now_iso()}])
    cus = [("Ananya Rao", "+91 98450 11223", "Gold", 500000), ("Rahul Mehta", "+91 99001 44556", "Silver", 0), ("Kabir Singh", "+91 90080 77889", None, 200000)]
    for name, phone, level, cl in cus:
        cid = uid("cus_")
        await db.customers.insert_one({"id": cid, "business_id": bid, "name": name, "phone": phone, "level": level,
                                       "credit_limit": cl, "store_credit": 0, "created_at": now_iso()})
        if level:
            await db.points_ledger.insert_one({"id": uid("pts_"), "business_id": bid, "customer_id": cid, "type": "adjusted",
                                               "points": 120 if level == "Gold" else 40, "note": "Welcome bonus", "created_at": now_iso()})
    tables = [("T1", "Indoor", 2), ("T2", "Indoor", 2), ("T3", "Indoor", 4), ("T4", "Indoor", 4), ("T5", "Indoor", 6),
              ("P1", "Patio", 2), ("P2", "Patio", 4), ("P3", "Patio", 4), ("B1", "Bar", 1), ("B2", "Bar", 1)]
    await db.tables.insert_many([{"id": uid("tbl_"), "business_id": bid, "outlet_id": o1, "name": n, "zone": z, "seats": s, "created_at": now_iso()} for n, z, s in tables])
    await db.suppliers.insert_one({"id": uid("sup_"), "business_id": bid, "name": "Blue Tokai Roasters", "phone": "+91 80 4000 1234", "created_at": now_iso()})
