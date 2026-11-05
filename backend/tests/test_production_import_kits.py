# Iteration 3: purchase-bill scan (AI), universal import (purchase/products/expenses), gift kits in POS sales, production runs
import os
import base64
import uuid
from datetime import datetime, timezone
import pytest
import requests

API = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/") + "/api"
OWNER = ("letinshajohnson@gmail.com", "Owner@123")
RUN = uuid.uuid4().hex[:6]
CREATED = {"products": [], "suppliers": [], "units": []}


@pytest.fixture(scope="module")
def s():
    x = requests.Session()
    r = x.post(f"{API}/auth/login", json={"email": OWNER[0], "password": OWNER[1]})
    if r.status_code != 200:
        pytest.skip("owner login failed")
    yield x
    for coll, ids in CREATED.items():
        for i in ids:
            x.delete(f"{API}/{coll}/{i}")


@pytest.fixture(scope="module")
def outs(s):
    o = {x["name"]: x["id"] for x in s.get(f"{API}/outlets").json()}
    return {"fac": o["Manufacturing Unit 1"], "shop": o["Retail Shop 1"]}


def qty(s, oid, pid):
    return next((r["qty"] for r in s.get(f"{API}/stock", params={"outlet_id": oid}).json() if r["product_id"] == pid), None)


def mk(s, name, **kw):
    r = s.post(f"{API}/products", json={"name": f"TEST_{name}_{RUN}", "price": 1000, "cost": 500, "track_stock": True, **kw})
    assert r.status_code == 200, r.text
    CREATED["products"].append(r.json()["id"])
    return r.json()


def sell(s, oid, lines, cid=None):
    cid = cid or str(uuid.uuid4())
    p = {"client_id": cid, "receipt_no": f"TEST-{cid[:8]}", "outlet_id": oid, "lines": lines,
         "payments": [{"method": "cash", "amount": 10000000}], "created_at": datetime.now(timezone.utc).isoformat()}
    return s.post(f"{API}/sync", json={"ops": [{"type": "sale", "client_id": cid, "payload": p, "offline": False}]}).json()["results"][0]


# ---------- AI bill scan (one call only) ----------
def test_scan_bill(s):
    if not os.path.exists("/tmp/bill.jpg"):
        pytest.skip("no sample bill")
    img = base64.b64encode(open("/tmp/bill.jpg", "rb").read()).decode()
    r = s.post(f"{API}/purchase-bills/scan", json={"image_base64": img}, timeout=120)
    assert r.status_code == 200, r.text
    d = r.json()
    print("SCAN:", d)
    for k in ("supplier", "supplier_gstin", "invoice_no", "date", "items", "net_total"):
        assert k in d
    assert d["supplier"] and d["invoice_no"] and len(d["items"]) > 0
    assert set(d["items"][0]) >= {"item", "hsn", "qty", "rate", "mrp", "gst"}


def test_scan_requires_image(s):
    assert s.post(f"{API}/purchase-bills/scan", json={"image_base64": ""}).status_code == 400


