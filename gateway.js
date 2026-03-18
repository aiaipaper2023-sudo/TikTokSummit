'use strict';

const express = require('express');
const https = require('https');
const fs = require('fs');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.GATEWAY_PORT || 80;

// Secret for signing tokens
const SECRET = crypto.randomBytes(32).toString('hex');

// Users
const USERS = {
  admin: { password: 'admin12345', role: 'admin' },
  viewer: { password: 'viewer123', role: 'viewer' },
  edward: { password: 'rizzway', role: 'admin' },
  dk: { password: 'rizzway', role: 'admin' },
  demon: { password: 'rizzway', role: 'admin' }
};

// Upstream services
const UPSTREAMS = {
  'v2v.tiktoksummit.com': 'http://localhost:8765',
  'p2v.tiktoksummit.com': 'http://localhost:8766',
  'spy.tiktoksummit.com': 'http://137.184.121.222:3100',
};

app.use(cookieParser());
// NOTE: express.json() is only applied to auth routes, NOT globally.
// Global JSON parsing consumes the request body before http-proxy-middleware
// can forward it to upstream services, breaking all proxied POST requests.
const jsonParser = express.json();

// ── Analytics data dir ──
const ANALYTICS_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(ANALYTICS_DIR)) fs.mkdirSync(ANALYTICS_DIR, { recursive: true });

// ── Token helpers ──
function makeToken(username, role) {
  const payload = JSON.stringify({ username, role, ts: Date.now() });
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + sig;
}

function verifyToken(token) {
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const payload = Buffer.from(b64, 'base64').toString();
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(payload);
    if (Date.now() - data.ts > 86400000) return null;
    return data;
  } catch { return null; }
}

// ── Auth API ──
app.post('/api/auth/token', jsonParser, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { username, password } = req.body;
  const user = USERS[username];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = makeToken(username, user.role);
  res.cookie('tks_auth', token, {
    domain: '.tiktoksummit.com',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 86400000
  });
  res.json({ token, username, role: user.role });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies.tks_auth;
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ username: user.username, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('tks_auth', { domain: '.tiktoksummit.com', path: '/' });
  res.json({ ok: true });
});

