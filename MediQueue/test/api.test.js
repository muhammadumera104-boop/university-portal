'use strict';
// End-to-end API tests: starts a real server on a free port with a temporary data file.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const PIN = '9876';
let proc, base, dir, auth;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediqueue-'));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '0', SIMULATE: '0', ADMIN_PIN: PIN, DATA_FILE: path.join(dir, 'db.json'),
      TWILIO_ACCOUNT_SID: '', SMS_WEBHOOK_URL: '' },
  });
  base = await new Promise((resolve, reject) => {
    proc.stdout.on('data', d => { const m = /localhost:(\d+)/.exec(d); if (m) resolve('http://localhost:' + m[1]); });
    proc.on('exit', code => reject(new Error('server exited with ' + code)));
  });
});
after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

async function call(p, body, headers = {}) {
  const r = await fetch(base + '/api' + p, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
const patient = (o = {}) => ({ name: 'Test Patient', age: 30, phone: '03001234567', dept: 'Cardiology', ...o });
const admin = (p, body) => call(p, body || {}, { Authorization: 'Bearer ' + auth });
const adminGet = p => call(p, null, { Authorization: 'Bearer ' + auth });

test('serves the app and public state', async () => {
  const html = await fetch(base + '/').then(r => r.text());
  assert.match(html, /MediQueue/);
  const { status, body } = await call('/state');
  assert.equal(status, 200);
  assert.equal(body.depts.length, 5);
  assert.equal(body.waiting, 0, 'starts empty when simulation is off');
});

test('rejects invalid registrations with the failing field', async () => {
  assert.equal((await call('/tokens', patient({ name: 'Al' }))).body.field, 'name');
  assert.equal((await call('/tokens', patient({ age: 200 }))).body.field, 'age');
  assert.equal((await call('/tokens', patient({ phone: '12345' }))).body.field, 'phone');
  assert.equal((await call('/tokens', patient({ dept: 'Dentistry' }))).body.field, 'dept');
});

test('registers patients in order and never exposes phone numbers publicly', async () => {
  const a = await call('/tokens', patient());
  const b = await call('/tokens', patient({ name: 'Second Patient', sms: true }));
  assert.equal(a.status, 201);
  assert.equal(a.body.label, 'C-001');
  assert.equal(b.body.label, 'C-002');
  assert.equal(b.body.ahead, 1);
  assert.equal(b.body.sms, true);
  const got = await call('/tokens/' + a.body.id);
  assert.equal(got.body.label, 'C-001');
  assert.equal(got.body.phone, undefined);
  assert.equal((await call('/tokens/doesnotexist')).status, 404);
});

test('staff endpoints require sign-in', async () => {
  assert.equal((await call('/admin/tokens')).status, 401);
  assert.equal((await call('/admin/login', { pin: '0000' })).status, 401);
  const r = await call('/admin/login', { pin: PIN });
  assert.equal(r.status, 200);
  auth = r.body.token;
  const list = await adminGet('/admin/tokens');
  assert.equal(list.status, 200);
});

test('call next, transfer, cancel and walk-in', async () => {
  const listed = (await adminGet('/admin/tokens')).body.tokens;
  assert.equal(listed[0].phone, '03001234567', 'staff can see phone numbers');

  assert.equal((await admin('/admin/depts/Cardiology/next')).body.serving, 'C-001');
  assert.equal((await call('/state')).body.depts[0].serving, 'C-001');

  const second = listed.find(t => t.label === 'C-002');
  const moved = await admin(`/admin/tokens/${second.id}/transfer`, { dept: 'Neurology' });
  assert.equal(moved.body.label, 'N-001');

  const cancelled = await admin(`/admin/tokens/${second.id}/cancel`);
  assert.equal(cancelled.body.st, 'cancelled');
  assert.equal((await admin(`/admin/tokens/${second.id}/cancel`)).status, 409);

  const walk = await admin('/admin/walkin', { name: 'Walk In Patient', dept: 'Emergency' });
  assert.equal(walk.status, 201);
  assert.equal(walk.body.label, 'E-001');
});

test('patients can cancel their own waiting token', async () => {
  const t = (await call('/tokens', patient({ dept: 'Pediatrics' }))).body;
  const r = await call(`/tokens/${t.id}/cancel`, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.st, 'cancelled');
  assert.equal((await call(`/tokens/${t.id}/cancel`, {})).status, 409);
});

test('paused departments refuse new tokens', async () => {
  await admin('/admin/depts/Neurology/pause', { paused: true });
  const r = await call('/tokens', patient({ dept: 'Neurology' }));
  assert.equal(r.status, 409);
  await admin('/admin/depts/Neurology/pause', { paused: false });
  assert.equal((await call('/tokens', patient({ dept: 'Neurology' }))).status, 201);
});

test('doctor status changes are validated', async () => {
  assert.equal((await admin('/admin/doctors/0', { status: 'Delayed' })).status, 200);
  assert.equal((await call('/state')).body.doctors[0].s, 'Delayed');
  assert.equal((await admin('/admin/doctors/0', { status: 'Asleep' })).status, 400);
  assert.equal((await admin('/admin/doctors/99', { status: 'Available' })).status, 404);
});

test('reset clears every queue and sign-out ends the session', async () => {
  await admin('/admin/reset');
  const s = (await call('/state')).body;
  assert.equal(s.waiting, 0);
  assert.ok(s.depts.every(d => d.serving === null));
  await admin('/admin/logout');
  assert.equal((await adminGet('/admin/tokens')).status, 401);
});
