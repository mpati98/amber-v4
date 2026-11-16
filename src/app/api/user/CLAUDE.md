# /api/user — User account management (Hồ sơ)

User profile and account operations.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `route` | GET/PATCH | Bearer | Get/update profile |
| `password` | POST | Bearer | Change password |

## Profile

**GET `/`** 
- Returns: `{id, email, name, createdAt, ...}`

**PATCH `/`**
- Body: `{name, ...}` (only certain fields)
- Returns: updated profile
- Email/password: separate endpoints

## Password Change

**POST `/password`**
- Body: `{oldPassword, newPassword}`
- Validates old password
- Hashes new password (bcrypt)
- **Deletes all refresh tokens** of user (force re-login on all devices)
- Returns: success message

## Validation

- Name: ≤ 255 chars
- Email: immutable (cannot change via API)
- Password: min 8 chars, bcrypt hashed
- Old password: must match current hash

## Notes

- All filtered by `user_id`
- One user only (personal account)
- Changing password logs out all sessions
- No password reset email flow (single user)
