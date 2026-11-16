# /api/mobile/auth — Mobile JWT authentication (active)

Mobile authentication endpoints. Issues access + refresh tokens. Used by Flutter app and amber-brain.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `auth/login` | POST | - | Issue access + refresh tokens |
| `auth/refresh` | POST | - | Refresh expired access token |
| `auth/logout` | POST | Bearer | Delete refresh token |

## Token Flow

**Credentials** → `/login` → `{accessToken, refreshToken}`
- Access: HS256, 1h expiry
- Refresh: random token, SHA-256 hash in DB, 30 days expiry, rotated (deleted after use)

**401** → `/refresh` → new access token (one shared refresh per user)
- Server deletes old refresh token, issues new one
- If refresh fails → must re-login

**Logout** → `/logout` → delete all refresh tokens of user

## Implementation

- `lib/mobile-auth.ts`: token generation, verification, refresh
- `MOBILE_JWT_SECRET`: HS256 key (env var, never logged)
- Password change: delete all refresh tokens for that user

## Notes

- No rate limiting on login (deferred)
- Refresh token rotation keeps single active token per user
- Mobile client retries once on 401, then goes to login
