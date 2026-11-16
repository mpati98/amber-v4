# /api/tang-kinh-cac — Personal library (books, documents, highlights)

Knowledge base domain. Books, PDFs, web highlights, reading goals. Global access (no userId filter on most resources, login-based only).

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `documents` | GET/POST | Bearer | List/add documents |
| `documents/[id]` | GET/PATCH/DELETE | Bearer | Get/update/delete document (responses now include `studyCourseId`, `studyCourseTitle`; clients cannot set `studyCourseId`) |
| `documents/random` | GET | Bearer | Get random document |
| `publications` | GET/POST | Bearer | List/add books |
| `publications/[id]` | GET/PATCH/DELETE | Bearer | Get/update/delete book |
| `highlights/[id]` | GET/PATCH/DELETE | Bearer | Get/update/delete highlight |
| `highlights/random` | GET | Bearer | Get random highlight |
| `topics` | GET/POST | Bearer | List/create topics |
| `reading-goals` | GET/POST | Bearer | List/create reading goals |
| `reading-goals/[id]` | PATCH/DELETE | Bearer | Update/delete goal |
| `upload` | POST | Bearer | Upload document file |

## Access Control

**Exception to userId filtering**: Tàng Kinh Các resources are **global** (one shared library for single user). No `user_id` column on most tables.

**Auth required**: All endpoints require Bearer token (login check only, not ownership check).

## Documents

**Type**: PDF, TXT, ePub

**Fields**: title, author, description, filePath (private Blob), uploadedAt, topics[]

**Upload**: `POST /upload` → FormData (file ≤ 4 MB) → returns {url, path, size}

**File storage**: Vercel Blob (private), path `/tang-kinh-cac/[uuid].[ext]`

**Highlights**: passages saved from documents, linked via `documentId`

## Publications

**Type**: Book metadata (title, author, ISBN, description)

**Reading Goal**: link goal to publication (target pages, current progress)

**Cover image**: uploaded via file picker or URL

## Highlights

**Source**: document excerpt (selected text + page/location)

**Fields**: text, context, documentId (or null), topicId (or null), notes, createdAt

**Random highlight**: daily/weekly reminder of past knowledge

## Topics

**Organization**: group documents and highlights

**Tags**: free-form topic names, many-to-many

**Search**: full-text on title + description

## Reading Goals

**Structure**: publication + target (pages or % complete) + deadline

**Progress**: track current page / percentage

**Status**: active | completed | abandoned

## Validation

- File upload: ≤ 4 MB, mime type checked
- Topic names: free text (no restrictions)
- ISBN: optional, validated if provided
- Dates: `YYYY-MM-DD` or ISO timestamp

## Response

- `documents`: list with metadata, topics array
- `publications`: book details + reading goal info
- `highlights`: passage + metadata + context
- Upload: `{url, path, sizeBytes}`

## Notes

- **No userId filter** (exception to pattern)
- One user only (personal library)
- Blob store is private-only
- Random endpoints: useful for spaced review
- Topics are free-form (no controlled vocabulary)
- Highlights without source document allowed (e.g., quotes)
