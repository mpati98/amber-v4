# /api/tra-dinh — English learning (chat, lessons, spaced repetition)

Multi-system English learning domain with three subsystems:
1. **Chat + Audio** — Real-time AI conversation
2. **Structured Learning** — Courses, lessons, schedules
3. **Flashcard System** — Vocabulary spaced repetition (migration 0011, 06/11/2026)

## Routes Overview

### Chat & Audio
| Route | Method | Auth | Body/Params | Purpose |
|---|---|---|---|---|
| `sessions` | GET/POST | Bearer | - / `{subjectId?, initialMessage?}` | List/start session |
| `sessions/[id]` | GET/PATCH | Bearer | - / `{summary?, endedAt?}` | Get/end session |
| `sessions/[id]/messages` | GET/POST | Bearer | - / `{text, ..}` | Get/add message |
| `transcribe` | POST | Bearer | FormData (audio) | Whisper transcription |
| `speak` | POST | Bearer | `{text}` | TTS (WAV, Groq) |
| `placement-test` | GET/POST | Bearer | - / `{courseId, ..}` | Run English level test |
| `placement-test/submit` | POST | Bearer | `{..}` | Submit test answers |
| `skills` | GET | Bearer | - | Get current skill scores |

### Structured Learning (`/hoc-tap`)
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `hoc-tap/courses` | GET/POST | Bearer | List/create courses; `?deleted=1` = Thùng rác (`deletedAt`, `daysLeft`); lazy-purges own courses trashed >30d |
| `hoc-tap/courses/[id]` | GET/PATCH/DELETE | Bearer | DELETE = soft delete, body `{password}` (403 wrong, 429 locked) |
| `hoc-tap/courses/[id]/restore` | POST | Bearer | Restore from trash (no password) |
| `hoc-tap/courses/[id]/purge` | DELETE | Bearer | Hard delete a trashed course, body `{password}` |
| `hoc-tap/overview` | GET | Bearer | Learning dashboard |
| `hoc-tap/schedule` | GET | Bearer | `?days=` lesson schedule |
| `hoc-tap/stats` | GET | Bearer | `?range=7\|30\|all` progress stats |
| `hoc-tap/logs` | GET/POST | Bearer | List/create lesson logs |
| `hoc-tap/logs/[id]` | PATCH/DELETE | Bearer | Update/delete log |

### Flashcards (`/hoc-tap/cards`) — NEW (06/11/2026)
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `hoc-tap/cards` | GET/POST | Bearer | List/create cards |
| `hoc-tap/cards/[id]` | GET/PATCH/DELETE | Bearer | Get/update/delete card |
| `hoc-tap/cards/parse` | POST | Bearer | Parse card text (preview) |
| `hoc-tap/cards/import` | POST | Bearer | Bulk import cards |
| `hoc-tap/cards/queue` | GET | Bearer | Today's review queue |
| `hoc-tap/cards/[id]/review` | POST | Bearer | Rate card (NOT_YET / REVIEW_AGAIN / REMEMBERED) |
| `hoc-tap/cards/insights` | GET | Bearer | Difficult card analytics |
| `hoc-tap/cards/topics` | GET | Bearer | Group by topic |

## Session (Chat)

**Start**: `POST /sessions` → session object with `id`

**Message flow**:
- User: `POST /sessions/[id]/messages {text}`
- Server calls Groq, streams back assistant message
- Assistant message auto-inserted in DB (one transaction)

**End session**: `PATCH /sessions/[id]` with summary + endedAt

**If Groq fails**: Return 502, no message saved. Session remains open.

## Placement Test

**GET**: shows questions (multiple choice)

**POST /placement-test/submit**: 
- Input: answers dict
- Output: `{cefrLevel, skills: {..}, summary}`
- **Overwrites all skill scores** (design choice pending review)

## Lessons (`hoc-tap`)

**Course**: list of lessons in order

**Subject**: domain (e.g., "Business English", "Conversation")

