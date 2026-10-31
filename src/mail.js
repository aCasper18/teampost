// Mail-App (/mail): beliebig viele IMAP/SMTP-Konten, Rechte je Konto, Status-Knöpfe, wer hat wann geöffnet, Antworten und neue Mails.
// Jede Aktion landet in mail_ereignisse – so ist nachvollziehbar, wer die Mail zuerst, wer danach geöffnet und wer sie erledigt hat.
// Dazu: Markieren (\Flagged), Anheften, Zurückstellen (Erinnerung), Zuweisen, Labels, interne Notizen mit @Erwähnung,
// Entwürfe auf dem Server mit Anhängen, Senden mit Rückgängig-Frist oder zu einem späteren Zeitpunkt, Vorlagen und Signaturen.
import crypto from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { DATEN } from './config.js';
import { db, team } from './db.js';
import { melden } from './push.js';
import {
  ERLEDIGT, LABEL_FARBEN, RECHTE, STATUS, berechtigte, darf, entschluesseln, kontoHolen, kontoOeffentlich, rechtFuer, sichtbareKonten, verschluesseln,
} from './mail-db.js';
import { anhangHolen, antwortVermerken, inGesendetAblegen, postfachAktion, starteMailAbgleich, verbindungTesten } from './mail-abgleich.js';

const SEITE = 50;
const MAX_ANHAENGE = 25 * 1024 * 1024; // je Mail
const ANHANG_ORDNER = join(DATEN, 'mail-anhaenge');
mkdirSync(ANHANG_ORDNER, { recursive: true });
const jetzt = () => new Date().toISOString();
const smtp = (k) => nodemailer.createTransport({
  host: k.smtp_host, port: k.smtp_port, secure: k.smtp_port === 465,
  auth: { user: k.benutzer, pass: entschluesseln(k.passwort) }, connectionTimeout: 20_000,
});
const platz = (n) => Array(n).fill('?').join(',');
const sitzungVon = (email) => ({ sub: email, rolle: db.prepare('SELECT rolle FROM nutzer WHERE email = ?').get(email)?.rolle || 'nutzer' });
const teamName = (e) => team().find((t) => t.email === e)?.name || e;
const fehler = (text, code = 400) => Object.assign(new Error(text), { code });

function ereignis(nachrichtId, email, art, text = null) {
  db.prepare('INSERT INTO mail_ereignisse (nachricht_id, email, art, text) VALUES (?, ?, ?, ?)').run(nachrichtId, email, art, text);
}

