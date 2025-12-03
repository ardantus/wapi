# Example API Server for whatsapp-web.js (local repo)

This example demonstrates a small Express-based API server that uses the `whatsapp-web.js` client from this repository.

Features:
- Serve QR code image for authentication
- SSE endpoint `/events` to stream WhatsApp events (message, ready, authenticated, etc.)
- Endpoints to send text and media messages
- Endpoints to list chats and contacts
- **PostgreSQL database** for message history and client metadata persistence
- **pgAdmin** web UI for database management
- **Redis** for session storage
- **Media storage** in host-mounted folder with symlink support

## Prerequisites

- Node.js >= 16 (for local development)
- Docker & Docker Compose (for containerized deployment)
- This example requires the package root (two levels up) to be the repo root containing `index.js`.
- Puppeteer and Chromium will be used by `whatsapp-web.js` (automatic)

## Docker Deployment (Recommended)

### Setup

1. Navigate to this folder:
```bash
cd examples/api-server
```

2. Update `.env` with your custom credentials (optional):
```bash
# Edit .env to change:
# - UI_CREDENTIALS (username:password for web UI login)
# - POSTGRES_PASSWORD (database password)
# - PGADMIN_PASSWORD (pgAdmin login password)
# - SESSION_SECRET (change to a strong random string in production)
# - DATABASE_URL (already configured for Docker)
cat .env
```

3. Start all services (API, PostgreSQL, pgAdmin, Redis):
```bash
docker-compose up -d
```

### Access Services

- **WhatsApp API**: http://localhost:3000
- **PostgreSQL Database**: `localhost:5432`
- **pgAdmin** (Database UI): http://localhost:5050 (login with credentials from `.env`)
- **Redis**: `localhost:6379`

### Database & Media Storage

- **Database**: Messages, client metadata, and all chat history stored in PostgreSQL (persistent volume: `pg-data`)
- **Media Files**: Stored in `./data` folder (host-mounted) - can be backed up independently
- **Media Paths**: Stored as relative paths in database, allowing easy migration/backup

### Migration from SQLite (if applicable)

If you had an existing `whatsapp_messages.db` file:
1. Place it in the `examples/api-server` folder
2. Run `docker-compose up -d`
3. Server will automatically migrate all data to PostgreSQL and remove the SQLite file

### pgAdmin Setup (First Time)

1. Open http://localhost:5050
2. Login with email/password from `.env` (default: `admin@example.com` / `admin`)
3. Create a new server connection:
   - Host: `postgres` (or `localhost` if connecting from outside Docker)
   - Port: `5432`
   - Database: `whatsapp` (from `.env`)
   - Username: `postgres`
   - Password: (from `.env` POSTGRES_PASSWORD)

### Stopping Services

```bash
docker-compose down
```

To also remove database volumes (WARNING: deletes all data):
```bash
docker-compose down -v
```

## Local Development (Without Docker)

Quick start

1. Open a terminal and go to this folder:

```bash
cd examples/api-server
```

2. Install dependencies (this installs only example dependencies):

```bash
npm install
```

3. Start the server:

```bash
npm start
```

4. Open `http://localhost:3000/events` in a browser or use `curl` to receive events.

### Additional setup (Puppeteer/Chromium)

The `whatsapp-web.js` client depends on Puppeteer. Because this example `require('../../')` the package root, Node will resolve dependencies from the repo root. If you got a `Cannot find module 'puppeteer'` error, install Puppeteer in the repository root.

From the repo root:

```bash
cd /Users/ziege/Documents/Documents/github.com/whatsapp-web.js
npm install puppeteer --save
```

If you want to avoid Chromium download (you have a compatible Chrome/Chromium installed), skip download and provide an executable path when running the server:

```bash
# skip chromium download during install
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install puppeteer --save

# start server while pointing to an existing Chrome binary (macOS example)
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
	node examples/api-server/server.js
```

Make sure Node version is compatible (Node >=16 recommended).

Useful endpoints

