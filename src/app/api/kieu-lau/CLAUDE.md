# /api/kieu-lau — Alerts & music (notifications, RSS)

Personal alerts and quick news domain. Notifications, RSS feed management, article curation.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `notifications` | GET/DELETE | Bearer | List/clear notifications |
| `feed-sources` | GET/POST | Bearer | List/add RSS sources |
| `feed-sources/[id]` | GET/PATCH/DELETE | Bearer | Get/update/delete source |
| `feeds/refresh` | POST | Bearer | Sync all RSS feeds |
| `feed-articles` | GET | Bearer | List articles from feeds |

## Notifications

**Types**: 
- System alerts (e.g., goal deadline, task overdue)
- App generated (e.g., new article, learner milestone)

**Alert struct**: 
- `id`, `title`, `message`
- `href`: Flutter route path (e.g., `/du-an`, `/hoc-tap/[id]`)
- `type`: category
- `read`: boolean
- `createdAt`: timestamp

**Actions**: 
- GET: list unread (limit, sort by date)
- DELETE: mark read / dismiss

## Feed Sources (RSS)

**Add**: URL + title

**Sync**: `POST /feeds/refresh` — fetch all sources (expensive, no schedule)

**Articles**: articles extracted from feed (title, description, link, pubDate)

**Curation**: mark as read, favorite, or hide source

## Response

- `notifications`: `{items: [], total, unreadCount}`
- `feed-sources`: `{sources: [], stats}`
- `feed-articles`: `{articles: [], total, nextCursor}` (paginated)

## Validation

- Feed URL: valid HTTPS URL
- Source title required
- Articles from public sources only

## Notes

- All filtered by `user_id`
- RSS sync is manual (POST endpoint)
- Alert `href` must match Flutter routes (see amber_flutter/CLAUDE.md)
- No auto-cleanup of old alerts or articles
- Notifications can reference other domains (finance, learn, etc.)
