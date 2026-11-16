# /api/music — Audio tracks (personal music library)

User's personal music collection. MP3 upload via client token, playback via signed stream URLs.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `upload` | POST | Bearer | Get client token for Blob upload |
| `tracks` | GET/POST | Bearer | List/create track metadata |
| `tracks/[id]` | GET/PATCH/DELETE | Bearer | Get/update/delete track |
| `tracks/[id]/stream` | GET | Signed token | Stream audio (no Bearer) |

## Upload Flow

1. **GET `/upload`** (Bearer token)
   - Returns: `{token, uploadUrl}`
   - Token valid for Vercel Blob upload only
   - Path restricted: `music/<userId>/*.mp3`
   - MIME type: `audio/mpeg` only
   - Max 50 MB per file

2. **Client uploads to Blob** (no API call)
   - Uses token from step 1
   - Direct to Vercel Blob endpoint
   - Returns: `{blobUrl, blobPathname}`

3. **POST `/tracks`** (Bearer token)
   - Body: `{title, blobUrl, blobPathname, sizeBytes, artist?, durationSeconds?}`
   - Server validates and saves metadata
   - Returns full track object

## Playback

**GET `/tracks`** (Bearer token)
- Returns: `{tracks: [{id, title, artist, createdAt, ...streamUrl}]}`
- `streamUrl`: signed token for this track, expires 1h
- Token: HS256, tracks one specific track ID

**GET `/tracks/[id]/stream?token=...** (Signed token)
- No Bearer header required
- HTTP Range support (206 Partial Content)
- Returns: audio/mpeg stream
- 401 if token invalid/expired/wrong track

## Track Metadata

**Fields**: 
- `title` (required), `artist` (optional)
- `blobUrl`, `blobPathname` (Blob info)
- `sizeBytes`, `durationSeconds` (metadata)
- `position` (order in list)
- `createdAt`, `updatedAt`

**Position**: continuous from 0, auto-updated when reordering

## Operations

- **PATCH**: update title, artist, or position
- **DELETE**: delete track + remove Blob file
- **Reorder**: PATCH with new position, gaps filled

## Validation

- Title required, ≤ 255 chars
- File size: ≤ 50 MB (checked before token issue)
- Blob path: must start with `music/<userId>/`
- Token expiry: 1 hour from issue

## Response

- `tracks`: array with `streamUrl` (valid 1h)
- Single track: full metadata
- Upload: `{token, uploadUrl}`

## Errors

- `file_too_large`: 413 (> 50 MB)
- `invalid_token`: 401 (stream endpoint)
- `track_not_found`: 404

## Notes

- All filtered by `user_id`
- One user only
- Blob store is **private only** (cannot change to public)
- Stream token HS256, specific to track + expires 1h
- **Never log `streamUrl` or token**
- Client refreshes `streamUrl` after 1h (GET `/tracks`)
- Range requests: supports basic Range header (not multi-range)