**Lesson**: one session of instruction within a course

**Status**: not_started | in_progress | completed

**Activity** (`study_logs.activity`): `LESSON` (default), `CARD_REVIEW` (flashcard review session), `PRACTICE` (AI chat practice; migration 0012, dev only until production migrate)

**Logs (`POST /hoc-tap/logs`, 201)**: CARD_REVIEW and PRACTICE take only `subjectId`, `minutes` (1–1440), `note`; `courseId` / `sections` → 400 `card_review_no_course|sections` / `practice_no_course|sections`. Always today (VN). PRACTICE also takes optional `practiceSessionId` (must be the user's `projects.type = PRACTICE`, else 404 `practice_session_not_found`; one log per session, repeat → 409 `practice_already_logged`, also under parallel requests via unique index; `practiceSessionId` with another activity → 400 `practice_session_only_practice`). Deleting the chat session keeps the log (`practice_session_id` → null). `PATCH /logs/[id]` on CARD_REVIEW / PRACTICE changes only `minutes`, `note`; other activity → 400 `activity_locked`. Minutes goal = LESSON + CARD_REVIEW + PRACTICE.

**Overview additions** (`GET /hoc-tap/overview`, additive): `subjects[].today.minutesByActivity {LESSON, CARD_REVIEW, PRACTICE}`, `subjects[].streak` + `pendingReasonDates` (same functions as the STUDY routine: `subjectStudyStats` → `studyRoutineExtras` + `routineStats`; subject with a STUDY routine uses that routine's weekdays/created date, otherwise a virtual every-day routine from the subject's created date), `subjects[].cards.total` (non-suspended cards), `subjects[].next.minutes` (also `nextSection.minutes` in courseView).

## Flashcards (New)

**Card**: phrase + meaning + example + metadata

**Stages**: NEW → LEARNING → WEEKLY → MONTHLY → QUARTERLY

**Ratings**: NOT_YET (need more time) / REVIEW_AGAIN (failed) / REMEMBERED (pass)

**Queue**: up to 20 cards/day, split into buckets: DUE (overdue) / NEW / HARD (failing) / RANDOM

**Review**: 
- `POST /cards/[id]/review {rating}`
- Locked during review (no parallel updates)
- Returns next stage + due date

**Parse**: `POST /cards/parse {subjectId, text}` — validate without saving

**Import**: `POST /cards/import {subjectId, logId?, cards[]}` — bulk load, skip duplicates

**Insights**: `GET /cards/insights` — difficult cards, grouped by topic/lesson/kind

## Validation

- **Chat**: text required, ≤ 5000 chars
- **Audio**: ≤ 4 MB (checked in body size limit)
- **Cards**: phrase ≥ 2 words, ≤ 255 chars; kind ∈ PHRASAL_VERB | COLLOCATION | IDIOM | PATTERN | EXPRESSION; ≤ 3 topics
- **Ratings**: NOT_YET | REVIEW_AGAIN | REMEMBERED
- **Times**: VN time for dates; microsecond precision for card cursors

## Errors

Common codes:
- `ai_unavailable`: 502 (Groq error)
- `card_not_found`, `subject_not_found`: 404
- `card_suspended`, `not_in_today_plan`, `already_finished_today`, `not_due_yet`: 409
- `duplicate_phrase`: 409
- `invalid_cards`: 400 (parse/import error)

## Dependencies

- **Groq API**: chat, transcription, TTS
- **Validation**: zod (all inputs)
- **Time**: `lib/vn-time.ts`
- **AI helpers**: `lib/groq.ts`, `lib/study-card-*.ts`

## Notes

- All filtered by `user_id`
- Skill scores stored per user (not per session)
- Placement test is one-time or repeatable? (design unclear)
- Card daily quota: 20 (configurable per subject)
- Spaced repetition: SM-2 inspired schedule
- See `amber-v4/docs/tra-dinh-the-tu-vung-ke-hoach.md` for flashcard design
