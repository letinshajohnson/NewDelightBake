# Auth testing (POSHub)
JWT email/password (cookies access_token + refresh_token). Login: POST /api/auth/login {email,password} -> sets cookies; GET /api/auth/me returns {user, business}.
Brute force: 5 failed attempts per ip:email -> 429 for 15 min.
Google (Emergent managed): frontend redirects to https://auth.emergentagent.com/?redirect=<origin>/app/dashboard; callback hash #session_id=... is exchanged by POST /api/auth/google/session which sets the same JWT cookies.
For API tests use cookie jar: curl -c c.txt -X POST $URL/api/auth/login ...; curl -b c.txt $URL/api/auth/me
Credentials in /app/memory/test_credentials.md
