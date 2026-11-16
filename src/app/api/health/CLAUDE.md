# /api/health — System health check

Simple health check endpoint for monitoring and deployment verification.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `route` | GET | - | Health status |

## Response

**GET `/`**
- Returns: `{status: "ok"}` (200)
- No authentication required
- Minimal response (no DB query)

## Usage

- **Deployment smoke test**: verify API is up
- **Monitoring**: external health checks
- **Load balancer**: endpoint pings
- **Debugging**: quick connectivity check

## Notes

- No database access (fast)
- No auth check
- Always 200 if running
- No side effects
