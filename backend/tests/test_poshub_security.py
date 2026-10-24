# POSHub server-side trust checks: cashier discount limit, unit price tampering, totals parity
import os
import uuid
from datetime import datetime, timezone
import requests

API = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/") + "/api"


def _s():
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json={"email": "cashier@poshub.demo", "password": "Cashier@123"}).status_code == 200
    return s


def _sale(s, boot, line_overrides=None, **kw):
    es = next(p for p in boot["products"] if p["name"] == "Espresso")
    cid = str(uuid.uuid4())
    ln = {"product_id": es["id"], "qty": 2, "unit_price": es["price"]}
    ln.update(line_overrides or {})
    p = {"client_id": cid, "receipt_no": f"TEST-{cid[:8]}", "outlet_id": boot["outlet"]["id"], "lines": [ln],
         "payments": [{"method": "cash", "amount": 100000}], "created_at": datetime.now(timezone.utc).isoformat(), **kw}
    r = s.post(f"{API}/sync", json={"ops": [{"type": "sale", "client_id": cid, "payload": p, "offline": False}]}).json()["results"][0]
    if r.get("ok"):
        s.post(f"{API}/sales/{r['sale']['id']}/void", json={"supervisor_pin": "9999", "reason": "TEST cleanup"})
    return es, r


def test_cashier_discount_over_limit_rejected():
    s = _s()
    boot = s.get(f"{API}/pos/bootstrap").json()
    _, r = _sale(s, boot, order_discount={"type": "percent", "value": 9000})
    assert not r["ok"], f"cashier 90% discount accepted by server: order_discount={r['sale']['order_discount']}"


def test_unit_price_tampering_rejected():
    s = _s()
    boot = s.get(f"{API}/pos/bootstrap").json()
    es, r = _sale(s, boot, {"unit_price": 1})
    assert not r["ok"] or r["sale"]["lines"][0]["unit_price"] == es["price"], "server trusted client unit_price=1"


def test_client_total_matches():
    s = _s()
    boot = s.get(f"{API}/pos/bootstrap").json()
    es, r = _sale(s, boot, client_total=0)
    assert r["ok"] and r["sale"]["totals_mismatch"] is True
