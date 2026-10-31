// Abgleich der Mail-Konten per IMAP: Posteingang und Gesendet, neue Mails sofort, das ganze Postfach nach und nach rückwärts.
// Erkennt Antworten, die außerhalb des Tools geschrieben wurden (Gesendet-Ordner mit In-Reply-To, \Answered-Markierung).
// Schreibt Aktionen zurück ins Postfach: gelesen/ungelesen (\Seen), beantwortet (\Answered), markiert (\Flagged), Spam (in den Spam-Ordner verschieben).
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db } from './db.js';
import { entschluesseln, kontoHolen } from './mail-db.js';

const RUNDE_MS = 2 * 60 * 1000;
const NEU_JE_RUNDE = 100; // neue Mails je Ordner und Runde
const ALT_JE_RUNDE = 100; // ältere Mails (Rückwärts-Import) je Ordner und Runde
const FLAGS_PRUEFEN = 300; // jüngste Mails, deren Markierungen (gelesen/beantwortet) abgeglichen werden
const MAX_QUELLE = 12 * 1024 * 1024;
const MAX_HTML = 600 * 1024;
const MAX_TEXT = 200 * 1024;

const verbindung = (k) => new ImapFlow({
  host: k.imap_host, port: k.imap_port, secure: k.imap_port === 993,
  auth: { user: k.benutzer, pass: entschluesseln(k.passwort) }, logger: false, socketTimeout: 120_000,
});

export async function verbindungTesten(k) {
  const imap = verbindung(k);
  await imap.connect();
  try {
    return await ordnerBestimmen(imap);
  } finally {
    await imap.logout().catch(() => {});
  }
}

// Posteingang, Gesendet und Spam finden (Sonderordner, sonst übliche Namen bei IONOS, Outlook, Gmail)
async function ordnerBestimmen(imap) {
  const liste = await imap.list();
  const nach = (use, namen) => liste.find((o) => o.specialUse === use)?.path
    || liste.find((o) => namen.some((n) => o.path.toLowerCase() === n || o.name.toLowerCase() === n))?.path || null;
  return {
    eingang: 'INBOX',
    gesendet: nach('\\Sent', ['gesendete objekte', 'gesendet', 'sent', 'sent items', 'sent messages', 'inbox.sent']),
    spam: nach('\\Junk', ['spam', 'junk', 'junk-e-mail', 'unerwünscht', 'inbox.spam']),
  };
}

const adressen = (feld) => (feld?.value || []).map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
const idSauber = (s) => (s ? String(s).trim().replace(/^<|>$/g, '') : null);

