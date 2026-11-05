# New Delight back-office (iteration 2): retests of iteration-1 security fixes + purchasing/stock/finance/AR-AP/reports/CRUD
import os
import uuid
from datetime import datetime, timezone, timedelta
import pytest
import requests

API = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/") + "/api"
OWNER = ("letinshajohnson@gmail.com", "Owner@123")
CASHIER = ("cashier@poshub.demo", "Cashier@123")


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code}")
    return s


@pytest.fixture(scope="module")
def owner():
    return login(*OWNER)


@pytest.fixture(scope="module")
def cashier():
    return login(*CASHIER)


@pytest.fixture(scope="module")
def ctx(owner):
    outs = {o["name"]: o for o in owner.get(f"{API}/outlets").json()}
    prods = {p["name"]: p for p in owner.get(f"{API}/products").json()}
    sups = owner.get(f"{API}/suppliers").json()
    return {"fac": outs["Manufacturing Unit 1"], "shop": outs["Retail Shop 1"], "prods": prods, "sup": sups[0]}


def stock_of(s, oid, pid):
    return next(r for r in s.get(f"{API}/stock", params={"outlet_id": oid}).json() if r["product_id"] == pid)


def sale(s, outlet_id, lines, offline=False, created_at=None, void=True, **kw):
    cid = str(uuid.uuid4())
    p = {"client_id": cid, "receipt_no": f"TEST-{cid[:8]}", "outlet_id": outlet_id, "lines": lines,
         "payments": kw.pop("payments", [{"method": "cash", "amount": 1000000}]),
         "created_at": created_at or datetime.now(timezone.utc).isoformat(), **kw}
    r = s.post(f"{API}/sync", json={"ops": [{"type": "sale", "client_id": cid, "payload": p, "offline": offline}]}).json()["results"][0]
    if void and r.get("ok") and r.get("sale"):
        s.post(f"{API}/sales/{r['sale']['id']}/void", json={"supervisor_pin": "9999", "reason": "TEST cleanup"})
    return r


# ---------- iteration-1 security retests ----------
class TestSecurityRetest:
    def test_cashier_discount_over_limit_403(self, cashier, ctx):
        pr = ctx["prods"]["Vegetable puffs"]
        r = sale(cashier, ctx["shop"]["id"], [{"product_id": pr["id"], "qty": 2, "unit_price": pr["price"]}], order_discount={"type": "percent", "value": 2000})
        assert not r["ok"] and r["code"] == 403, r

    def test_cashier_discount_with_approval_ok(self, cashier, ctx):
        tok = cashier.post(f"{API}/auth/supervisor", json={"pin": "9999"}).json()["approval"]
        pr = ctx["prods"]["Vegetable puffs"]
        r = sale(cashier, ctx["shop"]["id"], [{"product_id": pr["id"], "qty": 2, "unit_price": pr["price"]}],
                 order_discount={"type": "percent", "value": 2000, "approval": tok})
        assert r["ok"], r
        assert r["sale"]["discount_approved_by"] and r["sale"]["order_discount"] > 0

    def test_unit_price_ignored(self, cashier, ctx):
        pr = ctx["prods"]["Vegetable puffs"]
        r = sale(cashier, ctx["shop"]["id"], [{"product_id": pr["id"], "qty": 1, "unit_price": 1}])
        assert r["ok"] and r["sale"]["lines"][0]["unit_price"] == pr["price"], r

    def test_backdated_offline_unit_price_tamper(self, cashier, ctx):
        # Offline sales older than 30s trust client unit_price -> cashier can forge offline:true + old created_at
        pr = ctx["prods"]["Vegetable puffs"]
        old = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        r = sale(cashier, ctx["shop"]["id"], [{"product_id": pr["id"], "qty": 1, "unit_price": 1}], offline=True, created_at=old)
        assert not r["ok"] or r["sale"]["lines"][0]["unit_price"] == pr["price"], f"forged offline sale accepted at unit_price={r['sale']['lines'][0]['unit_price']}"

    def test_expired_voucher_rejected(self, owner, cashier, ctx):
        v = owner.post(f"{API}/vouchers", json={"code": f"TESTEXP{uuid.uuid4().hex[:5].upper()}", "type": "percent", "value": 1000,
                                                "start_date": "2024-01-01", "end_date": "2024-12-31", "active": True}).json()
        try:
            pr = ctx["prods"]["Vegetable puffs"]
            r = sale(cashier, ctx["shop"]["id"], [{"product_id": pr["id"], "qty": 2, "unit_price": pr["price"]}], voucher_code=v["code"])
            assert not r["ok"] and "Voucher rejected" in r["error"], r
        finally:
            owner.delete(f"{API}/vouchers/{v['id']}")

    def test_brute_force_429(self):
        email = f"test_bf_{uuid.uuid4().hex[:6]}@x.com"
        codes = [requests.post(f"{API}/auth/login", json={"email": email, "password": "bad"}).status_code for _ in range(6)]
        assert codes[-1] == 429, codes

    def test_brute_force_xff_spoof_bypass(self):
        email = f"test_bf2_{uuid.uuid4().hex[:6]}@x.com"
        codes = [requests.post(f"{API}/auth/login", json={"email": email, "password": "bad"},
                               headers={"X-Forwarded-For": f"10.0.0.{i}"}).status_code for i in range(7)]
        assert codes[-1] == 429, f"lockout bypassed by rotating X-Forwarded-For: {codes}"


