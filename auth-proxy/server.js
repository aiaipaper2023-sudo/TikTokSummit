'use strict';

const http = require('http');
const httpProxy = require('http-proxy');
const crypto = require('crypto');
const url = require('url');

const AUTH_SECRET = 'tks_2026_summit_secret_key';
const LOGIN_URL = 'https://www.tiktoksummit.com?msg=login_required';

// Route map: hostname -> local service port
const ROUTES = {
  'www.tiktoksummit.com': 8780,
  'tiktoksummit.com': 8780,
  'v2v.tiktoksummit.com': 8765,
  'p2v.tiktoksummit.com': 8766,
  'spy.tiktoksummit.com': 3100,
};

// These hostnames don't require auth (public pages)
const PUBLIC_HOSTS = ['www.tiktoksummit.com', 'tiktoksummit.com'];

const proxy = httpProxy.createProxyServer({});

proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err.message);
  res.writeHead(502, { 'Content-Type': 'text/plain' });
  res.end('Service unavailable');
});

function generateToken(username, role) {
  const payload = `${username}:${role}`;
  const hmac = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex').slice(0, 16);
  return Buffer.from(`${payload}:${hmac}`).toString('base64');
}

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');
    if (parts.length < 3) return null;
    const hmac = parts.pop();
    const payload = parts.join(':');
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex').slice(0, 16);
    if (hmac !== expected) return null;
    return { username: parts[0], role: parts[1] };
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').find(c => c.trim().startsWith(name + '='));
  return match ? match.split('=')[1].trim() : null;
}

// API endpoint to generate token (called by www login page)
function handleTokenAPI(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(); return;
  }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { username, role } = JSON.parse(body);
      const token = generateToken(username, role);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://www.tiktoksummit.com',
        'Access-Control-Allow-Credentials': 'true',
      });
      res.end(JSON.stringify({ token }));
    } catch {
      res.writeHead(400); res.end('Bad request');
    }
  });
}

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': 'https://www.tiktoksummit.com',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    });
    res.end(); return;
  }

  // Token generation API (used by www login)
  if (req.url === '/api/auth/token' && host === 'www.tiktoksummit.com') {
    handleTokenAPI(req, res); return;
  }

  const targetPort = ROUTES[host];
  if (!targetPort) {
    res.writeHead(404); res.end('Not found'); return;
  }

  // Public hosts (www) don't require auth
  if (PUBLIC_HOSTS.includes(host)) {
    proxy.web(req, res, { target: `http://127.0.0.1:${targetPort}` });
    return;
  }

  // Protected subdomains: check auth cookie
  const token = getCookie(req, 'tks_auth');
  const user = token ? verifyToken(token) : null;

  if (!user) {
    // Redirect to main site login
    res.writeHead(302, { 'Location': LOGIN_URL });
    res.end(); return;
  }

  // Pass user info to downstream service
  req.headers['x-auth-user'] = user.username;
  req.headers['x-auth-role'] = user.role;

  proxy.web(req, res, { target: `http://127.0.0.1:${targetPort}` });
});

// Handle WebSocket upgrades (needed for some services)
server.on('upgrade', (req, socket, head) => {
  const host = (req.headers.host || '').split(':')[0];
  const targetPort = ROUTES[host];
  if (targetPort) {
    proxy.ws(req, socket, head, { target: `http://127.0.0.1:${targetPort}` });
  }
});

const PORT = 8800;
server.listen(PORT, () => {
  console.log(`Auth proxy running on :${PORT}`);
  console.log('Routes:', Object.entries(ROUTES).map(([h,p]) => `${h} -> :${p}`).join(', '));
});
