# POSHub backend regression tests: auth/roles, pricing parity, sync idempotency, vouchers, stock, orders/kitchen, returns/void, reports
import os
import uuid
from datetime import datetime, timezone
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
CREDS = {
    "owner": ("letinshajohnson@gmail.com", "Owner@123"),
    "manager": ("manager@poshub.demo", "Manager@123"),
    "cashier": ("cashier@poshub.demo", "Cashier@123"),
    "waiter": ("waiter@poshub.demo", "Waiter@123"),
    "kitchen": ("kitchen@poshub.demo", "Kitchen@123"),
}


def login(role):
    s = requests.Session()
    e, p = CREDS[role]
    r = s.post(f"{API}/auth/login", json={"email": e, "password": p})
    assert r.status_code == 200, r.text
    return s, r


@pytest.fixture(scope="module")
def owner():
    return login("owner")[0]


@pytest.fixture(scope="module")
def cashier():
    return login("cashier")[0]


@pytest.fixture(scope="module")
def boot(cashier):
    r = cashier.get(f"{API}/pos/bootstrap")
    assert r.status_code == 200
    return r.json()


def prod(boot, name):
    return next(p for p in boot["products"] if p["name"] == name)


def sale_payload(boot, lines, **kw):
    cid = str(uuid.uuid4())
    p = {"client_id": cid, "receipt_no": f"TEST-{cid[:8]}", "outlet_id": boot["outlet"]["id"], "lines": lines,
         "payments": kw.pop("payments", [{"method": "cash", "amount": 10_000_00}]), "created_at": datetime.now(timezone.utc).isoformat()}
    p.update(kw)
    return p


# --- Auth & roles
class TestAuth:
    @pytest.mark.parametrize("role", list(CREDS))
    def test_login_roles(self, role):
        s, r = login(role)
        assert r.json()["user"]["role"] == role if "user" in r.json() else True
        assert "access_token" in s.cookies
        sc = r.headers.get("set-cookie", "").lower()
        assert "httponly" in sc

    def test_bad_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": "kitchen@poshub.demo", "password": "nope"})
        assert r.status_code in (400, 401)

    def test_cashier_no_cost_and_staff_forbidden(self, cashier):
        prods = cashier.get(f"{API}/products").json()
        assert prods and all("cost" not in p for p in prods)
        assert cashier.get(f"{API}/staff").status_code == 403

    def test_owner_sees_cost(self, owner):
        prods = owner.get(f"{API}/products").json()
        assert any("cost" in p for p in prods)

    def test_register_isolated_tenant(self):
        s = requests.Session()
        em = f"test_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{API}/auth/register", json={"email": em, "password": "Test@1234", "name": "TEST User", "business_name": "TEST Biz"})
        assert r.status_code == 200, r.text
        names = [p["name"] for p in s.get(f"{API}/products").json()]
        assert "Pain au Chocolat" not in names
        assert all("Ananya" not in c["name"] for c in s.get(f"{API}/customers").json())


# --- Vouchers
class TestVouchers:
    def test_welcome10(self, cashier, boot):
        r = cashier.get(f"{API}/vouchers/validate", params={"code": "WELCOME10", "outlet_id": boot["outlet"]["id"], "subtotal": 25000}).json()
        assert r["ok"] is True

    def test_welcome10_min_spend(self, cashier, boot):
        r = cashier.get(f"{API}/vouchers/validate", params={"code": "WELCOME10", "outlet_id": boot["outlet"]["id"], "subtotal": 10000}).json()
        assert r["ok"] is False

    def test_monsoon_expired(self, cashier, boot):
        r = cashier.get(f"{API}/vouchers/validate", params={"code": "MONSOON", "outlet_id": boot["outlet"]["id"], "subtotal": 50000}).json()
        assert r["reason"] == "Expired on 2025-09-30"

    def test_flat75_branch(self, cashier, boot):
        r = cashier.get(f"{API}/vouchers/validate", params={"code": "FLAT75", "outlet_id": boot["outlet"]["id"], "subtotal": 50000}).json()
        assert r["reason"] == "Not valid at this branch"

    def test_supervisor_pin(self, cashier):
        assert cashier.post(f"{API}/auth/supervisor", json={"pin": "9999"}).status_code == 200
        assert cashier.post(f"{API}/auth/supervisor", json={"pin": "0000"}).status_code in (401, 403)


