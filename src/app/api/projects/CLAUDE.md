# /api/projects — Projects & OKRs (Nghị Sự Đường)

Goal-oriented projects domain. Projects with Key Results (KRs), task tracking, Kanban board.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `route` | GET/POST | Bearer | List/create projects |
| `[id]` | GET/PATCH/DELETE | Bearer | Get/update/delete project |
| `[id]/key-results` | GET/POST | Bearer | List/create KRs |
| `[id]/key-results/[krId]` | GET/PATCH/DELETE | Bearer | Get/update/delete KR |
| `[id]/close` | POST | Bearer | Close/archive project |

## Project Structure

**Type**: STANDARD (with KRs)

**Key Results**: goals tied to project, measurable, with progress

**Kanban**: task board per project (see `/api/tasks`)

**Status**: active | closed | archived

## Key Results (KRs)

Each KR has:
- Title, description
- Target (numeric, measurable)
- Current progress
- Start/end dates
- Owner

## Response

- `[id]`: project full details + KRs + board info
- KR progress auto-calculated from related tasks
- Can bulk update KRs

## Validation

- Project name required
- KR targets numeric
- Cannot close project with active tasks (must archive)
- Dates: `YYYY-MM-DD`

## Notes

- Separate from Finance projects (which are monthly)
- STANDARD type = KRs required
- All filtered by `user_id`
- Closing/archiving: different workflow
- Task board integration: see `/api/tasks`
