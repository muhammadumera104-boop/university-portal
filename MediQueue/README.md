# MediQueue – Smart Hospital Queue

Digital queue tokens, live queue tracking, SMS alerts, a waiting-room TV display and a staff dashboard.
Plain Node.js (22+): no packages to install.

## Run

```sh
cd MediQueue
npm start
```

Open http://localhost:3100. Run the tests with `npm test`.

For real use, copy `.env.example` to `.env`, then set `ADMIN_PIN`, `SIMULATE=0` and (optionally) an SMS provider.
`npm start` loads `.env` automatically.

## Settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3100` | HTTP port |
| `ADMIN_PIN` | `1234` | Staff PIN. With `NODE_ENV=production` the server refuses to start on the default |
| `SIMULATE` | on | `0` = no fake patients (real use). On = demo with simulated queue movement |
| `DATA_FILE` | `data/db.json` | Where queue data is stored |
| `PUBLIC_URL` | – | Public address, used for tracking links in SMS |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | – | Send SMS through Twilio |
| `SMS_WEBHOOK_URL`, `SMS_WEBHOOK_TOKEN` | – | Or send SMS through any gateway that accepts `POST {to, message}` |

Without an SMS provider, SMS messages are written to the server log instead of being sent.

## Features

- **Register:** patient gets a token with a QR code (holds only a random id). They can tick "Text me" to get SMS alerts.
- **Live Queue:** position, people ahead and estimated wait update instantly; in-page alerts at 3 and 1 ahead and when called. Patients can cancel their own token.
- **SMS:** sent on registration, when 3 or fewer are ahead, when called, and when the token is transferred.
- **Waiting-room display** (`/#display`): full-screen "Now Serving" board for a TV, with optional chime and spoken announcements. Open it from the Admin dashboard.
- **Admin:** call next, pause/resume, cancel, transfer, doctor status (delays are broadcast to patients), walk-in tokens, reset all queues.
- **Daily reset:** at midnight (server local time) all queues clear and token numbers restart from 001.
- Patient phone numbers stay on the server and are visible only to signed-in staff.

## Files

- `server.js` – API, live updates (Server-Sent Events at `/api/events`), storage, staff sessions, simulation.
- `sms.js` – SMS delivery (Twilio or webhook).
- `public/index.html` – the web app.
- `test/api.test.js` – end-to-end API tests (`npm test`).

## API

Public:
- `GET  /api/state` – departments, now serving, doctors, totals
- `POST /api/tokens` `{name, age, phone, dept, sms}` – register
- `GET  /api/tokens/:id` – live status of one token
- `POST /api/tokens/:id/cancel` – patient cancels their own token
- `GET  /api/events` – live update stream (`update`, `notice`)
- `GET  /api/health`

Staff (header `Authorization: Bearer <token>` from login):
- `POST /api/admin/login` `{pin}` / `POST /api/admin/logout`
- `GET  /api/admin/tokens` – active tokens with patient details
- `POST /api/admin/depts/:dept/next` · `POST /api/admin/depts/:dept/pause` `{paused}`
- `POST /api/admin/tokens/:id/cancel` · `POST /api/admin/tokens/:id/transfer` `{dept}`
- `POST /api/admin/doctors/:i` `{status: Available|Delayed|Off duty}`
- `POST /api/admin/walkin` `{name, dept}`
- `POST /api/admin/reset` – clear all queues (re-adds demo patients when simulation is on)
