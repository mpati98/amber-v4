# /api/public — Public endpoints (no auth)

Endpoints accessible without authentication. Currently minimal.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `contact` | POST | - | Contact form submission |

## Contact Form

**POST `/contact`**
- Body: `{name, email, message}`
- **Origin restricted**: CORS checks `PORTFOLIO_ORIGIN`
- On success: sends email notification via Resend
- Recipient: `CONTACT_NOTIFY_EMAIL`
- Returns: `{success: true}` or error

## Validation

- `name`: ≤ 255 chars
- `email`: valid email format
- `message`: ≥ 10 chars

## CORS

- **Allowed origin**: `PORTFOLIO_ORIGIN` env var (e.g., `https://duangmai.io.vn`)
- Preflight OPTIONS automatically handled by proxy.ts
- **Dev**: `http://localhost:3001` (portfolio dev)
- **Production**: `https://duangmai.io.vn`

## Email

- Provider: Resend
- Subject: "New contact form submission"
- Recipient: `CONTACT_NOTIFY_EMAIL`
- Sender: Resend default

## Notes

- No authentication required
- Rate limiting: none implemented yet
- CORS misconfiguration = 403 (origin mismatch)
- Email sending failure: logs error, returns 500
