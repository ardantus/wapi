# Example API Server for whatsapp-web.js (Standalone)

This is a standalone Express-based API server that uses the `whatsapp-web.js` client.

...

## Docker Deployment (Recommended)

### Setup

1. Open a terminal in this folder.

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

...

### Migration from SQLite (if applicable)

If you had an existing `whatsapp_messages.db` file:
1. Place it in the root folder
2. Run `docker-compose up -d`
3. Server will automatically migrate all data to PostgreSQL and remove the SQLite file

...

## Local Development (Without Docker)

Quick start

1. Open a terminal in this folder.

2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

4. Open `http://localhost:3000/events` in a browser or use `curl` to receive events.

### Additional setup (Puppeteer/Chromium)

The `whatsapp-web.js` client depends on Puppeteer.

If you want to avoid Chromium download (you have a compatible Chrome/Chromium installed), skip download and provide an executable path when running the server:

```bash
# skip chromium download during install
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install puppeteer --save

# start server while pointing to an existing Chrome binary (macOS example)
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
	node server.js
```

...

Run the server
```bash
node server.js
# or
npm start
```

...

## Troubleshooting

### Error: Cannot find module 'better-sqlite3'

If you see this error:
```
Error: Cannot find module 'better-sqlite3'
Require stack:
- .../server.js
```

You need to install dependencies:

```bash
npm install
```

Then start the server:

```bash
npm start
```
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