# --- Sync idempotency, totals, stock
class TestSync:
    def test_duplicate_sync(self, cashier, owner, boot):
        es = prod(boot, "Espresso")
        oid = boot["outlet"]["id"]
        before = next(x for x in owner.get(f"{API}/stock", params={"outlet_id": oid}).json() if x["product_id"] == es["id"])["qty"]
        p = sale_payload(boot, [{"product_id": es["id"], "qty": 1, "unit_price": es["price"]}])
        op = {"type": "sale", "client_id": p["client_id"], "payload": p, "offline": False}
        r1 = cashier.post(f"{API}/sync", json={"ops": [op]}).json()["results"][0]
        assert r1["ok"] and r1["status"] == "created", r1
        r2 = cashier.post(f"{API}/sync", json={"ops": [op]}).json()["results"][0]
        assert r2["status"] == "duplicate"
        assert r2["sale"]["id"] == r1["sale"]["id"]
        after = next(x for x in owner.get(f"{API}/stock", params={"outlet_id": oid}).json() if x["product_id"] == es["id"])["qty"]
        if es.get("track_stock", True):
            assert after == before - 1
        matches = [s for s in owner.get(f"{API}/sales", params={"q": p["receipt_no"]}).json()]
        assert len(matches) == 1
        # void to clean up (manager-owner)
        assert owner.post(f"{API}/sales/{r1['sale']['id']}/void", json={"reason": "TEST cleanup"}).status_code == 200
        s = owner.get(f"{API}/sales/{r1['sale']['id']}").json()
        assert s["status"] == "voided"

    def test_strict_stock_online(self, cashier, boot):
        pc = prod(boot, "Pain au Chocolat")
        p = sale_payload(boot, [{"product_id": pc["id"], "qty": pc["stock"] + 1, "unit_price": pc["price"]}])
        r = cashier.post(f"{API}/sync", json={"ops": [{"type": "sale", "client_id": p["client_id"], "payload": p, "offline": False}]}).json()["results"][0]
        assert r["ok"] is False and r["code"] == 409

    def test_stock_check(self, cashier, boot):
        pc = prod(boot, "Pain au Chocolat")
        r = cashier.post(f"{API}/stock/check", json={"outlet_id": boot["outlet"]["id"], "lines": [{"product_id": pc["id"], "qty": pc["stock"] + 1}]}).json()
        assert r["ok"] is False

    def test_server_ignores_unvalidated_voucher(self, cashier, boot):
        """Security: server should reject expired voucher MONSOON on sync (it currently doesn't re-validate)."""
        es = prod(boot, "Espresso")
        p = sale_payload(boot, [{"product_id": es["id"], "qty": 5, "unit_price": es["price"]}], voucher_code="MONSOON")
        r = cashier.post(f"{API}/sync", json={"ops": [{"type": "sale", "client_id": p["client_id"], "payload": p, "offline": False}]}).json()["results"][0]
        applied = [a for a in r.get("sale", {}).get("applied", []) if a["source"] == "voucher"] if r["ok"] else []
        if r["ok"]:
            requests.Session  # noqa
        assert not applied, f"Expired voucher applied server-side: {applied}"


# --- Return & void keep record
class TestReturnVoid:
    def test_partial_return_then_cannot_void(self, cashier, owner, boot):
        es = prod(boot, "Espresso")
        p = sale_payload(boot, [{"product_id": es["id"], "qty": 2, "unit_price": es["price"]}])
        r = cashier.post(f"{API}/sync", json={"ops": [{"type": "sale", "client_id": p["client_id"], "payload": p, "offline": False}]}).json()["results"][0]
        sid = r["sale"]["id"]
        rr = owner.post(f"{API}/sales/{sid}/return", json={"lines": [{"index": 0, "qty": 1}], "refund_method": "cash", "reason": "TEST"})
        assert rr.status_code == 200 and rr.json()["amount"] > 0
        assert owner.post(f"{API}/sales/{sid}/return", json={"lines": [{"index": 0, "qty": 2}]}).status_code == 400
        s = owner.get(f"{API}/sales/{sid}").json()
        assert s["status"] == "completed" and len(s["returns"]) == 1

    def test_cashier_void_needs_pin(self, cashier, boot):
        es = prod(boot, "Espresso")
        p = sale_payload(boot, [{"product_id": es["id"], "qty": 1, "unit_price": es["price"]}])
        sid = cashier.post(f"{API}/sync", json={"ops": [{"type": "sale", "client_id": p["client_id"], "payload": p, "offline": False}]}).json()["results"][0]["sale"]["id"]
        assert cashier.post(f"{API}/sales/{sid}/void", json={}).status_code == 403
        assert cashier.post(f"{API}/sales/{sid}/void", json={"supervisor_pin": "9999", "reason": "TEST"}).status_code == 200


# --- Restaurant orders & kitchen
class TestOrders:
    def test_order_send_merge(self, owner, boot):
        oid = boot["outlet"]["id"]
        tables = owner.get(f"{API}/pos/bootstrap", params={"outlet_id": oid}).json()["tables"]
        open_t = {o.get("table_id") for o in owner.get(f"{API}/orders", params={"outlet_id": oid}).json()}
        free = [t for t in tables if t["id"] not in open_t]
        assert len(free) >= 2
        es, pc = prod(boot, "Espresso"), prod(boot, "Pain au Chocolat")
        mk = lambda t, p: owner.post(f"{API}/orders", json={"type": "table", "table_id": t["id"], "table_name": t["name"], "outlet_id": oid,
                                                            "lines": [{"product_id": p["id"], "name": p["name"], "qty": 1, "unit_price": p["price"], "station": p.get("station")}]}).json()
        a, b = mk(free[0], es), mk(free[1], pc)
        assert owner.post(f"{API}/orders", json={"type": "table", "table_id": free[0]["id"], "outlet_id": oid}).status_code == 400
        snd = owner.post(f"{API}/orders/{a['id']}/send").json()
        assert snd["ok"]
        assert owner.post(f"{API}/orders/{a['id']}/send").status_code == 400
        tk = [t for t in owner.get(f"{API}/kitchen/tickets", params={"outlet_id": oid}).json() if t["order_id"] == a["id"]]
        assert tk
        for st in ("preparing", "ready", "served"):
            assert owner.patch(f"{API}/kitchen/tickets/{tk[0]['id']}", json={"status": st}).status_code == 200
        assert owner.post(f"{API}/orders/{a['id']}/merge", json={"from_id": b["id"]}).status_code == 200
        ords = {o["id"]: o for o in owner.get(f"{API}/orders", params={"outlet_id": oid}).json()}
        assert b["id"] not in ords and len(ords[a["id"]]["lines"]) == 2
        assert owner.post(f"{API}/orders/{a['id']}/cancel").status_code == 200


# --- Reports
class TestReports:
    @pytest.mark.parametrize("kind", ["summary", "products", "trend", "profit_loss", "stock_movement", "branches"])
    def test_report(self, owner, kind):
        r = owner.get(f"{API}/reports/{kind}")
        assert r.status_code == 200, r.text[:200]
