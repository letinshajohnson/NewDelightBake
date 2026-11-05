# Helper (not a pytest file): verify records created by UI tests and archive TEST_ products/suppliers by id
import os, sys, requests
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
s = requests.Session()
s.post(f"{API}/auth/login", json={"email": "letinshajohnson@gmail.com", "password": "Owner@123"})
prods = s.get(f"{API}/products").json()
sups = s.get(f"{API}/suppliers").json()
names = sys.argv[1:]  # name prefixes to verify / clean
for p in prods:
    if any(p["name"].startswith(n) for n in names):
        print("PRODUCT", p["name"], "is_raw", p.get("is_raw"), "is_kit", p.get("is_kit"), "cost", p.get("cost"), "price", p.get("price"), "tax", p.get("tax_bps"), "recipe", p.get("recipe"))
for x in sups:
    if any(x["name"].startswith(n) for n in names):
        print("SUPPLIER", x["name"], x.get("gstin"), x.get("type"))
for c in s.get(f"{API}/cash").json():
    if any((c.get("note") or "").startswith(n) or (c.get("category") or "").startswith(n) for n in names):
        print("CASH", c["type"], c["category"], c["amount"], c["created_at"], c.get("note"), c.get("outlet_id"))
for po in s.get(f"{API}/purchase-orders").json():
    if any((po.get("supplier_name") or "").startswith(n) for n in names):
        print("PO", po["number"], po.get("supplier_invoice"), po["status"], po["total"], po["tax"], po["created_at"][:10], len(po["lines"]))
if os.environ.get("CLEAN"):
    for p in prods:
        if any(p["name"].startswith(n) for n in names):
            s.delete(f"{API}/products/{p['id']}")
    for x in sups:
        if any(x["name"].startswith(n) for n in names):
            s.delete(f"{API}/suppliers/{x['id']}")
    print("archived")