# ---------- Purchase import ----------
class TestPurchaseImport:
    def test_bad_date_400(self, s, outs):
        r = s.post(f"{API}/import/purchase", json={"outlet_id": outs["shop"], "rows": [
            {"supplier": f"TEST_Sup_{RUN}", "invoice_no": "X1", "date": "05/11/2025", "item": f"TEST_Bad_{RUN}", "qty": "1", "rate": "10"}]})
        assert r.status_code == 400 and "YYYY-MM-DD" in r.json()["detail"]

    def test_import_purchase_full(self, s, outs):
        sup, item, inv = f"TEST_Sup_{RUN}", f"TEST_PItem_{RUN}", f"TEST-INV-{RUN}"
        rows = [{"Supplier": sup, "Supplier_GSTIN": "32ABCDE1234F1Z5", "Invoice_no": inv, "Date": "2025-11-05", "Item": item,
                 "HSN": "1905", "Qty": "12", "Rate": "40.50", "MRP": "60", "GST": "5"}]
        r = s.post(f"{API}/import/purchase", json={"outlet_id": outs["shop"], "rows": rows})
        assert r.status_code == 200 and r.json()["imported"] == 1, r.text
        sp = next((x for x in s.get(f"{API}/suppliers").json() if x["name"] == sup), None)
        assert sp and sp["gstin"] == "32ABCDE1234F1Z5"
        CREATED["suppliers"].append(sp["id"])
        p = next((x for x in s.get(f"{API}/products").json() if x["name"] == item), None)
        assert p and p["cost"] == 4050 and p["price"] == 6000 and p["tax_bps"] == 500 and p["hsn"] == "1905"
        CREATED["products"].append(p["id"])
        assert qty(s, outs["shop"], p["id"]) == 12
        po = next((x for x in s.get(f"{API}/purchase-orders").json() if x.get("supplier_invoice") == inv), None)
        assert po and po["status"] == "received" and po["supplier_id"] == sp["id"]
        assert po["tax"] == 12 * 4050 * 500 // 10000 and po["total"] == 12 * 4050 + po["tax"]
        assert po["created_at"].startswith("2025-11-05")

    def test_import_purchase_special_chars_name(self, s, outs):
        # names containing regex metachars should be matched literally (no duplicates, no 500)
        item = f"TEST_Cake (500g)+{RUN}"
        rows = [{"supplier": f"TEST_Sup_{RUN}", "invoice_no": f"TEST-INV2-{RUN}", "date": "2025-11-06", "item": item, "qty": "2", "rate": "10", "gst": "5"}]
        r1 = s.post(f"{API}/import/purchase", json={"outlet_id": outs["shop"], "rows": rows})
        assert r1.status_code == 200, r1.text
        rows[0]["invoice_no"] = f"TEST-INV3-{RUN}"
        r2 = s.post(f"{API}/import/purchase", json={"outlet_id": outs["shop"], "rows": rows})
        assert r2.status_code == 200, r2.text
        ps = [x for x in s.get(f"{API}/products").json() if x["name"] == item]
        CREATED["products"].extend(x["id"] for x in ps)
        assert len(ps) == 1, f"duplicate products created for regex-like name: {len(ps)}"

    def test_import_purchase_bad_number_not_500(self, s, outs):
        rows = [{"supplier": f"TEST_Sup_{RUN}", "invoice_no": f"TEST-INV4-{RUN}", "date": "2025-11-06", "item": f"TEST_Pct_{RUN}", "qty": "2", "rate": "10", "gst": "5%"}]
        r = s.post(f"{API}/import/purchase", json={"outlet_id": outs["shop"], "rows": rows})
        ps = [x for x in s.get(f"{API}/products").json() if x["name"] == f"TEST_Pct_{RUN}"]
        CREATED["products"].extend(x["id"] for x in ps)
        assert r.status_code in (200, 400), f"gst='5%' gives {r.status_code}"

    def test_import_purchase_missing_outlet(self, s):
        rows = [{"supplier": f"TEST_Sup_{RUN}", "invoice_no": f"TEST-INV5-{RUN}", "date": "2025-11-06", "item": f"TEST_NoOut_{RUN}", "qty": "2", "rate": "10"}]
        r = s.post(f"{API}/import/purchase", json={"rows": rows})
        ps = [x for x in s.get(f"{API}/products").json() if x["name"] == f"TEST_NoOut_{RUN}"]
        CREATED["products"].extend(x["id"] for x in ps)
        assert r.status_code == 400, f"import without outlet_id accepted ({r.status_code}) -> stock booked to outlet None"


# ---------- Products & expenses import ----------
class TestOtherImports:
    def test_import_raw_products(self, s):
        unit = f"TEST_kg_{RUN}"
        rows = [{"Name": f"TEST_Flour_{RUN}", "Category": "Raw", "Unit": unit, "Price": "0", "Cost": "45.5", "GST": "0", "Raw_material": "yes"},
                {"Name": f"TEST_Bun_{RUN}", "Price": "20", "GST": "5", "Raw_material": "no"}]
        r = s.post(f"{API}/import/products", json={"rows": rows})
        assert r.status_code == 200 and r.json()["imported"] == 2
        prods = {p["name"]: p for p in s.get(f"{API}/products").json()}
        f, b = prods[f"TEST_Flour_{RUN}"], prods[f"TEST_Bun_{RUN}"]
        CREATED["products"] += [f["id"], b["id"]]
        assert f["is_raw"] is True and b["is_raw"] is False and f["cost"] == 4550 and b["tax_bps"] == 500
        u = next((x for x in s.get(f"{API}/units").json() if x["name"] == unit), None)
        assert u and f["unit_id"] == u["id"]
        CREATED["units"].append(u["id"])

    def test_import_expenses(self, s, outs):
        note = f"TEST_exp_{RUN}"
        rows = [{"Date": "2025-11-01", "Category": "Staff salary", "Amount": "15000", "Method": "bank", "Note": note},
                {"Date": "2025-11-02", "Category": "Rent", "Amount": "0", "Note": note}]
        r = s.post(f"{API}/import/expenses", json={"outlet_id": outs["fac"], "rows": rows})
        assert r.status_code == 200 and r.json()["imported"] == 1
        c = [x for x in s.get(f"{API}/cash").json() if x.get("note") == note]
        assert len(c) == 1 and c[0]["type"] == "out" and c[0]["amount"] == 1500000 and c[0]["category"] == "Staff salary"
        assert c[0]["created_at"].startswith("2025-11-01")

    def test_unknown_kind_404(self, s):
        assert s.post(f"{API}/import/foo", json={"rows": []}).status_code == 404


