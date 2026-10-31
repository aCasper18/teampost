// Anmeldung mit E-Mail (oder dem Teil vor dem @ bzw. dem Namen) + Passwort, Sitzung als JWT im Cookie.
// Rollen: admin (verwaltet Logins und sieht alle Postfächer) und nutzer (sieht nur Postfächer, für die er Rechte hat).
// Die Person wird bei jeder Anfrage frisch aus der Datenbank geladen – Sperren oder Rolle ändern wirkt sofort.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { APP, env } from './config.js';
import { db } from './db.js';

const COOKIE = 'teampost';
export const ROLLEN = ['admin', 'nutzer'];

export const nutzerAnzahl = () => db.prepare('SELECT count(*) n FROM nutzer').get().n;

// passwort = null lässt ein bestehendes Passwort unverändert
export function nutzerSpeichern(email, passwort, { name = null, rolle = 'nutzer' } = {}) {
  const mail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(mail)) throw new Error('E-Mail ungültig');
  if (!ROLLEN.includes(rolle)) throw new Error('Rolle ungültig');
  if (passwort && String(passwort).length < 8) throw new Error('Passwort braucht mindestens 8 Zeichen');
  const alt = db.prepare('SELECT passwort_hash FROM nutzer WHERE email = ?').get(mail);
  if (!alt && !passwort) throw new Error('Neuer Login braucht ein Passwort');
  const hash = passwort ? bcrypt.hashSync(String(passwort), 10) : alt.passwort_hash;
  db.prepare(`INSERT INTO nutzer (email, passwort_hash, rolle, name, aktiv) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(email) DO UPDATE SET passwort_hash = excluded.passwort_hash, rolle = excluded.rolle,
      name = coalesce(excluded.name, nutzer.name)`)
    .run(mail, hash, rolle, name ? String(name).trim() : null);
  return mail;
}

export function nutzerAktiv(email, aktiv) {
  return db.prepare('UPDATE nutzer SET aktiv = ? WHERE email = ?').run(aktiv ? 1 : 0, String(email).toLowerCase()).changes > 0;
}

export function nutzerListe() {
  return db.prepare('SELECT email, name, rolle, aktiv, erstellt FROM nutzer ORDER BY email').all().map((n) => ({ ...n, aktiv: !!n.aktiv }));
}

// Groß-/Kleinschreibung egal; ein Benutzername gilt nur, wenn er genau zu einem Login passt.
export function nutzerPruefen(email, passwort) {
  const k = String(email || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let n = db.prepare('SELECT * FROM nutzer WHERE email = ? AND aktiv = 1').get(k);
  if (!n && k && !k.includes('@')) {
    const alle = db.prepare('SELECT * FROM nutzer WHERE aktiv = 1').all();
    const einzig = (passt) => { const t = alle.filter(passt); return t.length === 1 ? t[0] : null; };
    n = einzig((x) => x.email.split('@')[0] === k) || einzig((x) => String(x.name || '').trim().toLowerCase().replace(/\s+/g, ' ') === k);
  }
  return n && bcrypt.compareSync(String(passwort || ''), n.passwort_hash) ? n : null;
}

export function sitzungSetzen(res, { sub }) {
  res.cookie(COOKIE, jwt.sign({ sub }, env.JWT_SECRET, { expiresIn: '90d' }), {
    httpOnly: true, sameSite: 'lax', secure: APP.sicher, maxAge: 90 * 86400000,
  });
}

export function sitzungBeenden(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: APP.sicher });
}

function sitzungLaden(token) {
  let s = null;
  try { s = token ? jwt.verify(token, env.JWT_SECRET) : null; } catch { return null; }
  if (!s) return null;
  const n = db.prepare('SELECT email, name, rolle FROM nutzer WHERE email = ? AND aktiv = 1').get(s.sub);
  return n ? { sub: n.email, name: n.name || n.email, rolle: n.rolle } : null;
}

export function nurAngemeldet(req, res, next) {
  const s = sitzungLaden(req.cookies?.[COOKIE]);
  if (!s) return req.originalUrl.startsWith('/api/') ? res.status(401).json({ fehler: 'nicht angemeldet' }) : res.redirect(`/login?weiter=${encodeURIComponent(req.originalUrl)}`);
  req.sitzung = s;
  next();
}

export function nurAdmin(req, res, next) {
  return req.sitzung?.rolle === 'admin' ? next() : res.status(403).json({ fehler: 'nur für Admins' });
}

// Cookie aus dem rohen Header lesen (für die Live-Verbindung)
export function sitzungAusCookie(header) {
  const teil = String(header || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(`${COOKIE}=`));
  return teil ? sitzungLaden(decodeURIComponent(teil.slice(COOKIE.length + 1))) : null;
}
