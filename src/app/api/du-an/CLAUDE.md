# /api/du-an — Daily tasks & routines (Nghị Sự Đường)

Personal productivity domain. Daily tasks, routines (CHECK/WORKOUT), and summaries.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `summary` | GET | Bearer | Today's summary (cached) |
| `overview` | GET | Bearer | Full day overview with routines |
| `routines` | GET/POST | Bearer | List/create routines |
| `routines/[id]` | GET/PATCH/DELETE | Bearer | Get/update/delete routine |
| `routines/[id]/logs/[date]` | PUT/DELETE | Bearer | Log routine (CHECK or WORKOUT) |

## Routines

**kind**: CHECK (tick ✓) | WORKOUT (duration + exercises)

**CHECK**: Simple daily checklist. Idempotent PUT.
- Body ignored
- Allows past dates
- Cannot change kind once logged

**WORKOUT**: Structured exercise log.
- Body: `{durationMinutes: 1–1440, exercises?: [...]}`
- Only today allowed
- Each exercise: measure (REPS | SETS_REPS | DURATION) + values
- Upsert + cascade delete old exercises

## Response

Every PUT/DELETE returns full routine object with:
- `kind`
- `todayLog` (null | {durationMinutes, exercises[]})
- WORKOUT only: `lastWorkout` (previous session)

## Errors

- `routine_not_found`: 404
- `future_date`, `not_scheduled`, `not_today`: 400
- `kind_locked`: 409 (cannot change kind once logged)

## Notes

- Dates are VN time (`YYYY-MM-DD`)
- All routines filtered by `user_id`
- Cannot change kind if any log exists
- WORKOUT exercises up to 50 per log
