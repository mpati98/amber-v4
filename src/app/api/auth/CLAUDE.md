# /api/auth — NextAuth authentication (legacy)

Web authentication via NextAuth. Session stored in httpOnly cookie. Currently legacy — mobile uses `/api/mobile/auth` instead.

## Routes

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `[...nextauth]/route.ts` | GET/POST | NextAuth callback handler | - |
| `register/route.ts` | POST | Register new user (closed: 403 if user exists) | - |

## Status

- NextAuth configured with credentials provider + JWT
- Cookie name, signed/encrypted per `.env`
- Pages: `signIn: "/login"` (no longer exists in web, harmless)
- **Decision pending**: Remove NextAuth entirely or keep as fallback?

## Migration Notes

- Web UI removed (phase 2); only API remains
- Mobile uses `/api/mobile/auth` for JWT tokens
- Session file not used in `/api/auth`
