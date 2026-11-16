# /api/finance — Money & budgets (Nghị Sự Đường)

Personal finance domain. Accounts, transactions, budgets, categories.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `summary` | GET | Bearer | Month summary (amount, trend) |
| `overview` | GET | Bearer | Full finance overview |
| `accounts` | GET/POST | Bearer | List/create accounts |
| `accounts/[id]` | GET/PATCH/DELETE | Bearer | Get/update/delete account |
| `categories` | GET/POST | Bearer | List/create categories |
| `transactions` | GET/POST | Bearer | List/create transactions |
| `transactions/[id]` | GET/PATCH/DELETE | Bearer | Get/update/delete transaction |
| `budgets` | GET/POST | Bearer | List/create budgets |
| `projects` | GET | Bearer | Finance view (projects monthly) |

## Data Types

**Money**: returned as string (client parses to Decimal)

**Accounts**: name, type (CASH | CHECKING | SAVINGS), balance

**Categories**: name, type (INCOME | EXPENSE)

**Transactions**: amount (string), date, note, accountId, categoryId

**Budgets**: category, month, limit (string)

## Validation

- Email/phone formats
- Dates: `YYYY-MM-DD`
- Money: numeric string (e.g., "1234567.89")

## Response Structure

- `summary`: `{month, amount, comparison}`
- `overview`: accounts + recent transactions + budget info
- Lists use pagination where applicable

## Notes

- All filtered by `user_id`
- One user only (personal finance)
- Money stored as numeric, returned as string
- Deletion cascades (e.g., delete account → delete transactions)
