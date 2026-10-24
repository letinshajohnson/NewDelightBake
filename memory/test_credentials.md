# Test Credentials — POSHub (business "Chai & Co. Café", INR, restaurant mode on)

| Role | Email | Password | PIN | Branch |
|---|---|---|---|---|
| owner | letinshajohnson@gmail.com | Owner@123 | 1111 | all |
| manager | manager@poshub.demo | Manager@123 | 9999 | MG Road |
| cashier | cashier@poshub.demo | Cashier@123 | 1234 | MG Road (discount limit 10%) |
| waiter | waiter@poshub.demo | Waiter@123 | 2222 | MG Road (tables only, cannot pay) |
| kitchen | kitchen@poshub.demo | Kitchen@123 | — | MG Road (kitchen display) |

Google login (Emergent managed): any Google account; a new email gets its own new isolated business.

Auth endpoints: POST /api/auth/login, /api/auth/register, /api/auth/logout, /api/auth/refresh, GET /api/auth/me,
POST /api/auth/pin (switch user by PIN), POST /api/auth/supervisor (verify manager PIN), POST /api/auth/google/session.
Cookies: access_token (15 min) + refresh_token (7 days), httpOnly.

Demo data: vouchers WELCOME10 (10% cap ₹100, min ₹200), FLAT75 (Indiranagar only), MONSOON (expired).
Customers: Ananya Rao (Gold, 120 pts, credit ₹5000), Rahul Mehta (Silver, 40 pts), Kabir Singh.
Barcodes 8901001..8901012 (Espresso=8901001), 8901099 = Gift Wrapping (no stock tracking).