# ---------- Kitchen tickets follow table move/merge ----------
class TestKitchenTables:
    def test_move_and_merge_update_ticket_table(self, owner, ctx):
        biz = owner.get(f"{API}/auth/me").json()
        prev = owner.get(f"{API}/pos/bootstrap").json()["business"].get("restaurant_mode")
        owner.put(f"{API}/business", json={"restaurant_mode": True})
        shop = ctx["shop"]["id"]
        t1 = owner.post(f"{API}/tables", json={"name": "TEST_T1", "outlet_id": shop, "area": "TEST"}).json()
        t2 = owner.post(f"{API}/tables", json={"name": "TEST_T2", "outlet_id": shop, "area": "TEST"}).json()
        t3 = owner.post(f"{API}/tables", json={"name": "TEST_T3", "outlet_id": shop, "area": "TEST"}).json()
        pr = ctx["prods"]["Egg puffs"]
        ln = [{"product_id": pr["id"], "name": pr["name"], "qty": 1, "unit_price": pr["price"]}]
        try:
            a = owner.post(f"{API}/orders", json={"outlet_id": shop, "table_id": t1["id"], "table_name": "TEST_T1", "type": "table", "lines": ln}).json()
            assert owner.post(f"{API}/orders/{a['id']}/send").status_code == 200
            assert owner.put(f"{API}/orders/{a['id']}", json={"table_id": t2["id"], "table_name": "TEST_T2"}).status_code == 200
            tk = [t for t in owner.get(f"{API}/kitchen/tickets", params={"outlet_id": shop}).json() if t["order_id"] == a["id"]]
            assert tk and all(t["table_name"] == "TEST_T2" for t in tk), tk
            b = owner.post(f"{API}/orders", json={"outlet_id": shop, "table_id": t3["id"], "table_name": "TEST_T3", "type": "table", "lines": ln}).json()
            owner.post(f"{API}/orders/{b['id']}/send")
            assert owner.post(f"{API}/orders/{a['id']}/merge", json={"from_id": b["id"]}).status_code == 200
            tk = [t for t in owner.get(f"{API}/kitchen/tickets", params={"outlet_id": shop}).json() if t["order_id"] == a["id"]]
            assert len(tk) >= 2 and all(t["table_name"] == "TEST_T2" for t in tk), tk
            owner.post(f"{API}/orders/{a['id']}/cancel")
        finally:
            for t in (t1, t2, t3):
                owner.delete(f"{API}/tables/{t['id']}")
            owner.put(f"{API}/business", json={"restaurant_mode": bool(prev)})


