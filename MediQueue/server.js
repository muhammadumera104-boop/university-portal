'use strict';
// MediQueue backend: zero-dependency Node server (REST API + Server-Sent Events + JSON file storage).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const sms = require('./sms');

const PORT = process.env.PORT != null && process.env.PORT !== '' ? Number(process.env.PORT) : 3100;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const ADMIN_PIN = String(process.env.ADMIN_PIN || '1234');
const SIMULATE = process.env.SIMULATE !== '0';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL = 8 * 60 * 60 * 1000;

const DEPTS = [
  { n: 'Cardiology', p: 'C', room: 'Room 12', avg: 10 },
  { n: 'General Medicine', p: 'G', room: 'Room 3', avg: 7 },
  { n: 'Neurology', p: 'N', room: 'Room 21', avg: 12 },
  { n: 'Pediatrics', p: 'P', room: 'Room 7', avg: 8 },
  { n: 'Emergency', p: 'E', room: 'ER Wing', avg: 5 },
];
const DOCTORS = [
  ['Dr. Ayesha Khan', 'Cardiology', 'MBBS, FCPS (Cardiology)', '9:00 AM – 2:00 PM'],
  ['Dr. Bilal Ahmed', 'Cardiology', 'MBBS, MRCP', '2:00 PM – 8:00 PM'],
  ['Dr. Sana Malik', 'General Medicine', 'MBBS, FCPS (Medicine)', '9:00 AM – 5:00 PM'],
  ['Dr. Omar Farooq', 'Neurology', 'MBBS, FCPS (Neurology)', '10:00 AM – 4:00 PM'],
  ['Dr. Hina Raza', 'Pediatrics', 'MBBS, DCH', '9:00 AM – 3:00 PM'],
  ['Dr. Imran Siddiqui', 'Emergency', 'MBBS, FCPS (Emergency)', '24 hours'],
].map(d => ({ name: d[0], dept: d[1], q: d[2], time: d[3], s: 'Available' }));
const NAMES = ['Ali Raza', 'Fatima Noor', 'Hassan Iqbal', 'Zainab Shah', 'Usman Tariq', 'Maryam Aziz', 'Kamran Ali', 'Sadia Hussain', 'Bilal Qureshi', 'Noor Fatima'];
const DOC_STATUSES = ['Available', 'Delayed', 'Off duty'];
const dp = n => DEPTS.find(d => d.n === n);
const rnd = n => Math.floor(Math.random() * n);

// ---------- storage ----------
let db, saveTimer = null;
function load() {
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { db = null; }
  if (!db || !db.d || !Array.isArray(db.t) || !Array.isArray(db.doc)) seed();
  DEPTS.forEach(d => { if (!db.d[d.n]) db.d[d.n] = { last: 0, paused: false }; });
  rollover();
}
// Local calendar date, e.g. 2026-10-27. Token numbers restart every day.
const today = () => new Date().toLocaleDateString('en-CA');
function rollover() {
  if (db.day === today()) return false;
  const first = !db.day;
  db.day = today();
  if (first) return false;
  db.t = [];
  DEPTS.forEach(d => { db.d[d.n].last = 0; });
  console.log('New day: queues reset for', db.day);
  return true;
}
function writeNow() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(db));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
  } catch (e) { console.error('Could not save data:', e.message); }
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeNow(); }, 200);
}
function seed() {
  db = { day: today(), d: {}, t: [], doc: DOCTORS.map(x => ({ ...x })) };
  if (!SIMULATE) { DEPTS.forEach(d => { db.d[d.n] = { last: 0, paused: false }; }); return save(); }
  DEPTS.forEach(d => {
    db.d[d.n] = { last: 0, paused: false };
    for (let i = 0; i < 6; i++) mk(d.n, { name: NAMES[(i * 3 + d.n.length) % 10], age: 20 + i * 7, phone: '03' + (100000000 + rnd(8e8)) });
  });
  DEPTS.forEach(d => callNext(d.n));
  save();
}