- `GET /status` - JSON status of client
- `GET /qr` - PNG image of latest QR (if available)
- `GET /events` - Server-Sent Events stream
- `POST /send` - Send text message { "to": "62812...@c.us", "message": "hello" }
- `POST /send-media` - Send media { "to": "...", "filename": "img.jpg", "mimetype": "image/jpeg", "data": "<base64>" }
- `GET /chats` - list chats with message count
- `GET /chats/:id/messages` - load message history from database (includes media metadata)
- `GET /media/:id/download` - download media file (served from `./data` folder, requires `client` and `api_key`)
- `GET /contacts` - list contacts
- `GET /clients` - list created client sessions
- `POST /clients` - create new client session (body: { id?: "customId" })
- `DELETE /clients/:id` - delete a client session

All endpoints that interact with a client accept an optional `client` query parameter (or `client` field in POST body). Example: `/chats?client=c_12345` or `POST /send?client=c_12345`.

All endpoints require an API key (generated per client) as `api_key` query parameter or header `X-API-Key`.

Examples (curl and browser)

- Get client status (JSON):

```bash
curl http://localhost:3000/status
# => { "status": "ready" }
```

- Stream events (Server-Sent Events). In terminal:

```bash
curl -N http://localhost:3000/events
```

Or open `http://localhost:3000/events` in browser (some browsers will show the stream or you can use an SSE client).

- Download the QR image (if available) to scan with your phone:

```bash
curl http://localhost:3000/qr --output qr.png
open qr.png   # macOS
```

- Send a text message (to user or group):

```bash
# Note: `client` and `api_key` are provided when you create a client (POST /clients)
# or listed via `GET /clients` (the UI also shows the apiKey for each client).
# Use the returned client id and apiKey in API requests. Example:
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{"to":"6281127009200@c.us","message":"Halo dari API"}'
```

- Send a media file (base64 payload):

```bash
curl -X POST http://localhost:3000/send-media \
	-H "Content-Type: application/json" \
	-d '{"to":"6281234567890@c.us","filename":"photo.jpg","mimetype":"image/jpeg","data":"<BASE64_DATA>"}'
```

- List chats and find a group id (groups have `isGroup: true`):

```bash
curl http://localhost:3000/chats
# => JSON array, look for an item with "isGroup": true and note `id` (e.g. "12345-67890@g.us")
```

# Example API server (whatsapp-web.js) — Multi-client demo with security & persistence

This example is a small Express API server that demonstrates how to run multiple `whatsapp-web.js` client sessions (multi‑WhatsApp), provide a REST API with **per-client API keys**, a **SQLite database** for message persistence, and a minimal web UI similar to a simplified WhatsApp Web.

Key features
- **Multi-client (multi‑WhatsApp) sessions** with unique API keys per client for secure access
- **PostgreSQL message storage** — automatically save all messages to persistent database with full metadata
- **REST endpoints** to send text/media, list chats/contacts, manage groups, read message history, and more
- **New HIGH PRIORITY features:**
  - **Get contact info by ID** — retrieve detailed contact information
  - **Get profile pictures** — fetch contact profile picture URLs (displayed in UI chat list)
  - **React to messages** — send emoji reactions to any message (👍 button in UI)
  - **Mention users** — tag users in messages with @ (automatic input field in UI)
  - **Mute/unmute chats** — silence notifications with optional duration (🔇/🔔 buttons in UI)
- **Server-Sent Events (`/events`)** streaming WhatsApp events per client (QR, ready, messages, group events)
- **Web UI (`/`)** to manage clients, scan QR, view chats with profile pictures, read full message history, react to messages, mention users, and perform group actions
- **Message input history** — arrow keys to navigate message history
- **File upload** for media sends directly from UI
- **Resource telemetry** — track uptime, memory usage, and message count per client
- **Message search** — search chats and messages with real-time filtering
- **Export messages** — export chat messages to JSON, CSV, or TXT formats
- **Real-time message display** — nicely formatted messages with timestamps, sender names, profile pictures, and live updates
- **Mute controls** — duration input with mute/unmute buttons in chat header

Prerequisites
- Node.js >= 16
- This example expects the repository root (two levels up) to contain the `whatsapp-web.js` package (the server `require('../../')`).

Installation

1. Install example dependencies:

```bash
cd examples/api-server
npm install
```