# ---------- Purchasing: PO receive/pay/return/cancel + payables ----------
class TestPurchasing:
    def test_po_full_flow(self, owner, ctx):
        shop = ctx["shop"]["id"]
        a, b = ctx["prods"]["[Other brand product]"], ctx["prods"]["Butter cookies"]
        before_a = stock_of(owner, shop, a["id"])
        po = owner.post(f"{API}/purchase-orders", json={"outlet_id": shop, "supplier_id": ctx["sup"]["id"], "note": "TEST_PO",
                                                        "lines": [{"product_id": a["id"], "qty": 10, "cost": 9000}, {"product_id": b["id"], "qty": 5, "cost": 4000}]})
        assert po.status_code == 200, po.text
        po = po.json()
        assert po["status"] == "ordered" and po["total"] == 10 * 9000 + 5 * 4000 and po["number"].startswith("PO")
        assert po["due_date"]  # from supplier terms
        r = owner.post(f"{API}/purchase-orders/{po['id']}/receive", json={"lines": [{"product_id": a["id"], "qty": 4}]}).json()
        assert r["status"] == "partial" and r["value"] == 36000
        after_a = stock_of(owner, shop, a["id"])
        assert after_a["qty"] == before_a["qty"] + 4
        exp = (before_a["qty"] * before_a["avg_cost"] + 4 * 9000) // (before_a["qty"] + 4)
        assert abs(after_a["avg_cost"] - exp) <= 1, (after_a, exp)
        pay = [p for p in owner.get(f"{API}/payables").json() if p["id"] == po["id"]]
        assert pay and pay[0]["balance"] == 36000
        assert owner.post(f"{API}/purchase-orders/{po['id']}/pay", json={"amount": 10000}).status_code == 200
        assert owner.post(f"{API}/purchase-orders/{po['id']}/pay", json={"amount": 999999}).status_code == 400
        pay = [p for p in owner.get(f"{API}/payables").json() if p["id"] == po["id"]]
        assert pay[0]["balance"] == 26000
        assert owner.post(f"{API}/purchase-returns", json={"po_id": po["id"], "lines": [{"product_id": a["id"], "qty": 9}]}).status_code == 400
        pr = owner.post(f"{API}/purchase-returns", json={"po_id": po["id"], "reason": "TEST", "lines": [{"product_id": a["id"], "qty": 2}]}).json()
        assert pr["amount"] == 18000 and pr["number"].startswith("PR")
        assert stock_of(owner, shop, a["id"])["qty"] == before_a["qty"] + 2
        assert owner.post(f"{API}/purchase-returns/{pr['id']}/collect", json={"amount": 5000}).status_code == 200
        got = next(x for x in owner.get(f"{API}/purchase-returns").json() if x["id"] == pr["id"])
        assert got["collected"] == 5000
        assert owner.post(f"{API}/purchase-orders/{po['id']}/cancel", json={}).status_code == 400  # partial can't cancel

    def test_po_cancel(self, owner, ctx):
        a = ctx["prods"]["Cupcakes"]
        po = owner.post(f"{API}/purchase-orders", json={"outlet_id": ctx["shop"]["id"], "supplier_id": ctx["sup"]["id"], "lines": [{"product_id": a["id"], "qty": 3, "cost": 100}]}).json()
        assert owner.post(f"{API}/purchase-orders/{po['id']}/cancel", json={"reason": "TEST"}).status_code == 200
        got = next(x for x in owner.get(f"{API}/purchase-orders").json() if x["id"] == po["id"])
        assert got["status"] == "cancelled"
        assert owner.post(f"{API}/purchase-orders/{po['id']}/receive", json={"lines": [{"product_id": a["id"], "qty": 1}]}).status_code == 400

    def test_po_validation(self, owner, ctx):
        assert owner.post(f"{API}/purchase-orders", json={"outlet_id": ctx["shop"]["id"], "lines": []}).status_code == 400
        r = owner.post(f"{API}/purchase-orders", json={"outlet_id": ctx["shop"]["id"], "lines": [{"product_id": ctx["prods"]["Cupcakes"]["id"], "qty": "abc", "cost": 1}]})
        assert r.status_code in (400, 422), f"non-numeric qty -> {r.status_code}"

    def test_prefix_change_reflected(self, owner, ctx):
        biz = owner.get(f"{API}/pos/bootstrap").json()["business"]
        old = biz.get("prefixes") or {}
        owner.put(f"{API}/business", json={"prefixes": {**old, "po": "TPO"}})
        try:
            po = owner.post(f"{API}/purchase-orders", json={"outlet_id": ctx["shop"]["id"], "lines": [{"product_id": ctx["prods"]["Cupcakes"]["id"], "qty": 1, "cost": 1}]}).json()
            assert po["number"].startswith("TPO-"), po["number"]
            owner.post(f"{API}/purchase-orders/{po['id']}/cancel", json={"reason": "TEST"})
        finally:
            owner.put(f"{API}/business", json={"prefixes": old})

    def test_cashier_forbidden(self, cashier):
        for ep in ("purchase-orders", "payables", "receivables", "transfers", "stocktakes"):
            assert cashier.get(f"{API}/{ep}").status_code == 403, ep