// ---------- queue logic ----------
const label = t => dp(t.dept).p + '-' + String(t.num).padStart(3, '0');
const act = dn => db.t.filter(t => t.dept === dn && (t.st === 'waiting' || t.st === 'consult'));
const waiting = dn => db.t.filter(t => t.dept === dn && t.st === 'waiting');
const cur = dn => db.t.find(t => t.dept === dn && t.st === 'consult');
const docOf = dn => db.doc.find(x => x.dept === dn && x.s !== 'Off duty') || db.doc.find(x => x.dept === dn);
const avail = dn => db.doc.filter(x => x.dept === dn && x.s === 'Available').length;
const ahead = t => db.t.filter(x => x.dept === t.dept && x.st === 'waiting' && x.num < t.num).length + (cur(t.dept) && t.st === 'waiting' ? 1 : 0);
const est = t => Math.round(ahead(t) * dp(t.dept).avg / Math.max(1, avail(t.dept)));
function stat(t) {
  if (t.st === 'consult') return ['Consult', 'In Consultation'];
  if (t.st === 'done') return ['Done', 'Completed'];
  if (t.st === 'cancelled') return ['Cancelled', 'Cancelled'];
  if (db.d[t.dept].paused) return ['Closed', 'Queue Paused'];
  return ahead(t) <= 2 ? ['Almost', 'Almost Your Turn'] : ['Waiting', 'Waiting'];
}
function mk(dn, { name, age, phone, source = 'online', smsOptIn = false }) {
  const d = db.d[dn];
  d.last++;
  const t = { id: crypto.randomBytes(8).toString('hex'), name, age, phone, source, sms: smsOptIn, dept: dn, num: d.last, st: 'waiting', at: Date.now() };
  db.t.push(t);
  t.start = ahead(t);
  return t;
}
function callNext(dn) {
  const c = cur(dn);
  if (c) { c.st = 'done'; c.endAt = Date.now(); }
  const n = waiting(dn).sort((a, b) => a.num - b.num)[0];
  if (n) { n.st = 'consult'; n.calledAt = Date.now(); }
  return n || null;
}

// ---------- views sent to clients ----------
function publicState() {
  const depts = DEPTS.map(d => {
    const c = cur(d.n), a = act(d.n).length, av = avail(d.n);
    return { n: d.n, p: d.p, room: d.room, avg: d.avg, paused: db.d[d.n].paused, serving: c ? label(c) : null,
      waiting: waiting(d.n).length, active: a, avail: av, est: Math.round(a * d.avg / Math.max(1, av)) };
  });
  const doctors = db.doc.map((x, i) => ({ i, name: x.name, dept: x.dept, q: x.q, time: x.time, s: x.s,
    consulting: docOf(x.dept) === x && !!cur(x.dept) && x.s === 'Available' }));
  const busiest = depts.slice().sort((a, b) => b.active - a.active)[0].n;
  return {
    depts, doctors, busiest, simulated: SIMULATE,
    waiting: db.t.filter(t => t.st === 'waiting').length,
    served: db.t.filter(t => t.st === 'done').length,
    avgWait: Math.round(depts.reduce((s, d) => s + d.active * d.avg, 0) / DEPTS.length / 5),
  };
}
function tokenView(t, full) {
  const d = dp(t.dept), dc = docOf(t.dept), c = cur(t.dept), [cls, text] = stat(t);
  const v = { id: t.id, label: label(t), name: t.name, dept: t.dept, room: d.room, st: t.st, statusClass: cls, statusText: text,
    ahead: t.st === 'waiting' ? ahead(t) : 0, est: t.st === 'waiting' ? est(t) : null, start: t.start, at: t.at, sms: !!t.sms,
    serving: c ? label(c) : null, doctor: dc ? { name: dc.name, s: dc.s } : null };
  if (full) Object.assign(v, { num: t.num, age: t.age, phone: t.phone, source: t.source });
  return v;
}