# ---------- Gift kits ----------
class TestKits:
    @pytest.fixture(scope="class")
    def kit(self, s, outs):
        a, b = mk(s, "KitA"), mk(s, "KitB")
        for p in (a, b):
            assert s.post(f"{API}/stock/adjust", json={"outlet_id": outs["fac"], "product_id": p["id"], "qty": 10, "reason": "count", "cost": 300}).status_code == 200
        k = mk(s, "GiftPack", price=5000)
        r = s.put(f"{API}/products/{k['id']}", json={"is_kit": True, "track_stock": False, "batch_yield": 1,
                                                    "recipe": [{"product_id": a["id"], "qty": 2, "name": a["name"]}, {"product_id": b["id"], "qty": 1, "name": b["name"]}]})
        assert r.status_code == 200 and r.json()["is_kit"] is True
        return {"a": a["id"], "b": b["id"], "k": k["id"], "o": outs["fac"]}

    def test_stock_check_explodes(self, s, kit):
        r = s.post(f"{API}/stock/check", json={"outlet_id": kit["o"], "lines": [{"product_id": kit["k"], "qty": 6}]}).json()
        assert r["ok"] is False and {x["product_id"] for x in r["short"]} == {kit["a"]}
        assert r["short"][0]["requested"] == 12
        r2 = s.post(f"{API}/stock/check", json={"outlet_id": kit["o"], "lines": [{"product_id": kit["k"], "qty": 2}]}).json()
        assert r2["ok"] is True

    def test_kit_sale_void_return(self, s, kit):
        o = kit["o"]
        r = sell(s, o, [{"product_id": kit["k"], "qty": 2, "unit_price": 5000}])
        assert r["ok"], r
        line = r["sale"]["lines"][0]
        assert {x["product_id"]: x["qty"] for x in line["kit_used"]} == {kit["a"]: 4, kit["b"]: 2}
        assert line["unit_cost"] == 900 and line["cogs"] == 1800
        assert qty(s, o, kit["a"]) == 6 and qty(s, o, kit["b"]) == 8 and qty(s, o, kit["k"]) == 0
        v = s.post(f"{API}/sales/{r['sale']['id']}/void", json={"reason": "TEST"})
        assert v.status_code == 200
        assert qty(s, o, kit["a"]) == 10 and qty(s, o, kit["b"]) == 10 and qty(s, o, kit["k"]) == 0
        # partial return
        r = sell(s, o, [{"product_id": kit["k"], "qty": 3, "unit_price": 5000}])
        assert r["ok"], r
        assert qty(s, o, kit["a"]) == 4 and qty(s, o, kit["b"]) == 7
        rt = s.post(f"{API}/sales/{r['sale']['id']}/return", json={"lines": [{"index": 0, "qty": 1}], "refund_method": "cash", "reason": "TEST"})
        assert rt.status_code == 200, rt.text
        assert qty(s, o, kit["a"]) == 6 and qty(s, o, kit["b"]) == 8 and qty(s, o, kit["k"]) == 0
        rt = s.post(f"{API}/sales/{r['sale']['id']}/return", json={"lines": [{"index": 0, "qty": 2}], "refund_method": "cash", "reason": "TEST"})
        assert rt.status_code == 200
        assert qty(s, o, kit["a"]) == 10 and qty(s, o, kit["b"]) == 10

    def test_kit_insufficient_409_and_rollback(self, s, kit):
        o = kit["o"]
        r = sell(s, o, [{"product_id": kit["b"], "qty": 1, "unit_price": 1000}, {"product_id": kit["k"], "qty": 6, "unit_price": 5000}])
        assert not r["ok"] and r["code"] == 409, r
        assert qty(s, o, kit["a"]) == 10 and qty(s, o, kit["b"]) == 10

    def test_production_rejects_kit(self, s, kit):
        r = s.post(f"{API}/production", json={"product_id": kit["k"], "outlet_id": kit["o"], "batches": 1, "produced_qty": 1})
        assert r.status_code == 400


# ---------- Production ----------
class TestProduction:
    def test_production_run(self, s, outs):
        o = outs["fac"]
        raw = mk(s, "Maida", is_raw=True, price=0)
        assert s.post(f"{API}/stock/adjust", json={"outlet_id": o, "product_id": raw["id"], "qty": 20, "reason": "count", "cost": 100}).status_code == 200
        fin = mk(s, "Puff", price=2000)
        s.put(f"{API}/products/{fin['id']}", json={"made_in_house": True, "batch_yield": 10, "recipe": [{"product_id": raw["id"], "qty": 3, "name": raw["name"]}]})
        r = s.post(f"{API}/production", json={"product_id": fin["id"], "outlet_id": o, "batches": 2, "produced_qty": 18, "note": "TEST"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["expected_qty"] == 20 and d["material_cost"] == 600 and d["unit_cost"] == 33
        assert qty(s, o, raw["id"]) == 14 and qty(s, o, fin["id"]) == 18
        assert any(x["id"] == d["id"] for x in s.get(f"{API}/production").json())

    def test_production_validation(self, s, outs):
        assert s.post(f"{API}/production", json={"product_id": "nope", "outlet_id": outs["fac"], "batches": 1, "produced_qty": 1}).status_code == 400

    def test_production_missing_outlet_not_500(self, s, outs):
        fin = mk(s, "Puff2", recipe=[{"product_id": "x", "qty": 1}])
        r = s.post(f"{API}/production", json={"product_id": fin["id"], "batches": 1, "produced_qty": 1})
        assert r.status_code == 400, f"missing outlet_id -> {r.status_code}"