# ---------- Receivables: wholesale credit sale ----------
class TestReceivables:
    def test_wholesale_credit_sale(self, owner, ctx):
        cust = next(c for c in owner.get(f"{API}/customers").json() if c.get("price_level") == "wholesale")
        pr = ctx["prods"]["Sandwich bread"]
        r = sale(owner, ctx["shop"]["id"], [{"product_id": pr["id"], "qty": 2, "unit_price": pr["price"]}], customer_id=cust["id"],
                 payments=[{"method": "cash", "amount": 2000}], void=False)
        assert r["ok"], r
        s = r["sale"]
        try:
            assert s["lines"][0]["unit_price"] == pr["price"] * 85 // 100
            assert s["amount_due"] == s["total"] - 2000
            rec = next(x for x in owner.get(f"{API}/receivables").json() if x["id"] == s["id"])
            assert rec["balance"] == s["amount_due"] and rec["age_days"] == 0 and rec["bucket"] == "0-30"
            assert owner.post(f"{API}/sales/{s['id']}/pay", json={"amount": 1000}).status_code == 200
            rec = next(x for x in owner.get(f"{API}/receivables").json() if x["id"] == s["id"])
            assert rec["balance"] == s["amount_due"] - 1000
        finally:
            owner.post(f"{API}/sales/{s['id']}/void", json={"supervisor_pin": "9999", "reason": "TEST cleanup"})


# ---------- Finance ----------
class TestFinance:
    def test_cash_in_out(self, owner, ctx):
        for t in ("in", "out"):
            r = owner.post(f"{API}/cash", json={"type": t, "amount": 12300, "category": "Fuel" if t == "out" else "Capital", "outlet_id": ctx["shop"]["id"], "note": "TEST_cash"})
            assert r.status_code == 200 and r.json()["type"] == t
        assert owner.post(f"{API}/cash", json={"type": "x", "amount": 1}).status_code == 400
        rows = owner.get(f"{API}/cash").json()
        assert any(c.get("note") == "TEST_cash" for c in rows)


# ---------- Stock manager ----------
class TestStock:
    def test_production_adjustment(self, owner, ctx):
        fac, pr = ctx["fac"]["id"], ctx["prods"]["Milk bread"]
        before = stock_of(owner, fac, pr["id"])["qty"]
        assert owner.post(f"{API}/stock/adjust", json={"outlet_id": fac, "product_id": pr["id"], "qty": 50, "reason": "production", "note": "TEST"}).status_code == 200
        assert stock_of(owner, fac, pr["id"])["qty"] == before + 50
        rows = owner.get(f"{API}/adjustments").json()
        assert any(r["reason"] == "production" and r.get("note") == "TEST" for r in rows)
        owner.post(f"{API}/stock/adjust", json={"outlet_id": fac, "product_id": pr["id"], "qty": -50, "reason": "correction", "note": "TEST revert"})

    def test_stocktake(self, owner, ctx):
        fac, pr = ctx["fac"]["id"], ctx["prods"]["Pastries"]
        sys = stock_of(owner, fac, pr["id"])["qty"]
        st = owner.post(f"{API}/stocktakes", json={"outlet_id": fac, "counts": [{"product_id": pr["id"], "counted": sys - 3}], "note": "TEST"}).json()
        assert st["lines"][0]["diff"] == -3 and st["number"].startswith("ST")
        assert stock_of(owner, fac, pr["id"])["qty"] == sys - 3
        owner.post(f"{API}/stocktakes", json={"outlet_id": fac, "counts": [{"product_id": pr["id"], "counted": sys}], "note": "TEST revert"})
        assert owner.post(f"{API}/stocktakes", json={"outlet_id": fac, "counts": []}).status_code == 400

    def test_transfer_send_receive(self, owner, ctx):
        fac, shop, pr = ctx["fac"]["id"], ctx["shop"]["id"], ctx["prods"]["Dinner rolls (6 pcs)"]
        f0, s0 = stock_of(owner, fac, pr["id"]), stock_of(owner, shop, pr["id"])
        t = owner.post(f"{API}/transfers", json={"from_outlet_id": fac, "to_outlet_id": shop, "lines": [{"product_id": pr["id"], "qty": 5}]}).json()
        assert t["status"] == "in_transit" and t["lines"][0]["unit_cost"] == f0["avg_cost"]
        assert stock_of(owner, fac, pr["id"])["qty"] == f0["qty"] - 5
        assert stock_of(owner, shop, pr["id"])["qty"] == s0["qty"]
        assert owner.post(f"{API}/transfers/{t['id']}/receive").status_code == 200
        assert stock_of(owner, shop, pr["id"])["qty"] == s0["qty"] + 5
        assert owner.post(f"{API}/transfers/{t['id']}/receive").status_code == 400

    def test_transfer_over_available_409(self, owner, ctx):
        fac, shop, pr = ctx["fac"]["id"], ctx["shop"]["id"], ctx["prods"]["Dinner rolls (6 pcs)"]
        f0 = stock_of(owner, fac, pr["id"])["qty"]
        r = owner.post(f"{API}/transfers", json={"from_outlet_id": fac, "to_outlet_id": shop, "lines": [{"product_id": pr["id"], "qty": f0 + 1000}]})
        assert r.status_code == 409
        assert stock_of(owner, fac, pr["id"])["qty"] == f0


