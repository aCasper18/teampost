// Mail-App: Tabellen, Verschlüsselung der Postfach-Passwörter und Zugriffsrechte.
// Konten gehören dem, der sie anlegt; er (und jeder Admin) vergibt Rechte: lesen < schreiben < verwalten.
import crypto from 'node:crypto';
import { env } from './config.js';
import { db } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS mail_konten (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, absender TEXT,
  imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL DEFAULT 993, smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL DEFAULT 465,
  benutzer TEXT NOT NULL, passwort TEXT NOT NULL, besitzer TEXT NOT NULL, aktiv INTEGER NOT NULL DEFAULT 1,
  ordner_eingang TEXT, ordner_gesendet TEXT, ordner_spam TEXT,
  status TEXT NOT NULL DEFAULT 'neu', fehler TEXT, abgleich TEXT, erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mail_rechte (
  konto_id INTEGER NOT NULL, email TEXT NOT NULL, recht TEXT NOT NULL, PRIMARY KEY (konto_id, email)
);
CREATE TABLE IF NOT EXISTS mail_ordner (
  konto_id INTEGER NOT NULL, pfad TEXT NOT NULL, uidvalidity TEXT NOT NULL, oben INTEGER NOT NULL DEFAULT 0, unten INTEGER,
  vollstaendig INTEGER NOT NULL DEFAULT 0, gesamt INTEGER, PRIMARY KEY (konto_id, pfad)
);
CREATE TABLE IF NOT EXISTS mail_nachrichten (
  id INTEGER PRIMARY KEY AUTOINCREMENT, konto_id INTEGER NOT NULL, ordner TEXT NOT NULL, art TEXT NOT NULL,
  uidvalidity TEXT NOT NULL, uid INTEGER NOT NULL, message_id TEXT, in_reply_to TEXT, thread TEXT,
  von_name TEXT, von_mail TEXT, an TEXT, cc TEXT, betreff TEXT, datum TEXT, vorschau TEXT, text TEXT, html TEXT,
  anhaenge TEXT NOT NULL DEFAULT '[]', gesehen INTEGER NOT NULL DEFAULT 0, beantwortet_flag INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'offen', status_von TEXT, status_am TEXT,
  beantwortet_von TEXT, beantwortet_am TEXT, beantwortet_wie TEXT,
  UNIQUE (konto_id, ordner, uidvalidity, uid)
);
CREATE INDEX IF NOT EXISTS idx_mail_liste ON mail_nachrichten (konto_id, art, datum);
CREATE INDEX IF NOT EXISTS idx_mail_msgid ON mail_nachrichten (message_id);
CREATE INDEX IF NOT EXISTS idx_mail_thread ON mail_nachrichten (thread);
CREATE TABLE IF NOT EXISTS mail_ereignisse (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nachricht_id INTEGER NOT NULL, email TEXT NOT NULL, art TEXT NOT NULL,
  text TEXT, zeit TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mail_ereignisse ON mail_ereignisse (nachricht_id, id);
CREATE TABLE IF NOT EXISTS mail_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, farbe TEXT NOT NULL, erstellt_von TEXT, erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mail_nachricht_labels (
  nachricht_id INTEGER NOT NULL, label_id INTEGER NOT NULL, PRIMARY KEY (nachricht_id, label_id)
);
CREATE TABLE IF NOT EXISTS mail_entwuerfe (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, konto_id INTEGER, art TEXT NOT NULL DEFAULT 'neu', bezug INTEGER,
  an TEXT, cc TEXT, bcc TEXT, betreff TEXT, html TEXT, anhaenge TEXT NOT NULL DEFAULT '[]', original_anhaenge TEXT NOT NULL DEFAULT '[]',
  senden_um TEXT, status TEXT NOT NULL DEFAULT 'entwurf', fehler TEXT, erstellt TEXT NOT NULL DEFAULT (datetime('now')), geaendert TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mail_entwuerfe ON mail_entwuerfe (email, status);
CREATE TABLE IF NOT EXISTS mail_vorlagen (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kuerzel TEXT, betreff TEXT, html TEXT NOT NULL, besitzer TEXT NOT NULL,
  geteilt INTEGER NOT NULL DEFAULT 1, erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);`);

// Spalten, die nach dem ersten Ausbau dazukamen (Markieren, Anheften, Zurückstellen, Zuweisen, Signatur)
const spalte = (tabelle, def) => { try { db.exec(`ALTER TABLE ${tabelle} ADD COLUMN ${def}`); } catch {} };
spalte('mail_nachrichten', 'markiert INTEGER NOT NULL DEFAULT 0');
spalte('mail_nachrichten', 'angeheftet INTEGER NOT NULL DEFAULT 0');
spalte('mail_nachrichten', 'zurueck_bis TEXT');
spalte('mail_nachrichten', 'zurueck_von TEXT');
spalte('mail_nachrichten', 'zugewiesen TEXT');
spalte('mail_nachrichten', 'zugewiesen_von TEXT');
spalte('mail_konten', 'signatur TEXT');
db.exec(`CREATE INDEX IF NOT EXISTS idx_mail_zurueck ON mail_nachrichten (zurueck_bis);
CREATE TABLE IF NOT EXISTS mail_ungelesen (nachricht_id INTEGER NOT NULL, email TEXT NOT NULL, PRIMARY KEY (nachricht_id, email));`);

export const LABEL_FARBEN = ['#2563EB', '#FF6A00', '#16A34A', '#7C3AED', '#DC2626', '#0891B2', '#CA8A04', '#DB2777', '#4B5563'];

// Status-Knöpfe: „gelesen“ bleibt offen, die anderen gelten als erledigt
export const STATUS = { offen: 'Offen', gelesen: 'Gelesen', unnoetig: 'Unnötig', spam: 'Spam', bearbeitet: 'Bearbeitet', geantwortet: 'Geantwortet' };
export const ERLEDIGT = ['unnoetig', 'spam', 'bearbeitet', 'geantwortet'];
export const RECHTE = ['lesen', 'schreiben', 'verwalten'];

// ---------- Passwörter: AES-256-GCM, Schlüssel aus MAIL_SCHLUESSEL (sonst aus JWT_SECRET abgeleitet) ----------
const schluessel = () => crypto.createHash('sha256').update(env.MAIL_SCHLUESSEL || `teampost-mail|${env.JWT_SECRET}`).digest();
export function verschluesseln(klar) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', schluessel(), iv);
  const daten = Buffer.concat([c.update(String(klar), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), daten]).toString('base64');
}
export function entschluesseln(geheim) {
  const b = Buffer.from(geheim, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', schluessel(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

// ---------- Rechte ----------
export const kontoHolen = (id) => db.prepare('SELECT * FROM mail_konten WHERE id = ?').get(Number(id));

export function rechtFuer(konto, sitzung) {
  if (!konto || !sitzung) return null;
  if (sitzung.rolle === 'admin' || konto.besitzer === sitzung.sub) return 'verwalten';
  return db.prepare('SELECT recht FROM mail_rechte WHERE konto_id = ? AND email = ?').get(konto.id, sitzung.sub)?.recht || null;
}
export const darf = (recht, mindestens) => recht && RECHTE.indexOf(recht) >= RECHTE.indexOf(mindestens);

export function sichtbareKonten(sitzung) {
  return db.prepare('SELECT * FROM mail_konten ORDER BY name').all().map((k) => ({ ...k, recht: rechtFuer(k, sitzung) })).filter((k) => k.recht);
}

// Wer darf eine Mail eines Kontos sehen (für Live-Signale an die richtigen Personen)
export function berechtigte(kontoId) {
  const k = kontoHolen(kontoId);
  if (!k) return [];
  const admins = db.prepare("SELECT email FROM nutzer WHERE rolle = 'admin' AND aktiv = 1").all().map((n) => n.email);
  const rechte = db.prepare('SELECT email FROM mail_rechte WHERE konto_id = ?').all(k.id).map((r) => r.email);
  return [...new Set([k.besitzer, ...admins, ...rechte])];
}

// Konto ohne Passwort für die Oberfläche
export const kontoOeffentlich = (k) => k && ({
  id: k.id, name: k.name, email: k.email, absender: k.absender, imap_host: k.imap_host, imap_port: k.imap_port,
  smtp_host: k.smtp_host, smtp_port: k.smtp_port, benutzer: k.benutzer, besitzer: k.besitzer, aktiv: !!k.aktiv,
  ordner_eingang: k.ordner_eingang, ordner_gesendet: k.ordner_gesendet, ordner_spam: k.ordner_spam,
  status: k.status, fehler: k.fehler, abgleich: k.abgleich, recht: k.recht, signatur: k.signatur || '',
});
