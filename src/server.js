// Teampost: Express + Socket.io. Seiten: /login, /einrichten (nur solange es noch keinen Login gibt), /mail, /team (Admins).
// Jede Person hat einen eigenen Live-Raum (nutzer:<email>); die Mail-App schickt Signale nur an Personen mit Recht auf das Postfach.
import { createServer } from 'node:http';
import { join } from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { Server } from 'socket.io';
import { APP, WURZEL } from './config.js';
import {
  ROLLEN, nurAdmin, nurAngemeldet, nutzerAktiv, nutzerAnzahl, nutzerListe, nutzerPruefen, nutzerSpeichern, sitzungAusCookie, sitzungBeenden, sitzungSetzen,
} from './auth.js';
import { db } from './db.js';
import { mailRouter } from './mail.js';
import { pushRouter } from './push.js';

const OEFFENTLICH = join(WURZEL, 'public');
const LOGIN_VERSUCHE = 8;
const LOGIN_SPERRE_MS = 15 * 60 * 1000;

const app = express();
const server = createServer(app);
const io = new Server(server);
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);

app.use('/api/mail', express.json({ limit: '2mb' })); // Mail-Entwürfe mit Zitat können größer sein
app.use(express.json());
app.use(cookieParser());

// Name und Farbe der Installation für alle Seiten (ohne Login)
app.get('/api/app', (_req, res) => res.json({ name: APP.name, farbe: APP.farbe, einrichten: nutzerAnzahl() === 0 }));
app.get('/manifest.webmanifest', (_req, res) => res.type('application/manifest+json').json({
  name: APP.name, short_name: APP.name, id: '/mail', start_url: '/mail', scope: '/', display: 'standalone', orientation: 'any',
  background_color: '#FAFAFB', theme_color: '#FFFFFF', lang: 'de',
  icons: [{ src: '/app/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/app/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }],
}));
// Symbol in der Farbe der Installation
app.get('/app/icon.svg', (_req, res) => res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600')
  .send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${APP.farbe}"/><g fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"><rect x="104" y="148" width="304" height="216" rx="32"/><path d="m116 172 140 100 140-100"/></g></svg>`));
app.get('/sw.js', (_req, res) => res.set('Cache-Control', 'no-cache').type('application/javascript').sendFile(join(OEFFENTLICH, 'app/sw.js')));
app.use('/app', express.static(join(OEFFENTLICH, 'app')));
app.use('/js', express.static(join(OEFFENTLICH, 'js')));
app.get('/gesund', (_req, res) => res.json({ ok: true }));

// ---------- Anmelden ----------
const fehlversuche = new Map(); // IP → Zeitpunkte der Fehlversuche
app.post('/api/login', (req, res) => {
  const jetzt = Date.now();
  const liste = (fehlversuche.get(req.ip) || []).filter((t) => jetzt - t < LOGIN_SPERRE_MS);
  if (liste.length >= LOGIN_VERSUCHE) return res.status(429).json({ error: 'Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen' });
  const n = nutzerPruefen(req.body?.email, req.body?.password);
  if (!n) {
    fehlversuche.set(req.ip, [...liste, jetzt]);
    return res.status(401).json({ error: 'Benutzername/E-Mail oder Passwort falsch' });
  }
  fehlversuche.delete(req.ip);
  sitzungSetzen(res, { sub: n.email });
  res.json({ ok: true });
});
app.post('/api/logout', (_req, res) => {
  sitzungBeenden(res);
  res.json({ ok: true });
});
app.get('/login', (_req, res) => (nutzerAnzahl() === 0 ? res.redirect('/einrichten') : res.sendFile(join(OEFFENTLICH, 'login.html'))));

// Erster Start: den ersten Admin anlegen – danach ist die Seite gesperrt
app.get('/einrichten', (_req, res) => (nutzerAnzahl() > 0 ? res.redirect('/login') : res.sendFile(join(OEFFENTLICH, 'einrichten.html'))));
app.post('/api/einrichten', (req, res) => {
  if (nutzerAnzahl() > 0) return res.status(403).json({ error: 'Schon eingerichtet' });
  try {
    const email = nutzerSpeichern(req.body?.email, req.body?.password, { name: req.body?.name, rolle: 'admin' });
    sitzungSetzen(res, { sub: email });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Angemeldet ----------
app.get('/', nurAngemeldet, (_req, res) => res.redirect('/mail'));
app.get('/api/ich', nurAngemeldet, (req, res) => res.json(req.sitzung));
app.put('/api/ich', nurAngemeldet, (req, res) => {
  const { name, passwort, altesPasswort } = req.body || {};
  try {
    if (passwort && !nutzerPruefen(req.sitzung.sub, altesPasswort)) throw new Error('Bisheriges Passwort stimmt nicht');
    nutzerSpeichern(req.sitzung.sub, passwort || null, { name: name ?? null, rolle: req.sitzung.rolle });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ fehler: e.message });
  }
});
app.get('/mail', nurAngemeldet, (_req, res) => res.sendFile(join(OEFFENTLICH, 'mail.html')));
app.use('/api/mail', nurAngemeldet, mailRouter({ io }));
app.use('/api/push', nurAngemeldet, pushRouter());

// ---------- Team verwalten (nur Admins) ----------
app.get('/team', nurAngemeldet, (req, res) => (req.sitzung.rolle === 'admin' ? res.sendFile(join(OEFFENTLICH, 'team.html')) : res.redirect('/mail')));
app.get('/api/team', nurAngemeldet, nurAdmin, (_req, res) => res.json({ nutzer: nutzerListe(), rollen: ROLLEN }));
app.post('/api/team', nurAngemeldet, nurAdmin, (req, res) => {
  const { email, name, rolle, passwort } = req.body || {};
  try {
    const mail = String(email || '').trim().toLowerCase();
    if (mail === req.sitzung.sub && rolle !== 'admin') throw new Error('Die eigene Admin-Rolle lässt sich nicht entfernen');
    nutzerSpeichern(mail, passwort || null, { name, rolle });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ fehler: e.message });
  }
});
app.put('/api/team/:email/aktiv', nurAngemeldet, nurAdmin, (req, res) => {
  const email = String(req.params.email).toLowerCase();
  if (email === req.sitzung.sub) return res.status(400).json({ fehler: 'Du kannst dich nicht selbst sperren' });
  if (!nutzerAktiv(email, !!req.body?.aktiv)) return res.status(404).json({ fehler: 'Login nicht gefunden' });
  if (!req.body?.aktiv) db.prepare('DELETE FROM push_abos WHERE email = ?').run(email);
  res.json({ ok: true });
});

// ---------- Live ----------
io.use((socket, next) => {
  const s = sitzungAusCookie(socket.handshake.headers.cookie);
  if (!s) return next(new Error('nicht angemeldet'));
  socket.data.email = s.sub;
  socket.join(`nutzer:${s.sub}`);
  next();
});

server.listen(APP.port, APP.host, () => {
  console.log(`${APP.name} läuft auf http://${APP.host === '0.0.0.0' ? 'localhost' : APP.host}:${APP.port}`);
  if (nutzerAnzahl() === 0) console.log(`Erster Start: unter http://localhost:${APP.port}/einrichten den ersten Admin anlegen`);
});
