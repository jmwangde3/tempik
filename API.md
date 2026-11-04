# Tempik API

Tempik exposes a REST API for session management, inbox operations, and message retrieval. All endpoints live under `/api/`.

**Base URL:** `https://YOUR_DOMAIN/api/`

---

## Authentication

Tempik uses **anonymous session tokens** — no login required.

1. Call `GET /api/session` to obtain a `sessionId`
2. Pass `x-session-id` header on all subsequent requests
3. Inboxes are scoped to the session: Browser A cannot see Browser B's inboxes

The session ID is a UUIDv4 and the only credential in this API. Values that are
not UUID-shaped are rejected with `400` instead of being stored, so a client
cannot smuggle arbitrary strings into the database.

> **Timestamps** are ISO-8601 UTC (`2026-11-04T13:26:32Z`). They used to be
> returned as `2026-11-04 13:26:32`, which browsers parse as *local* time and
> therefore displayed eight hours off in GMT+8. Parse them as instants, not as
> wall-clock strings.

> **Message bodies** are plain text. HTML mail is flattened server-side
> (links become `label (url)`), so no consumer ever needs to render markup.

---

## Endpoints

### GET `/api/config`

Returns the public app configuration.

**Headers:** none

**Response** `200 OK`

```json
{
  "appName": "Tempik",
  "mailDomain": "example.com",
  "mailDomains": ["example.com", "another-domain.my.id"],
  "webHost": "tempik.example.com",
  "maxInboxesPerSession": 50,
  "messageLimit": 50
}
```

| Field | Type | Description |
|---|---|---|
| `appName` | string | App display name |
| `mailDomain` | string | Default mail domain (first in the list, for backward compat) |
| `mailDomains` | string[] | All available mail domains |
| `webHost` | string | Web frontend hostname |
| `maxInboxesPerSession` | number | Inboxes one session may hold (`MAX_INBOXES_PER_SESSION`) |
| `messageLimit` | number | Default page size for the messages endpoint |

---

### GET `/api/session`

Creates or retrieves an anonymous browser session. If you pass an existing `x-session-id`, it returns the same ID. If you don't, it generates a new one.

**Headers**

| Header | Required | Description |
|---|---|---|
| `x-session-id` | No | Existing session ID (UUID v4). Omit to create a new session. |

**Response** `200 OK`

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Errors**

| Status | Message | Meaning |
|---|---|---|
| `400` | `Malformed x-session-id (expected UUID)` | The header you sent is not a UUID |

**Usage**

```bash
# Create a new session
curl -s https://YOUR_DOMAIN/api/session

# Reuse an existing session
curl -s https://YOUR_DOMAIN/api/session \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000"
```

---

### GET `/api/inboxes`

Lists all inboxes linked to your session.

**Headers**

| Header | Required | Description |
|---|---|---|
| `x-session-id` | **Yes** | Session ID from `/api/session` |

**Response** `200 OK`

```json
[
  {
    "address": "kopihujan23@example.com",
    "created_at": "2026-06-26 07:48:19"
  }
]
```

**Errors**

| Status | Message | Meaning |
|---|---|---|
| `400` | `Missing x-session-id` | No session header provided |

**Usage**

```bash
curl -s https://YOUR_DOMAIN/api/inboxes \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000"
```

---

### POST `/api/inboxes`

Creates a new inbox (or claims an existing one) and links it to your session.

**Headers**

| Header | Required | Description |
|---|---|---|
| `x-session-id` | **Yes** | Session ID |
| `Content-Type` | Yes | `application/json` |

**Request Body**

| Field | Required | Description |
|---|---|---|
| `localPart` | No | Custom username. 1–64 characters from `a-z` `0-9` `.` `-` `_`, must start and end with a letter or digit, no `..`. Lowercased before use. Omit for a random address. |
| `domain` | No | Domain override. Must be one of the allowed domains from `GET /api/config`'s `mailDomains`. Defaults to the first configured domain. Invalid domains are rejected with `400`. |

**Examples**

```json
// Custom address on default domain
{ "localPart": "myinbox" }
// → myinbox@example.com

// Random address
{}
// → langitbiru23@example.com

// Custom address on specific domain
{ "localPart": "test", "domain": "another-domain.my.id" }
// → test@another-domain.my.id

// Random on specific domain
{ "domain": "another-domain.my.id" }
// → melatijaya87@another-domain.my.id

// Invalid domain → 400
{ "domain": "evil.com" }
// → { "error": "Invalid domain: evil.com. Allowed: example.com, another-domain.my.id" }
```

**Response** `201 Created`

```json
{
  "address": "langitbiru23@example.com",
  "created_at": "2026-06-26 07:48:19"
}
```

**Errors**

| Status | Message | Meaning |
|---|---|---|
| `400` | `Missing x-session-id` | No session header provided |
| `400` | `Malformed x-session-id (expected UUID)` | Header is not a UUID |
| `400` | `Invalid domain: ...` | Requested domain is not in the allowed list. Check `GET /config`'s `mailDomains`. |
| `400` | `Invalid localPart: ...` | The local-part breaks the character/length rules |
| `409` | `Address is already in use by another session` | The address exists and belongs to someone else |
| `429` | `Session limit reached (N inboxes)...` | Too many inboxes in this session |

