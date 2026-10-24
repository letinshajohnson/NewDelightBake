from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

import os
import uuid
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import Request, HTTPException, Depends
from motor.motor_asyncio import AsyncIOMotorClient

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
JWT_ALG = "HS256"

CURRENCIES = {"INR": {"symbol": "₹", "decimals": 2}, "USD": {"symbol": "$", "decimals": 2},
              "IDR": {"symbol": "Rp", "decimals": 0}, "KWD": {"symbol": "KD", "decimals": 3}}

MANAGERS = ("owner", "manager")


def uid(prefix=""):
    return f"{prefix}{uuid.uuid4().hex[:16]}"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_pw(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False


def make_token(user_id: str, kind: str):
    ttl = timedelta(minutes=15) if kind == "access" else timedelta(days=7)
    payload = {"sub": user_id, "type": kind, "exp": datetime.now(timezone.utc) + ttl}
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALG)


def set_auth_cookies(response, user_id: str):
    response.set_cookie("access_token", make_token(user_id, "access"), httponly=True, secure=True, samesite="none", max_age=900, path="/")
    response.set_cookie("refresh_token", make_token(user_id, "refresh"), httponly=True, secure=True, samesite="none", max_age=604800, path="/")


def public_user(u: dict) -> dict:
    return {k: v for k, v in u.items() if k not in ("_id", "password_hash", "pin_hash")} | {"has_pin": bool(u.get("pin_hash"))}


async def get_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    auth = request.headers.get("Authorization", "")
    if not token and auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(401, "Invalid token type")
    user = await db.users.find_one({"id": payload["sub"], "active": {"$ne": False}}, {"_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


def require(*roles):
    async def dep(user: dict = Depends(get_user)):
        if roles and user["role"] not in roles:
            raise HTTPException(403, "You don't have permission for this")
        return user
    return dep


async def get_business(bid: str) -> dict:
    b = await db.businesses.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Business not found")
    return b


def settings_of(b: dict) -> dict:
    return {"tax_inclusive": b.get("tax_inclusive", False), "service_bps": b.get("service_bps", 0),
            "rounding_unit": b.get("rounding_unit", 0)}
