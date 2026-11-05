import os
import re
import hmac
import asyncio
import hashlib
import ipaddress
import logging
import secrets
import calendar
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta
from typing import Optional
import httpx
import requests
from fastapi import APIRouter, Body, Depends, HTTPException, Request, UploadFile, File, Response
from core import db, uid, now_iso, hash_pw, get_user, require, get_business, MANAGERS
from backoffice import next_no, payables, receivables

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------- Object storage ----------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "newdelight-poshub"
_storage_key: Optional[str] = None
ALLOWED = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}


def init_storage(force: bool = False) -> str:
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": os.environ["EMERGENT_LLM_KEY"]}, timeout=30)
    r.raise_for_status()
    _storage_key = r.json()["storage_key"]
    return _storage_key


def _put(path: str, data: bytes, ctype: str) -> dict:
    r = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage(), "Content-Type": ctype}, data=data, timeout=120)
    if r.status_code == 404:
        r = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage(True), "Content-Type": ctype}, data=data, timeout=120)
    r.raise_for_status()
    return r.json()


def _get(path: str) -> bytes:
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage()}, timeout=60)
    if r.status_code == 404:
        r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage(True)}, timeout=60)
    r.raise_for_status()
    return r.content


@router.post("/files")
async def upload_file(file: UploadFile = File(...), user=Depends(get_user)) -> dict:
    ctype = file.content_type or ""
    if ctype not in ALLOWED:
        raise HTTPException(400, "Only JPG, PNG, WEBP images or PDF files")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "File is larger than 10 MB")
    fid = uid("fil_")
    res = await asyncio.to_thread(_put, f"{APP_NAME}/{user['business_id']}/{fid}.{ALLOWED[ctype]}", data, ctype)
    doc = {"id": fid, "business_id": user["business_id"], "path": res["path"], "name": file.filename, "content_type": ctype, "size": len(data),
           "is_deleted": False, "by": user["name"], "created_at": now_iso()}
    await db.files.insert_one(doc)
    return {"id": fid, "name": file.filename, "content_type": ctype}


@router.get("/files/{fid}")
async def download_file(fid: str, user=Depends(get_user)) -> Response:
    f = await db.files.find_one({"id": fid, "business_id": user["business_id"], "is_deleted": False})
    if not f:
        raise HTTPException(404, "File not found")
    data = await asyncio.to_thread(_get, f["path"])
    return Response(content=data, media_type=f["content_type"], headers={"Cache-Control": "private, max-age=86400"})


# ---------------- Email (Emergent managed) ----------------
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": os.environ["EMAIL_FROM_NAME"]}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": os.environ["EMERGENT_EMAIL_KEY"]}, json=payload)
        r.raise_for_status()
        return r.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.warning(f"Email send failed: {e.response.status_code} {e.response.text[:300]}")
    except Exception as e:
        logger.error(f"Email send error: {e}")
    return None


def _wrap(title: str, inner: str) -> str:
    brand = escape(os.environ["EMAIL_FROM_NAME"])
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#222">'
            f'<h2 style="margin:0 0 12px">{escape(title)}</h2>{inner}'
            f'<p style="font-size:12px;color:#888;margin-top:24px">Sent by {brand}. We never ask for your password by email.</p></td></tr></table>')