**Note:** `better-sqlite3` requires build tools (node-gyp). On macOS, ensure Xcode Command Line Tools are installed:
```bash
xcode-select --install
```

2. Install Puppeteer at the repo root so that `whatsapp-web.js` can require it (the package in the repo root may `require('puppeteer')`). From the repository root:

```bash
cd /Users/ziege/Documents/Documents/github.com/whatsapp-web.js
npm install puppeteer --save
```

Notes about Puppeteer/Chromium
- Installing `puppeteer` downloads a Chromium binary by default (large). To skip download and use an existing Chrome/Chromium install:

```bash
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install puppeteer --save
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
	node examples/api-server/server.js
```

Run the server

```bash
# from repo root (recommended so puppeteer is available)
node examples/api-server/server.js

# or from examples folder (after npm install there)
cd examples/api-server
npm start
```

Open the demo UI: http://localhost:3000/

API overview

All API calls that require a WhatsApp session require an **API key** (unique per client) for authentication. The API key can be passed via:
- Query parameter: `?api_key=<key>`
- HTTP header: `X-API-Key: <key>`
- Request body: `{ "api_key": "<key>" }`

**Get API key:** When you create a client via `POST /clients`, the response includes the `apiKey`. The UI displays it at the top and allows copying.

Example: `/chats?client=c_12345&api_key=abc123...` or `POST /send?client=c_12345` with header `X-API-Key: abc123...`

Endpoints (high-level)

- `GET /clients` — list created client sessions with telemetry (no auth required)
- `POST /clients` — create a new client session (no auth required). Returns `{ success, id, apiKey }`
- `DELETE /clients/:id` — delete a client session (no auth required)
- `GET /status?client=ID&api_key=KEY` — get status and telemetry for a client
- `GET /qr?client=ID` — get latest QR image for client (PNG, no auth)
- `GET /events` — SSE stream for events. Use `?client=ID` to subscribe to a specific client only
- `GET /chats?client=ID&api_key=KEY` — list chats for client
- `GET /chats/:id/messages?client=ID&api_key=KEY&limit=50` — get recent messages for chat (from SQLite + library, includes media metadata)
- `GET /contacts?client=ID&api_key=KEY` — list contacts for client
- **Messaging:**
  - `POST /send?client=ID&api_key=KEY` — send text message. Body: `{ "to": "...", "message": "...", "mentions": ["id1@c.us"] }` (mentions optional)
  - `POST /send-media?client=ID&api_key=KEY` — send media (images, audio, video, documents). Body: `{ "to": "...", "filename": "x.jpg", "mimetype": "image/jpeg", "data": "<base64>" }`
  - `POST /send-sticker?client=ID&api_key=KEY` — send sticker. Body: `{ "to": "...", "data": "<base64 webp>" }`
  - `POST /send-location?client=ID&api_key=KEY` — send location. Body: `{ "to": "...", "latitude": 6.2088, "longitude": 106.8456, "address": "Jakarta" }`
  - `POST /send-contact?client=ID&api_key=KEY` — send contact card. Body: `{ "to": "...", "contactNumber": "628123..." }`
- **Contacts:**
  - `GET /contact/:id?client=ID&api_key=KEY` — get specific contact info by ID
  - `GET /contact/:id/picture?client=ID&api_key=KEY` — get contact profile picture URL
- **Messages:**
  - `POST /message/:id/react?client=ID&api_key=KEY` — react to message with emoji. Body: `{ "emoji": "👍" }`
- **Chats:**
  - `POST /chat/:id/mute?client=ID&api_key=KEY` — mute chat. Body: `{ "duration": 3600 }` (optional, seconds)
  - `POST /chat/:id/unmute?client=ID&api_key=KEY` — unmute chat
- **Media Receive:**
  - `GET /media/:id/download?client=ID&api_key=KEY` — download media from a received message (images, audio, video, documents)