async function speichern(k, pfad, art, uidvalidity, m) {
  let p = null;
  try {
    p = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: MAX_HTML });
  } catch {
    p = { subject: m.envelope?.subject, from: null, date: m.envelope?.date, text: '(Mail konnte nicht gelesen werden – bitte im Postfach öffnen)', attachments: [] };
  }
  const von = p.from?.value?.[0] || m.envelope?.from?.[0] || {};
  const refs = [].concat(p.references || []).map(idSauber).filter(Boolean);
  const msgId = idSauber(p.messageId || m.envelope?.messageId);
  const antwortAuf = idSauber(p.inReplyTo || m.envelope?.inReplyTo);
  const text = (p.text || '').slice(0, MAX_TEXT);
  const html = typeof p.html === 'string' ? p.html.slice(0, MAX_HTML) : null;
  const anhaenge = (p.attachments || []).filter((a) => a.contentDisposition !== 'inline' || !a.contentId)
    .map((a, i) => ({ i, name: a.filename || `Anhang ${i + 1}`, typ: a.contentType, groesse: a.size }));
  const flags = m.flags || new Set();
  const r = db.prepare(`INSERT INTO mail_nachrichten (konto_id, ordner, art, uidvalidity, uid, message_id, in_reply_to, thread,
      von_name, von_mail, an, cc, betreff, datum, vorschau, text, html, anhaenge, gesehen, beantwortet_flag, markiert)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    k.id, pfad, art, uidvalidity, m.uid, msgId, antwortAuf, refs[0] || antwortAuf || msgId,
    von.name || null, von.address || null, adressen(p.to), adressen(p.cc), p.subject || m.envelope?.subject || '(ohne Betreff)',
    new Date(p.date || m.envelope?.date || m.internalDate || Date.now()).toISOString(),
    text.replace(/\s+/g, ' ').trim().slice(0, 220), text, html, JSON.stringify(anhaenge),
    flags.has('\\Seen') ? 1 : 0, flags.has('\\Answered') ? 1 : 0, flags.has('\\Flagged') ? 1 : 0,
  );
  if (!r.changes) return null;
  const id = Number(r.lastInsertRowid);
  // Gesendete Mail mit In-Reply-To → die Original-Mail gilt als beantwortet (auch wenn außerhalb des Tools geschrieben)
  if (art === 'gesendet' && antwortAuf) antwortVermerken(antwortAuf, { von: `konto:${k.id}`, am: new Date(p.date || Date.now()).toISOString(), wie: 'postfach' });
  return id;
}

// Original-Mail(s) als beantwortet markieren, sofern noch nicht geschehen
export function antwortVermerken(messageId, { von, am, wie }) {
  const offen = db.prepare(`SELECT id FROM mail_nachrichten WHERE message_id = ? AND art <> 'gesendet' AND beantwortet_von IS NULL`).all(messageId);
  for (const o of offen) {
    db.prepare(`UPDATE mail_nachrichten SET beantwortet_von = ?, beantwortet_am = ?, beantwortet_wie = ?,
      status = CASE WHEN status IN ('offen', 'gelesen') THEN 'geantwortet' ELSE status END,
      status_von = CASE WHEN status IN ('offen', 'gelesen') THEN ? ELSE status_von END,
      status_am = CASE WHEN status IN ('offen', 'gelesen') THEN ? ELSE status_am END WHERE id = ?`).run(von, am, wie, von, am, o.id);
  }
  return offen.map((o) => o.id);
}

async function ordnerAbgleichen(imap, k, pfad, art, melden) {
  if (!pfad) return;
  const lock = await imap.getMailboxLock(pfad);
  try {
    const mb = imap.mailbox;
    const uv = String(mb.uidValidity);
    let st = db.prepare('SELECT * FROM mail_ordner WHERE konto_id = ? AND pfad = ?').get(k.id, pfad);
    if (st && st.uidvalidity !== uv) {
      // Postfach wurde neu nummeriert → Ordner komplett neu holen
      db.prepare('DELETE FROM mail_nachrichten WHERE konto_id = ? AND ordner = ?').run(k.id, pfad);
      st = null;
    }
    if (!st) {
      db.prepare('INSERT OR REPLACE INTO mail_ordner (konto_id, pfad, uidvalidity, oben, unten, vollstaendig) VALUES (?, ?, ?, 0, NULL, 0)').run(k.id, pfad, uv);
      st = { oben: 0, unten: null, vollstaendig: 0 };
    }
    const alle = mb.exists ? ((await imap.search({ all: true }, { uid: true })) || []) : [];
    db.prepare('UPDATE mail_ordner SET gesamt = ? WHERE konto_id = ? AND pfad = ?').run(alle.length, k.id, pfad);

    const holen = async (uids) => {
      if (!uids.length) return [];
      const neu = [];
      // Einzeln verarbeiten statt alle Quellen im Speicher zu sammeln (Server hat 2 GB)
      for await (const m of imap.fetch(uids, { uid: true, flags: true, envelope: true, internalDate: true, size: true, source: { maxLength: MAX_QUELLE } }, { uid: true })) {
        const id = await speichern(k, pfad, art, uv, m);
        if (id) neu.push(id);
      }
      return neu;
    };

    // 1) Neue Mails (oberhalb des höchsten bekannten UID), älteste zuerst
    const neuUids = alle.filter((u) => u > st.oben).slice(0, NEU_JE_RUNDE);
    // Erster Abgleich: mit den neuesten anfangen, der Rest kommt rückwärts
    const ersteRunde = st.oben === 0 && st.unten === null;
    const start = ersteRunde ? alle.slice(-NEU_JE_RUNDE) : neuUids;
    const neueIds = await holen(start);
    if (start.length) {
      const oben = Math.max(st.oben, ...start);
      const unten = ersteRunde ? Math.min(...start) : st.unten ?? Math.min(...start);
      db.prepare('UPDATE mail_ordner SET oben = ?, unten = ? WHERE konto_id = ? AND pfad = ?').run(oben, unten, k.id, pfad);
      st = { ...st, oben, unten };
    }
    if (!ersteRunde && neueIds.length) melden(neueIds);

    // 2) Ältere Mails rückwärts nachholen (komplettes Postfach)
    if (!st.vollstaendig && st.unten !== null) {
      const aeltere = alle.filter((u) => u < st.unten).slice(-ALT_JE_RUNDE);
      if (aeltere.length) {
        await holen(aeltere);
        db.prepare('UPDATE mail_ordner SET unten = ? WHERE konto_id = ? AND pfad = ?').run(Math.min(...aeltere), k.id, pfad);
      } else db.prepare('UPDATE mail_ordner SET vollstaendig = 1 WHERE konto_id = ? AND pfad = ?').run(k.id, pfad);
    }

    // 3) Markierungen der jüngsten Mails abgleichen (in Outlook/am Handy gelesen, beantwortet oder mit Fähnchen markiert)
    const juengste = alle.slice(-FLAGS_PRUEFEN);
    if (juengste.length && art !== 'gesendet') {
      const geaendert = [];
      for await (const m of imap.fetch(juengste, { uid: true, flags: true }, { uid: true })) {
        const z = db.prepare('SELECT id, gesehen, beantwortet_flag, beantwortet_von, markiert FROM mail_nachrichten WHERE konto_id = ? AND ordner = ? AND uidvalidity = ? AND uid = ?').get(k.id, pfad, uv, m.uid);
        if (!z) continue;
        const g = m.flags.has('\\Seen') ? 1 : 0, b = m.flags.has('\\Answered') ? 1 : 0, f = m.flags.has('\\Flagged') ? 1 : 0;
        if (g !== z.gesehen || b !== z.beantwortet_flag || f !== z.markiert) {
          db.prepare('UPDATE mail_nachrichten SET gesehen = ?, beantwortet_flag = ?, markiert = ? WHERE id = ?').run(g, b, f, z.id);
          if (b && !z.beantwortet_von) {
            db.prepare(`UPDATE mail_nachrichten SET beantwortet_von = ?, beantwortet_am = ?, beantwortet_wie = 'postfach',
              status = CASE WHEN status IN ('offen', 'gelesen') THEN 'geantwortet' ELSE status END,
              status_von = CASE WHEN status IN ('offen', 'gelesen') THEN ? ELSE status_von END,
              status_am = CASE WHEN status IN ('offen', 'gelesen') THEN ? ELSE status_am END WHERE id = ?`)
              .run(`konto:${k.id}`, new Date().toISOString(), `konto:${k.id}`, new Date().toISOString(), z.id);
          }
          geaendert.push(z.id);
        }
      }
      if (geaendert.length) melden(geaendert, true);
    }
  } finally {
    lock.release();
  }
}

export async function kontoAbgleichen(id, melden = () => {}) {
  const k = kontoHolen(id);
  if (!k || !k.aktiv) return;
  const imap = verbindung(k);
  try {
    await imap.connect();
    let { ordner_eingang: eingang, ordner_gesendet: gesendet, ordner_spam: spam } = k;
    if (!gesendet || !spam) {
      const o = await ordnerBestimmen(imap);
      eingang = eingang || o.eingang; gesendet = gesendet || o.gesendet; spam = spam || o.spam;
      db.prepare('UPDATE mail_konten SET ordner_eingang = ?, ordner_gesendet = ?, ordner_spam = ? WHERE id = ?').run(eingang, gesendet, spam, k.id);
    }
    await ordnerAbgleichen(imap, k, eingang || 'INBOX', 'eingang', melden);
    await ordnerAbgleichen(imap, k, gesendet, 'gesendet', melden);
    const offen = db.prepare('SELECT count(*) n FROM mail_ordner WHERE konto_id = ? AND vollstaendig = 0').get(k.id).n;
    db.prepare("UPDATE mail_konten SET status = ?, fehler = NULL, abgleich = datetime('now') WHERE id = ?").run(offen ? 'import' : 'ok', k.id);
  } catch (e) {
    db.prepare("UPDATE mail_konten SET status = 'fehler', fehler = ?, abgleich = datetime('now') WHERE id = ?").run(String(e.responseText || e.message).slice(0, 300), k.id);
  } finally {
    await imap.logout().catch(() => {});
  }
}

// ---------- Aktionen zurück ins Postfach ----------
export async function postfachAktion(nachrichtId, aktion) {
  const n = db.prepare('SELECT * FROM mail_nachrichten WHERE id = ?').get(nachrichtId);
  const k = n && kontoHolen(n.konto_id);
  if (!k) return;
  const imap = verbindung(k);
  try {
    await imap.connect();
    const lock = await imap.getMailboxLock(n.ordner);
    try {
      if (String(imap.mailbox.uidValidity) !== n.uidvalidity) return;
      if (aktion === 'gelesen') await imap.messageFlagsAdd(String(n.uid), ['\\Seen'], { uid: true });
      if (aktion === 'ungelesen') await imap.messageFlagsRemove(String(n.uid), ['\\Seen'], { uid: true });
      if (aktion === 'markiert') await imap.messageFlagsAdd(String(n.uid), ['\\Flagged'], { uid: true });
      if (aktion === 'entmarkiert') await imap.messageFlagsRemove(String(n.uid), ['\\Flagged'], { uid: true });
      if (aktion === 'beantwortet') await imap.messageFlagsAdd(String(n.uid), ['\\Seen', '\\Answered'], { uid: true });
      if (aktion === 'spam' && k.ordner_spam && n.ordner !== k.ordner_spam) {
        await imap.messageFlagsAdd(String(n.uid), ['\\Seen'], { uid: true });
        const r = await imap.messageMove(String(n.uid), k.ordner_spam, { uid: true });
        const neueUid = r?.uidMap?.get(n.uid);
        const ziel = db.prepare('SELECT uidvalidity FROM mail_ordner WHERE konto_id = ? AND pfad = ?').get(k.id, k.ordner_spam);
        db.prepare("UPDATE mail_nachrichten SET ordner = ?, art = 'spam', uid = ?, uidvalidity = ? WHERE id = ?")
          .run(k.ordner_spam, neueUid || -n.id, ziel?.uidvalidity || String(r?.uidValidity || 'spam'), n.id);
      }
    } finally {
      lock.release();
    }
  } catch (e) {
    console.error(`Mail-Aktion ${aktion} (${k.email}):`, e.message);
  } finally {
    await imap.logout().catch(() => {});
  }
}

// Gesendete Mail in den Gesendet-Ordner legen (SMTP bei IONOS speichert nicht selbst)
export async function inGesendetAblegen(k, roh) {
  if (!k.ordner_gesendet) return;
  const imap = verbindung(k);
  try {
    await imap.connect();
    await imap.append(k.ordner_gesendet, roh, ['\\Seen']);
  } catch (e) {
    console.error(`Gesendet ablegen (${k.email}):`, e.message);
  } finally {
    await imap.logout().catch(() => {});
  }
}

// Anhang auf Abruf aus dem Postfach holen (Inhalte werden nicht gespeichert)
export async function anhangHolen(n, index) {
  const k = kontoHolen(n.konto_id);
  const imap = verbindung(k);
  await imap.connect();
  try {
    const lock = await imap.getMailboxLock(n.ordner);
    try {
      const m = await imap.fetchOne(String(n.uid), { source: true }, { uid: true });
      if (!m?.source) return null;
      const p = await simpleParser(m.source, { skipTextToHtml: true });
      const liste = (p.attachments || []).filter((a) => a.contentDisposition !== 'inline' || !a.contentId);
      return liste[index] || null;
    } finally {
      lock.release();
    }
  } finally {
    await imap.logout().catch(() => {});
  }
}

// Alle aktiven Konten nacheinander, alle 2 Minuten; abgleichJetzt(id) für sofort (neues Konto, nach dem Senden)
export function starteMailAbgleich({ beiNeu }) {
  let laeuft = false;
  const warteschlange = new Set();
  const runde = async () => {
    if (laeuft) return;
    laeuft = true;
    try {
      const ids = warteschlange.size ? [...warteschlange] : db.prepare('SELECT id FROM mail_konten WHERE aktiv = 1').all().map((k) => k.id);
      warteschlange.clear();
      for (const id of ids) await kontoAbgleichen(id, (neu, nurAenderung) => beiNeu(id, neu, nurAenderung));
    } finally {
      laeuft = false;
      if (warteschlange.size) setTimeout(runde, 1000);
    }
  };
  setTimeout(runde, 5000);
  setInterval(runde, RUNDE_MS).unref();
  // Solange ein Konto noch importiert, öfter nachholen
  setInterval(() => {
    const importiert = db.prepare("SELECT id FROM mail_konten WHERE aktiv = 1 AND status IN ('neu', 'import')").all();
    if (importiert.length && !laeuft) { importiert.forEach((k) => warteschlange.add(k.id)); runde(); }
  }, 20_000).unref();
  return (id) => { warteschlange.add(id); runde(); };
}
