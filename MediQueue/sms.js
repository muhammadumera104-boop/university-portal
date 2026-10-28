'use strict';
// SMS delivery. Configure ONE provider via environment variables; otherwise messages are only logged.
//   Twilio:  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
//   Webhook: SMS_WEBHOOK_URL (+ optional SMS_WEBHOOK_TOKEN) – receives POST {to, message}; use for local SMS gateways.
const { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: AUTH, TWILIO_FROM: FROM, SMS_WEBHOOK_URL: HOOK, SMS_WEBHOOK_TOKEN: HOOK_TOKEN } = process.env;

const provider = SID && AUTH && FROM ? 'twilio' : HOOK ? 'webhook' : null;

// 03001234567 / 923001234567 / +923001234567 -> +923001234567
const toE164 = phone => '+92' + String(phone).replace(/^\+?92|^0/, '');

async function send(phone, message) {
  if (!phone) return;
  const to = toE164(phone);
  if (!provider) return console.log(`[sms disabled] to ${to.slice(0, 6)}***: ${message}`);
  try {
    let r;
    if (provider === 'twilio') {
      r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(SID + ':' + AUTH).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: FROM, Body: message }),
      });
    } else {
      r = await fetch(HOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(HOOK_TOKEN ? { Authorization: 'Bearer ' + HOOK_TOKEN } : {}) },
        body: JSON.stringify({ to, message }),
      });
    }
    if (!r.ok) console.error(`SMS failed (${r.status}):`, (await r.text()).slice(0, 200));
  } catch (e) { console.error('SMS failed:', e.message); }
}

module.exports = { send, provider };
