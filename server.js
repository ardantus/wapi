/*
 Example API server for whatsapp-web.js (local repo)
 - Provides endpoints:
   GET  /status        - client status
   GET  /qr            - latest QR code (image/png data-url)
   GET  /events        - Server-Sent Events stream for WhatsApp events
   POST /send          - send text message { to, message }
   POST /send-media    - send media { to, filename, mimetype, data (base64) }
   GET  /chats         - list chats
   GET  /contacts      - list contacts

 Prerequisites: run `npm install` inside this folder. The server uses the local package root (../../)
*/

const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode');
const crypto = require('crypto');
const Database = require('better-sqlite3');
// PostgreSQL client
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const os = require('os');
// load environment variables (create a .env with UI_CREDENTIALS=username:password)
require('dotenv').config();
const session = require('express-session');
let RedisStore;
let redisClient = null;
try {
  if (process.env.REDIS_URL) {
    const Redis = require('ioredis');
    // connect-redis may export differently across versions (function or { default })
    const connectRedisPkg = require('connect-redis');
    let connectRedis = typeof connectRedisPkg === 'function' ? connectRedisPkg : (connectRedisPkg && connectRedisPkg.default) ? connectRedisPkg.default : null;
    if (!connectRedis) throw new Error('connect-redis export not a function');
    redisClient = new Redis(process.env.REDIS_URL);
    // In newer versions of connect-redis, RedisStore is a class that needs instantiation in middleware
    RedisStore = connectRedis;
  }
} catch (e) {
  console.warn('Redis not configured or not available:', e.message);
}

// Import whatsapp-web.js from repository root
const wwebjs = require('./lib');
const { Client, LocalAuth, MessageMedia } = wwebjs;

// Function to clean up stale Chrome locks from previous sessions
function cleanupSessionLocks() {
  const sessionsDir = path.join(__dirname, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    try {
      // Recursive function to walk directories and delete SingletonLock files
      const clean = (dir) => {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          const fullPath = path.join(dir, file);
          const stat = fs.lstatSync(fullPath);
          if (stat.isDirectory()) {
            clean(fullPath);
          } else if (file === 'SingletonLock') {
            try {
              fs.unlinkSync(fullPath);
              console.log('Removed stale lock file:', fullPath);
            } catch (e) {
              console.error('Failed to remove lock:', fullPath, e.message);
            }
          }
        });
      };
      clean(sessionsDir);
    } catch (e) {
      console.error('Error cleaning up session locks:', e.message);
    }
  }
}
// Run cleanup immediately on startup
cleanupSessionLocks();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// session middleware (use Redis store if REDIS_URL provided)
const sessionOpts = {
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
};
if (RedisStore && redisClient) {
  try {
    // RedisStore can be a function (old versions) or a class (new versions)
    app.use(session(Object.assign({}, sessionOpts, { store: new RedisStore({ client: redisClient }) })));
    console.log('Using Redis session store');
  } catch (e) {
    console.warn('Failed to initialize Redis session store:', e.message, '- falling back to memory store');
    app.use(session(sessionOpts));
  }
} else {
  app.use(session(sessionOpts));
}

function shouldProtectUi(req) {
  const p = req.path || '';
  const accept = (req.headers && req.headers.accept) || '';
  if (p === '/' || p.endsWith('.html') || p.endsWith('/app.js') || accept.includes('text/html')) return true;
  return false;
}

// UI auth middleware: if UI_CREDENTIALS is set, require a logged-in session for UI routes
function uiAuthMiddleware(req, res, next) {
  const creds = process.env.UI_CREDENTIALS; // expected format username:password
  if (!creds) return next();
  if (!shouldProtectUi(req)) return next();
  // allow login routes
  if (req.path === '/login' || req.path === '/logout' || req.path.startsWith('/public') || req.path.startsWith('/assets')) return next();
  if (req.session && req.session.loggedIn) return next();
  // redirect to login page
  return res.redirect('/login');
}

app.use(uiAuthMiddleware);

// Serve a small web UI from /public
app.use(express.static('public'));

// Swagger API Documentation (public, no auth required)
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger.config');

// Serve Swagger UI at /api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'WhatsApp API Documentation'
}));


