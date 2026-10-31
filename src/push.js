// Push-Mitteilungen aufs Handy (Web Push, ohne App Store). Die Schlüssel (VAPID) erzeugt der Server beim ersten Start
// selbst und legt sie im Datenordner als vapid.json ab. Jede Person wählt ihre Themen; Abos gelten je Gerät.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import webpush from 'web-push';
import { APP, DATEN } from './config.js';
import { db } from './db.js';

const DATEI = join(DATEN, 'vapid.json');
export const THEMEN = [
  { id: 'mail', name: 'Neue Mails in meinen Postfächern' },
  { id: 'team', name: 'Mir zugewiesen, @Erwähnungen, Erinnerungen' },
];
const ALLE = THEMEN.map((t) => t.id);

function schluessel() {
  if (existsSync(DATEI)) return JSON.parse(readFileSync(DATEI, 'utf8'));
  const k = webpush.generateVAPIDKeys();
  writeFileSync(DATEI, JSON.stringify(k));
  chmodSync(DATEI, 0o600);
  return k;
}
const K = schluessel();
webpush.setVapidDetails(APP.kontakt, K.publicKey, K.privateKey);

// Gespeichert werden gewählte Themen und abgewählte mit „-“ davor; Themen, die es beim Speichern noch nicht gab, sind an
const themenVon = (email) => {
  const r = db.prepare('SELECT themen FROM push_themen WHERE email = ?').get(email);
  if (!r) return ALLE; // neu: alles an
  const l = JSON.parse(r.themen);
  return ALLE.filter((id) => !l.includes(`-${id}`));
};

// Mitteilung senden – an eine Person (an) oder an alle, die das Thema gewählt haben. Abgelaufene Abos werden entfernt.
export async function senden({ an = null, thema, titel, text, url = '/', tag, immer = false }) {
  const abos = db.prepare(`SELECT * FROM push_abos${an ? ' WHERE email = ?' : ''}`).all(...(an ? [an] : []))
    .filter((a) => immer || themenVon(a.email).includes(thema));
  const nutzlast = JSON.stringify({ titel, text, url, tag: tag || thema });
  await Promise.all(abos.map(async (a) => {
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: JSON.parse(a.schluessel) }, nutzlast, { TTL: 12 * 3600, urgency: 'normal' });
      db.prepare("UPDATE push_abos SET zuletzt = datetime('now') WHERE endpoint = ?").run(a.endpoint);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_abos WHERE endpoint = ?').run(a.endpoint);
      else console.error('Push:', e.statusCode || '', e.message);
    }
  }));
  return abos.length;
}
// Ohne await nutzbar, Fehler landen nur im Log
export const melden = (m) => { senden(m).catch((e) => console.error('Push:', e.message)); };

export function pushRouter() {
  const r = express.Router();
  r.get('/', (req, res) => res.json({
    publicKey: K.publicKey, themen: THEMEN, meine: themenVon(req.sitzung.sub),
    geraete: db.prepare('SELECT geraet, erstellt, zuletzt FROM push_abos WHERE email = ? ORDER BY erstellt').all(req.sitzung.sub),
  }));

  r.post('/abo', (req, res) => {
    const s = req.body?.abo;
    if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return res.status(400).json({ fehler: 'Abo ungültig' });
    db.prepare(`INSERT INTO push_abos (endpoint, email, schluessel, geraet) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET email = excluded.email, schluessel = excluded.schluessel, geraet = excluded.geraet`)
      .run(s.endpoint, req.sitzung.sub, JSON.stringify({ p256dh: s.keys.p256dh, auth: s.keys.auth }), String(req.body.geraet || '').slice(0, 80));
    res.json({ ok: true });
  });

  r.delete('/abo', (req, res) => {
    db.prepare('DELETE FROM push_abos WHERE endpoint = ? AND email = ?').run(String(req.body?.endpoint || ''), req.sitzung.sub);
    res.json({ ok: true });
  });

  r.put('/themen', (req, res) => {
    const t = (Array.isArray(req.body?.themen) ? req.body.themen : []).filter((x) => ALLE.includes(x));
    db.prepare('INSERT INTO push_themen (email, themen) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET themen = excluded.themen')
      .run(req.sitzung.sub, JSON.stringify([...t, ...ALLE.filter((x) => !t.includes(x)).map((x) => `-${x}`)]));
    res.json({ ok: true, meine: t });
  });

  r.post('/test', async (req, res) => {
    const n = await senden({ an: req.sitzung.sub, thema: 'test', immer: true, titel: `${APP.name} · Test 👋`, text: 'Mitteilungen funktionieren auf diesem Gerät.', url: '/', tag: 'test' })
      .catch(() => 0);
    res.json({ ok: true, geraete: n });
  });

  return r;
}