# ---------- Reports ----------
REPORTS = ["summary", "transactions", "products", "profit", "payments", "trend", "cashiers", "returns", "cash", "profit_loss", "stock_movement", "shifts",
           "restaurant", "branches", "loyalty", "returns_by_product", "monthly_trend", "daily_trend", "sales_by_category", "sales_by_brand", "best_sellers",
           "purchases_by_product", "purchases_by_transaction", "purchase_returns_by_product", "purchase_returns_by_transaction", "cash_in", "cash_out",
           "purchase_payments", "sale_payments", "purchase_return_refunds", "sale_return_refunds", "stock_alerts", "product_stock", "stocktakes",
           "transfers", "waiters", "busy_hours", "kitchen_time", "outlet_pl"]


def test_all_reports_load(owner):
    bad = {}
    for n in REPORTS:
        r = owner.get(f"{API}/reports/{n}")
        if r.status_code != 200 or "rows" not in r.json() and "columns" not in r.json():
            bad[n] = r.status_code
    assert not bad, bad


# ---------- Generic CRUD ----------
@pytest.mark.parametrize("ep,payload", [("units", {"name": "TEST_unit"}), ("racks", {"name": "TEST_rack", "floor": "1"}), ("brands", {"name": "TEST_brand"}),
                                        ("levels", {"name": "TEST_lvl", "kind": "flat"}), ("rewards", {"name": "TEST_rw", "points": 10}),
                                        ("cash-categories", {"name": "TEST_cc", "type": "out"}), ("taxes", {"name": "TEST_tax", "rate_bps": 1200}),
                                        ("charges", {"name": "TEST_ch", "type": "fixed", "value": 500}), ("roles", {"name": "TEST_role", "base": "cashier", "permissions": ["pos"]})])
def test_crud(owner, ep, payload):
    c = owner.post(f"{API}/{ep}", json=payload)
    assert c.status_code == 200, c.text
    i = c.json()["id"]
    u = owner.put(f"{API}/{ep}/{i}", json={"name": payload["name"] + "_upd"})
    assert u.json()["name"] == payload["name"] + "_upd"
    assert any(x["id"] == i for x in owner.get(f"{API}/{ep}").json())
    owner.delete(f"{API}/{ep}/{i}")
    assert not any(x["id"] == i for x in owner.get(f"{API}/{ep}").json())


def test_cashier_cannot_edit_customer_credit(cashier, owner):
    c = owner.get(f"{API}/customers").json()[0]
    r = cashier.put(f"{API}/customers/{c['id']}", json={"credit_limit": c.get("credit_limit", 0)})
    assert r.status_code == 403, "cashier may edit customer credit_limit / price_level"
