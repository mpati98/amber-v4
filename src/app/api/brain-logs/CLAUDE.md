# /api/brain-logs — amber-brain activity logs

Logs of AI agent (amber-brain) interactions. Records model calls, outputs, corrections, and feedback for training data curation.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `route` | GET/POST | Bearer | List/ingest logs |
| `[id]` | GET/PATCH | Bearer | Get/correct log |
| `[id]/feedback` | POST | Bearer | Rate log (helpful/unhelpful) |
| `stats` | GET | Bearer | Aggregated statistics |
| `export` | GET | Bearer | Training data export (JSONL) |

## Log Structure

**Fields**:
- `id`, `userId`
- `messages` (array of user/assistant turns)
- `parsedOutput` (structured action from model)
- `correctedOutput` (manual override, optional)
- `trainingTarget` (iff corrected or eligible; prioritizes `correctedOutput`)
- `route`: LOCAL | CLOUD | null
- `cloudModel`: e.g., "gpt-oss-120b" (CLOUD only)
- `createdAt`, `correctedAt` (if corrected)

## Ingestion

**POST `/ingest`** (from amber-brain)
- Body: `{messages, parsedOutput, route?, cloudModel?, ...}`
- Route: LOCAL or CLOUD (defaults to null if missing)
- cloudModel: optional, only with CLOUD
- Returns: ingested log object
- No auth check (amber-brain uses internal call or special token)

## Correction & Feedback

**PATCH `/[id]`** (user)
- Body: `{correctedOutput}` (valid action JSON | null to remove correction)
- Updates `correctedAt` timestamp
- Does **not** auto-change `accepted`/`rejected` status
- Response: updated log

**POST `/[id]/feedback`** (user)
- Body: `{helpful: true|false}` or rating enum
- Records user rating (separate from correction)

## Filtering

**GET `/`** (list)
- Query params:
  - `route`: LOCAL | CLOUD (filter)
  - `agent`: filter by agent type
  - `outcome`: ACCEPTED | REJECTED | null (filter)
  - `date`: `YYYY-MM-DD` (filter by date)
  - Cursor pagination
- Returns: `{logs, nextCursor, total}`

## Statistics

**GET `/stats`**
- Aggregated counts: total, by outcome, by route, by model
- Time series: daily/weekly breakdown
- Model breakdown: which models called, frequency
- Parameters: `eligible=true|false|all` (eligibility filter)

## Export

**GET `/export`** (training data)
- Query: `eligible=true|false|all` (defaults: all)
- Returns: JSONL (one log per line)
- Fields: `messages`, `trainingTarget`, `route`, `cloudModel`, `eligible`, `eligibleReason`
- `eligibleReason`: corrected | user_rated | confirmed (enum)
- **Never logs to console/stdout**

## Eligibility

Log eligible for training if:
1. `correctedOutput` present (user corrected it), OR
2. User rated feedback (rating exists), OR
3. Outcome marked as confirmed

Reasons tracked: `corrected`, `user_rated`, `confirmed`

## Validation

- Messages array required, non-empty
- parsedOutput: JSON (validate structure)
- correctedOutput: valid action schema (if present)
- Route: enum (LOCAL | CLOUD)
- CloudModel: required if route=CLOUD, forbidden if LOCAL

## Notes

- All filtered by `user_id` (no cross-user logs)
- No auto-deletion (manual cleanup only)
- Eligibility determined server-side (immutable)
- Export: training data format matches chat-completion schema
- `scripts/export_production_dataset.py`: Python exporter with JSONL output
- Eligible logs only for ML training (seed logs excluded)