// Initialize databases
const SQLITE_DB_FILE = 'whatsapp_messages.db';
let sqliteDb = null;
if (fs.existsSync(SQLITE_DB_FILE)) {
  sqliteDb = new Database(SQLITE_DB_FILE);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      from_user TEXT,
      body TEXT,
      timestamp INTEGER,
      has_media INTEGER DEFAULT 0,
      media_type TEXT,
      is_location INTEGER DEFAULT 0,
      is_contact INTEGER DEFAULT 0,
      is_sticker INTEGER DEFAULT 0,
      media_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_client_chat ON messages(client_id, chat_id);

    CREATE TABLE IF NOT EXISTS clients_metadata (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Setup Postgres pool using DATABASE_URL or default
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/whatsapp';
const pgPool = new Pool({ connectionString: DATABASE_URL });

// Ensure Postgres table exists
(async function ensurePg() {
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        from_user TEXT,
        body TEXT,
        timestamp BIGINT,
        has_media BOOLEAN DEFAULT false,
        media_type TEXT,
        media_path TEXT,
        is_location BOOLEAN DEFAULT false,
        is_contact BOOLEAN DEFAULT false,
        is_sticker BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients_metadata (
        id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pg_client_chat ON messages(client_id, chat_id);`);
    console.log('PostgreSQL tables created/verified');
    // Now load cache after tables are created
    await loadClientMetadataCache();
  } catch (e) {
    console.error('Failed to ensure Postgres tables:', e.message);
  } finally {
    client.release();
  }
})();

// Media root folder (mounted from host via docker-compose `./data`)
const MEDIA_ROOT = path.join(__dirname, 'data');
try { fs.mkdirSync(MEDIA_ROOT, { recursive: true }); } catch (e) { }

// If an existing SQLite DB exists, migrate its messages to Postgres
async function migrateSqliteToPostgres() {
  if (!sqliteDb) return;
  try {
    const rows = sqliteDb.prepare('SELECT id, client_id, chat_id, from_user, body, timestamp, has_media, media_type, media_path, is_location, is_contact, is_sticker FROM messages').all();
    for (const r of rows) {
      // ensure media file copied under MEDIA_ROOT if media_path is present
      let mediaPath = null;
      if (r.media_path) {
        const src = path.isAbsolute(r.media_path) ? r.media_path : path.join(__dirname, r.media_path);
        if (fs.existsSync(src)) {
          const destDir = path.join(MEDIA_ROOT, r.client_id || 'unknown');
          fs.mkdirSync(destDir, { recursive: true });
          const filename = path.basename(src);
          const dest = path.join(destDir, filename);
          try { fs.copyFileSync(src, dest); mediaPath = path.join(r.client_id || 'unknown', filename); } catch (e) { console.warn('failed to copy media file during migration', src, e.message); }
        }
      }
      try {
        await pgPool.query(`INSERT INTO messages (id, client_id, chat_id, from_user, body, timestamp, has_media, media_type, media_path, is_location, is_contact, is_sticker) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`, [
          r.id,
          r.client_id,
          r.chat_id,
          r.from_user,
          r.body,
          r.timestamp,
          r.has_media === 1,
          r.media_type,
          mediaPath || r.media_path,
          r.is_location === 1,
          r.is_contact === 1,
          r.is_sticker === 1
        ]);
      } catch (e) { console.warn('failed to migrate message', r.id, e.message); }
    }

    // Close and remove sqlite file
    try { sqliteDb.close(); } catch (e) { }
    try { fs.unlinkSync(SQLITE_DB_FILE); console.log('Removed old sqlite DB after migration'); } catch (e) { console.warn('failed to remove sqlite file', e.message); }
    sqliteDb = null;
  } catch (e) {
    console.error('migration from sqlite to postgres failed:', e.message);
  }
}

// Multi-client support
const clients = new Map();
const sseClients = new Set();

// API key management
function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

// Helper functions for client metadata persistence
// Client metadata cache backed by Postgres
const clientMetadataCache = new Map();

async function loadClientMetadataCache() {
  try {
    const r = await pgPool.query('SELECT id, api_key FROM clients_metadata');
    r.rows.forEach(row => clientMetadataCache.set(row.id, row.api_key));
    console.log('Client metadata cache loaded from Postgres');
  } catch (e) {
    console.error('Failed to load client metadata cache from Postgres:', e.message);
  }
}

function saveClientMetadata(clientId, apiKey) {
  try {
    clientMetadataCache.set(clientId, apiKey);
    // persist in background
    pgPool.query(`INSERT INTO clients_metadata (id, api_key) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET api_key = EXCLUDED.api_key`, [clientId, apiKey]).catch(e => console.error('Failed to persist client metadata to Postgres:', e.message));
  } catch (e) {
    console.error(`Failed to save client metadata for ${clientId}:`, e.message);
  }
}

function loadClientMetadata(clientId) {
  return clientMetadataCache.has(clientId) ? clientMetadataCache.get(clientId) : null;
}

function getAllClientMetadata() {
  return Array.from(clientMetadataCache.entries()).map(([id, api_key]) => ({ id, api_key }));
}

function deleteClientMetadata(clientId) {
  try {
    clientMetadataCache.delete(clientId);
    pgPool.query('DELETE FROM clients_metadata WHERE id = $1', [clientId]).catch(e => console.error('Failed to delete client metadata from Postgres:', e.message));
  } catch (e) {
    console.error(`Failed to delete client metadata for ${clientId}:`, e.message);
  }
}

// Rate limiter: Redis-backed token counter if Redis available, else in-memory fixed window
const RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10);
const rateLimits = new Map();
async function checkRateLimitForKey(apiKey) {
  const windowMs = 60 * 1000;
  if (!apiKey) return { limited: false, limit: RATE_LIMIT_PER_MINUTE, remaining: RATE_LIMIT_PER_MINUTE };

  if (redisClient) {
    const key = `rate:${apiKey}`;
    // INCR and set expiry if new
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.pexpire(key, windowMs);
    const pttl = await redisClient.pttl(key); // ms remaining
    const remaining = Math.max(0, RATE_LIMIT_PER_MINUTE - count);
    const limited = count > RATE_LIMIT_PER_MINUTE;
    return { limited, remaining, limit: RATE_LIMIT_PER_MINUTE, reset: Date.now() + (pttl > 0 ? pttl : 0) };
  }

  // fallback in-memory fixed window
  const now = Date.now();
  let entry = rateLimits.get(apiKey);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
  }
  entry.count++;
  rateLimits.set(apiKey, entry);
  const remaining = Math.max(0, RATE_LIMIT_PER_MINUTE - entry.count);
  const limited = entry.count > RATE_LIMIT_PER_MINUTE;
  return { limited, remaining, limit: RATE_LIMIT_PER_MINUTE, reset: entry.windowStart + windowMs };
}

async function requireApiKey(req, res, next) {
  try {
    const apiKey = req.query.api_key || req.headers['x-api-key'] || req.body.api_key;
    // client may be provided explicitly, or inferred from API key
    let clientId = req.query.client || req.body.client || null;

    // If caller provided only an API key, try to find the client that owns it
    if (apiKey && !clientId) {
      for (const [id, state] of clients.entries()) {
        if (state.apiKey === apiKey) { clientId = id; break; }
      }
    }

    // fallback to default client if still not provided
    clientId = clientId || 'default';

    if (!clients.has(clientId)) return res.status(404).json({ error: 'client not found' });
    const clientState = clients.get(clientId);

    // if client has API key set, require it and ensure it matches the provided key
    if (clientState.apiKey) {
      if (!apiKey || clientState.apiKey !== apiKey) {
        return res.status(401).json({ error: 'unauthorized: invalid or missing API key' });
      }
    }

    // enforce rate limit per API key (async-aware)
    const rl = await checkRateLimitForKey(apiKey);
    res.setHeader('X-RateLimit-Limit', rl.limit);
    res.setHeader('X-RateLimit-Remaining', rl.remaining);
    res.setHeader('X-RateLimit-Reset', rl.reset);
    if (rl.limited) return res.status(429).json({ error: 'rate limit exceeded' });

    req.clientId = clientId;
    return next();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function sendSseEvent(event, data, clientId) {
  const payloadObj = Object.assign({}, { clientId }, { payload: data });
  const payload = JSON.stringify(payloadObj);
  for (const entry of sseClients) {
    const { res, filter } = entry;
    try {
      // if filter is set and doesn't match, skip
      if (filter && filter !== clientId) continue;
      res.write(`event: ${event}\n`);
      res.write(`data: ${payload}\n\n`);
    } catch (e) {
      // ignore write errors
    }
  }
}

async function createClient(clientId) {
  // Puppeteer in containers often needs --no-sandbox flags when running as root.
  const puppeteerArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-zygote'
  ];
  const puppeteerOpts = {
    headless: true,
    args: puppeteerArgs
  };
  // allow overriding executable path via env (we install chromium in image)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) puppeteerOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId,
      dataPath: path.join(__dirname, 'sessions')
    }),
    puppeteer: puppeteerOpts
  });

  const startTime = Date.now();
  const state = {
    client,
    status: 'initializing',
    lastQr: null,
    apiKey: loadClientMetadata(clientId) || generateApiKey(),
    startTime,
    messagesSaved: 0,
    uptime: () => Date.now() - startTime,
    resourceUsage: { cpuPercent: 0, memoryUsage: process.memoryUsage() }
  };

  // Save client metadata to database for persistence across restarts
  saveClientMetadata(clientId, state.apiKey);

  client.on('qr', async qr => {
    state.status = 'qr';
    try { state.lastQr = await qrcode.toDataURL(qr); } catch (e) { state.lastQr = null; }
    sendSseEvent('qr', { qr }, clientId);
  });

  client.on('ready', () => {
    state.status = 'ready';
    state.lastQr = null; // Clear QR code when ready
    sendSseEvent('ready', { message: 'Client ready' }, clientId);
    console.log(`WhatsApp client ${clientId} ready`);
  });

  client.on('authenticated', () => {
    state.status = 'authenticated';
    state.lastQr = null; // Clear QR code when authenticated
    sendSseEvent('authenticated', {}, clientId);
  });
  client.on('auth_failure', msg => { state.status = 'auth_failure'; sendSseEvent('auth_failure', { msg }, clientId); });
  client.on('disconnected', reason => { state.status = 'disconnected'; sendSseEvent('disconnected', { reason }, clientId); });

  // message events with PostgreSQL persistence
  client.on('message', async message => {
    // Normalize message fields and provide safe fallbacks for DB insertion
    const id = (message.id && message.id._serialized) || `${clientId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Try to get chatId from message - be strict about non-null and non-empty
    let chatId = null;
    if (message.chatId && typeof message.chatId === 'string' && message.chatId.trim()) {
      chatId = message.chatId;
    } else if (message.from && typeof message.from === 'string' && message.from.trim()) {
      chatId = message.from;
    } else if (message.to && typeof message.to === 'string' && message.to.trim()) {
      chatId = message.to;
    } else {
      // Last resort: use a hash of message id - this should never fail
      chatId = `unknown_${clientId}_${Math.random().toString(36).slice(2, 8)}`;
      console.warn('Message has no valid chatId/from/to, generated fallback:', { msgId: id, chatId });
    }
    const timestamp = message.timestamp || Math.floor(Date.now() / 1000);

    // Capture media metadata if message has media
    let mediaTypeTop = null; // top-level for UI/SSE: image, video, audio, application
    let storedMimeType = null; // full mimetype for DB and Content-Type
    if (message.hasMedia && message.media) {
      try {
        if (message.media.mimetype) {
          storedMimeType = message.media.mimetype;
          mediaTypeTop = message.media.mimetype.split('/')[0];
        } else {
          mediaTypeTop = 'unknown';
        }
      } catch (e) {
        // ignore media extraction errors
      }
    }

    const msgData = {
      id,
      from: message.from || null,
      to: message.to || null,
      body: message.body || null,
      hasMedia: message.hasMedia || false,
      mediaType: mediaTypeTop,
      chatId,
      timestamp,
      isLocation: message.type === 'location',
      isContact: message.type === 'contact_card',
      isSticker: message.type === 'sticker'
    };

    // save to Postgres; if sqlite exists we'll migrate later
    try {
      let mediaPath = null;
      // If message has media, try to download and save into host-mounted data folder
      if (msgData.hasMedia) {
        try {
          const m = await message.downloadMedia();
          if (m && m.data) {
            // Update MIME type from downloaded media (more reliable than message.media)
            if (m.mimetype) {
              storedMimeType = m.mimetype;
              mediaTypeTop = m.mimetype.split('/')[0];
            }
            // derive extension
            let ext = '';
            if (m.filename) ext = path.extname(m.filename);
            else if (m.mimetype && m.mimetype.includes('/')) ext = '.' + m.mimetype.split('/')[1];
            const clientDir = path.join(MEDIA_ROOT, clientId);
            fs.mkdirSync(clientDir, { recursive: true });
            const filename = `${msgData.id}${ext || ''}`;
            const filePath = path.join(clientDir, filename);
            fs.writeFileSync(filePath, Buffer.from(m.data, 'base64'));
            // store relative path
            mediaPath = path.join(clientId, filename);
          }
        } catch (e) {
          console.warn('failed to download media for message', msgData.id, e.message);
        }
      }

      // Insert into Postgres messages table
      await pgPool.query(`
        INSERT INTO messages (id, client_id, chat_id, from_user, body, timestamp, has_media, media_type, media_path, is_location, is_contact, is_sticker)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (id) DO UPDATE SET
          body = EXCLUDED.body,
          timestamp = EXCLUDED.timestamp
      `, [
        msgData.id,
        clientId,
        msgData.chatId,
        msgData.from,
        msgData.body,
        msgData.timestamp,
        msgData.hasMedia ? true : false,
        storedMimeType,
        mediaPath,
        msgData.isLocation ? true : false,
        msgData.isContact ? true : false,
        msgData.isSticker ? true : false
      ]);
      state.messagesSaved++;
    } catch (e) {
      console.error('error saving message to Postgres:', e.message || e);
    }

    sendSseEvent('message', msgData, clientId);
  });

  client.on('message_create', message => sendSseEvent('message_create', { id: message.id && message.id._serialized, from: message.from, body: message.body }, clientId));
  client.on('message_revoke_everyone', (after, before) => sendSseEvent('message_revoke_everyone', { after: after && after._serialized, before: before && before._serialized }, clientId));
  client.on('message_revoke_me', msgId => sendSseEvent('message_revoke_me', { msgId: msgId && msgId._serialized }, clientId));
  client.on('message_ack', (msg, ack) => sendSseEvent('message_ack', { id: msg && msg.id && msg.id._serialized, ack }, clientId));
  client.on('message_media_uploaded', message => sendSseEvent('message_media_uploaded', { id: message && message.id && message.id._serialized }, clientId));
  client.on('message_reaction', (reaction) => {
    sendSseEvent('message_reaction', {
      messageId: reaction.msgId && reaction.msgId._serialized,
      reaction: reaction.reaction,
      from: reaction.from
    }, clientId);
  });

  // group events
  client.on('group_join', notification => sendSseEvent('group_join', { id: notification.id && notification.id._serialized, chatId: notification.chatId, type: notification.type }, clientId));
  client.on('group_leave', notification => sendSseEvent('group_leave', { id: notification.id && notification.id._serialized }, clientId));
  client.on('group_update', (notification) => {
    sendSseEvent('group_update', {
      id: notification.id && notification.id._serialized,
      type: notification.type,
      chatId: notification.chatId
    }, clientId);
  });

  await client.initialize();
  state.status = 'initializing';
  clients.set(clientId, state);
  return state;
}

// Load all clients from database and recreate them at startup
(async () => {
  try {
    await loadClientMetadataCache();
    // migrate any existing sqlite data into Postgres
    await migrateSqliteToPostgres();
    const savedClients = getAllClientMetadata();
    if (savedClients.length === 0) {
      // No saved clients, create default client for first-time setup
      await createClient('default');
    } else {
      // Recreate all saved clients from database
      for (const { id } of savedClients) {
        try {
          await createClient(id);
          console.log(`Restored client: ${id}`);
        } catch (e) {
          console.error(`Failed to restore client ${id}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('Error loading clients from database:', e.message);
    // Fallback: create default client
    await createClient('default').catch(err => console.error('failed create default client', err));
  }
})();

// SSE events endpoint
app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  res.write('\n');
  const filterClient = req.query.client || null; // optional filter for a specific client
  const entry = { res, filter: filterClient };
  sseClients.add(entry);

  // send initial status for the requested client or summary
  if (filterClient && clients.has(filterClient)) {
    const st = clients.get(filterClient).status;
    res.write(`event: status\n`);
    res.write(`data: ${JSON.stringify({ clientId: filterClient, status: st })}\n\n`);
  } else {
    // send list of clients
    const list = Array.from(clients.entries()).map(([id, s]) => ({ id, status: s.status }));
    res.write(`event: clients\n`);
    res.write(`data: ${JSON.stringify({ clients: list })}\n\n`);
  }

  req.on('close', () => { sseClients.delete(entry); });
});

// Login page and handlers
app.get('/login', (req, res) => {
  // serve public/login.html from the public folder
  res.sendFile(require('path').join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const creds = process.env.UI_CREDENTIALS || '';
  const [u, p] = creds.split(':');
  const username = req.body.username || '';
  const password = req.body.password || '';
  if (!creds) return res.status(400).send('UI_CREDENTIALS not configured');
  if (username === u && password === p) {
    req.session.loggedIn = true;
    req.session.user = u;
    return res.redirect('/');
  }
  return res.status(401).send('Invalid credentials');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Clients management endpoints
// List clients with telemetry
app.get('/clients', (req, res) => {
  const list = Array.from(clients.entries()).map(([id, s]) => ({
    id,
    status: s.status,
    apiKey: s.apiKey,
    uptime: s.uptime(),
    messagesSaved: s.messagesSaved,
    memoryUsage: Math.round(s.resourceUsage.memoryUsage.heapUsed / 1024 / 1024) + ' MB'
  }));
  res.json({ clients: list });
});

// Rotate API key for a client without destroying session
app.post('/clients/:id/rotate-key', async (req, res) => {
  const id = req.params.id;
  if (!clients.has(id)) return res.status(404).json({ error: 'client not found' });
  const state = clients.get(id);
  // allow rotation if UI session is logged in
  const allowedBySession = req.session && req.session.loggedIn;
  // or if caller presents the current api key in body
  const suppliedKey = req.body.current_api_key || req.query.current_api_key || req.headers['x-api-key'];
  const allowedByKey = suppliedKey && state.apiKey && suppliedKey === state.apiKey;
  if (!allowedBySession && !allowedByKey) return res.status(401).json({ error: 'unauthorized' });
  const newKey = generateApiKey();
  state.apiKey = newKey;
  // update clients map
  clients.set(id, state);
  res.json({ success: true, apiKey: newKey });
});

// Helper: save outgoing message to Postgres
async function saveOutgoingMessage(clientId, sentMessage, messageBody, messageType = 'text', mimeType = null, mediaPath = null, toParam = null) {
  try {
    const msgId = sentMessage.id && sentMessage.id._serialized ? sentMessage.id._serialized : sentMessage.id;
    const chatId = toParam || sentMessage.to || sentMessage.recipient || sentMessage.chatId;
    const timestamp = sentMessage.timestamp || Math.floor(Date.now() / 1000);

    if (!msgId || !chatId) {
      console.warn('cannot save outgoing message: missing msgId or chatId', { msgId, chatId, sentMessage, toParam });
      return;
    }

    let hasMedia = false;
    let mediaTypeVal = null; // store full mimetype when available
    let isLocationVal = false;
    let isContactVal = false;
    let isStickerVal = false;
    let bodyText = messageBody || '';

    // Determine message type
    if (messageType === 'media') {
      hasMedia = true;
      mediaTypeVal = mimeType || null;
    } else if (messageType === 'location') {
      isLocationVal = true;
      bodyText = messageBody || 'Location';
    } else if (messageType === 'contact') {
      isContactVal = true;
      bodyText = messageBody || 'Contact';
    } else if (messageType === 'sticker') {
      isStickerVal = true;
      hasMedia = true;
      mediaTypeVal = mimeType || 'image/webp';
    }

    await pgPool.query(`
      INSERT INTO messages (id, client_id, chat_id, from_user, body, timestamp, has_media, media_type, media_path, is_location, is_contact, is_sticker)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        body = EXCLUDED.body,
        timestamp = EXCLUDED.timestamp
    `, [
      msgId,
      clientId,
      chatId,
      'outgoing',
      bodyText,
      timestamp,
      hasMedia,
      mediaTypeVal,
      mediaPath,
      isLocationVal,
      isContactVal,
      isStickerVal
    ]);
    console.log('saved outgoing message to postgres:', { msgId, clientId, chatId, bodyText });
  } catch (e) {
    console.error('ERROR saving outgoing message to Postgres:', e.message || e, e.stack);
  }
}

// Create a new client session: { id: optional }
app.post('/clients', async (req, res) => {
  const id = req.body.id || `c_${Date.now()}`;
  if (clients.has(id)) return res.status(400).json({ error: 'client already exists' });
  try {
    const state = await createClient(id);
    res.json({ success: true, id, apiKey: state.apiKey });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete client session
app.delete('/clients/:id', async (req, res) => {
  const id = req.params.id;
  if (!clients.has(id)) return res.status(404).json({ error: 'client not found' });
  try {
    const state = clients.get(id);
    if (state && state.client && typeof state.client.destroy === 'function') await state.client.destroy();
    clients.delete(id);
    // cleanup messages from Postgres and delete media files
    try {
      const r = await pgPool.query('SELECT media_path FROM messages WHERE client_id = $1', [id]);
      for (const row of r.rows) {
        if (row.media_path) {
          const fp = path.join(MEDIA_ROOT, row.media_path);
          try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { console.warn('failed to delete media file', fp, e.message); }
        }
      }
      await pgPool.query('DELETE FROM messages WHERE client_id = $1', [id]);
    } catch (e) { console.warn('error cleaning up messages for client', id, e.message); }
    // cleanup client metadata from Postgres
    deleteClientMetadata(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Status with telemetry
app.get('/status', requireApiKey, (req, res) => {
  const clientId = req.clientId;
  if (clients.has(clientId)) {
    const s = clients.get(clientId);
    return res.json({
      clientId,
      status: s.status,
      uptime: s.uptime(),
      messagesSaved: s.messagesSaved,
      memoryUsage: Math.round(s.resourceUsage.memoryUsage.heapUsed / 1024 / 1024) + ' MB'
    });
  }
  return res.status(404).json({ error: 'client not found' });
});

// Set user status message: PUT /status { message: 'Available' }
app.put('/status', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message required' });
    }

    const c = clients.get(clientId).client;
    await c.setStatus(message);

    res.json({
      success: true,
      status: message
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// QR (data URL)
app.get('/qr', (req, res) => {
  const clientId = req.query.client || 'default';
  if (!clients.has(clientId)) return res.status(404).json({ error: 'client not found' });
  const lastQr = clients.get(clientId).lastQr;
  if (!lastQr) return res.status(404).json({ error: 'QR not available' });
  const img = Buffer.from(lastQr.split(',')[1], 'base64');
  res.set('Content-Type', 'image/png');
  res.send(img);
});

// Send text message: { to: '6281234@s.whatsapp.net' or '6281234@c.us', message: 'hello', mentions?: ['id1@c.us', 'id2@c.us'] }
app.post('/send', requireApiKey, async (req, res) => {
  const { to, message, mentions, quotedMessageId } = req.body;
  const clientId = req.clientId;
  if (!to || !message) return res.status(400).json({ error: 'to and message required' });
  try {
    const state = clients.get(clientId);
    if (!state) return res.status(404).json({ error: 'client not found' });
    const c = state.client;
    console.log('DEBUG /send:', { to, message, mentions, quotedMessageId, clientId });
    let sent;
    try {
      // Build options
      const options = {};
      if (mentions && Array.isArray(mentions) && mentions.length > 0) {
        options.mentions = mentions;
      }
      if (quotedMessageId) {
        options.quotedMessageId = quotedMessageId;
      }

      sent = await c.sendMessage(to, message, options);
      console.log('DEBUG sent message FULL:', JSON.stringify(sent, null, 2));
      await saveOutgoingMessage(clientId, sent, message, 'text', null, null, to);
      state.messagesSaved++;
      res.json({ success: true, id: sent.id && sent.id._serialized });
    } catch (sendErr) {
      console.error('ERROR in /send (sendMessage failed):', sendErr && sendErr.message);
      const localId = `out_${Date.now()}`;
      const fakeMsg = { id: localId, chatId: to, timestamp: Math.floor(Date.now() / 1000) };
      await saveOutgoingMessage(clientId, fakeMsg, `[FAILED SEND] ${message}`, 'text', null, null, to);
      state.messagesSaved++;
      res.status(500).json({ error: sendErr.message });
    }
  } catch (e) {
    console.error('ERROR in /send:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Send media: { to, filename, mimetype, data: base64 }
app.post('/send-media', requireApiKey, async (req, res) => {
  const { to, filename, mimetype, data } = req.body;
  const clientId = req.clientId;
  if (!to || !data) return res.status(400).json({ error: 'to and data required' });
  try {
    const state = clients.get(clientId);
    if (!state) return res.status(404).json({ error: 'client not found' });
    const c = state.client;
    const buffer = Buffer.from(data, 'base64');
    const media = new MessageMedia(mimetype || 'application/octet-stream', buffer.toString('base64'), filename || 'file');
    const sent = await c.sendMessage(to, media);

    // Save media to host-mounted data folder
    let mediaPath = null;
    try {
      const msgId = sent.id && sent.id._serialized ? sent.id._serialized : sent.id;
      let ext = '';
      if (filename) ext = path.extname(filename);
      else if (mimetype && mimetype.includes('/')) ext = '.' + mimetype.split('/')[1];
      const clientDir = path.join(MEDIA_ROOT, clientId);
      fs.mkdirSync(clientDir, { recursive: true });
      const fname = `${msgId}${ext || ''}`;
      const filePath = path.join(clientDir, fname);
      fs.writeFileSync(filePath, buffer);
      mediaPath = path.join(clientId, fname);
    } catch (e) {
      console.warn('failed to save sent media for message', e.message);
    }

    // Save outgoing message to database
    await saveOutgoingMessage(clientId, sent, filename || 'Media', 'media', mimetype || null, mediaPath, to);
    state.messagesSaved++;
    res.json({ success: true, id: sent.id && sent.id._serialized });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send sticker: { to, filename, mimetype, data: base64 }
// (stickers use MessageMedia with image/webp mimetype)
app.post('/send-sticker', requireApiKey, async (req, res) => {
  const { to, data } = req.body;
  const clientId = req.clientId;
  if (!to || !data) return res.status(400).json({ error: 'to and data required' });
  try {
    const state = clients.get(clientId);
    if (!state) return res.status(404).json({ error: 'client not found' });
    const c = state.client;
    const buffer = Buffer.from(data, 'base64');
    // Stickers are typically WebP images
    const sticker = new MessageMedia('image/webp', buffer.toString('base64'), 'sticker.webp');
    const sent = await c.sendMessage(to, sticker);

    // Save sticker to host-mounted data folder
    let mediaPath = null;
    try {
      const msgId = sent.id && sent.id._serialized ? sent.id._serialized : sent.id;
      const clientDir = path.join(MEDIA_ROOT, clientId);
      fs.mkdirSync(clientDir, { recursive: true });
      const fname = `${msgId}.webp`;
      const filePath = path.join(clientDir, fname);
      fs.writeFileSync(filePath, buffer);
      mediaPath = path.join(clientId, fname);
    } catch (e) {
      console.warn('failed to save sent sticker for message', e.message);
    }

    // Save outgoing message to database
    await saveOutgoingMessage(clientId, sent, 'Sticker', 'sticker', 'image/webp', mediaPath, to);
    state.messagesSaved++;
    res.json({ success: true, id: sent.id && sent.id._serialized });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send location: { to, latitude, longitude, address?: string }
app.post('/send-location', requireApiKey, async (req, res) => {
  const { to, latitude, longitude, address } = req.body;
  const clientId = req.clientId;
  if (!to || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'to, latitude, and longitude required' });
  }
  try {
    const state = clients.get(clientId);
    if (!state) return res.status(404).json({ error: 'client not found' });
    const c = state.client;
    const location = new (require('whatsapp-web.js').Location)(latitude, longitude, address || '');
    const sent = await c.sendMessage(to, location);

    // Save outgoing message to database
    const locationBody = address || `Location: ${latitude},${longitude}`;
    await saveOutgoingMessage(clientId, sent, locationBody, 'location', null, null, to);
    state.messagesSaved++;
    res.json({ success: true, id: sent.id && sent.id._serialized });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send contact card: { to, contactNumber, displayName?: string }
app.post('/send-contact', requireApiKey, async (req, res) => {
  const { to, contactNumber, displayName } = req.body;
  const clientId = req.clientId;
  if (!to || !contactNumber) return res.status(400).json({ error: 'to and contactNumber required' });
  try {
    const state = clients.get(clientId);
    if (!state) return res.status(404).json({ error: 'client not found' });
    const c = state.client;
    const contact = await c.getContactById(contactNumber);
    const sent = await c.sendMessage(to, contact);

    // Save outgoing message to database
    const contactBody = displayName || `Contact: ${contactNumber}`;
    await saveOutgoingMessage(clientId, sent, contactBody, 'contact', null, null, to);
    state.messagesSaved++;
    res.json({ success: true, id: sent.id && sent.id._serialized });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send poll: { to, question, options: ['Option 1', 'Option 2'], allowMultipleAnswers?: boolean }
app.post('/send-poll', requireApiKey, async (req, res) => {
  const { to, question, options, allowMultipleAnswers } = req.body;
  const clientId = req.clientId;

  if (!to || !question || !options || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'to, question, and at least 2 options required' });
  }

  try {
    const state = clients.get(clientId);
    if (!state) return res.status(404).json({ error: 'client not found' });
    const c = state.client;

    const poll = new (require('whatsapp-web.js').Poll)(question, options, {
      allowMultipleAnswers: allowMultipleAnswers || false
    });

    const sent = await c.sendMessage(to, poll);

    // Save outgoing message to database
    const pollBody = `Poll: ${question} (${options.length} options)`;
    await saveOutgoingMessage(clientId, sent, pollBody, 'text', null, null, to);
    state.messagesSaved++;
    res.json({ success: true, id: sent.id && sent.id._serialized });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List chats
app.get('/chats', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const c = clients.get(clientId).client;
    const chats = await c.getChats();
    res.json(chats.map(ch => ({ id: ch.id._serialized, name: ch.name, isGroup: ch.isGroup })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List contacts
app.get('/contacts', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const c = clients.get(clientId).client;
    const contacts = await c.getContacts();
    res.json(Object.values(contacts).map(ct => ({ id: ct.id && ct.id._serialized, pushname: ct.pushname || ct.name, number: ct.number })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get specific contact by ID: /contact/:id?client=...&api_key=...
app.get('/contact/:id', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const contactId = req.params.id;
    const c = clients.get(clientId).client;

    const contact = await c.getContactById(contactId);

    res.json({
      id: contact.id._serialized,
      name: contact.name,
      pushname: contact.pushname,
      number: contact.number,
      isMyContact: contact.isMyContact,
      isBlocked: contact.isBlocked,
      isBusiness: contact.isBusiness,
      isEnterprise: contact.isEnterprise
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Block a contact: POST /contact/:id/block
app.post('/contact/:id/block', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const contactId = req.params.id;
    const c = clients.get(clientId).client;

    const contact = await c.getContactById(contactId);
    await contact.block();

    res.json({
      success: true,
      contactId: contact.id._serialized,
      blocked: true
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Unblock a contact: POST /contact/:id/unblock
app.post('/contact/:id/unblock', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const contactId = req.params.id;
    const c = clients.get(clientId).client;

    const contact = await c.getContactById(contactId);
    await contact.unblock();

    res.json({
      success: true,
      contactId: contact.id._serialized,
      blocked: false
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get contact profile picture URL: /contact/:id/picture?client=...&api_key=...
app.get('/contact/:id/picture', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const contactId = req.params.id;
    const c = clients.get(clientId).client;

    const contact = await c.getContactById(contactId);
    let profilePicUrl = null;

    try {
      profilePicUrl = await contact.getProfilePicUrl();
    } catch (picError) {
      // Profile picture may not be available, return null
      console.log(`No profile picture for ${contactId}:`, picError.message);
    }

    // Always return success with profilePicUrl (null if not available)
    res.json({
      contactId: contact.id._serialized,
      profilePicUrl
    });
  } catch (e) {
    console.error('Error getting contact profile picture:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get messages for a chat from SQLite + recent from library: /chats/:id/messages?client=...
app.get('/chats/:id/messages', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const c = clients.get(clientId).client;
    const chat = await c.getChatById(req.params.id);

    let messages = [];
    // try to fetch recent messages from library
    if (typeof chat.fetchMessages === 'function') {
      const limit = parseInt(req.query.limit || '50', 10);
      messages = await chat.fetchMessages({ limit });
    } else if (chat.messages) {
      messages = Array.from(chat.messages._models || chat.messages).slice(-50);
    }

    // also fetch from Postgres to get full history including media metadata
    const dbRes = await pgPool.query(`
      SELECT id, from_user, body, timestamp, has_media, media_type, media_path, is_location, is_contact, is_sticker FROM messages
      WHERE client_id = $1 AND chat_id = $2
      ORDER BY timestamp DESC LIMIT 50
    `, [clientId, req.params.id]);
    const dbMessages = dbRes.rows || [];

    // combine and deduplicate
    const msgMap = new Map();
    // Prioritize DB data (has complete metadata) first
    dbMessages.forEach(m => {
      msgMap.set(m.id, {
        id: m.id,
        from: m.from_user,
        body: m.body,
        timestamp: m.timestamp,
        hasMedia: m.has_media === true,
        mediaType: (m.media_type && m.media_type.includes('/') ? m.media_type.split('/')[0] : m.media_type),
        mediaPath: m.media_path,
        isLocation: m.is_location === true,
        isContact: m.is_contact === true,
        isSticker: m.is_sticker === true
      });
    });
    // Then add messages from library only if not already in DB
    messages.forEach(m => {
      const id = m.id && m.id._serialized;
      if (id && !msgMap.has(id)) {
        msgMap.set(id, {
          id,
          from: m.from,
          body: m.body,
          timestamp: m.timestamp,
          hasMedia: m.hasMedia,
          mediaType: m.hasMedia ? (m.media && m.media.mimetype ? m.media.mimetype.split('/')[0] : 'unknown') : null,
          mediaPath: null,
          isLocation: m.type === 'location',
          isContact: m.type === 'contact_card',
          isSticker: m.type === 'sticker'
        });
      }
    });

    const combined = Array.from(msgMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    res.json({ messages: combined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Check if media file exists locally: /media/:id/exists?client=...&api_key=...
app.get('/media/:id/exists', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const r = await pgPool.query('SELECT media_path FROM messages WHERE id = $1 AND client_id = $2', [req.params.id, clientId]);
    if (r.rowCount === 1 && r.rows[0].media_path) {
      const filePath = path.join(MEDIA_ROOT, r.rows[0].media_path);
      const exists = fs.existsSync(filePath);
      return res.json({ exists, mediaPath: r.rows[0].media_path });
    }
    res.json({ exists: false, mediaPath: null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download media from a received message: /media/:id/download?client=...&api_key=...
app.get('/media/:id/download', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const c = clients.get(clientId).client;
    // First, try to find media_path in Postgres (saved during message receipt)
    try {
      const r = await pgPool.query('SELECT media_path, media_type FROM messages WHERE id = $1 AND client_id = $2', [req.params.id, clientId]);
      if (r.rowCount === 1 && r.rows[0].media_path) {
        const rel = r.rows[0].media_path;
        const filePath = path.join(MEDIA_ROOT, rel);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'media file not found on disk' });
        if (r.rows[0].media_type && r.rows[0].media_type.includes('/')) res.set('Content-Type', r.rows[0].media_type);
        return res.sendFile(filePath);
      }
    } catch (e) {
      console.warn('failed to lookup media in Postgres:', e.message);
    }

    // Fallback: try to download via whatsapp-web.js if media not stored yet
    const chats = await c.getChats();
    let foundMessage = null;
    let foundChat = null;
    for (const chat of chats) {
      try {
        const messages = await chat.fetchMessages({ limit: 100 });
        foundMessage = messages.find(m => m.id && m.id._serialized === req.params.id);
        if (foundMessage && foundMessage.hasMedia) {
          foundChat = chat;
          break;
        }
      } catch (fetchErr) {
        console.warn(`Failed to fetch messages from chat ${chat.id._serialized}:`, fetchErr.message);
        continue;
      }
    }
    if (!foundMessage || !foundMessage.hasMedia) {
      return res.status(404).json({ error: 'media not found or message has no media' });
    }
    try {
      const media = await foundMessage.downloadMedia();
      if (!media) return res.status(404).json({ error: 'could not download media' });

      // Save media to disk for future requests
      try {
        const filename = media.filename || `${req.params.id.substring(0, 20)}.${media.mimetype.split('/')[1]}`;
        const destPath = path.join(MEDIA_ROOT, clientId, filename);
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(destPath, media.data, 'base64');

        // Update database with media path
        const relativePath = path.join(clientId, filename);
        await pgPool.query(
          'UPDATE messages SET media_path = $1, media_type = $2 WHERE id = $3 AND client_id = $4',
          [relativePath, media.mimetype, req.params.id, clientId]
        );
        console.log(`Saved media on-demand: ${relativePath}`);
      } catch (saveErr) {
        console.warn('Failed to save downloaded media:', saveErr.message);
      }

      const buffer = Buffer.from(media.data, 'base64');
      res.set('Content-Type', media.mimetype);
      res.set('Content-Disposition', `attachment; filename="${media.filename || 'file'}"`);
      res.send(buffer);
    } catch (e) {
      console.error('Failed to download media:', e.message);
      res.status(500).json({ error: 'failed to download media: ' + e.message });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// React to a message: POST /message/:id/react { emoji: '👍' }
app.post('/message/:id/react', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const messageId = req.params.id;
    const { emoji } = req.body;

    if (!emoji) return res.status(400).json({ error: 'emoji required' });

    const c = clients.get(clientId).client;

    // Find the message across all chats
    const chats = await c.getChats();
    let foundMessage = null;
    for (const chat of chats) {
      const messages = await chat.fetchMessages({ limit: 100 });
      foundMessage = messages.find(m => m.id && m.id._serialized === messageId);
      if (foundMessage) break;
    }

    if (!foundMessage) {
      return res.status(404).json({ error: 'message not found' });
    }

    await foundMessage.react(emoji);
    res.json({ success: true, messageId, emoji });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Group endpoints
// Get participants of a group
app.get('/group/:id/participants', requireApiKey, async (req, res) => {
  const groupId = req.params.id;
  const clientId = req.clientId;
  if (!groupId) return res.status(400).json({ error: 'group id required' });
  try {
    const chat = await clients.get(clientId).client.getChatById(groupId);
    const parts = chat.participants || (chat.groupMetadata && chat.groupMetadata.participants) || [];
    const list = Array.from(parts).map(p => {
      if (p.id) return { id: p.id._serialized, admin: p.isAdmin };
      if (p[0] && p[0].id) return { id: p[0].id._serialized, admin: p[0].isAdmin };
      return p;
    });
    res.json({ participants: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add participants: { groupId, participants: ['62812...@c.us'] }
app.post('/group/add', requireApiKey, async (req, res) => {
  const { groupId, participants } = req.body;
  const clientId = req.clientId;
  if (!groupId || !participants) return res.status(400).json({ error: 'groupId and participants required' });
  try {
    const chat = await clients.get(clientId).client.getChatById(groupId);
    const result = await chat.addParticipants(participants);
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove participants: { groupId, participants: ['62812...@c.us'] }
app.post('/group/remove', requireApiKey, async (req, res) => {
  const { groupId, participants } = req.body;
  const clientId = req.clientId;
  if (!groupId || !participants) return res.status(400).json({ error: 'groupId and participants required' });
  try {
    const chat = await clients.get(clientId).client.getChatById(groupId);
    const result = await chat.removeParticipants(participants);
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Promote participants: { groupId, participants: ['62812...@c.us'] }
app.post('/group/promote', requireApiKey, async (req, res) => {
  const { groupId, participants } = req.body;
  const clientId = req.clientId;
  if (!groupId || !participants) return res.status(400).json({ error: 'groupId and participants required' });
  try {
    const chat = await clients.get(clientId).client.getChatById(groupId);
    const result = await chat.promoteParticipants(participants);
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Demote participants: { groupId, participants: ['62812...@c.us'] }
app.post('/group/demote', requireApiKey, async (req, res) => {
  const { groupId, participants } = req.body;
  const clientId = req.clientId;
  if (!groupId || !participants) return res.status(400).json({ error: 'groupId and participants required' });
  try {
    const chat = await clients.get(clientId).client.getChatById(groupId);
    const result = await chat.demoteParticipants(participants);
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get group invite link: GET /group/:id/invite
app.get('/group/:id/invite', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const groupId = req.params.id;

    const c = clients.get(clientId).client;
    const chat = await c.getChatById(groupId);

    if (!chat.isGroup) {
      return res.status(400).json({ error: 'chat is not a group' });
    }

    const inviteCode = await chat.getInviteCode();
    const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;

    res.json({
      success: true,
      groupId: chat.id._serialized,
      inviteCode,
      inviteLink
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Join group by invite code: POST /group/join { inviteCode: 'ABC123...' }
app.post('/group/join', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { inviteCode } = req.body;

    if (!inviteCode) {
      return res.status(400).json({ error: 'inviteCode required' });
    }

    const c = clients.get(clientId).client;

    // Extract code from full link if provided
    const code = inviteCode.includes('chat.whatsapp.com/')
      ? inviteCode.split('chat.whatsapp.com/')[1]
      : inviteCode;

    const chatId = await c.acceptInvite(code);

    res.json({
      success: true,
      groupId: chatId,
      message: 'Successfully joined group'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Modify group info: PUT /group/:id/info { subject?: string, description?: string }
app.put('/group/:id/info', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const groupId = req.params.id;
    const { subject, description } = req.body;

    if (!subject && !description) {
      return res.status(400).json({ error: 'subject or description required' });
    }

    const c = clients.get(clientId).client;
    const chat = await c.getChatById(groupId);

    if (!chat.isGroup) {
      return res.status(400).json({ error: 'chat is not a group' });
    }

    const results = {};

    if (subject) {
      await chat.setSubject(subject);
      results.subject = subject;
    }

    if (description) {
      await chat.setDescription(description);
      results.description = description;
    }

    res.json({
      success: true,
      groupId: chat.id._serialized,
      updated: results
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Modify group settings: PUT /group/:id/settings { messagesAdminsOnly?: boolean, infoAdminsOnly?: boolean }
app.put('/group/:id/settings', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const groupId = req.params.id;
    const { messagesAdminsOnly, infoAdminsOnly } = req.body;

    if (messagesAdminsOnly === undefined && infoAdminsOnly === undefined) {
      return res.status(400).json({ error: 'messagesAdminsOnly or infoAdminsOnly required' });
    }

    const c = clients.get(clientId).client;
    const chat = await c.getChatById(groupId);

    if (!chat.isGroup) {
      return res.status(400).json({ error: 'chat is not a group' });
    }

    const results = {};

    if (messagesAdminsOnly !== undefined) {
      await chat.setMessagesAdminsOnly(messagesAdminsOnly);
      results.messagesAdminsOnly = messagesAdminsOnly;
    }

    if (infoAdminsOnly !== undefined) {
      await chat.setInfoAdminsOnly(infoAdminsOnly);
      results.infoAdminsOnly = infoAdminsOnly;
    }

    res.json({
      success: true,
      groupId: chat.id._serialized,
      settings: results
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mute a chat: POST /chat/:id/mute { duration?: number (seconds, optional - defaults to forever) }
app.post('/chat/:id/mute', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const chatId = req.params.id;
    const { duration } = req.body; // duration in seconds, optional

    const c = clients.get(clientId).client;
    const chat = await c.getChatById(chatId);

    // If duration is provided, calculate expiration time
    // Otherwise mute indefinitely
    if (duration && typeof duration === 'number' && duration > 0) {
      const unmuteDate = new Date();
      unmuteDate.setSeconds(unmuteDate.getSeconds() + duration);
      await chat.mute(unmuteDate);
      res.json({ success: true, chatId, mutedUntil: unmuteDate.toISOString() });
    } else {
      await chat.mute();
      res.json({ success: true, chatId, mutedUntil: 'forever' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Unmute a chat: POST /chat/:id/unmute
app.post('/chat/:id/unmute', requireApiKey, async (req, res) => {
  try {
    const clientId = req.clientId;
    const chatId = req.params.id;

    const c = clients.get(clientId).client;
    const chat = await c.getChatById(chatId);

    await chat.unmute();
    res.json({ success: true, chatId, muted: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// CHANNELS ENDPOINTS
// ============================================

// Create channel: POST /channel/create { title, description?, picture? }
app.post('/channel/create', requireApiKey, async (req, res) => {
  const { title, description, picture } = req.body;
  const clientId = req.clientId;

  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    const state = clients.get(clientId);
    if (!state) return res.status(404).json({ error: 'client not found' });
    const c = state.client;

    const options = {};
    if (description) options.description = description;
    if (picture) options.picture = picture; // Base64 or MessageMedia

    const result = await c.createChannel(title, options);

    if (typeof result === 'string') {
      // Error message returned
      return res.status(500).json({ error: result });
    }

    res.json({
      success: true,
      channel: result
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Subscribe to channel: POST /channel/:id/subscribe
app.post('/channel/:id/subscribe', requireApiKey, async (req, res) => {
  const channelId = req.params.id;
  const clientId = req.clientId;

  try {
    const state = clients.get(clientId);
    if (!state) return res.status(404).json({ error: 'client not found' });
    const c = state.client;

    const success = await c.subscribeToChannel(channelId);
    res.json({ success, channelId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Unsubscribe from channel: POST /channel/:id/unsubscribe { deleteLocalModels?: boolean }
app.post('/channel/:id/unsubscribe', requireApiKey, async (req, res) => {
  const channelId = req.params.id;
  const clientId = req.clientId;
  const { deleteLocalModels } = req.body;

  try {
    const state = clients.get(clientId);
    if (!state) return res.status(404).json({ error: 'client not found' });
    const c = state.client;

    const options = deleteLocalModels !== undefined ? { deleteLocalModels } : {};
    const success = await c.unsubscribeFromChannel(channelId, options);
    res.json({ success, channelId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Search channels: POST /channel/search { searchString, limit? }
app.post('/channel/search', requireApiKey, async (req, res) => {
  const { searchString, limit } = req.body;
  const clientId = req.clientId;

  if (!searchString) return res.status(400).json({ error: 'searchString required' });

  try {
    const state = clients.get(clientId);
    if (!state) return res.status(404).json({ error: 'client not found' });
    const c = state.client;

    const options = { searchString };
    if (limit) options.limit = limit;

    const channels = await c.searchChannels(options);
    res.json({ success: true, channels });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ADDITIONAL WHATSAPP-WEB.JS FEATURES =====

// Archive chat
app.post('/chat/:id/archive', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const chat = await c.getChatById(req.params.id);
    await chat.archive();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Unarchive chat
app.post('/chat/:id/unarchive', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const chat = await c.getChatById(req.params.id);
    await chat.unarchive();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pin chat
app.post('/chat/:id/pin', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const chat = await c.getChatById(req.params.id);
    const result = await chat.pin();
    res.json({ success: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Unpin chat
app.post('/chat/:id/unpin', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const chat = await c.getChatById(req.params.id);
    const result = await chat.unpin();
    res.json({ success: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark chat as unread
app.post('/chat/:id/unread', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    await c.markChatUnread(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send seen (mark as read)
app.post('/chat/:id/seen', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const result = await c.sendSeen(req.params.id);
    res.json({ success: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create group
app.post('/group/create', requireApiKey, async (req, res) => {
  try {
    const { title, participants } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const c = clients.get(req.clientId).client;
    const result = await c.createGroup(title, participants || []);
    res.json({ success: true, groupId: result.gid?._serialized || result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get group membership requests
app.get('/group/:id/requests', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const requests = await c.getGroupMembershipRequests(req.params.id);
    res.json({ requests });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Approve group membership requests
app.post('/group/:id/requests/approve', requireApiKey, async (req, res) => {
  try {
    const { requesters } = req.body;
    const c = clients.get(req.clientId).client;
    const options = requesters ? { requesterIds: requesters } : {};
    const result = await c.approveGroupMembershipRequests(req.params.id, options);
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reject group membership requests
app.post('/group/:id/requests/reject', requireApiKey, async (req, res) => {
  try {
    const { requesters } = req.body;
    const c = clients.get(req.clientId).client;
    const options = requesters ? { requesterIds: requesters } : {};
    const result = await c.rejectGroupMembershipRequests(req.params.id, options);
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get blocked contacts
app.get('/contacts/blocked', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const blocked = await c.getBlockedContacts();
    res.json({
      contacts: blocked.map(ct => ({
        id: ct.id._serialized,
        name: ct.name,
        pushname: ct.pushname,
        number: ct.number
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete profile picture
app.delete('/profile/picture', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const result = await c.deleteProfilePicture();
    res.json({ success: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set profile picture
app.put('/profile/picture', requireApiKey, async (req, res) => {
  try {
    const { data, mimetype } = req.body;
    if (!data) return res.status(400).json({ error: 'data (base64) required' });
    const c = clients.get(req.clientId).client;
    const media = new MessageMedia(mimetype || 'image/jpeg', data);
    const result = await c.setProfilePicture(media);
    res.json({ success: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Search messages
app.get('/messages/search', requireApiKey, async (req, res) => {
  try {
    const { query, chatId, limit } = req.query;
    if (!query) return res.status(400).json({ error: 'query required' });
    const c = clients.get(req.clientId).client;
    const options = {};
    if (chatId) options.chatId = chatId;
    if (limit) options.limit = parseInt(limit);
    const messages = await c.searchMessages(query, options);
    res.json({
      messages: messages.map(m => ({
        id: m.id._serialized,
        from: m.from,
        to: m.to,
        body: m.body,
        timestamp: m.timestamp
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set presence available
app.post('/presence/available', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    await c.sendPresenceAvailable();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set presence unavailable
app.post('/presence/unavailable', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    await c.sendPresenceUnavailable();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete channel
app.delete('/channel/:id', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const result = await c.deleteChannel(req.params.id);
    res.json({ success: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get labels (WhatsApp Business)
app.get('/labels', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const labels = await c.getLabels();
    res.json({
      labels: labels.map(l => ({
        id: l.id,
        name: l.name,
        hexColor: l.hexColor
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get chats by label
app.get('/labels/:id/chats', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const chats = await c.getChatsByLabelId(req.params.id);
    res.json({
      chats: chats.map(ch => ({
        id: ch.id._serialized,
        name: ch.name,
        isGroup: ch.isGroup
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Assign labels to chats
app.post('/labels/assign', requireApiKey, async (req, res) => {
  try {
    const { labelIds, chatIds } = req.body;
    if (!labelIds || !chatIds) return res.status(400).json({ error: 'labelIds and chatIds required' });
    const c = clients.get(req.clientId).client;
    await c.addOrRemoveLabels(labelIds, chatIds);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create call link
app.post('/call/link', requireApiKey, async (req, res) => {
  try {
    const { callType, startTime } = req.body;
    const c = clients.get(req.clientId).client;
    const start = startTime ? new Date(startTime) : new Date();
    const link = await c.createCallLink(start, callType || 'video');
    res.json({ success: true, link });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get broadcasts
app.get('/broadcasts', requireApiKey, async (req, res) => {
  try {
    const c = clients.get(req.clientId).client;
    const broadcasts = await c.getBroadcasts();
    res.json({
      broadcasts: broadcasts.map(b => ({
        id: b.id._serialized,
        name: b.name
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== END ADDITIONAL FEATURES =====

// Run migration and then start server
(async () => {
  await migrateSqliteToPostgres();
  const server = app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
    console.log('Open /events for Server-Sent Events, /qr for QR image, /status for status');
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);

    // Close server first to stop accepting new requests
    server.close(() => {
      console.log('HTTP server closed.');
    });

    // Destroy all WhatsApp clients to release session locks
    const closePromises = [];
    for (const [clientId, state] of clients.entries()) {
      if (state.client) {
        console.log(`Destroying client ${clientId}...`);
        closePromises.push(state.client.destroy().catch(e => console.error(`Failed to destroy client ${clientId}:`, e.message)));
      }
    }

    await Promise.all(closePromises);
    console.log('All WhatsApp clients destroyed.');

    // Close Database Pool
    try {
      await pgPool.end();
      console.log('PostgreSQL pool closed.');
    } catch (e) {
      console.error('Error closing Postgres pool:', e.message);
    }

    // Close Redis if active
    if (redisClient) {
      try {
        await redisClient.quit();
        console.log('Redis client closed.');
      } catch (e) {
        console.error('Error closing Redis:', e.message);
      }
    }

    console.log('Graceful shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

})();