// ---------- live updates (SSE) ----------
const clients = new Set();
function broadcast(event, data = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
const changed = () => { save(); broadcast('update'); notifySms(); };

// SMS alerts for patients who opted in: once when 3 or fewer are ahead, once when called.
const trackUrl = t => PUBLIC_URL ? ' Track: ' + PUBLIC_URL + '/#track-' + t.id : '';
function notifySms() {
  for (const t of db.t) {
    if (!t.sms) continue;
    if (t.st === 'waiting' && !db.d[t.dept].paused) {
      const a = ahead(t);
      if (a <= 3 && !t.smsNear) { t.smsNear = true; sms.send(t.phone, `MediQueue: token ${label(t)} - ${a} patient(s) ahead of you. Please wait near ${dp(t.dept).room}.`); }
    } else if (t.st === 'consult' && !t.smsCalled) {
      t.smsCalled = true; sms.send(t.phone, `MediQueue: it's your turn! Token ${label(t)}, please go to ${dp(t.dept).room} now.`);
    }
  }
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

// ---------- auth & rate limiting ----------
const sessions = new Map();
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(), arr = (hits.get(key) || []).filter(x => now - x < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
function isAdmin(req) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const exp = sessions.get(m[1]);
  if (!exp || exp < Date.now()) { sessions.delete(m[1]); return false; }
  return true;
}
function pinOk(pin) {
  const a = crypto.createHash('sha256').update(String(pin)).digest(), b = crypto.createHash('sha256').update(ADMIN_PIN).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- HTTP helpers ----------
class HttpError extends Error { constructor(status, msg, field) { super(msg); this.status = status; this.field = field; } }
const fail = (status, msg, field) => { throw new HttpError(status, msg, field); };
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 10000) { reject(new HttpError(413, 'Request too large.')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new HttpError(400, 'Invalid JSON.')); } });
    req.on('error', reject);
  });
}
const findToken = id => db.t.find(t => t.id === id) || fail(404, 'Token not found.');
const findDept = n => dp(n) || fail(400, 'Unknown department.', 'dept');
function cleanName(v) {
  const n = String(v || '').trim().replace(/\s+/g, ' ');
  if (n.length < 3 || n.length > 80) fail(400, 'Please enter the full name (3–80 characters).', 'name');
  return n;
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler, admin) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, admin });

route('GET', '/api/state', () => publicState());

route('POST', '/api/tokens', (req, p, b, ip) => {
  if (limited('reg:' + ip, 20, 10 * 60 * 1000)) fail(429, 'Too many registrations from this device. Please try again later.');
  const name = cleanName(b.name), age = Number(b.age), phone = String(b.phone || '').replace(/[\s-]/g, '');
  if (!Number.isInteger(age) || age < 1 || age > 120) fail(400, 'Enter an age between 1 and 120.', 'age');
  if (!/^(\+?92|0)3\d{9}$/.test(phone)) fail(400, 'Enter a valid mobile number, e.g. 03001234567.', 'phone');
  const dept = findDept(b.dept).n;
  if (db.d[dept].paused) fail(409, dept + ' is not accepting new tokens right now.', 'dept');
  const t = mk(dept, { name, age, phone, smsOptIn: b.sms === true });
  if (t.sms) {
    t.smsNear = ahead(t) <= 3; // short queue: the confirmation already says to wait nearby
    sms.send(phone, `MediQueue: your token is ${label(t)} for ${dept} (${dp(dept).room}). ` +
      (t.smsNear ? 'Your turn is near, please wait close by.' : "We'll text you when your turn is near.") + trackUrl(t));
  }
  changed();
  return [201, tokenView(t)];
});

route('GET', '/api/tokens/:id', (req, p) => tokenView(findToken(p.id)));

// The token id is an unguessable secret held only by the patient (and their QR code), so it authorises self-cancel.
route('POST', '/api/tokens/:id/cancel', (req, p) => {
  const t = findToken(p.id);
  if (t.st !== 'waiting') fail(409, t.st === 'consult' ? 'You are already being seen. Please speak to the doctor.' : 'This token is already closed.');
  t.st = 'cancelled'; t.endAt = Date.now();
  changed();
  return tokenView(t);
});

route('GET', '/api/health', () => ({ ok: true, day: db.day, sms: sms.provider || 'disabled', simulated: SIMULATE }));

route('POST', '/api/admin/login', (req, p, b, ip) => {
  if (limited('login:' + ip, 10, 15 * 60 * 1000)) fail(429, 'Too many sign-in attempts. Try again in 15 minutes.');
  if (!pinOk(b.pin)) fail(401, 'Incorrect PIN.');
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return { token };
});
route('POST', '/api/admin/logout', req => {
  sessions.delete((req.headers.authorization || '').slice(7));
  return { ok: true };
}, true);

route('GET', '/api/admin/tokens', () => ({
  tokens: db.t.filter(t => t.st === 'waiting' || t.st === 'consult')
    .sort((a, b) => a.dept.localeCompare(b.dept) || a.num - b.num).map(t => tokenView(t, true)),
}), true);

route('POST', '/api/admin/depts/:dept/next', (req, p) => {
  const dept = findDept(decodeURIComponent(p.dept)).n, n = callNext(dept);
  changed();
  return { serving: n ? label(n) : null };
}, true);