// ---------- HTML der eigenen Mails: gefährliche Teile raus, Textfassung daraus ableiten ----------
function htmlSauber(html) {
  return String(html || '')
    .replace(/<(script|style|iframe|object|embed|form|svg|math|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|svg|math|template|noscript|link|meta|base|input|button|textarea|select)\b[^>]*>/gi, '')
    .replace(/[\s/"']on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ' ')
    .replace(/(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(javascript|vbscript|data):[^"'\s>]*\2/gi, '$1="#"')
    .slice(0, 400_000);
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
export function htmlZuText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|blockquote|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, u, t) => (t.replace(/<[^>]+>/g, '') === u ? u : `${t} (${u})`))
    .replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENT[e])
    .replace(/\n{3,}/g, '\n\n').trim();
}

// Wer hat die Mail geöffnet – in der Reihenfolge des ersten Öffnens
const oeffnungen = (ids) => {
  if (!ids.length) return new Map();
  const z = db.prepare(`SELECT nachricht_id, email, min(zeit) zeit FROM mail_ereignisse WHERE art = 'geoeffnet' AND nachricht_id IN (${platz(ids.length)})
    GROUP BY nachricht_id, email ORDER BY zeit`).all(...ids);
  const m = new Map();
  for (const r of z) m.set(r.nachricht_id, [...(m.get(r.nachricht_id) || []), { email: r.email, zeit: r.zeit }]);
  return m;
};
const labelsVon = (ids) => {
  const m = new Map();
  if (!ids.length) return m;
  for (const r of db.prepare(`SELECT nachricht_id, label_id FROM mail_nachricht_labels WHERE nachricht_id IN (${platz(ids.length)})`).all(...ids)) {
    m.set(r.nachricht_id, [...(m.get(r.nachricht_id) || []), r.label_id]);
  }
  return m;
};
const ungelesenVon = (ids, email) => (ids.length
  ? new Set(db.prepare(`SELECT nachricht_id FROM mail_ungelesen WHERE email = ? AND nachricht_id IN (${platz(ids.length)})`).all(email, ...ids).map((r) => r.nachricht_id))
  : new Set());
const notizenVon = (ids) => (ids.length
  ? new Map(db.prepare(`SELECT nachricht_id, count(*) n FROM mail_ereignisse WHERE art = 'notiz' AND nachricht_id IN (${platz(ids.length)}) GROUP BY nachricht_id`).all(...ids).map((r) => [r.nachricht_id, r.n]))
  : new Map());

function listenZeilen(zeilen, ich) {
  const ids = zeilen.map((n) => n.id);
  const offen = oeffnungen(ids), labels = labelsVon(ids), ungelesen = ungelesenVon(ids, ich), notizen = notizenVon(ids);
  return zeilen.map((n) => ({
    id: n.id, konto_id: n.konto_id, art: n.art, von_name: n.von_name, von_mail: n.von_mail, an: n.an, betreff: n.betreff, datum: n.datum,
    vorschau: n.vorschau, status: n.status, status_von: n.status_von, status_am: n.status_am,
    beantwortet_von: n.beantwortet_von, beantwortet_am: n.beantwortet_am, beantwortet_wie: n.beantwortet_wie,
    anhaenge: JSON.parse(n.anhaenge || '[]').length, gesehen: !!n.gesehen, geoeffnet: offen.get(n.id) || [],
    markiert: !!n.markiert, angeheftet: !!n.angeheftet, zurueck_bis: n.zurueck_bis, zugewiesen: n.zugewiesen, zugewiesen_von: n.zugewiesen_von,
    labels: labels.get(n.id) || [], ungelesen: ungelesen.has(n.id), notizen: notizen.get(n.id) || 0, thread: n.thread,
  }));
}

// ---------- Suche: freie Wörter plus von: an: betreff: label: hat:anhang ist:markiert|ungelesen|zugewiesen vor:/nach:JJJJ-MM-TT ----------
function sucheZerlegen(q, ich) {
  const wo = [], werte = [];
  const teile = String(q || '').match(/(\w+:"[^"]*"|\w+:\S+|"[^"]*"|\S+)/g) || [];
  for (const t of teile) {
    const m = t.match(/^(\w+):(.+)$/);
    const wert = (m ? m[2] : t).replace(/^"|"$/g, '');
    if (!wert) continue;
    const s = m?.[1].toLowerCase();
    if (s === 'von') { wo.push('(von_name LIKE ? OR von_mail LIKE ?)'); werte.push(`%${wert}%`, `%${wert}%`); }
    else if (s === 'an') { wo.push('(an LIKE ? OR cc LIKE ?)'); werte.push(`%${wert}%`, `%${wert}%`); }
    else if (s === 'betreff') { wo.push('betreff LIKE ?'); werte.push(`%${wert}%`); }
    else if (s === 'label') { wo.push('id IN (SELECT nl.nachricht_id FROM mail_nachricht_labels nl JOIN mail_labels l ON l.id = nl.label_id WHERE l.name LIKE ?)'); werte.push(`%${wert}%`); }
    else if (s === 'hat' && /^anhang/i.test(wert)) wo.push("anhaenge <> '[]'");
    else if (s === 'ist' && /^markiert/i.test(wert)) wo.push('markiert = 1');
    else if (s === 'ist' && /^ungelesen/i.test(wert)) { wo.push("NOT EXISTS (SELECT 1 FROM mail_ereignisse e WHERE e.nachricht_id = mail_nachrichten.id AND e.art = 'geoeffnet' AND e.email = ?)"); werte.push(ich); }
    else if (s === 'ist' && /^zugewiesen/i.test(wert)) wo.push('zugewiesen IS NOT NULL');
    else if ((s === 'vor' || s === 'nach') && /^\d{4}-\d{2}-\d{2}$/.test(wert)) { wo.push(`datum ${s === 'vor' ? '<' : '>='} ?`); werte.push(`${wert}T00:00:00.000Z`); }
    else { wo.push('(betreff LIKE ? OR von_name LIKE ? OR von_mail LIKE ? OR an LIKE ? OR text LIKE ?)'); werte.push(...Array(5).fill(`%${wert}%`)); }
  }
  return { wo, werte };
}

export function mailRouter({ io }) {
  const router = express.Router();
  // Live: nur an Personen mit Recht auf das Konto
  const signal = (kontoId, art, daten) => berechtigte(kontoId).forEach((e) => io.to(`nutzer:${e}`).emit(art, daten));
  const eigenesSignal = (email, art, daten) => io.to(`nutzer:${email}`).emit(art, daten);
  const abgleichJetzt = starteMailAbgleich({
    beiNeu: (kontoId, ids, nurAenderung) => {
      signal(kontoId, nurAenderung ? 'mail-geaendert' : 'mail-neu', { konto: kontoId, ids });
      if (nurAenderung || !ids.length) return;
      // Neue Eingänge aufs Handy (bei vielen auf einmal nur eine Sammelmeldung)
      const neu = db.prepare(`SELECT id, von_name, von_mail, betreff FROM mail_nachrichten WHERE art = 'eingang' AND id IN (${platz(ids.length)})`).all(...ids);
      if (!neu.length) return;
      const k = kontoHolen(kontoId);
      for (const e of berechtigte(kontoId)) {
        if (neu.length > 3) melden({ an: e, thema: 'mail', titel: `✉️ ${neu.length} neue Mails`, text: k?.name || '', url: '/mail', tag: `mail-${kontoId}` });
        else neu.forEach((n) => melden({ an: e, thema: 'mail', titel: `✉️ ${n.von_name || n.von_mail || 'Neue Mail'}`, text: n.betreff || '', url: `/mail#m${n.id}`, tag: `mail-${n.id}` }));
      }
    },
  });

  const nachricht = (req, res, mindestens = 'lesen') => {
    const n = db.prepare('SELECT * FROM mail_nachrichten WHERE id = ?').get(Number(req.params.id));
    const recht = n && rechtFuer(kontoHolen(n.konto_id), req.sitzung);
    if (!n || !recht) { res.status(404).json({ fehler: 'Mail nicht gefunden' }); return null; }
    if (!darf(recht, mindestens)) { res.status(403).json({ fehler: 'Dafür fehlt dir das Recht auf dieses Postfach' }); return null; }
    return n;
  };
  const konto = (req, res, mindestens) => {
    const k = kontoHolen(req.params.id);
    const recht = rechtFuer(k, req.sitzung);
    if (!k || !recht) { res.status(404).json({ fehler: 'Konto nicht gefunden' }); return null; }
    if (!darf(recht, mindestens)) { res.status(403).json({ fehler: 'Dafür fehlt dir das Recht auf dieses Konto' }); return null; }
    return { ...k, recht };
  };

  // ---------- Übersicht ----------
  router.get('/', (req, res) => {
    const konten = sichtbareKonten(req.sitzung);
    const nun = jetzt();
    const offen = Object.fromEntries(konten.map((k) => [k.id, db.prepare(`SELECT count(*) n FROM mail_nachrichten WHERE konto_id = ? AND art = 'eingang'
      AND status NOT IN (${platz(ERLEDIGT.length)}) AND (zurueck_bis IS NULL OR zurueck_bis <= ?)`).get(k.id, ...ERLEDIGT, nun).n]));
    const fortschritt = Object.fromEntries(konten.map((k) => [k.id, db.prepare('SELECT sum(gesamt) gesamt, (SELECT count(*) FROM mail_nachrichten WHERE konto_id = ?) da FROM mail_ordner WHERE konto_id = ?').get(k.id, k.id)]));
    const ids = konten.map((k) => k.id);
    const zaehlen = (wo, ...w) => (ids.length ? db.prepare(`SELECT count(*) n FROM mail_nachrichten WHERE konto_id IN (${platz(ids.length)}) AND ${wo}`).get(...ids, ...w).n : 0);
    res.json({
      ich: req.sitzung.sub, admin: req.sitzung.rolle === 'admin', team: team(), status: STATUS, erledigt: ERLEDIGT, rechte: RECHTE,
      konten: konten.map((k) => ({ ...kontoOeffentlich(k), offen: offen[k.id], fortschritt: fortschritt[k.id] })),
      labels: db.prepare('SELECT id, name, farbe, erstellt_von FROM mail_labels ORDER BY name').all(), farben: LABEL_FARBEN,
      zahlen: {
        mir: zaehlen(`zugewiesen = ? AND status NOT IN (${platz(ERLEDIGT.length)})`, req.sitzung.sub, ...ERLEDIGT),
        markiert: zaehlen('markiert = 1'),
        zurueck: zaehlen('zurueck_bis > ?', nun),
        entwuerfe: db.prepare("SELECT count(*) n FROM mail_entwuerfe WHERE email = ? AND status IN ('entwurf', 'fehler')").get(req.sitzung.sub).n,
        geplant: db.prepare("SELECT count(*) n FROM mail_entwuerfe WHERE email = ? AND status = 'geplant'").get(req.sitzung.sub).n,
      },
    });
  });

  // Tageszahlen fürs Cockpit oben in der Liste
  router.get('/statistik', (req, res) => {
    const ids = sichtbareKonten(req.sitzung).map((k) => k.id);
    if (!ids.length) return res.json({});
    const heute = new Date(); heute.setHours(0, 0, 0, 0);
    const h = heute.toISOString();
    const inK = `konto_id IN (${platz(ids.length)})`;
    const eins = (sql, ...w) => db.prepare(sql).get(...ids, ...w);
    const antwort = db.prepare(`SELECT avg((julianday(beantwortet_am) - julianday(datum)) * 24 * 60) m, count(*) n FROM mail_nachrichten
      WHERE ${inK} AND art = 'eingang' AND beantwortet_am IS NOT NULL AND beantwortet_am > datum AND datum >= ?`).get(...ids, new Date(Date.now() - 7 * 864e5).toISOString());
    res.json({
      eingang_heute: eins(`SELECT count(*) n FROM mail_nachrichten WHERE ${inK} AND art = 'eingang' AND datum >= ?`, h).n,
      erledigt_heute: eins(`SELECT count(*) n FROM mail_nachrichten WHERE ${inK} AND status IN (${platz(ERLEDIGT.length)}) AND status_am >= ?`, ...ERLEDIGT, h).n,
      gesendet_heute: eins(`SELECT count(*) n FROM mail_nachrichten WHERE ${inK} AND art = 'gesendet' AND datum >= ?`, h).n,
      offen: eins(`SELECT count(*) n FROM mail_nachrichten WHERE ${inK} AND art = 'eingang' AND status NOT IN (${platz(ERLEDIGT.length)}) AND (zurueck_bis IS NULL OR zurueck_bis <= ?)`, ...ERLEDIGT, jetzt()).n,
      antwort_minuten: antwort.n ? Math.round(antwort.m) : null,
      team_heute: db.prepare(`SELECT status_von email, count(*) n FROM mail_nachrichten WHERE ${inK} AND status IN (${platz(ERLEDIGT.length)}) AND status_am >= ? AND status_von NOT LIKE 'konto:%' GROUP BY status_von ORDER BY n DESC`).all(...ids, ...ERLEDIGT, h),
    });
  });

  // Adressbuch aus allen sichtbaren Mails (Absender und Empfänger gesendeter Mails)
  router.get('/kontakte', (req, res) => {
    const ids = sichtbareKonten(req.sitzung).map((k) => k.id);
    const q = String(req.query.q || '').trim();
    if (!ids.length || !q) return res.json({ kontakte: [] });
    const von = db.prepare(`SELECT max(von_name) name, lower(von_mail) email, count(*) n, max(datum) zuletzt FROM mail_nachrichten
      WHERE konto_id IN (${platz(ids.length)}) AND von_mail IS NOT NULL AND art <> 'spam' AND (von_mail LIKE ? OR von_name LIKE ?) GROUP BY lower(von_mail) ORDER BY n DESC LIMIT 12`).all(...ids, `%${q}%`, `%${q}%`);
    const an = db.prepare(`SELECT an FROM mail_nachrichten WHERE konto_id IN (${platz(ids.length)}) AND art = 'gesendet' AND an LIKE ? ORDER BY datum DESC LIMIT 60`).all(...ids, `%${q}%`);
    const m = new Map(von.map((k) => [k.email, k]));
    for (const r of an) {
      for (const teil of String(r.an).split(/,\s*/)) {
        const t = teil.match(/^(.*?)\s*<([^>]+)>$/) || [null, '', teil];
        const email = t[2].trim().toLowerCase();
        if (!email.includes('@') || !`${t[1]} ${email}`.toLowerCase().includes(q.toLowerCase())) continue;
        const alt = m.get(email);
        m.set(email, { name: alt?.name || t[1].replace(/^"|"$/g, '') || null, email, n: (alt?.n || 0) + 1, zuletzt: alt?.zuletzt });
      }
    }
    res.json({ kontakte: [...m.values()].sort((a, b) => b.n - a.n).slice(0, 8) });
  });

  // Steckbrief eines Absenders: wie oft, seit wann, was zuletzt
  router.get('/absender', (req, res) => {
    const ids = sichtbareKonten(req.sitzung).map((k) => k.id);
    const mail = String(req.query.mail || '').trim().toLowerCase();
    if (!ids.length || !mail) return res.json({});
    const inK = `konto_id IN (${platz(ids.length)})`;
    const z = db.prepare(`SELECT count(*) n, min(datum) erste, max(datum) letzte, sum(CASE WHEN status NOT IN (${platz(ERLEDIGT.length)}) THEN 1 ELSE 0 END) offen,
      sum(CASE WHEN beantwortet_am IS NOT NULL THEN 1 ELSE 0 END) beantwortet FROM mail_nachrichten WHERE ${inK} AND lower(von_mail) = ? AND art = 'eingang'`).get(...ERLEDIGT, ...ids, mail);
    const gesendet = db.prepare(`SELECT count(*) n FROM mail_nachrichten WHERE ${inK} AND art = 'gesendet' AND lower(an) LIKE ?`).get(...ids, `%${mail}%`).n;
    const letzte = db.prepare(`SELECT id, betreff, datum, status, art FROM mail_nachrichten WHERE ${inK} AND (lower(von_mail) = ? OR (art = 'gesendet' AND lower(an) LIKE ?)) ORDER BY datum DESC LIMIT 6`).all(...ids, mail, `%${mail}%`);
    res.json({ ...z, gesendet, letzte, domain: mail.split('@')[1] || '' });
  });

  // ---------- Konten ----------
  const kontoFelder = (b) => ({
    name: String(b.name || '').trim().slice(0, 80), email: String(b.email || '').trim().toLowerCase().slice(0, 200),
    absender: String(b.absender || '').trim().slice(0, 120) || null,
    imap_host: String(b.imap_host || '').trim(), imap_port: Number(b.imap_port) || 993,
    smtp_host: String(b.smtp_host || '').trim(), smtp_port: Number(b.smtp_port) || 465,
    benutzer: String(b.benutzer || b.email || '').trim(),
  });
  const pruefen = async (k) => {
    const ordner = await verbindungTesten(k);
    await smtp(k).verify();
    return ordner;
  };

  router.post('/konten', async (req, res) => {
    const f = kontoFelder(req.body || {});
    if (!f.email.includes('@') || !f.imap_host || !f.smtp_host || !req.body?.passwort) return res.status(400).json({ fehler: 'E-Mail, Server und Passwort ausfüllen' });
    const k = { ...f, passwort: verschluesseln(req.body.passwort) };
    try {
      const o = await pruefen(k);
      const r = db.prepare(`INSERT INTO mail_konten (name, email, absender, imap_host, imap_port, smtp_host, smtp_port, benutzer, passwort, besitzer,
          ordner_eingang, ordner_gesendet, ordner_spam) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(f.name || f.email, f.email, f.absender, f.imap_host, f.imap_port, f.smtp_host, f.smtp_port, f.benutzer, k.passwort, req.sitzung.sub, o.eingang, o.gesendet, o.spam);
      abgleichJetzt(Number(r.lastInsertRowid));
      res.json({ ok: true, id: Number(r.lastInsertRowid), ordner: o });
    } catch (e) {
      res.status(400).json({ fehler: `Verbindung fehlgeschlagen: ${e.responseText || e.response || e.message}` });
    }
  });

  router.patch('/konten/:id', async (req, res) => {
    const alt = konto(req, res, 'verwalten');
    if (!alt) return;
    const f = { ...kontoFelder({ ...alt, ...req.body }) };
    const passwort = req.body?.passwort ? verschluesseln(req.body.passwort) : alt.passwort;
    const zugangNeu = req.body?.passwort || ['imap_host', 'imap_port', 'smtp_host', 'smtp_port', 'benutzer'].some((x) => req.body?.[x] !== undefined && String(req.body[x]) !== String(alt[x]));
    if (zugangNeu) {
      try { await pruefen({ ...f, passwort }); } catch (e) { return res.status(400).json({ fehler: `Verbindung fehlgeschlagen: ${e.responseText || e.message}` }); }
    }
    const aktiv = req.body?.aktiv === undefined ? alt.aktiv : req.body.aktiv ? 1 : 0;
    const signatur = req.body?.signatur === undefined ? alt.signatur : htmlSauber(req.body.signatur).slice(0, 20_000) || null;
    db.prepare(`UPDATE mail_konten SET name = ?, absender = ?, imap_host = ?, imap_port = ?, smtp_host = ?, smtp_port = ?, benutzer = ?, passwort = ?, aktiv = ?, signatur = ?,
      status = CASE WHEN ? THEN 'neu' ELSE status END, fehler = CASE WHEN ? THEN NULL ELSE fehler END WHERE id = ?`)
      .run(f.name || alt.name, f.absender, f.imap_host, f.imap_port, f.smtp_host, f.smtp_port, f.benutzer, passwort, aktiv, signatur, zugangNeu ? 1 : 0, zugangNeu ? 1 : 0, alt.id);
    if (zugangNeu || (aktiv && !alt.aktiv)) abgleichJetzt(alt.id);
    res.json({ ok: true });
  });

  router.delete('/konten/:id', (req, res) => {
    const k = konto(req, res, 'verwalten');
    if (!k) return;
    for (const t of ['mail_ereignisse', 'mail_nachricht_labels', 'mail_ungelesen']) db.prepare(`DELETE FROM ${t} WHERE nachricht_id IN (SELECT id FROM mail_nachrichten WHERE konto_id = ?)`).run(k.id);
    for (const t of ['mail_nachrichten', 'mail_ordner', 'mail_rechte']) db.prepare(`DELETE FROM ${t} WHERE konto_id = ?`).run(k.id);
    db.prepare('DELETE FROM mail_konten WHERE id = ?').run(k.id);
    res.json({ ok: true });
  });

  router.post('/konten/:id/abgleich', (req, res) => {
    const k = konto(req, res, 'lesen');
    if (!k) return;
    abgleichJetzt(k.id);
    res.json({ ok: true });
  });

  router.get('/konten/:id/rechte', (req, res) => {
    const k = konto(req, res, 'verwalten');
    if (!k) return;
    res.json({ besitzer: k.besitzer, rechte: db.prepare('SELECT email, recht FROM mail_rechte WHERE konto_id = ?').all(k.id) });
  });

  router.put('/konten/:id/rechte', (req, res) => {
    const k = konto(req, res, 'verwalten');
    if (!k) return;
    const erlaubt = new Set(team().map((t) => t.email));
    const liste = (req.body?.rechte || []).filter((r) => erlaubt.has(r.email) && RECHTE.includes(r.recht) && r.email !== k.besitzer);
    db.prepare('DELETE FROM mail_rechte WHERE konto_id = ?').run(k.id);
    for (const r of liste) db.prepare('INSERT INTO mail_rechte (konto_id, email, recht) VALUES (?, ?, ?)').run(k.id, r.email, r.recht);
    res.json({ ok: true });
  });

  // ---------- Labels (fürs ganze Team gleich) ----------
  router.post('/labels', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 40);
    const farbe = LABEL_FARBEN.includes(req.body?.farbe) ? req.body.farbe : LABEL_FARBEN[db.prepare('SELECT count(*) n FROM mail_labels').get().n % LABEL_FARBEN.length];
    if (!name) return res.status(400).json({ fehler: 'Name fehlt' });
    try {
      const r = db.prepare('INSERT INTO mail_labels (name, farbe, erstellt_von) VALUES (?, ?, ?)').run(name, farbe, req.sitzung.sub);
      io.emit('mail-labels');
      res.json({ ok: true, id: Number(r.lastInsertRowid) });
    } catch { res.status(400).json({ fehler: 'Ein Label mit diesem Namen gibt es schon' }); }
  });
  router.put('/labels/:id', (req, res) => {
    const l = db.prepare('SELECT * FROM mail_labels WHERE id = ?').get(Number(req.params.id));
    if (!l) return res.status(404).json({ fehler: 'Label nicht gefunden' });
    const name = String(req.body?.name ?? l.name).trim().slice(0, 40) || l.name;
    const farbe = LABEL_FARBEN.includes(req.body?.farbe) ? req.body.farbe : l.farbe;
    try { db.prepare('UPDATE mail_labels SET name = ?, farbe = ? WHERE id = ?').run(name, farbe, l.id); } catch { return res.status(400).json({ fehler: 'Name schon vergeben' }); }
    io.emit('mail-labels');
    res.json({ ok: true });
  });
  router.delete('/labels/:id', (req, res) => {
    const l = db.prepare('SELECT * FROM mail_labels WHERE id = ?').get(Number(req.params.id));
    if (!l) return res.status(404).json({ fehler: 'Label nicht gefunden' });
    if (req.sitzung.rolle !== 'admin' && l.erstellt_von !== req.sitzung.sub) return res.status(403).json({ fehler: 'Nur wer das Label angelegt hat (oder ein Admin) darf es löschen' });
    db.prepare('DELETE FROM mail_nachricht_labels WHERE label_id = ?').run(l.id);
    db.prepare('DELETE FROM mail_labels WHERE id = ?').run(l.id);
    io.emit('mail-labels');
    res.json({ ok: true });
  });

  // ---------- Liste ----------
  router.get('/nachrichten', (req, res) => {
    const ich = req.sitzung.sub;
    const konten = sichtbareKonten(req.sitzung).map((k) => k.id);
    const gewaehlt = req.query.konto && req.query.konto !== 'alle' ? [Number(req.query.konto)].filter((id) => konten.includes(id)) : konten;
    if (!gewaehlt.length) return res.json({ nachrichten: [], mehr: false });
    const wo = [`konto_id IN (${platz(gewaehlt.length)})`];
    const werte = [...gewaehlt];
    const nun = jetzt();
    const nichtErledigt = () => { wo.push(`status NOT IN (${platz(ERLEDIGT.length)})`); werte.push(...ERLEDIGT); };
    const nichtZurueck = () => { wo.push('(zurueck_bis IS NULL OR zurueck_bis <= ?)'); werte.push(nun); };
    const ansicht = String(req.query.ansicht || 'offen');
    const suche = String(req.query.q || '').trim();
    if (ansicht === 'gesendet') wo.push("art = 'gesendet'");
    else if (ansicht === 'spam') wo.push("(art = 'spam' OR status = 'spam')");
    else if (ansicht === 'markiert') wo.push('markiert = 1');
    else if (ansicht === 'zurueck') { wo.push('zurueck_bis > ?'); werte.push(nun); }
    else if (ansicht === 'mir') { wo.push('zugewiesen = ?'); werte.push(ich); nichtErledigt(); }
    else if (ansicht === 'anhang') wo.push("anhaenge <> '[]'", "art <> 'spam'", "status <> 'spam'");
    else if (ansicht.startsWith('label:')) { wo.push('id IN (SELECT nachricht_id FROM mail_nachricht_labels WHERE label_id = ?)'); werte.push(Number(ansicht.slice(6))); }
    else {
      wo.push("art = 'eingang'");
      if (ansicht === 'offen') { nichtErledigt(); if (!suche) nichtZurueck(); }
      if (ansicht === 'erledigt') { wo.push(`status IN (${platz(ERLEDIGT.length)})`, "status <> 'spam'"); werte.push(...ERLEDIGT); }
      if (ansicht === 'alle') wo.push("status <> 'spam'");
      if (ansicht === 'ungeoeffnet') {
        wo.push("NOT EXISTS (SELECT 1 FROM mail_ereignisse e WHERE e.nachricht_id = mail_nachrichten.id AND e.art = 'geoeffnet' AND e.email = ?)"); werte.push(ich);
        nichtErledigt(); nichtZurueck();
      }
    }
    const s = sucheZerlegen(suche, ich);
    wo.push(...s.wo); werte.push(...s.werte);
    // Angeheftete Mails stehen auf der ersten Seite oben, danach geht es nach Datum weiter
    const mitOben = ansicht !== 'zurueck';
    const oben = !mitOben || req.query.vor ? [] : db.prepare(`SELECT * FROM mail_nachrichten WHERE ${wo.join(' AND ')} AND angeheftet = 1 ORDER BY datum DESC LIMIT 20`).all(...werte);
    if (mitOben) wo.push('angeheftet = 0');
    if (req.query.vor) { wo.push('datum < ?'); werte.push(String(req.query.vor)); }
    const zeilen = db.prepare(`SELECT * FROM mail_nachrichten WHERE ${wo.join(' AND ')} ORDER BY ${mitOben ? 'datum DESC' : 'zurueck_bis ASC'} LIMIT ${SEITE + 1}`).all(...werte);
    const liste = zeilen.slice(0, SEITE);
    res.json({ nachrichten: listenZeilen([...oben, ...liste], ich), mehr: mitOben && zeilen.length > SEITE });
  });

  // ---------- Einzelne Mail (Öffnen wird protokolliert) ----------
  router.get('/nachrichten/:id', (req, res) => {
    const n = nachricht(req, res);
    if (!n) return;
    const ich = req.sitzung.sub;
    if (req.query.still !== '1') {
      const schonOffen = db.prepare("SELECT 1 FROM mail_ereignisse WHERE nachricht_id = ? AND email = ? AND art = 'geoeffnet'").get(n.id, ich);
      const warUngelesen = db.prepare('DELETE FROM mail_ungelesen WHERE nachricht_id = ? AND email = ?').run(n.id, ich).changes;
      if (!schonOffen) ereignis(n.id, ich, 'geoeffnet');
      if (!n.gesehen && n.art === 'eingang') {
        db.prepare('UPDATE mail_nachrichten SET gesehen = 1 WHERE id = ?').run(n.id);
        postfachAktion(n.id, 'gelesen');
      }
      if (!schonOffen || warUngelesen) signal(n.konto_id, 'mail-geaendert', { konto: n.konto_id, ids: [n.id] });
    }
    const verlauf = db.prepare('SELECT id, email, art, text, zeit FROM mail_ereignisse WHERE nachricht_id = ? ORDER BY id').all(n.id);
    const sichtbar = sichtbareKonten(req.sitzung).map((k) => k.id);
    const thread = n.thread ? db.prepare(`SELECT id, art, von_name, von_mail, an, betreff, datum, status, vorschau FROM mail_nachrichten
      WHERE thread = ? AND konto_id IN (${sichtbar.join(',') || 0}) ORDER BY datum`).all(n.thread) : [];
    const frisch = db.prepare('SELECT * FROM mail_nachrichten WHERE id = ?').get(n.id);
    res.json({
      ...listenZeilen([frisch], ich)[0], cc: n.cc, text: n.text, html: n.html, message_id: n.message_id,
      anhang_liste: JSON.parse(n.anhaenge || '[]'), verlauf, thread, recht: rechtFuer(kontoHolen(n.konto_id), req.sitzung),
    });
  });

  // Eine Aktion auf einer Mail – gemeinsam für Einzel- und Stapelaktionen
  const MINDESTENS = { gelesen: 'lesen', markieren: 'lesen', status: 'schreiben', anheften: 'schreiben', zurueck: 'schreiben', zuweisen: 'schreiben', label: 'schreiben' };
  function aktion(n, sitzung, art, wert) {
    const ich = sitzung.sub;
    if (art === 'status') {
      const status = String(wert || '');
      if (!STATUS[status]) throw fehler('Unbekannter Status');
      const erledigt = ERLEDIGT.includes(status) ? 1 : 0;
      db.prepare(`UPDATE mail_nachrichten SET status = ?, status_von = ?, status_am = ?,
        zurueck_bis = CASE WHEN ? THEN NULL ELSE zurueck_bis END, angeheftet = CASE WHEN ? THEN 0 ELSE angeheftet END WHERE id = ?`)
        .run(status, ich, jetzt(), erledigt, erledigt, n.id);
      ereignis(n.id, ich, `status:${status}`);
      if (status === 'spam') postfachAktion(n.id, 'spam');
      else if (status === 'geantwortet') postfachAktion(n.id, 'beantwortet');
      else if (status !== 'offen' && !n.gesehen) { db.prepare('UPDATE mail_nachrichten SET gesehen = 1 WHERE id = ?').run(n.id); postfachAktion(n.id, 'gelesen'); }
    } else if (art === 'gelesen') {
      if (wert) {
        db.prepare('DELETE FROM mail_ungelesen WHERE nachricht_id = ? AND email = ?').run(n.id, ich);
        if (!db.prepare("SELECT 1 FROM mail_ereignisse WHERE nachricht_id = ? AND email = ? AND art = 'geoeffnet'").get(n.id, ich)) ereignis(n.id, ich, 'geoeffnet');
        if (!n.gesehen) { db.prepare('UPDATE mail_nachrichten SET gesehen = 1 WHERE id = ?').run(n.id); postfachAktion(n.id, 'gelesen'); }
      } else {
        db.prepare('INSERT OR IGNORE INTO mail_ungelesen (nachricht_id, email) VALUES (?, ?)').run(n.id, ich);
        if (n.gesehen) { db.prepare('UPDATE mail_nachrichten SET gesehen = 0 WHERE id = ?').run(n.id); postfachAktion(n.id, 'ungelesen'); }
      }
    } else if (art === 'markieren') {
      if (!!wert === !!n.markiert) return;
      db.prepare('UPDATE mail_nachrichten SET markiert = ? WHERE id = ?').run(wert ? 1 : 0, n.id);
      ereignis(n.id, ich, wert ? 'markiert' : 'entmarkiert');
      postfachAktion(n.id, wert ? 'markiert' : 'entmarkiert');
    } else if (art === 'anheften') {
      if (!!wert === !!n.angeheftet) return;
      db.prepare('UPDATE mail_nachrichten SET angeheftet = ? WHERE id = ?').run(wert ? 1 : 0, n.id);
      ereignis(n.id, ich, wert ? 'angeheftet' : 'losgeloest');
    } else if (art === 'zurueck') {
      const bis = wert ? new Date(wert) : null;
      if (bis && (Number.isNaN(bis.getTime()) || bis.getTime() < Date.now())) throw fehler('Zeitpunkt liegt in der Vergangenheit');
      db.prepare('UPDATE mail_nachrichten SET zurueck_bis = ?, zurueck_von = ?, angeheftet = 0 WHERE id = ?').run(bis ? bis.toISOString() : null, bis ? ich : null, n.id);
      ereignis(n.id, ich, bis ? 'zurueckgestellt' : 'zurueckgeholt', bis ? bis.toISOString() : null);
    } else if (art === 'zuweisen') {
      const an = wert ? String(wert).toLowerCase() : null;
      if (an === (n.zugewiesen || null)) return;
      if (an && !team().some((t) => t.email === an)) throw fehler('Person unbekannt');
      if (an && !darf(rechtFuer(kontoHolen(n.konto_id), sitzungVon(an)), 'lesen')) throw fehler(`${teamName(an)} hat keinen Zugriff auf dieses Postfach`);
      db.prepare('UPDATE mail_nachrichten SET zugewiesen = ?, zugewiesen_von = ? WHERE id = ?').run(an, an ? ich : null, n.id);
      ereignis(n.id, ich, an ? 'zugewiesen' : 'zuweisung_weg', an);
      if (an && an !== ich) {
        melden({ an, thema: 'team', titel: `📌 ${teamName(ich)} hat dir eine Mail zugewiesen`, text: n.betreff || '', url: `/mail#m${n.id}`, tag: `mail-${n.id}` });
        eigenesSignal(an, 'mail-zugewiesen', { id: n.id, von: ich, betreff: n.betreff });
      }
    } else if (art === 'label') {
      const { id, an } = wert || {};
      if (!db.prepare('SELECT 1 FROM mail_labels WHERE id = ?').get(Number(id))) throw fehler('Label unbekannt');
      if (an) db.prepare('INSERT OR IGNORE INTO mail_nachricht_labels (nachricht_id, label_id) VALUES (?, ?)').run(n.id, Number(id));
      else db.prepare('DELETE FROM mail_nachricht_labels WHERE nachricht_id = ? AND label_id = ?').run(n.id, Number(id));
    } else throw fehler('Unbekannte Aktion');
  }

  router.post('/nachrichten/:id/status', (req, res) => {
    const status = String(req.body?.status || '');
    const n = nachricht(req, res, status === 'gelesen' ? 'lesen' : 'schreiben');
    if (!n) return;
    try { aktion(n, req.sitzung, 'status', status); } catch (e) { return res.status(e.code || 500).json({ fehler: e.message }); }
    signal(n.konto_id, 'mail-geaendert', { konto: n.konto_id, ids: [n.id] });
    res.json({ ok: true });
  });

  // Stapel: { ids: [..], aktion: 'status'|'gelesen'|'markieren'|'anheften'|'zurueck'|'zuweisen'|'label', wert }
  router.post('/stapel', (req, res) => {
    const art = String(req.body?.aktion || '');
    if (!MINDESTENS[art]) return res.status(400).json({ fehler: 'Unbekannte Aktion' });
    const mindestens = art === 'status' && req.body.wert === 'gelesen' ? 'lesen' : MINDESTENS[art];
    const ids = [...new Set((req.body?.ids || []).map(Number).filter(Boolean))].slice(0, 500);
    const geaendert = new Map();
    let hinweis = null, ok = 0;
    for (const id of ids) {
      const n = db.prepare('SELECT * FROM mail_nachrichten WHERE id = ?').get(id);
      if (!n || !darf(rechtFuer(kontoHolen(n.konto_id), req.sitzung), mindestens)) { hinweis ||= 'Bei einigen Mails fehlt dir das Recht'; continue; }
      try {
        aktion(n, req.sitzung, art, req.body.wert);
        ok += 1;
        geaendert.set(n.konto_id, [...(geaendert.get(n.konto_id) || []), n.id]);
      } catch (e) {
        hinweis = e.message;
        if (e.code === 400) break;
      }
    }
    for (const [kontoId, l] of geaendert) signal(kontoId, 'mail-geaendert', { konto: kontoId, ids: l });
    if (!ok && hinweis) return res.status(400).json({ fehler: hinweis });
    res.json({ ok: true, anzahl: ok, hinweis });
  });

  // Interne Notiz (nur im Team sichtbar, geht nie an den Kunden); @Vorname benachrichtigt
  router.post('/nachrichten/:id/notiz', (req, res) => {
    const n = nachricht(req, res, 'lesen');
    if (!n) return;
    const text = String(req.body?.text || '').trim().slice(0, 4000);
    if (!text) return res.status(400).json({ fehler: 'Notiz ist leer' });
    ereignis(n.id, req.sitzung.sub, 'notiz', text);
    const erwaehnt = team().filter((t) => t.email !== req.sitzung.sub
      && new RegExp(`@${t.name.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\wäöüß])`, 'i').test(text));
    for (const t of erwaehnt) {
      melden({ an: t.email, thema: 'team', titel: `💬 ${teamName(req.sitzung.sub)} hat dich erwähnt`, text: `${n.betreff}: ${text.slice(0, 120)}`, url: `/mail#m${n.id}`, tag: `mail-notiz-${n.id}` });
      eigenesSignal(t.email, 'mail-erwaehnt', { id: n.id, von: req.sitzung.sub, betreff: n.betreff });
    }
    signal(n.konto_id, 'mail-geaendert', { konto: n.konto_id, ids: [n.id] });
    res.json({ ok: true, erwaehnt: erwaehnt.map((t) => t.email) });
  });
  router.delete('/nachrichten/:id/notiz/:eid', (req, res) => {
    const n = nachricht(req, res, 'lesen');
    if (!n) return;
    const r = db.prepare("DELETE FROM mail_ereignisse WHERE id = ? AND nachricht_id = ? AND art = 'notiz' AND email = ?").run(Number(req.params.eid), n.id, req.sitzung.sub);
    if (!r.changes) return res.status(404).json({ fehler: 'Notiz nicht gefunden (nur eigene löschbar)' });
    signal(n.konto_id, 'mail-geaendert', { konto: n.konto_id, ids: [n.id] });
    res.json({ ok: true });
  });

  // Anhang: ?ansehen=1 zeigt Bilder und PDFs im Browser, alles andere wird heruntergeladen
  const ANSEHBAR = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/i;
  router.get('/nachrichten/:id/anhang/:i', async (req, res) => {
    const n = nachricht(req, res);
    if (!n) return;
    try {
      const a = await anhangHolen(n, Number(req.params.i));
      if (!a) return res.status(404).json({ fehler: 'Anhang nicht gefunden' });
      const typ = String(a.contentType || 'application/octet-stream');
      const ansehen = req.query.ansehen === '1' && ANSEHBAR.test(typ);
      res.set('Content-Type', ansehen || !/html|xml|svg|javascript|^text\//i.test(typ) ? typ : 'application/octet-stream');
      res.set('Content-Disposition', `${ansehen ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename || 'anhang')}`);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(a.content);
    } catch (e) {
      res.status(502).json({ fehler: `Postfach nicht erreichbar: ${e.message}` });
    }
  });

  // ---------- Entwürfe, Senden (mit Rückgängig-Frist oder geplant) ----------
  const entwurfZeile = (e) => e && ({
    id: e.id, konto_id: e.konto_id, art: e.art, bezug: e.bezug, an: e.an || '', cc: e.cc || '', bcc: e.bcc || '', betreff: e.betreff || '', html: e.html || '',
    anhaenge: JSON.parse(e.anhaenge || '[]').map(({ datei, ...a }) => a), original_anhaenge: JSON.parse(e.original_anhaenge || '[]'),
    senden_um: e.senden_um, status: e.status, fehler: e.fehler, geaendert: e.geaendert,
  });
  const entwurf = (req, res) => {
    const e = db.prepare('SELECT * FROM mail_entwuerfe WHERE id = ? AND email = ?').get(Number(req.params.id), req.sitzung.sub);
    if (!e) { res.status(404).json({ fehler: 'Entwurf nicht gefunden' }); return null; }
    return e;
  };
  const entwurfFelder = (b) => {
    const f = {};
    for (const x of ['an', 'cc', 'bcc']) if (x in b) f[x] = String(b[x] || '').slice(0, 4000);
    if ('betreff' in b) f.betreff = String(b.betreff || '').slice(0, 300);
    if ('html' in b) f.html = htmlSauber(b.html);
    if ('konto_id' in b) f.konto_id = Number(b.konto_id) || null;
    if ('art' in b && ['neu', 'antwort', 'allen', 'weiter'].includes(b.art)) f.art = b.art;
    if ('bezug' in b) f.bezug = Number(b.bezug) || null;
    if ('original_anhaenge' in b) f.original_anhaenge = JSON.stringify((Array.isArray(b.original_anhaenge) ? b.original_anhaenge : []).map(Number).filter((i) => i >= 0).slice(0, 50));
    return f;
  };
  const entwurfDateienLoeschen = (e) => JSON.parse(e.anhaenge || '[]').forEach((a) => rmSync(join(ANHANG_ORDNER, a.datei), { force: true }));

  router.get('/entwuerfe', (req, res) => {
    res.json({ entwuerfe: db.prepare("SELECT * FROM mail_entwuerfe WHERE email = ? AND status IN ('entwurf', 'geplant', 'fehler') ORDER BY coalesce(senden_um, geaendert) DESC").all(req.sitzung.sub).map(entwurfZeile) });
  });
  router.get('/entwuerfe/:id', (req, res) => { const e = entwurf(req, res); if (e) res.json(entwurfZeile(e)); });
  router.post('/entwuerfe', (req, res) => {
    const f = entwurfFelder(req.body || {});
    const spalten = Object.keys(f);
    const r = db.prepare(`INSERT INTO mail_entwuerfe (email${spalten.map((s) => `, ${s}`).join('')}) VALUES (?${spalten.map(() => ', ?').join('')})`).run(req.sitzung.sub, ...Object.values(f));
    res.json(entwurfZeile(db.prepare('SELECT * FROM mail_entwuerfe WHERE id = ?').get(Number(r.lastInsertRowid))));
  });
  router.put('/entwuerfe/:id', (req, res) => {
    const e = entwurf(req, res);
    if (!e) return;
    if (e.status === 'sendet') return res.status(409).json({ fehler: 'Wird gerade gesendet' });
    const f = entwurfFelder(req.body || {});
    if (Object.keys(f).length) {
      db.prepare(`UPDATE mail_entwuerfe SET ${Object.keys(f).map((s) => `${s} = ?`).join(', ')}, geaendert = datetime('now') WHERE id = ?`).run(...Object.values(f), e.id);
    }
    res.json({ ok: true });
  });
  router.delete('/entwuerfe/:id', (req, res) => {
    const e = entwurf(req, res);
    if (!e) return;
    if (e.status === 'sendet') return res.status(409).json({ fehler: 'Wird gerade gesendet' });
    entwurfDateienLoeschen(e);
    db.prepare('DELETE FROM mail_entwuerfe WHERE id = ?').run(e.id);
    res.json({ ok: true });
  });
  // Datei hochladen: roher Inhalt, Name in X-Dateiname (URL-kodiert), Typ in X-Typ
  router.post('/entwuerfe/:id/anhang', express.raw({ type: () => true, limit: MAX_ANHAENGE }), (req, res) => {
    const e = entwurf(req, res);
    if (!e) return;
    const anhaenge = JSON.parse(e.anhaenge || '[]');
    const inhalt = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!inhalt.length) return res.status(400).json({ fehler: 'Datei ist leer' });
    if (anhaenge.reduce((s, a) => s + a.groesse, 0) + inhalt.length > MAX_ANHAENGE) return res.status(413).json({ fehler: 'Zusammen höchstens 25 MB Anhänge je Mail' });
    let name = 'anhang';
    try { name = decodeURIComponent(String(req.get('X-Dateiname') || 'anhang')); } catch {}
    name = name.replace(/[\\/\0\r\n]/g, '_').slice(0, 180) || 'anhang';
    const a = { id: crypto.randomBytes(6).toString('hex'), name, typ: String(req.get('X-Typ') || 'application/octet-stream').slice(0, 120), groesse: inhalt.length };
    a.datei = `${e.id}-${a.id}`;
    writeFileSync(join(ANHANG_ORDNER, a.datei), inhalt);
    anhaenge.push(a);
    db.prepare("UPDATE mail_entwuerfe SET anhaenge = ?, geaendert = datetime('now') WHERE id = ?").run(JSON.stringify(anhaenge), e.id);
    const { datei, ...rest } = a;
    res.json(rest);
  });
  router.delete('/entwuerfe/:id/anhang/:aid', (req, res) => {
    const e = entwurf(req, res);
    if (!e) return;
    const anhaenge = JSON.parse(e.anhaenge || '[]');
    const a = anhaenge.find((x) => x.id === req.params.aid);
    if (a) rmSync(join(ANHANG_ORDNER, a.datei), { force: true });
    db.prepare('UPDATE mail_entwuerfe SET anhaenge = ? WHERE id = ?').run(JSON.stringify(anhaenge.filter((x) => x !== a)), e.id);
    res.json({ ok: true });
  });

  const liste = (s) => String(s || '').split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
  const adresseOk = (x) => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(x.replace(/^.*<|>$/g, ''));
  function sendePruefen(e, sitzung) {
    const k = kontoHolen(e.konto_id);
    if (!darf(rechtFuer(k, sitzung), 'schreiben')) throw fehler('Für dieses Postfach darfst du nicht senden', 403);
    const an = liste(e.an), cc = liste(e.cc), bcc = liste(e.bcc);
    if (!an.length) throw fehler('Empfänger fehlt');
    if ([...an, ...cc, ...bcc].some((x) => !adresseOk(x))) throw fehler('Eine Empfängeradresse ist ungültig');
    return { k, an, cc, bcc };
  }

  // Tatsächlich verschicken (vom Planer aufgerufen, wenn die Frist abgelaufen ist)
  async function versenden(e) {
    const { k, an, cc, bcc } = sendePruefen(e, sitzungVon(e.email));
    const bezug = e.bezug ? db.prepare('SELECT * FROM mail_nachrichten WHERE id = ?').get(e.bezug) : null;
    const html = e.html || '';
    const anhaenge = JSON.parse(e.anhaenge || '[]').map((a) => ({ filename: a.name, contentType: a.typ, content: readFileSync(join(ANHANG_ORDNER, a.datei)) }));
    if (bezug && e.art === 'weiter') {
      for (const i of JSON.parse(e.original_anhaenge || '[]')) {
        const a = await anhangHolen(bezug, i);
        if (a) anhaenge.push({ filename: a.filename, contentType: a.contentType, content: a.content });
      }
    }
    const opts = {
      from: { name: k.absender || k.name, address: k.email }, to: an, cc, bcc, subject: String(e.betreff || '').slice(0, 300),
      text: htmlZuText(html), html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${html}</div>`, attachments: anhaenge,
    };
    if (bezug && e.art !== 'weiter' && bezug.message_id) {
      opts.inReplyTo = `<${bezug.message_id}>`;
      opts.references = [bezug.thread, bezug.message_id].filter((x, i, a) => x && a.indexOf(x) === i).map((x) => `<${x}>`);
    }
    const info = await smtp(k).sendMail(opts);
    // Kopie in den Gesendet-Ordner (ohne Bcc-Zeile für die Empfänger, aber mit Message-ID wie verschickt)
    const roh = await new MailComposer({ ...opts, bcc: undefined, messageId: info.messageId }).compile().build();
    inGesendetAblegen(k, roh).then(() => abgleichJetzt(k.id));
    if (bezug) {
      if (e.art !== 'weiter') {
        db.prepare(`UPDATE mail_nachrichten SET beantwortet_von = ?, beantwortet_am = ?, beantwortet_wie = 'tool', status = 'geantwortet', status_von = ?, status_am = ?,
          zurueck_bis = NULL, angeheftet = 0 WHERE id = ?`).run(e.email, jetzt(), e.email, jetzt(), bezug.id);
        ereignis(bezug.id, e.email, 'beantwortet', `an ${an.join(', ')}`);
        postfachAktion(bezug.id, 'beantwortet');
        if (bezug.message_id) antwortVermerken(bezug.message_id, { von: e.email, am: jetzt(), wie: 'tool' });
      } else ereignis(bezug.id, e.email, 'weitergeleitet', `an ${an.join(', ')}`);
      signal(bezug.konto_id, 'mail-geaendert', { konto: bezug.konto_id, ids: [bezug.id] });
    }
  }

  // Senden: verzoegerung (Sekunden, für „Rückgängig“) oder senden_um (geplant)
  router.post('/entwuerfe/:id/senden', (req, res) => {
    const e = entwurf(req, res);
    if (!e) return;
    if (!['entwurf', 'fehler', 'geplant'].includes(e.status)) return res.status(409).json({ fehler: 'Wird gerade gesendet' });
    try { sendePruefen(e, req.sitzung); } catch (x) { return res.status(x.code || 400).json({ fehler: x.message }); }
    let um = new Date(Date.now() + Math.min(30, Math.max(0, Number(req.body?.verzoegerung) || 0)) * 1000);
    if (req.body?.senden_um) {
      um = new Date(req.body.senden_um);
      if (Number.isNaN(um.getTime()) || um.getTime() < Date.now() - 60_000) return res.status(400).json({ fehler: 'Sendezeit liegt in der Vergangenheit' });
    }
    db.prepare("UPDATE mail_entwuerfe SET status = 'geplant', senden_um = ?, fehler = NULL, geaendert = datetime('now') WHERE id = ?").run(um.toISOString(), e.id);
    const warten = um.getTime() - Date.now();
    if (warten < 60_000) setTimeout(planer, Math.max(0, warten) + 50);
    res.json({ ok: true, senden_um: um.toISOString() });
  });
  // Rückgängig / Planung aufheben → zurück zum Entwurf
  router.post('/entwuerfe/:id/stopp', (req, res) => {
    const e = entwurf(req, res);
    if (!e) return;
    const r = db.prepare("UPDATE mail_entwuerfe SET status = 'entwurf', senden_um = NULL WHERE id = ? AND status = 'geplant'").run(e.id);
    if (!r.changes) return res.status(409).json({ fehler: 'Zu spät – die Mail ist schon unterwegs' });
    res.json({ ok: true });
  });

  let planerLaeuft = false;
  async function planer() {
    if (planerLaeuft) return;
    planerLaeuft = true;
    try {
      const faellig = db.prepare("SELECT * FROM mail_entwuerfe WHERE status = 'geplant' AND senden_um <= ? ORDER BY senden_um").all(jetzt());
      for (const e of faellig) {
        if (!db.prepare("UPDATE mail_entwuerfe SET status = 'sendet' WHERE id = ? AND status = 'geplant'").run(e.id).changes) continue;
        try {
          await versenden(e);
          entwurfDateienLoeschen(e);
          db.prepare('DELETE FROM mail_entwuerfe WHERE id = ?').run(e.id);
          eigenesSignal(e.email, 'mail-gesendet', { id: e.id, betreff: e.betreff });
        } catch (x) {
          const text = String(x.response || x.message).slice(0, 300);
          db.prepare("UPDATE mail_entwuerfe SET status = 'fehler', fehler = ? WHERE id = ?").run(text, e.id);
          eigenesSignal(e.email, 'mail-sendefehler', { id: e.id, betreff: e.betreff, fehler: text });
          melden({ an: e.email, thema: 'mail', titel: '⚠️ Mail nicht gesendet', text: `${e.betreff || '(ohne Betreff)'}: ${text}`, url: '/mail#entwuerfe', immer: true });
        }
      }
      // Zurückgestellte Mails, deren Zeit gekommen ist, oben anheften und Bescheid geben
      const zurueck = db.prepare('SELECT id, konto_id, betreff, zurueck_von FROM mail_nachrichten WHERE zurueck_bis IS NOT NULL AND zurueck_bis <= ?').all(jetzt());
      for (const n of zurueck) {
        db.prepare('UPDATE mail_nachrichten SET zurueck_bis = NULL, angeheftet = 1 WHERE id = ?').run(n.id);
        if (n.zurueck_von) {
          ereignis(n.id, n.zurueck_von, 'wieder_da');
          db.prepare('INSERT OR IGNORE INTO mail_ungelesen (nachricht_id, email) VALUES (?, ?)').run(n.id, n.zurueck_von);
          melden({ an: n.zurueck_von, thema: 'team', titel: '⏰ Erinnerung an eine Mail', text: n.betreff || '', url: `/mail#m${n.id}`, tag: `mail-${n.id}` });
          eigenesSignal(n.zurueck_von, 'mail-erinnerung', { id: n.id, betreff: n.betreff });
        }
        signal(n.konto_id, 'mail-geaendert', { konto: n.konto_id, ids: [n.id] });
      }
    } catch (x) {
      console.error('Mail-Planer:', x.message);
    } finally {
      planerLaeuft = false;
    }
  }
  // Nach einem Neustart mitten im Senden: hängende Mails wieder einplanen
  db.prepare("UPDATE mail_entwuerfe SET status = 'geplant' WHERE status = 'sendet'").run();
  setInterval(planer, 15_000).unref();
  setTimeout(planer, 3000);

  // ---------- Vorlagen (Textbausteine) ----------
  const vorlage = (req, res) => {
    const v = db.prepare('SELECT * FROM mail_vorlagen WHERE id = ?').get(Number(req.params.id));
    if (!v || (v.besitzer !== req.sitzung.sub && req.sitzung.rolle !== 'admin')) { res.status(404).json({ fehler: 'Vorlage nicht gefunden' }); return null; }
    return v;
  };
  const vorlageFelder = (b) => ({
    name: String(b.name || '').trim().slice(0, 80), kuerzel: String(b.kuerzel || '').trim().toLowerCase().replace(/[^a-z0-9äöüß-]/g, '').slice(0, 20) || null,
    betreff: String(b.betreff || '').slice(0, 300) || null, html: htmlSauber(b.html), geteilt: b.geteilt === false ? 0 : 1,
  });
  router.get('/vorlagen', (req, res) => {
    res.json({ vorlagen: db.prepare('SELECT * FROM mail_vorlagen WHERE geteilt = 1 OR besitzer = ? ORDER BY name').all(req.sitzung.sub) });
  });
  router.post('/vorlagen', (req, res) => {
    const f = vorlageFelder(req.body || {});
    if (!f.name || !f.html) return res.status(400).json({ fehler: 'Name und Text ausfüllen' });
    const r = db.prepare('INSERT INTO mail_vorlagen (name, kuerzel, betreff, html, besitzer, geteilt) VALUES (?, ?, ?, ?, ?, ?)').run(f.name, f.kuerzel, f.betreff, f.html, req.sitzung.sub, f.geteilt);
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  });
  router.put('/vorlagen/:id', (req, res) => {
    const v = vorlage(req, res);
    if (!v) return;
    const f = vorlageFelder({ ...v, geteilt: !!v.geteilt, ...req.body });
    db.prepare('UPDATE mail_vorlagen SET name = ?, kuerzel = ?, betreff = ?, html = ?, geteilt = ? WHERE id = ?').run(f.name || v.name, f.kuerzel, f.betreff, f.html || v.html, f.geteilt, v.id);
    res.json({ ok: true });
  });
  router.delete('/vorlagen/:id', (req, res) => {
    const v = vorlage(req, res);
    if (!v) return;
    db.prepare('DELETE FROM mail_vorlagen WHERE id = ?').run(v.id);
    res.json({ ok: true });
  });

  return router;
}
