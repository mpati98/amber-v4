# /api/tasks — Kanban tasks (Nghị Sự Đường)

Task management for projects. Tasks, checklists within tasks, board view.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `route` | GET/POST | Bearer | List/create tasks |
| `[id]` | GET/PATCH/DELETE | Bearer | Get/update/delete task |
| `[id]/checklist` | GET/POST | Bearer | List/add checklist items |
| `[id]/checklist/[itemId]` | GET/PATCH/DELETE | Bearer | Get/update/delete item |

## Task Structure

**Board**: Kanban columns (To Do, In Progress, Done, Backlog) per project

**Status**: not_started | in_progress | done | blocked

**Priority**: low | medium | high | critical

**Checklist**: sub-items within task (tick off independently)

## Checklist Items

Each item:
- Title, description
- Done (boolean)
- Order (position in list)

## Response

- `route`: tasks filtered by project + status
- `[id]`: task + full checklist array
- Checklist item: title, done, created/updated dates
- Board view: tasks grouped by status column

## Validation

- Task title required
- Must belong to project (projectId required)
- Checklist item titles required
- Cannot move task between projects
- Status: enum validation

## Notes

- All filtered by `user_id` (via project ownership)
- Checklist items cascade on task delete
- Order preserved for UI board view
- No swimlanes (just columns)
- Dates: `YYYY-MM-DD`