- **Group actions** (body: `{ groupId, participants: [...] }` and `api_key`):
  - `GET /group/:id/participants?client=ID&api_key=KEY` — list participants
  - `POST /group/add` — add participants
  - `POST /group/remove` — remove participants
  - `POST /group/promote` — promote to admin
  - `POST /group/demote` — demote from admin
  - `GET /group/:id/invite?client=ID&api_key=KEY` — get group invite link
  - `POST /group/join` — join group by invite code. Body: `{ "inviteCode": "ABC123..." }`
  - `PUT /group/:id/info` — update group subject/description. Body: `{ "subject": "...", "description": "..." }`
  - `PUT /group/:id/settings` — update group permissions. Body: `{ "messagesAdminsOnly": true, "infoAdminsOnly": false }`

**Server-Sent Events (SSE)**

- SSE endpoint: `/events`
- Each SSE event carries a JSON payload with `clientId` and `payload` fields. Available events:
  - `message` — received message (includes `hasMedia`, `mediaType`, `isLocation`, `isContact`, `isSticker`)
  - `message_create` — message created
  - `message_reaction` — reaction to a message
  - `message_ack` — message delivery status change
  - `message_revoke_everyone` — message revoked
  - `group_join` — user joined group
  - `group_leave` — user left group
  - `group_update` — group info updated (channels support)
- Subscribe to a specific client with: `/events?client=ID`

Web UI

- Visit `http://localhost:3000/`.
- The UI provides:
  - **Client management** — select, create, delete clients (each with unique API key shown and copyable)
  - **API Key display** — shows current client's API key with copy button
  - **QR display** — shows QR for the selected client (if authentication needed)
  - **Chat search** — real-time filter chats by name/ID (🔍 Search chats)
  - **Load chats** — fetch and display chat list for selected client
  - **Chat view** — shows recent messages from database and library, real-time appends when new messages arrive
  - **Message search** — filter loaded messages by text or sender (🔍 Search messages with highlighting)
  - **Export messages** — download chat messages in JSON, CSV, or TXT format (📥 Export button)
  - **Send message** — text input with message history navigation (↑/↓ arrow keys)
  - **Send media** — file upload input for images/videos, converts to base64 and sends
  - **Group actions panel** — add/remove/promote/demote participants
  - **Live event log** — SSE events displayed in real-time
  - **Resource telemetry** — uptime, memory usage, message count visible in client selector
  - **Message formatting** — each message shows timestamp, sender name, and content in formatted boxes

Message Storage & History

- **SQLite database** (`whatsapp_messages.db`): All messages received are automatically saved to SQLite.
- **Message persistence**: When you load a chat, messages are fetched from both the library and the database, combined and deduplicated.
- **Client persistence**: All created clients (IDs and API keys) are saved to the SQLite `clients_metadata` table. When the API server restarts, all previously created clients are automatically restored (not just the default client).
- **Input history**: Previous messages are stored in browser localStorage. Use arrow keys (↑/↓) in the message textarea to navigate history.
- **Telemetry**: Each client tracks uptime (milliseconds since creation), memory usage, and total messages saved.

Examples (curl)

- List clients with telemetry:

```bash
curl http://localhost:3000/clients
# => { "clients": [ { "id": "default", "status": "ready", "apiKey": "3220bd8c77f8443c76291f1a3c55fdf9624bcbd6fe690955428e6ecf135d3631", "uptime": 5000, "messagesSaved": 10, "memoryUsage": "45 MB" }, ... ] }
```

- Create client (returns API key):

```bash
curl -X POST http://localhost:3000/clients -H "Content-Type: application/json" -d '{}'
# => { "success": true, "id": "default", "apiKey": "3220bd8c77f8443c76291f1a3c55fdf9624bcbd6fe690955428e6ecf135d3631" }
```

- Send message using a client with API key:

```bash
curl -X POST "http://localhost:3000/send?client=default&api_key=3220bd8c77f8443c76291f1a3c55fdf9624bcbd6fe690955428e6ecf135d3631" \
  -H "Content-Type: application/json" \
 	-d '{"to":"6281127009200@c.us","message":"Halo dari client"}'
```

- Send message with mentions (tag users):

```bash
curl -X POST "http://localhost:3000/send?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"120363123456@g.us","message":"Hello @John!","mentions":["6281234@c.us"]}'
```

```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -H "api_key: YOUR_API_KEY" \
  -d '{"to":"6281234567890@c.us","message":"Test outgoing message"}'
```

- List chats for a client:

```bash
curl "http://localhost:3000/chats?client=default&api_key=3220bd8c77f8443c76291f1a3c55fdf9624bcbd6fe690955428e6ecf135d3631"
```

- Get chat messages (from SQLite + library):

```bash
curl "http://localhost:3000/chats/12345-67890@g.us/messages?client=default&api_key=def789...&limit=50"
```

- Send media with base64 encoded file:

```bash
curl -X POST "http://localhost:3000/send-media?client=default&api_key=3220bd8c77f8443c76291f1a3c55fdf9624bcbd6fe690955428e6ecf135d3631" \
  -H "Content-Type: application/json" \
  -d '{"to":"6281127009200@c.us","filename":"photo.jpg","mimetype":"image/jpeg","data":"<BASE64_DATA>"}'
```

- Send sticker (WebP image):

```bash
curl -X POST "http://localhost:3000/send-sticker?client=default&api_key=3220bd8c77f8443c76291f1a3c55fdf9624bcbd6fe690955428e6ecf135d3631" \
  -H "Content-Type: application/json" \
  -d '{"to":"6281127009200@c.us","data":"<BASE64_WEBP_DATA>"}'
```

- Send location:

```bash
curl -X POST "http://localhost:3000/send-location?client=default&api_key=3220bd8c77f8443c76291f1a3c55fdf9624bcbd6fe690955428e6ecf135d3631" \
  -H "Content-Type: application/json" \
  -d '{"to":"6281127009200@c.us","latitude":-6.2088,"longitude":106.8456,"address":"Jakarta, Indonesia"}'
```

- Send contact card:

```bash
curl -X POST "http://localhost:3000/send-contact?client=default&api_key=3220bd8c77f8443c76291f1a3c55fdf9624bcbd6fe690955428e6ecf135d3631" \
  -H "Content-Type: application/json" \
  -d '{"to":"6281127009200@c.us","contactNumber":"628123456789"}'
```

- Download media from received message:

```bash
curl "http://localhost:3000/media/msg_id_here/download?client=default&api_key=3220bd8c77f8443c76291f1a3c55fdf9624bcbd6fe690955428e6ecf135d3631" \
  --output downloaded_media.jpg
```

- Add participant to group with API key:

```bash
curl -X POST "http://localhost:3000/group/add?client=default&api_key=3220bd8c77f8443c76291f1a3c55fdf9624bcbd6fe690955428e6ecf135d3631" \
  -H "Content-Type: application/json" \
  -d '{"groupId":"12345-67890@g.us","participants":["6281127009200@c.us"]}'
```

- Get contact info by ID:

```bash
curl "http://localhost:3000/contact/6281234@c.us?client=default&api_key=YOUR_API_KEY"
```

- Get contact profile picture:

```bash
curl "http://localhost:3000/contact/6281234@c.us/picture?client=default&api_key=YOUR_API_KEY"
# Response: {"contactId":"6281234@c.us","profilePicUrl":"https://..."}
```

- React to a message with emoji:

```bash
curl -X POST "http://localhost:3000/message/MESSAGE_ID/react?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"emoji":"❤️"}'
```

- Mute a chat for 1 hour (3600 seconds):

```bash
curl -X POST "http://localhost:3000/chat/6281234@c.us/mute?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"duration":3600}'
```

- Mute a chat indefinitely (no duration):

```bash
curl -X POST "http://localhost:3000/chat/6281234@c.us/mute?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

- Unmute a chat:

```bash
curl -X POST "http://localhost:3000/chat/6281234@c.us/unmute?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json"
```

- Get group invite link:

```bash
curl "http://localhost:3000/group/GROUP_ID@g.us/invite?client=default&api_key=YOUR_API_KEY"
# Response: {"success":true,"groupId":"...","inviteCode":"ABC123","inviteLink":"https://chat.whatsapp.com/ABC123"}
```

- Join group by invite code:

```bash
curl -X POST "http://localhost:3000/group/join?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"inviteCode":"ABC123xyz"}'

# Or use full invite link:
curl -X POST "http://localhost:3000/group/join?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"inviteCode":"https://chat.whatsapp.com/ABC123xyz"}'
```

- Update group subject and description:

```bash
curl -X PUT "http://localhost:3000/group/GROUP_ID@g.us/info?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subject":"New Group Name","description":"Updated group description"}'