// ── Analytics API ──
app.post('/api/analytics/track', jsonParser, (req, res) => {
  const events = req.body && req.body.events;
  if (!Array.isArray(events) || !events.length) return res.json({ ok: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const filePath = path.join(ANALYTICS_DIR, `events-${dateStr}.jsonl`);
  const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFile(filePath, lines, () => {});
  res.json({ ok: true, count: events.length });
});

app.get('/api/analytics/query', (req, res) => {
  // Auth check — admin only
  const token = req.cookies.tks_auth;
  const authUser = verifyToken(token);
  if (!authUser || authUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required' });
  }

  const rangeStr = req.query.range || '1d';
  const days = parseInt(rangeStr) || 1;
  const now = Date.now();
  const cutoff = now - days * 86400000;

  // Read JSONL files for the range
  let allEvents = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(now - d * 86400000).toISOString().slice(0, 10);
    const filePath = path.join(ANALYTICS_DIR, `events-${date}.jsonl`);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      content.split('\n').filter(Boolean).forEach(line => {
        try {
          const ev = JSON.parse(line);
          if (ev.ts >= cutoff) allEvents.push(ev);
        } catch {}
      });
    } catch {}
  }

  // Aggregate
  const pvEvents = allEvents.filter(e => e.event === 'page_view');
  const leaveEvents = allEvents.filter(e => e.event === 'page_leave');
  const uniqueUsers = new Set(allEvents.map(e => e.user).filter(u => u !== '_anon'));
  const uniqueSessions = new Set(allEvents.map(e => e.sid).filter(Boolean));

  // Avg duration from page_leave events
  const durations = leaveEvents.map(e => (e.meta && e.meta.duration) || 0).filter(d => d > 0);
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  // Pages breakdown
  const pageCounts = {};
  pvEvents.forEach(e => { pageCounts[e.page] = (pageCounts[e.page] || 0) + 1; });
  const pages = Object.entries(pageCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, views]) => ({ name, views }));

  // Page durations
  const pageDurSums = {};
  const pageDurCounts = {};
  leaveEvents.forEach(e => {
    const dur = (e.meta && e.meta.duration) || 0;
    if (dur > 0) {
      pageDurSums[e.page] = (pageDurSums[e.page] || 0) + dur;
      pageDurCounts[e.page] = (pageDurCounts[e.page] || 0) + 1;
    }
  });
  const pageDurations = Object.keys(pageDurSums)
    .map(name => ({ name, views: Math.round(pageDurSums[name] / pageDurCounts[name]) }))
    .sort((a, b) => b.views - a.views);

  // User breakdown
  const userCounts = {};
  pvEvents.forEach(e => { if (e.user !== '_anon') userCounts[e.user] = (userCounts[e.user] || 0) + 1; });
  const users = Object.entries(userCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, views]) => ({ name, views }));

  // Role breakdown
  const roleCounts = {};
  uniqueUsers.forEach(u => {
    const ev = allEvents.find(e => e.user === u && e.role && e.role !== '_anon');
    if (ev) roleCounts[ev.role] = (roleCounts[ev.role] || 0) + 1;
  });
  const roles = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, views]) => ({ name, views }));

  // Page flow paths (page_view sequences per session)
  const sessionPages = {};
  pvEvents.sort((a, b) => a.ts - b.ts).forEach(e => {
    if (!e.sid) return;
    if (!sessionPages[e.sid]) sessionPages[e.sid] = [];
    sessionPages[e.sid].push(e.page);
  });
  const pathCounts = {};
  Object.values(sessionPages).forEach(pages => {
    for (let i = 0; i < pages.length - 1; i++) {
      const key = pages[i] + ' → ' + pages[i + 1];
      pathCounts[key] = (pathCounts[key] || 0) + 1;
    }
  });
  const paths = Object.entries(pathCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([key, count]) => {
      const [from, to] = key.split(' → ');
      return { from, to, count };
    });

  // Timeline (most recent 100)
  const timeline = allEvents
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 100);

  res.json({
    overview: { pv: pvEvents.length, uv: uniqueUsers.size, sessions: uniqueSessions.size, avgDuration },
    pages,
    pageDurations,
    users,
    roles,
    paths,
    timeline
  });
});

// ── Auth middleware ──
function requireAuth(req, res, next) {
  const token = req.cookies.tks_auth;
  const user = verifyToken(token);
  if (user) {
    req.authUser = user.username;
    req.authRole = user.role;
    return next();
  }
  const returnUrl = `https://${req.hostname}${req.originalUrl}`;
  res.redirect(`https://www.tiktoksummit.com/?login=1&return=${encodeURIComponent(returnUrl)}`);
}

// ── Route by hostname ──
app.use((req, res, next) => {
  const host = req.hostname;

  // www / naked domain → serve static portal
  if (host === 'www.tiktoksummit.com' || host === 'tiktoksummit.com' || host === 'localhost') {
    return next();
  }

  // Subdomains → API passthrough
  if (req.path.startsWith('/api/')) return next();

  // Subdomains → proxy (auth disabled)
  const upstream = UPSTREAMS[host];
  if (upstream) {
    const proxy = createProxyMiddleware({
      target: upstream,
      changeOrigin: true,
      ws: true,
    });
    return proxy(req, res, next);
  }

  res.status(404).send('Not found');
});

// ── Static portal for www ──
app.use(express.static(path.join(__dirname)));

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TikTokSummit gateway on http://0.0.0.0:${PORT}`);
});

// Also listen on 8800 (Cloudflare origin port)
app.listen(8800, '0.0.0.0', () => {
  console.log('TikTokSummit gateway on http://0.0.0.0:8800');
});

// HTTPS for Cloudflare Full SSL
const sslKeyPath = path.join(__dirname, 'ssl.key');
const sslCertPath = path.join(__dirname, 'ssl.cert');
if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
  const sslOpts = { key: fs.readFileSync(sslKeyPath), cert: fs.readFileSync(sslCertPath) };
  https.createServer(sslOpts, app).listen(443, '0.0.0.0', () => {
    console.log('TikTokSummit gateway on https://0.0.0.0:443');
  });
}