route('POST', '/api/admin/depts/:dept/pause', (req, p, b) => {
  const dept = findDept(decodeURIComponent(p.dept)).n;
  db.d[dept].paused = !!b.paused;
  changed();
  broadcast('notice', { msg: dept + (b.paused ? ' queue is paused. Please wait for staff instructions.' : ' queue has resumed.') });
  return { paused: db.d[dept].paused };
}, true);

route('POST', '/api/admin/tokens/:id/cancel', (req, p) => {
  const t = findToken(p.id);
  if (t.st === 'done' || t.st === 'cancelled') fail(409, 'This token is already closed.');
  t.st = 'cancelled'; t.endAt = Date.now();
  changed();
  return tokenView(t, true);
}, true);

route('POST', '/api/admin/tokens/:id/transfer', (req, p, b) => {
  const t = findToken(p.id), dept = findDept(b.dept).n;
  if (t.st === 'done' || t.st === 'cancelled') fail(409, 'This token is already closed.');
  if (t.dept === dept) fail(400, 'Token is already in ' + dept + '.', 'dept');
  t.dept = dept; t.num = ++db.d[dept].last; t.st = 'waiting'; t.start = ahead(t); t.smsNear = false;
  if (t.sms) sms.send(t.phone, `MediQueue: your token was transferred to ${dept}. New token: ${label(t)}, ${dp(dept).room}.`);
  changed();
  return tokenView(t, true);
}, true);

route('POST', '/api/admin/doctors/:i', (req, p, b) => {
  const x = db.doc[Number(p.i)] || fail(404, 'Doctor not found.');
  if (!DOC_STATUSES.includes(b.status)) fail(400, 'Unknown status.');
  x.s = b.status;
  changed();
  if (x.s === 'Delayed') broadcast('notice', { msg: x.name + ' is delayed. Wait times in ' + x.dept + ' may increase.' });
  if (x.s === 'Off duty') broadcast('notice', { msg: x.name + ' is unavailable.' });
  return { ok: true };
}, true);

route('POST', '/api/admin/walkin', (req, p, b) => {
  const name = cleanName(b.name), dept = findDept(b.dept).n;
  const t = mk(dept, { name, age: null, phone: null, source: 'walk-in' });
  changed();
  return [201, tokenView(t, true)];
}, true);

route('POST', '/api/admin/reset', () => { seed(); changed(); return { ok: true }; }, true);

// ---------- static files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const { pathname } = new URL(req.url, 'http://localhost');
  const ip = req.socket.remoteAddress || '';

  if (pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, pathname);
  }

  try {
    let match = null, params;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (m) { if (r.method === req.method) { match = r; params = m.groups || {}; break; } match = match || false; }
    }
    if (match === null) fail(404, 'Not found.');
    if (match === false) fail(405, 'Method not allowed.');
    if (match.admin && !isAdmin(req)) fail(401, 'Please sign in as staff.');
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await match.handler(req, params, body, ip);
    Array.isArray(out) ? send(res, out[0], out[1]) : send(res, 200, out);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, field: e.field });
    console.error(e);
    send(res, 500, { error: 'Server error.' });
  }
});

// Demo simulation: doctors call the next patient and new patients arrive.
function tick() {
  DEPTS.forEach(d => {
    if (db.d[d.n].paused || !avail(d.n)) return;
    if (Math.random() < 0.6) callNext(d.n);
    if (Math.random() < 0.2) mk(d.n, { name: NAMES[rnd(10)], age: 25 + rnd(50), phone: '0300' + (1e6 + rnd(8e6)), source: 'simulated' });
  });
  // Keep the data file small: drop finished tokens after 6 hours.
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  db.t = db.t.filter(t => !((t.st === 'done' || t.st === 'cancelled') && (t.endAt || t.at) < cutoff));
  changed();
}

if (ADMIN_PIN === '1234' || ADMIN_PIN.length < 4) {
  if (process.env.NODE_ENV === 'production') { console.error('Refusing to start: set a strong ADMIN_PIN (not 1234) for production.'); process.exit(1); }
  console.warn('Warning: using the default staff PIN 1234. Set ADMIN_PIN before real use.');
}
load();
if (SIMULATE) setInterval(tick, 7000);
setInterval(() => { if (rollover()) changed(); }, 60 * 1000);
server.listen(PORT, () => console.log(`MediQueue running at http://localhost:${server.address().port} (simulation ${SIMULATE ? 'on' : 'off'}, SMS ${sms.provider || 'disabled'})`));
const shutdown = () => { clearTimeout(saveTimer); writeNow(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