# Update only subject:
curl -X PUT "http://localhost:3000/group/GROUP_ID@g.us/info?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subject":"New Group Name"}'
```

- Update group settings (permissions):

```bash
# Only admins can send messages:
curl -X PUT "http://localhost:3000/group/GROUP_ID@g.us/settings?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messagesAdminsOnly":true}'

# Only admins can edit group info:
curl -X PUT "http://localhost:3000/group/GROUP_ID@g.us/settings?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"infoAdminsOnly":true}'

# Set both settings:
curl -X PUT "http://localhost:3000/group/GROUP_ID@g.us/settings?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messagesAdminsOnly":true,"infoAdminsOnly":true}'
```

### Contact Management

- Block a contact:

```bash
curl -X POST "http://localhost:3000/contact/6281234@c.us/block?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json"
# Response: {"success":true,"contactId":"6281234@c.us","blocked":true}
```

- Unblock a contact:

```bash
curl -X POST "http://localhost:3000/contact/6281234@c.us/unblock?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json"
# Response: {"success":true,"contactId":"6281234@c.us","blocked":false}
```

- Set user status message (About):

```bash
curl -X PUT "http://localhost:3000/status?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"Busy working 💼"}'
# Response: {"success":true,"status":"Busy working 💼"}
```

### Advanced Messaging

- Send a poll:

```bash
curl -X POST "http://localhost:3000/send-poll?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "6281234@c.us",
    "question": "What is your favorite color?",
    "options": ["Red", "Blue", "Green", "Yellow"],
    "allowMultipleAnswers": false
  }'
# Response: {"success":true,"id":"MESSAGE_ID"}
```

### Channel Management

- Create a new channel:

```bash
curl -X POST "http://localhost:3000/channel/create?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My News Channel",
    "description": "Daily updates and news"
  }'
# Response: {"success":true,"channel":{"title":"My News Channel","nid":{...},"inviteLink":"https://whatsapp.com/channel/...","createdAtTs":...}}
```

- Subscribe to a channel:

```bash
curl -X POST "http://localhost:3000/channel/CHANNEL_ID@newsletter/subscribe?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json"
# Response: {"success":true,"channelId":"CHANNEL_ID@newsletter"}
```

- Unsubscribe from a channel:

```bash
curl -X POST "http://localhost:3000/channel/CHANNEL_ID@newsletter/unsubscribe?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"deleteLocalModels":true}'
# Response: {"success":true,"channelId":"CHANNEL_ID@newsletter"}
```

- Search for channels:

```bash
curl -X POST "http://localhost:3000/channel/search?client=default&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "searchString": "technology",
    "limit": 10
  }'