**Notes**
- An address that nobody holds yet can be claimed by name. An address that is
  **already linked to another session is refused with `409`** — otherwise
  knowing (or guessing) an address would be enough to read its mail. Deleting an
  inbox from your session releases the name, so you can claim it again later.
- Re-posting an address your own session already holds is idempotent (`201`) and
  does not count against the limit twice.
- Random addresses are human-readable Indonesian-style (e.g. `kopihujan42`, `bulanbiru17`)
- The generator checks the actual database for uniqueness — it never creates duplicates, even across different sessions

**Usage**

```bash
# Create with custom name
curl -s -X POST https://YOUR_DOMAIN/api/inboxes \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{"localPart":"myinbox"}'

# Create random
curl -s -X POST https://YOUR_DOMAIN/api/inboxes \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

### DELETE `/api/inboxes/:address`

Removes an inbox from your session. Does **not** delete the inbox or its messages from the database — it just unlinks it from your session so it no longer appears in your list. Deletion of expired data is handled by the nightly retention sweep (`RETENTION_DAYS`).

**Headers**

| Header | Required | Description |
|---|---|---|
| `x-session-id` | **Yes** | Session ID |

**Path Parameters**

| Param | Description |
|---|---|
| `address` | Full email address, URI-encoded. Example: `test123%40example.com` |

**Response** `200 OK`

```json
{ "ok": true }
```

**Errors**

| Status | Message | Meaning |
|---|---|---|
| `400` | `Missing x-session-id` | No session header |

**Usage**

```bash
curl -s -X DELETE "https://YOUR_DOMAIN/api/inboxes/test123%40example.com" \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000"
```

---

### GET `/api/inboxes/:address/messages`

Fetches messages for a given inbox, newest first. The inbox must be linked to your session.

**Headers**

| Header | Required | Description |
|---|---|---|
| `x-session-id` | **Yes** | Session ID |

**Path Parameters**

| Param | Description |
|---|---|
| `address` | Full email address, URI-encoded. |

**Query Parameters**

| Param | Default | Description |
|---|---|---|
| `limit` | `50` | Page size, clamped to 1–200 |
| `offset` | `0` | Skip this many rows |

**Response** `200 OK`

```json
[
  {
    "id": "msg_1782461413912_0956a83c",
    "inbox_address": "test123@example.com",
    "from_address": "someone@gmail.com",
    "subject": "Hello",
    "body": "This is the email body",
    "received_at": "2026-06-26T08:10:14Z"
  }
]
```

Bodies are plain text and capped at 100 000 characters at ingest; longer mail
ends with `[message truncated]`.

**Errors**

| Status | Message | Meaning |
|---|---|---|
| `400` | `Missing x-session-id` | No session header |
| `400` | `Malformed x-session-id (expected UUID)` | Header is not a UUID |
| `403` | `Inbox not in this session` | The inbox is not linked to your session. `POST /api/inboxes` with the matching `localPart` claims it — only if no other session holds it (`409` otherwise). |

**Usage**

```bash
curl -s "https://YOUR_DOMAIN/api/inboxes/test123%40example.com/messages" \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000"
```

---

## Full flow example

```bash
DOMAIN="tempik.YOURDOMAIN.com"

# 1. Get session
SESSION=$(curl -s https://$DOMAIN/api/session | jq -r '.sessionId')

# 2. Create an inbox
INBOX=$(curl -s -X POST https://$DOMAIN/api/inboxes \
  -H "x-session-id: $SESSION" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.address')
echo "Created: $INBOX"

# 3. ...wait for an email to arrive...

# 4. List inboxes
curl -s https://$DOMAIN/api/inboxes -H "x-session-id: $SESSION" | jq '.'

# 5. Read messages
ENCODED=$(echo -n "$INBOX" | jq -sRr '@uri')
curl -s "https://$DOMAIN/api/inboxes/$ENCODED/messages" \
  -H "x-session-id: $SESSION" | jq '.'

# 6. Delete inbox from session
curl -s -X DELETE "https://$DOMAIN/api/inboxes/$ENCODED" \
  -H "x-session-id: $SESSION"
```

---

## Errors

All error responses follow this format:

```json
{
  "error": "Human-readable error message"
}
```

| Status | When |
|---|---|
| `400` | Missing/malformed `x-session-id`, invalid `localPart`, or invalid domain in POST `/api/inboxes` |
| `403` | Unauthorized — inbox not linked to your session |
| `404` | Route not found |
| `409` | Address already held by another session |
| `429` | Session inbox limit reached |

---

## Session isolation

Tempik uses per-browser anonymous sessions:

| Scenario | Behavior |
|---|---|
| New browser | Empty inbox list |
| After creating inbox A | Only inbox A appears in that browser |
| Open in incognito | Empty — different session |
| Refresh same browser | Inboxes persist (via `localStorage`) |
| Send email to inbox A | Inbox A gets it instantly (email handler auto-creates inbox record) |
