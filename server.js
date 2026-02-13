const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(path.dirname(USERS_FILE))) fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

const sessions = new Map();
const rooms = new Map();

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, original] = String(stored).split(':');
  if (!salt || !original) return false;
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(original));
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function getUsernameFromReq(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) return null;
  return session.username;
}

function ensureRoom(roomCode) {
  const key = roomCode.toUpperCase();
  if (!rooms.has(key)) {
    rooms.set(key, {
      videoUrl: '',
      playerState: { currentTime: 0, isPlaying: false, updatedAt: Date.now() },
      chat: [],
      events: [],
    });
  }
  return [key, rooms.get(key)];
}

function pushEvent(room, type, data) {
  room.events.push({ id: Date.now() + Math.random(), type, data, at: Date.now() });
  if (room.events.length > 300) room.events.splice(0, room.events.length - 300);
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.join(PUBLIC_DIR, path.normalize(safePath));
  if (!fullPath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Acesso negado.' });

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const ext = path.extname(fullPath);
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
  res.writeHead(200, { 'Content-Type': `${types[ext] || 'application/octet-stream'}; charset=utf-8` });
  fs.createReadStream(fullPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = parsed;

  try {
    if (req.method === 'POST' && pathname === '/api/register') {
      const { username, password } = await parseBody(req);
      if (!username || !password || String(password).length < 4) {
        return sendJson(res, 400, { error: 'Usuário e senha (mín. 4 caracteres) são obrigatórios.' });
      }
      const users = readUsers();
      const exists = users.some((u) => u.username.toLowerCase() === String(username).toLowerCase());
      if (exists) return sendJson(res, 409, { error: 'Usuário já existe.' });
      users.push({ username: String(username), passwordHash: hashPassword(String(password)) });
      writeUsers(users);
      return sendJson(res, 201, { message: 'Conta criada com sucesso.' });
    }

    if (req.method === 'POST' && pathname === '/api/login') {
      const { username, password } = await parseBody(req);
      const user = readUsers().find((u) => u.username.toLowerCase() === String(username).toLowerCase());
      if (!user || !verifyPassword(String(password), user.passwordHash)) {
        return sendJson(res, 401, { error: 'Credenciais inválidas.' });
      }

      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { username: user.username, expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
      return sendJson(res, 200, { token, username: user.username });
    }

    if (req.method === 'GET' && pathname === '/api/me') {
      const username = getUsernameFromReq(req);
      if (!username) return sendJson(res, 401, { error: 'Token inválido.' });
      return sendJson(res, 200, { username });
    }

    if (pathname.startsWith('/api/room/')) {
      const username = getUsernameFromReq(req);
      if (!username) return sendJson(res, 401, { error: 'Não autorizado.' });

      const roomCode = pathname.split('/')[3] || '';
      if (!roomCode) return sendJson(res, 400, { error: 'Sala inválida.' });

      const [normalized, room] = ensureRoom(roomCode);

      if (req.method === 'GET' && pathname.endsWith('/state')) {
        return sendJson(res, 200, { roomCode: normalized, videoUrl: room.videoUrl, playerState: room.playerState });
      }

      if (req.method === 'POST' && pathname.endsWith('/video')) {
        const { videoUrl } = await parseBody(req);
        room.videoUrl = String(videoUrl || '').trim();
        room.playerState = { currentTime: 0, isPlaying: false, updatedAt: Date.now() };
        pushEvent(room, 'video-updated', { videoUrl: room.videoUrl, by: username });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname.endsWith('/player')) {
        const { currentTime, isPlaying } = await parseBody(req);
        room.playerState = {
          currentTime: Number(currentTime || 0),
          isPlaying: Boolean(isPlaying),
          updatedAt: Date.now(),
        };
        pushEvent(room, 'player-sync', room.playerState);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname.endsWith('/chat')) {
        const { text } = await parseBody(req);
        const message = String(text || '').trim();
        if (!message) return sendJson(res, 400, { error: 'Mensagem vazia.' });
        const msg = { id: Date.now() + Math.random(), username, text: message, timestamp: Date.now() };
        room.chat.push(msg);
        if (room.chat.length > 500) room.chat.splice(0, room.chat.length - 500);
        pushEvent(room, 'chat-message', msg);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && pathname.endsWith('/events')) {
        const since = Number(searchParams.get('since') || 0);
        const events = room.events.filter((e) => e.at > since);
        return sendJson(res, 200, { now: Date.now(), events });
      }

      return sendJson(res, 404, { error: 'Endpoint da sala não encontrado.' });
    }

    return serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: 'Erro interno do servidor.' });
  }
});

server.listen(PORT, () => {
  console.log(`Servidor em http://localhost:${PORT}`);
});