# Response: {"success":true,"channels":[...]}
```

SSE example (subscribe to a specific client):

```bash
curl -N "http://localhost:3000/events?client=default"
```

Or in browser JavaScript:

```js
const es = new EventSource('/events?client=default');
es.addEventListener('message', e => { const d = JSON.parse(e.data); console.log(d); });
```

Notes and caveats

- **API Key Security**: Each client has a unique auto-generated API key. Protect these keys like passwords. In production, store keys securely (env vars, secrets manager).
- **PostgreSQL persistence (current)**: Messages and metadata are persisted in Postgres. Use pgAdmin or `psql` to query. Legacy SQLite is auto-migrated on startup and removed.
- **Per-key rate limiting (implemented)**: Configurable via `RATE_LIMIT_PER_MINUTE` and backed by Redis if available for global enforcement.
- **Session storage (improved)**: Web UI sessions use in-memory by default or Redis when `REDIS_URL` is set.
- **Puppeteer resource usage**: Each client starts a Chromium instance with `LocalAuth`. Multiple clients increase CPU, memory, and disk usage.
- **Library differences across versions**: `GET /chats/:id/messages` uses `chat.fetchMessages` when available; otherwise it falls back to library models.
- **Group operations permissions**: Admin actions require the client account to be a group admin.
- **Telemetry**: Basic metrics (uptime, memory usage, messages saved) are exposed via `/clients`. For production, add Prometheus/Grafana.

Security considerations

- **Development only**: This example is for development and demonstration. **Do not expose to public networks without:**
  - API key authentication (implemented ✓)
  - Rate limiting
  - HTTPS/TLS
  - Proper access control
  - Input validation on all endpoints
  - Logging and monitoring

Next steps (optional enhancements)

- Add HTTPS and certificate support
- Implement detailed audit logging for all API operations
- Add database backup/restore tooling and scheduled dumps
- Improve UI with richer SSE live updates, search and CSV/JSON export
- Add telemetry export (Prometheus, Grafana) for resource monitoring

---

## Security, Login, and Rate Limiting

### Web UI Login (Session/Cookie Auth)
- If you set `UI_CREDENTIALS` in your `.env` (e.g. `UI_CREDENTIALS=admin:password`), the web UI will require login at `/login`.
- After login, a session cookie is set. You can log out with the Logout button.
- Sessions are stored in memory by default, or in Redis if `REDIS_URL` is set.
- Set `SESSION_SECRET` in your `.env` for secure session cookies.

### API Key Security
- All API endpoints that interact with WhatsApp require an API key (unique per client, shown in the UI and returned by `/clients`).
- Pass the API key as a query param (`?api_key=...`), header (`X-API-Key`), or in the POST body.

### Rate Limiting
- Per-API-key rate limiting is enforced. Default: 60 requests/minute per key.
- Configure with `RATE_LIMIT_PER_MINUTE` in `.env`.
- If `REDIS_URL` is set, rate limiting is global (across all server instances); otherwise, it's per-process.
- Exceeding the limit returns HTTP 429 and rate limit headers.

### Rotate API Key (without destroying session)
- Use the Rotate button in the UI, or call:

```bash
curl -X POST "http://localhost:3000/clients/CLIENT_ID/rotate-key" \
  -H "Content-Type: application/json" \
  -d '{"current_api_key":"OLD_KEY"}'
```
- You can also rotate from the UI if logged in.

---
 
## Security Checklist (Implemented vs Pending)

Implemented
- [x] API key authentication on WhatsApp endpoints (`requireApiKey`)
- [x] Per-API-key rate limiting (`RATE_LIMIT_PER_MINUTE`), Redis-backed when `REDIS_URL` is set
- [x] Web UI login with session/cookie auth (`UI_CREDENTIALS`), logout, optional Redis session store
- [x] API key rotation endpoint (`POST /clients/:id/rotate-key`)
- [x] PostgreSQL persistence with auto-migration from legacy SQLite
- [x] Basic telemetry via `/clients` (uptime, memory usage, messages saved)

Pending (recommended for production)
- [ ] HTTPS/TLS termination (reverse proxy like Nginx/Caddy or Node TLS)
- [ ] Centralized request validation (e.g., zod/joi) for all endpoints
- [ ] Structured logging (e.g., pino) with request IDs and log levels
- [ ] Metrics export (Prometheus) and dashboards (Grafana)
- [ ] Secrets management (store credentials/API keys in a secrets manager)
- [ ] Audit logging for sensitive operations (group admin changes, channel actions)

---

## Environment Variables (.env)

- `UI_CREDENTIALS=admin:password` — enables login page for the UI
- `SESSION_SECRET=your_secret` — session cookie secret (required for production)
- `REDIS_URL=redis://localhost:6379` — enables Redis session store and global rate limiting
- `RATE_LIMIT_PER_MINUTE=120` — set per-API-key rate limit (default 60)

---

## Troubleshooting

### Error: Cannot find module 'better-sqlite3'

If you see this error:

```
Error: Cannot find module 'better-sqlite3'
Require stack:
- .../examples/api-server/server.js
```

You need to install dependencies in the `examples/api-server` directory:

```bash
cd examples/api-server
npm install
```

Then start the server:

```bash
npm start
```

---

## Start the server

```bash
cd examples/api-server
npm install   # (if not already done)
npm start
```

---

## New Features (2025)
- Login page and session/cookie auth for UI (no more HTTP Basic Auth)
- Redis-backed session store and rate limiting (if `REDIS_URL` is set)
- Per-API-key rate limiting (configurable)
- Rotate API key endpoint (`/clients/:id/rotate-key`) and UI button
- Improved security and error handling