# ---------------- Password reset ----------------
@router.post("/auth/forgot")
async def forgot(data: dict = Body(...)) -> dict:
    email = (data.get("email") or "").strip().lower()
    u = await db.users.find_one({"email": email, "active": {"$ne": False}}, {"_id": 0})
    if u and u["role"] in MANAGERS:
        tok = secrets.token_urlsafe(32)
        await db.password_resets.insert_one({"hash": hashlib.sha256(tok.encode()).hexdigest(), "user_id": u["id"], "used": False,
                                             "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()})
        link = f"{os.environ['FRONTEND_URL'].rstrip('/')}/reset-password?token={tok}"
        html = _wrap("Reset your password", f'<p>Hi {escape(u["name"])},</p><p>Someone asked to reset the password for your account. '
                     f'The link works once, for 1 hour.</p><p><a href="{escape(link)}" style="background:#b4532a;color:#fff;padding:10px 18px;text-decoration:none">Choose a new password</a></p>'
                     f'<p>If this was not you, ignore this email.</p>')
        await send_email(to=email, subject="Reset your password", html=html)
        await audit(u, "auth.forgot_password", "Password reset link requested", "warning")
    return {"ok": True}


@router.post("/auth/reset")
async def reset(data: dict = Body(...)) -> dict:
    if len(data.get("password") or "") < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    h = hashlib.sha256((data.get("token") or "").encode()).hexdigest()
    r = await db.password_resets.find_one_and_update({"hash": h, "used": False, "expires_at": {"$gt": now_iso()}}, {"$set": {"used": True}})
    if not r:
        raise HTTPException(400, "This reset link is invalid or has expired")
    await db.users.update_one({"id": r["user_id"]}, {"$set": {"password_hash": hash_pw(data["password"])}})
    u = await db.users.find_one({"id": r["user_id"]}, {"_id": 0})
    await audit(u, "auth.reset_password", "Password changed via reset link", "warning")
    return {"ok": True}


@router.get("/public/shop/{code}")
async def shop_info(code: str) -> dict:
    o = await db.outlets.find_one({"code": {"$regex": f"^{re.escape(code)}$", "$options": "i"}, "archived": {"$ne": True}}, {"_id": 0, "name": 1, "code": 1})
    if not o:
        raise HTTPException(404, "Shop not found")
    return o


# ---------------- Audit ----------------
async def audit(user: Optional[dict], action: str, detail: str, level: str = "info", outlet_id: Optional[str] = None, ip: Optional[str] = None) -> None:
    if not user:
        return
    await db.audit.insert_one({"id": uid("aud_"), "business_id": user["business_id"], "user_id": user["id"], "user_name": user.get("name"), "role": user.get("role"),
                               "outlet_id": outlet_id or user.get("outlet_id"), "action": action, "detail": detail, "level": level, "ip": ip, "created_at": now_iso()})


DANGER_PATHS = ("/void", "/staff", "/password", "/roles", "/business", "/outlets")
WARN_PATHS = ("/return", "/stocktakes", "/adjust", "/cancel", "/import", "/pay", "/collect", "/transfers")


def classify(method: str, path: str, status: int) -> str:
    if status in (401, 403, 429) or method == "DELETE" or any(p in path for p in DANGER_PATHS):
        return "danger"
    if any(p in path for p in WARN_PATHS) or method == "PUT":
        return "warning"
    return "info"


@router.get("/audit")
async def list_audit(outlet_id: str = None, start: str = None, end: str = None, level: str = None, user_id: str = None, user=Depends(require(*MANAGERS))) -> list:
    f = {"business_id": user["business_id"]}
    if user["role"] != "owner":
        f["role"] = {"$ne": "owner"}
    if outlet_id:
        f["outlet_id"] = outlet_id
    if level:
        f["level"] = level
    if user_id:
        f["user_id"] = user_id
    if start or end:
        f["created_at"] = {k: v for k, v in (("$gte", start), ("$lt", end and f"{end}T23:59:59.999")) if v}
    return await db.audit.find(f, {"_id": 0}).sort("created_at", -1).to_list(3000)


# ---------------- Sales orders ----------------
SO_STATUS = ("booked", "in_production", "ready", "delivered", "cancelled")


def _so_lines(raw: list) -> list:
    out = []
    for l in raw or []:
        q, pr = int(float(l.get("qty") or 0)), int(l.get("price") or 0)
        if (l.get("name") or "").strip() and q > 0 and pr >= 0:
            out.append({"product_id": l.get("product_id") or None, "name": l["name"].strip(), "qty": q, "price": pr, "amount": q * pr})
    return out


def _so_validate(d: dict) -> None:
    missing = [k for k, lbl in (("customer_name", "customer"), ("bill_name", "bill name"), ("order_date", "ordered date"), ("delivery_date", "delivery date"),
                                ("delivery_mode", "pickup or delivery"), ("outlet_id", "outlet")) if not d.get(k)]
    if d.get("delivery_mode") == "delivery" and not d.get("location"):
        missing.append("delivery location")
    if missing:
        raise HTTPException(400, f"Required: {', '.join(missing)}")
    if not (d.get("phone") or d.get("email")):
        raise HTTPException(400, "Enter the customer's phone number or email")
    if not d["lines"]:
        raise HTTPException(400, "Add at least one product")
    if d["status"] not in SO_STATUS:
        raise HTTPException(400, "Unknown status")


def _sms_text(b: dict, so: dict, event: str) -> str:
    bal = (so["total"] - so["received"]) / 100
    return (f"{b['name']}: order {so['number']} {event}. Delivery {so['delivery_date']} ({so['delivery_mode']}). "
            f"Total Rs {so['total'] / 100:.2f}, paid Rs {so['received'] / 100:.2f}, balance Rs {bal:.2f}.")


SO_FIELDS = ("customer_id", "customer_name", "phone", "email", "bill_name", "order_date", "delivery_date", "delivery_time", "delivery_mode", "location", "outlet_id", "status", "note")


@router.get("/sales-orders")
async def list_so(user=Depends(get_user)) -> list:
    return await db.sales_orders.find({"business_id": user["business_id"]}, {"_id": 0}).sort("delivery_date", 1).to_list(3000)


@router.post("/sales-orders")
async def create_so(data: dict = Body(...), user=Depends(require("owner", "manager", "cashier"))) -> dict:
    b = await get_business(user["business_id"])
    d = {k: (data.get(k) or "").strip() if isinstance(data.get(k), str) else data.get(k) for k in SO_FIELDS}
    d["status"] = d.get("status") or "booked"
    d["lines"] = _so_lines(data.get("lines"))
    _so_validate(d)
    adv = int(data.get("advance") or 0)
    d.update({"id": uid("so_"), "business_id": user["business_id"], "number": await next_no(b, "so"), "total": sum(l["amount"] for l in d["lines"]),
              "payments": [], "received": 0, "sms_log": [], "created_by": user["name"], "created_at": now_iso()})
    if adv < 0 or adv > d["total"]:
        raise HTTPException(400, "Advance must be between 0 and the order total")
    if adv:
        d["payments"].append({"amount": adv, "method": data.get("method") or "cash", "at": now_iso(), "by": user["name"], "kind": "advance"})
        d["received"] = adv
        await _so_money(d, adv, data.get("method") or "cash")
    d["sms_log"].append({"to": d.get("phone"), "text": _sms_text(b, d, "confirmed"), "status": "not sent (no SMS account connected)", "at": now_iso()})
    await db.sales_orders.insert_one(d)
    d.pop("_id", None)
    return d


async def _so_money(so: dict, amt: int, method: str) -> None:
    await db.money_moves.insert_one({"id": uid("mm_"), "business_id": so["business_id"], "kind": "order_advance", "ref": so["number"], "party": so["customer_name"],
                                     "method": method, "amount": amt, "outlet_id": so["outlet_id"], "created_at": now_iso()})


@router.put("/sales-orders/{sid}")
async def update_so(sid: str, data: dict = Body(...), user=Depends(require("owner", "manager", "cashier"))) -> dict:
    so = await db.sales_orders.find_one({"id": sid, "business_id": user["business_id"]}, {"_id": 0})
    if not so:
        raise HTTPException(404, "Order not found")
    b = await get_business(user["business_id"])
    upd = {k: data[k] for k in SO_FIELDS if k in data}
    merged = {**so, **upd}
    if "lines" in data:
        merged["lines"] = _so_lines(data["lines"])
        merged["total"] = sum(l["amount"] for l in merged["lines"])
        if merged["total"] < so["received"]:
            raise HTTPException(400, "Total cannot be less than what was already received")
    _so_validate(merged)
    if merged["status"] != so["status"]:
        merged["sms_log"] = so["sms_log"] + [{"to": merged.get("phone"), "text": _sms_text(b, merged, f"is now {merged['status'].replace('_', ' ')}"),
                                              "status": "not sent (no SMS account connected)", "at": now_iso()}]
    await db.sales_orders.update_one({"id": sid}, {"$set": {k: merged[k] for k in (*SO_FIELDS, "lines", "total", "sms_log")}})
    return await db.sales_orders.find_one({"id": sid}, {"_id": 0})


@router.post("/sales-orders/{sid}/pay")
async def pay_so(sid: str, data: dict = Body(...), user=Depends(require("owner", "manager", "cashier"))) -> dict:
    so = await db.sales_orders.find_one({"id": sid, "business_id": user["business_id"]}, {"_id": 0})
    amt = int(data.get("amount") or 0)
    if not so or amt <= 0 or amt > so["total"] - so["received"]:
        raise HTTPException(400, "Amount must be between 0 and the balance")
    method = data.get("method") or "cash"
    await db.sales_orders.update_one({"id": sid}, {"$inc": {"received": amt}, "$push": {"payments": {"amount": amt, "method": method, "at": now_iso(), "by": user["name"]}}})
    await _so_money(so, amt, method)
    return {"ok": True}


# ---------------- Attendance & salary ----------------
ATT = {"present": 1, "half_day": 0.5, "absent": 0, "leave": 0}


@router.get("/attendance")
async def list_attendance(date: str = None, month: str = None, outlet_id: str = None, user=Depends(require(*MANAGERS))) -> list:
    f = {"business_id": user["business_id"]}
    if date:
        f["date"] = date
    if month:
        f["date"] = {"$regex": f"^{re.escape(month)}"}
    if outlet_id:
        f["outlet_id"] = outlet_id
    return await db.attendance.find(f, {"_id": 0}).sort("date", -1).to_list(10000)


@router.post("/attendance")
async def mark_attendance(data: dict = Body(...), user=Depends(require(*MANAGERS))) -> dict:
    st = await db.users.find_one({"id": data.get("staff_id"), "business_id": user["business_id"]}, {"_id": 0})
    if not st or data.get("status") not in ATT or not re.match(r"^\d{4}-\d{2}-\d{2}$", data.get("date") or ""):
        raise HTTPException(400, "Choose staff, a date and a status")
    doc = {"business_id": user["business_id"], "staff_id": st["id"], "staff_name": st["name"], "role": st["role"], "outlet_id": st.get("outlet_id"),
           "date": data["date"], "status": data["status"], "check_in": data.get("check_in"), "check_out": data.get("check_out"), "note": data.get("note"),
           "by": user["name"], "updated_at": now_iso()}
    await db.attendance.update_one({"business_id": user["business_id"], "staff_id": st["id"], "date": data["date"]}, {"$set": doc, "$setOnInsert": {"id": uid("att_")}}, upsert=True)
    return doc


def _salary_due(st: dict, days: float, absent: float, month: str) -> int:
    sal, per = int(st.get("salary") or 0), st.get("salary_period") or "monthly"
    if per == "daily":
        return int(sal * days)
    if per == "weekly":
        return int(sal * days / 6)
    y, m = map(int, month.split("-"))
    dim = calendar.monthrange(y, m)[1]
    return max(int(sal - sal * absent / dim), 0)


@router.get("/attendance/salary")
async def salary_report(month: str, outlet_id: str = None, user=Depends(require(*MANAGERS))) -> list:
    bid = user["business_id"]
    staff = await db.users.find({"business_id": bid, "active": {"$ne": False}, "role": {"$ne": "owner"}, **({"outlet_id": outlet_id} if outlet_id else {})}, {"_id": 0}).to_list(1000)
    att = await db.attendance.find({"business_id": bid, "date": {"$regex": f"^{re.escape(month)}"}}, {"_id": 0}).to_list(20000)
    paid = await db.cash_entries.find({"business_id": bid, "salary_month": month}, {"_id": 0}).to_list(5000)
    rows = []
    for st in staff:
        mine = [a for a in att if a["staff_id"] == st["id"]]
        days = sum(ATT[a["status"]] for a in mine)
        absent = sum(1 - ATT[a["status"]] for a in mine if a["status"] != "present")
        due = _salary_due(st, days, absent, month)
        pd = sum(c["amount"] for c in paid if c.get("staff_id") == st["id"])
        rows.append({"staff_id": st["id"], "name": st["name"], "role": st["role"], "outlet_id": st.get("outlet_id"), "salary": int(st.get("salary") or 0),
                     "period": st.get("salary_period") or "monthly", "present": len([a for a in mine if a["status"] == "present"]),
                     "half_days": len([a for a in mine if a["status"] == "half_day"]), "absent": len([a for a in mine if a["status"] == "absent"]),
                     "leave": len([a for a in mine if a["status"] == "leave"]), "due": due, "paid": pd, "balance": due - pd})
    return rows


@router.post("/attendance/salary/pay")
async def pay_salary(data: dict = Body(...), user=Depends(require(*MANAGERS))) -> dict:
    st = await db.users.find_one({"id": data.get("staff_id"), "business_id": user["business_id"]}, {"_id": 0})
    amt = int(data.get("amount") or 0)
    if not st or amt <= 0 or not re.match(r"^\d{4}-\d{2}$", data.get("month") or ""):
        raise HTTPException(400, "Choose staff, month and amount")
    await db.cash_entries.insert_one({"id": uid("cash_"), "business_id": user["business_id"], "outlet_id": st.get("outlet_id"), "shift_id": None, "type": "out",
                                      "category": "Staff salary", "method": data.get("method") or "cash", "amount": amt, "note": f"{st['name']} salary {data['month']}",
                                      "staff_id": st["id"], "salary_month": data["month"], "user_id": user["id"], "user_name": user["name"], "created_at": now_iso()})
    return {"ok": True}


# ---------------- Dashboard extras ----------------
@router.get("/dashboard/alerts")
async def dashboard_alerts(outlet_id: str = None, user=Depends(require(*MANAGERS))) -> dict:
    bid = user["business_id"]
    lv = await db.stock_levels.find({"business_id": bid, **({"outlet_id": outlet_id} if outlet_id else {})}).to_list(100000)
    qty = {}
    for l in lv:
        qty[l["product_id"]] = qty.get(l["product_id"], 0) + l["qty"]
    cats = {c["id"]: c["name"] for c in await db.categories.find({"business_id": bid}).to_list(1000)}
    brands = {c["id"]: c["name"] for c in await db.brands.find({"business_id": bid}).to_list(1000)}
    low = []
    async for p in db.products.find({"business_id": bid, "archived": {"$ne": True}, "track_stock": {"$ne": False}, "is_kit": {"$ne": True}}, {"_id": 0}):
        q = qty.get(p["id"], 0)
        if q <= (p.get("low_stock") or 0):
            low.append({"id": p["id"], "name": p["name"], "qty": q, "min": p.get("low_stock") or 0, "category": cats.get(p.get("category_id"), "No category"),
                        "brand": brands.get(p.get("brand_id"), "No brand"), "raw": bool(p.get("is_raw"))})
    group = lambda k: sorted(({"name": n, "count": len([x for x in low if x[k] == n]), "items": [x for x in low if x[k] == n]} for n in {x[k] for x in low}), key=lambda g: -g["count"])
    pay, rec = await payables(user), await receivables(user)
    orders = await db.sales_orders.find({"business_id": bid, "status": {"$nin": ["delivered", "cancelled"]}}, {"_id": 0, "total": 1, "received": 1}).to_list(5000)
    return {"low_stock": low, "by_brand": group("brand"), "by_category": group("category"),
            "payables": {"total": sum(r["balance"] for r in pay), "overdue": sum(r["balance"] for r in pay if r["overdue"]), "count": len(pay)},
            "receivables": {"total": sum(r["balance"] for r in rec), "overdue": sum(r["balance"] for r in rec if r["age_days"] > 30), "count": len(rec)},
            "open_orders": {"count": len(orders), "balance": sum(o["total"] - o["received"] for o in orders)}}


# ---------------- Print ----------------
PRINT_KINDS = {"sale": "sales", "sale_return": "returns", "purchase": "purchase_orders", "purchase_return": "purchase_returns", "sales_order": "sales_orders"}


@router.get("/print/{kind}/{did}")
async def print_doc(kind: str, did: str, user=Depends(get_user)) -> dict:
    if kind not in PRINT_KINDS or (kind.startswith("purchase") and user["role"] not in MANAGERS):
        raise HTTPException(404, "Unknown document")
    d = await db[PRINT_KINDS[kind]].find_one({"id": did, "business_id": user["business_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Document not found")
    if kind == "sale_return":
        d["sale"] = await db.sales.find_one({"id": d.get("sale_id")}, {"_id": 0, "lines": 1, "receipt_no": 1, "customer_name": 1})
    o = await db.outlets.find_one({"id": d.get("outlet_id"), "business_id": user["business_id"]}, {"_id": 0}) or {}
    if kind.startswith("purchase") and d.get("supplier_id"):
        d["supplier"] = await db.suppliers.find_one({"id": d["supplier_id"]}, {"_id": 0})
    return {"doc": d, "outlet": o, "business": await get_business(user["business_id"])}


# ---------------- Daily summary email ----------------
def _rupees(v: int) -> str:
    return f"Rs {v / 100:,.2f}"


def _table(head: list, rows: list) -> str:
    th = "".join(f'<th style="text-align:left;border-bottom:1px solid #ccc;padding:4px 8px">{escape(h)}</th>' for h in head)
    tr = "".join("<tr>" + "".join(f'<td style="padding:4px 8px;border-bottom:1px solid #eee">{escape(str(c))}</td>' for c in r) + "</tr>" for r in rows)
    return f'<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-bottom:16px">{th and "<tr>" + th + "</tr>"}{tr or "<tr><td>None</td></tr>"}</table>'


async def build_summary(bid: str, day: Optional[str] = None) -> tuple:
    b = await get_business(bid)
    tz = timedelta(minutes=b.get("tz_offset_min", 0))
    day = day or (datetime.now(timezone.utc) + tz).strftime("%Y-%m-%d")
    d0 = datetime.fromisoformat(day).replace(tzinfo=timezone.utc) - tz
    s, e = d0.isoformat(), (d0 + timedelta(days=1)).isoformat()
    rng = {"business_id": bid, "created_at": {"$gte": s, "$lt": e}}
    outs = {o["id"]: o["name"] for o in await db.outlets.find({"business_id": bid}).to_list(200)}
    sales = await db.sales.find({**rng, "status": "completed"}, {"_id": 0}).to_list(100000)
    rets = await db.returns.find(rng, {"_id": 0}).to_list(10000)
    pos = await db.purchase_orders.find(rng, {"_id": 0}).to_list(10000)
    cash = await db.cash_entries.find(rng, {"_id": 0}).to_list(10000)
    att = await db.attendance.find({"business_id": bid, "date": day}, {"_id": 0}).to_list(5000)
    aud = await db.audit.find(rng, {"_id": 0}).to_list(20000)
    per = lambda xs, f: {outs.get(k, "—"): sum(f(x) for x in xs if x.get("outlet_id") == k) for k in {x.get("outlet_id") for x in xs}}
    sale_rows = [[o, len([x for x in sales if outs.get(x["outlet_id"]) == o]), _rupees(v)] for o, v in per(sales, lambda x: x["total"]).items()]
    html = f'<p>Summary for <b>{day}</b>.</p><h3>Sales</h3>' + _table(["Outlet / unit", "Bills", "Total"], sale_rows)
    html += f'<p>Returns: {len(rets)} ({_rupees(sum(r["amount"] for r in rets))})</p>'
    html += "<h3>Purchases</h3>" + _table(["PO", "Supplier", "Outlet", "Value"], [[p["number"], p.get("supplier_name") or "—", outs.get(p["outlet_id"], "—"), _rupees(p["total"])] for p in pos])
    html += "<h3>Finance</h3>" + _table(["Type", "Category", "Outlet", "Amount"], [[c["type"], c.get("category"), outs.get(c.get("outlet_id"), "—"), _rupees(c["amount"])] for c in cash])
    html += "<h3>Attendance</h3>" + _table(["Staff", "Role", "Status"], [[a["staff_name"], a["role"], a["status"].replace("_", " ")] for a in att])
    bad = [a for a in aud if a["level"] == "danger"]
    html += f"<h3>Audit</h3><p>{len(aud)} recorded actions, {len([a for a in aud if a['level'] == 'warning'])} warnings, <b style=\"color:#b00\">{len(bad)} danger</b>.</p>"
    html += _table(["Time", "Who", "Outlet", "What"], [[a["created_at"][11:16], f"{a.get('user_name')} ({a.get('role')})", outs.get(a.get("outlet_id"), "—"), a["detail"]] for a in bad[:100]])
    return b, day, _wrap(f"{b['name']} — daily report", html)


async def send_daily(bid: str) -> int:
    b, day, html = await build_summary(bid)
    to = [u["email"] for u in await db.users.find({"business_id": bid, "role": {"$in": list(MANAGERS)}, "active": {"$ne": False}}).to_list(50)
          if u.get("email") and not u["email"].endswith(".local")]
    n = 0
    for addr in dict.fromkeys(to):
        if await send_email(to=addr, subject=f"{b['name']} daily report — {day}", html=html):
            n += 1
    await db.daily_reports.insert_one({"business_id": bid, "day": day, "sent_to": to, "delivered": n, "at": now_iso()})
    return n


@router.get("/daily-summary/preview")
async def preview_summary(day: str = None, user=Depends(require(*MANAGERS))) -> Response:
    _, _, html = await build_summary(user["business_id"], day)
    return Response(content=html, media_type="text/html")


@router.post("/daily-summary/send")
async def send_summary_now(user=Depends(require("owner"))) -> dict:
    return {"delivered": await send_daily(user["business_id"])}


async def _run_daily_all() -> None:
    async for b in db.businesses.find({}, {"id": 1}):
        try:
            await send_daily(b["id"])
        except Exception as e:
            logger.error(f"daily summary failed for {b['id']}: {e}")


@router.post("/cron/daily-summary")
async def cron_daily(request: Request) -> dict:
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:], os.environ["WEBHOOK_CRON_SECRET"]):
        raise HTTPException(401, "Unauthorized")
    run_id = request.headers.get("X-Webhook-Id") or ""
    if run_id and await db.cron_runs.find_one({"run_id": run_id}):
        return {"ok": True, "duplicate": True}
    await db.cron_runs.insert_one({"run_id": run_id, "at": now_iso()})
    asyncio.create_task(_run_daily_all())
    return {"ok": True}