---

## Endpoint URL Patterns (with query params)

All endpoints that interact with WhatsApp require `client` and `api_key`. Use `client=default` unless you created multiple clients.

- Send Poll: `http://localhost:3000/send-poll?client=default&api_key=YOUR_API_KEY`
- Set Status: `http://localhost:3000/status?client=default&api_key=YOUR_API_KEY`
- Block Contact: `http://localhost:3000/contact/{CONTACT_ID}/block?client=default&api_key=YOUR_API_KEY`
- Unblock Contact: `http://localhost:3000/contact/{CONTACT_ID}/unblock?client=default&api_key=YOUR_API_KEY`
- Create Channel: `http://localhost:3000/channel/create?client=default&api_key=YOUR_API_KEY`
- Subscribe Channel: `http://localhost:3000/channel/{CHANNEL_ID@newsletter}/subscribe?client=default&api_key=YOUR_API_KEY`
- Unsubscribe Channel: `http://localhost:3000/channel/{CHANNEL_ID@newsletter}/unsubscribe?client=default&api_key=YOUR_API_KEY`
- Search Channels: `http://localhost:3000/channel/search?client=default&api_key=YOUR_API_KEY`

Replace placeholders:
- `{CONTACT_ID}`: e.g. `6281234@c.us`
- `{CHANNEL_ID@newsletter}`: full channel id ending with `@newsletter`

See detailed curl examples in sections above.


## Running in Docker (Recommended for Clean Setup)

Docker eliminates the need to compile native modules on your local system. The image is built for both `arm64` (Apple Silicon) and `amd64` (Intel) architectures.

### Prerequisites
- Docker and Docker Compose installed

### Quick start with Docker Compose

1. Copy the example `.env` file:

```bash
cp docker.env .env
```

2. Edit `.env` and set your credentials (optional, but recommended for production):

```bash
UI_CREDENTIALS=admin:yourpassword
SESSION_SECRET=your-secret-key-change-this
```

3. Start the services (API server + Redis):

```bash
docker-compose up -d
```

4. View logs:

```bash
docker-compose logs -f api
```

5. Open the UI: http://localhost:3000/

6. Stop the services:

```bash
docker-compose down
```

### Building the Docker image manually

If you want to build the image without docker-compose:

```bash
docker build -t whatsapp-api-server:latest .
```

Run the container:

```bash
docker run -d \
  --name whatsapp-api \
  -p 3000:3000 \
  -e UI_CREDENTIALS=admin:password \
  -e SESSION_SECRET=your-secret-key \
  -v $(pwd)/sessions:/app/sessions \
  -v $(pwd)/data:/app/data \
  whatsapp-api-server:latest
```

### Environment variables in Docker

When running in Docker, these environment variables are supported:

- `UI_CREDENTIALS=username:password` — enable login for web UI
- `SESSION_SECRET=your-secret` — session cookie secret (recommended to change)
- `REDIS_URL=redis://redis:6379` — Redis URL (auto-detected in docker-compose)
- `RATE_LIMIT_PER_MINUTE=120` — requests per minute per API key
- `NODE_ENV=production` — set to production

### Data persistence in Docker

The docker-compose setup creates volumes:

- `./sessions/` — stores WhatsApp session data (LocalAuth)
- `./data/` — stores SQLite database (`whatsapp_messages.db`)
- `redis-data` — stores Redis session data

These volumes persist even after containers are stopped/removed.

### Docker networking

The docker-compose setup uses a bridge network (`whatsapp-network`) so the API server can communicate with Redis. The API is accessible at `http://localhost:3000` on your host machine.

### Cross-architecture builds (arm64, amd64)

The Dockerfile uses a multi-stage build and Alpine Linux for minimal image size. It works on:
- Apple Silicon (M1/M2/M3, arm64)
- Intel Macs and Linux (amd64)
- Other architectures supported by node:20-alpine

To build for a specific architecture:

```bash
docker buildx build --platform linux/amd64 -t whatsapp-api-server:amd64 .
docker buildx build --platform linux/arm64 -t whatsapp-api-server:arm64 .
```

