// Mail-App (Oberfläche): Ansichten, Liste mit Schnellaktionen und Mehrfachauswahl, Unterhaltung mit Team-Notizen,
// schwebender Editor (Entwurf auf dem Server, Anhänge, Vorlagen mit ;kürzel, Senden mit Rückgängig oder später),
// Befehlspalette (Strg+K), Tastenkürzel (?), Hell/Dunkel. Alles live über Socket.io.
(() => {
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lesen = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const merken = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const sql = (s) => (s && !/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
const datum = (iso) => new Date(sql(iso));
const zeitKurz = (iso) => {
  const d = datum(iso), h = new Date();
  if (d.toDateString() === h.toDateString()) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (h - d < 6 * 864e5) return d.toLocaleDateString('de-DE', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', ...(d.getFullYear() !== h.getFullYear() ? { year: '2-digit' } : {}) });
};
const zeitLang = (iso) => datum(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const zeitWann = (d) => {
  const h = new Date(), m = new Date(h); m.setDate(m.getDate() + 1);
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === h.toDateString()) return `heute ${uhr}`;
  if (d.toDateString() === m.toDateString()) return `morgen ${uhr}`;
  return `${d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })} ${uhr}`;
};
const groesse = (b) => (b > 1048576 ? `${(b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const dauer = (min) => (min == null ? '–' : min < 60 ? `${min} min` : min < 1440 ? `${(min / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h` : `${(min / 1440).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tg.`);
const hue = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const textZuHtml = (t) => esc(t).replace(/\n/g, '<br>');
// Eigenes HTML (Entwürfe, Vorlagen, Signaturen) nur mit erlaubten Tags/Attributen in den Editor lassen
const ERLAUBT = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'HR', 'IMG', 'FONT', 'SUB', 'SUP', 'CODE', 'PRE']);
function htmlRein(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const gehen = (el) => {
    for (const k of [...el.children]) {
      if (!ERLAUBT.has(k.tagName)) { if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|SVG|MATH|TEMPLATE|NOSCRIPT)$/.test(k.tagName)) k.remove(); else { gehen(k); k.replaceWith(...k.childNodes); } continue; }
      for (const a of [...k.attributes]) {
        const n = a.name.toLowerCase();
        const ok = (n === 'href' && /^(https?:|mailto:|tel:|#)/i.test(a.value.trim())) || (n === 'src' && k.tagName === 'IMG' && /^(https?:|data:image\/(png|jpe?g|gif|webp);)/i.test(a.value.trim()))
          || (n === 'class' && /^(sig|zitat)$/.test(a.value)) || ['style', 'alt', 'title', 'colspan', 'rowspan', 'color', 'width', 'height'].includes(n);
        if (!ok || (n === 'style' && /url\(|expression|javascript/i.test(a.value))) k.removeAttribute(a.name);
      }
      gehen(k);
    }
  };
  gehen(doc.body);
  return doc.body.innerHTML;
}
const linkify = (h) => h.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);

// ---------- Symbole ----------
const P = {
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  eyeoff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/>',
  usercheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/>',
  vorlage: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  geplant: '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4M8 2v4M3 10h5"/><circle cx="16" cy="16" r="6"/><path d="M16 14v2l1 1"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  checkc: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  spam: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="M12 8v4M12 16h.01"/>',
  tag: '<path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l8.59-8.59a1 1 0 0 0 0-1.41z"/><path d="M7 7h.01"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
  mailopen: '<path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
  reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  replyall: '<path d="m7 17-5-5 5-5"/><path d="m12 17-5-5 5-5"/><path d="M22 18v-2a4 4 0 0 0-4-4H7"/>',
  forward: '<path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  regler: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  cmd: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  minus: '<path d="M5 12h14"/>',
  max: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  min: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  links: '<path d="m15 18-6-6 6-6"/>',
  rechts: '<path d="m9 18 6-6-6-6"/>',
  runter: '<path d="m6 9 6 6 6-6"/>',
  hoch: '<path d="m18 15-6-6-6 6"/>',
  zurueck: '<path d="m12 19-7-7 7-7M19 12H5"/>',
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H6zM6 4h7a4 4 0 0 1 0 8H6z"/>',
  italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16"/>',
  strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16"/>',
  ul: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  ol: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2H4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .01-1 1.01V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2h-4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9"/>',
  note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  aufgabe: '<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  fokus: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
};
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;

// ---------- Zustand ----------
let S = { ich: '', admin: false, team: [], konten: [], status: {}, erledigt: [], rechte: [], labels: [], farben: [], zahlen: {} };
const E = Object.assign({ theme: 'auto', dichte: 'komfort', rueckgaengig: 10, weiter: 'naechste', leiste: true, bilder: [] }, lesen('mail-einst', {}));
const einstMerken = () => merken('mail-einst', E);
let konto = lesen('mail-konto', 'alle');
let ansicht = lesen('mail-ansicht', 'offen');
let suche = '', filter = new Set();
let mails = [], mehr = false, laedt = false, offenId = null, offenMail = null, tastaturIdx = -1;
let entwuerfe = [];
const auswahl = new Set();
const bilderErlaubt = new Set();
let statistik = null;
let vorlagenCache = null;
let teamTab = 'notizen';

const ANSICHTEN = [
  { k: 'offen', t: 'Posteingang', i: 'inbox', z: () => S.konten.reduce((s, k) => s + (k.offen || 0), 0), voll: true },
  { k: 'ungeoeffnet', t: 'Von mir ungeöffnet', i: 'eyeoff' },
  { k: 'mir', t: 'Mir zugewiesen', i: 'usercheck', z: () => S.zahlen.mir, voll: true },
  { k: 'markiert', t: 'Markiert', i: 'star', z: () => S.zahlen.markiert },
  { k: 'zurueck', t: 'Zurückgestellt', i: 'clock', z: () => S.zahlen.zurueck },
  { k: 'entwuerfe', t: 'Entwürfe', i: 'file', z: () => S.zahlen.entwuerfe },
  { k: 'geplant', t: 'Geplant', i: 'geplant', z: () => S.zahlen.geplant },
  { k: 'gesendet', t: 'Gesendet', i: 'send' },
];
const MEHR_ANSICHTEN = [
  { k: 'anhang', t: 'Mit Anhang', i: 'clip' },
  { k: 'alle', t: 'Alle Eingänge', i: 'layers' },
  { k: 'erledigt', t: 'Erledigt', i: 'checkc' },
  { k: 'spam', t: 'Spam', i: 'spam' },
];
const ansichtName = (a = ansicht) => {
  if (a.startsWith('label:')) return S.labels.find((l) => `label:${l.id}` === a)?.name || 'Label';
  return [...ANSICHTEN, ...MEHR_ANSICHTEN].find((x) => x.k === a)?.t || 'Mails';
};
const name = (e) => {
  if (!e) return '–';
  if (String(e).startsWith('konto:')) { const k = S.konten.find((x) => `konto:${x.id}` === e); return `außerhalb des Tools${k ? ` (${k.email})` : ''}`; }
  return S.team.find((t) => t.email === e)?.name || e;
};
const vorname = (e) => name(e).split(/[\s@]/)[0];
const kuerzel = (s) => String(s || '?').replace(/<.*>/, '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const ava = (wer, mail, cls = '') => `<span class="ava ${cls}" style="--h:${hue(mail || wer)}" aria-hidden="true">${esc(kuerzel(wer || mail))}</span>`;
const teamAva = (e, cls = 'k') => `<span class="ava ${cls}" style="--h:${hue(e)}" title="${esc(name(e))}">${esc(kuerzel(name(e)))}</span>`;
const kontoVon = (id) => S.konten.find((k) => k.id === id);
const kontoFarbe = (id) => `hsl(${(id * 67) % 360} 65% 50%)`;
const labelVon = (id) => S.labels.find((l) => l.id === id);
const schreibKonten = () => S.konten.filter((k) => ['schreiben', 'verwalten'].includes(k.recht));
const istNeu = (m) => m.art === 'eingang' && !S.erledigt.includes(m.status) && (m.ungelesen || !m.geoeffnet.some((o) => o.email === S.ich));

// ---------- Hilfen: Server, Meldungen, Menüs, Fenster ----------
async function api(method, url, body) {
  const r = await fetch('/api/mail' + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/login?weiter=/mail'; throw new Error('nicht angemeldet'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.fehler || 'Fehler');
  return d;
}

function toast(text, { knopf, aktion, dauer: ms = 3500, fehler = false } = {}) {
  const t = document.createElement('div');
  t.className = `toast${fehler ? ' fehler' : ''}`;
  t.innerHTML = `<span>${esc(text)}</span>${knopf ? `<button type="button">${esc(knopf)}</button>` : ''}`;
  $('toasts').appendChild(t);
  const weg = () => t.remove();
  const timer = setTimeout(weg, ms);
  t.querySelector('button')?.addEventListener('click', () => { clearTimeout(timer); weg(); aktion?.(); });
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  return weg;
}
const fehlerToast = (e) => toast(e.message || String(e), { fehler: true, dauer: 5000 });

let popAktiv = null;
function popZu() { popAktiv?.el.remove(); popAktiv?.zu?.(); popAktiv = null; }
// Kleines Menü an einem Element (oder an x/y); beiKlick bekommt das angeklickte [data-p]-Element
function pop(anker, html, beiKlick, { breit = false, zu } = {}) {
  popZu();
  const el = document.createElement('div');
  el.className = 'pop';
  el.setAttribute('role', 'menu');
  el.innerHTML = html;
  if (breit) el.style.minWidth = '300px';
  document.body.appendChild(el);
  const r = anker.getBoundingClientRect ? anker.getBoundingClientRect() : { left: anker.x, right: anker.x, top: anker.y, bottom: anker.y };
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = Math.min(r.left, innerWidth - w - 8), y = r.bottom + 6;
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
  el.style.left = `${Math.max(8, x)}px`; el.style.top = `${y}px`;
  el.addEventListener('click', (e) => { const z = e.target.closest('[data-p]'); if (z) beiKlick?.(z, el, e); });
  popAktiv = { el, anker, zu };
  el.querySelector('input:not([type=checkbox])')?.focus();
  return el;
}
document.addEventListener('mousedown', (e) => { if (popAktiv && !popAktiv.el.contains(e.target) && !popAktiv.anker?.contains?.(e.target)) popZu(); });

function dialog(html, { klasse = 'fenster', aufZu } = {}) {
  const hg = document.createElement('div');
  hg.className = 'hg';
  hg.innerHTML = `<div class="${klasse}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(hg);
  const zu = () => { hg.remove(); aufZu?.(); };
  hg.addEventListener('mousedown', (e) => { if (e.target === hg) zu(); });
  hg.addEventListener('click', (e) => { if (e.target.closest('[data-zu]')) zu(); });
  hg.zu = zu;
  return hg;
}

// Zeitpunkte für Zurückstellen und späteres Senden
function zeitpunkte() {
  const n = new Date();
  const um = (tage, h) => { const d = new Date(n); d.setDate(d.getDate() + tage); d.setHours(h, 0, 0, 0); return d; };
  const l = [];
  if (n.getHours() < 16) l.push(['Später heute', new Date(Math.ceil((n.getTime() + 3 * 36e5) / 9e5) * 9e5)]);
  if (n.getHours() < 17) l.push(['Heute Abend', um(0, 18)]);
  l.push(['Morgen früh', um(1, 8)]);
  l.push(['Übermorgen', um(2, 8)]);
  const bisMo = ((8 - n.getDay()) % 7) || 7;
  l.push(['Nächste Woche', um(bisMo, 8)]);
  l.push(['In einem Monat', um(30, 8)]);
  return l;
}
function zeitMenue(anker, titel, beiWahl, { aufheben } = {}) {
  const lokal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  const liste = zeitpunkte();
  pop(anker, `<div class="p-titel">${esc(titel)}</div>
    ${liste.map(([t, d], i) => `<button class="p-zeile" data-p="z" data-i="${i}">${ic('clock', 'k')}${esc(t)}<small>${esc(zeitWann(d))}</small></button>`).join('')}
    <div class="p-titel">Eigene Zeit</div>
    <div style="padding:0 6px 6px;display:flex;gap:6px"><input type="datetime-local" id="zEigen" value="${lokal(liste.at(-3)[1])}" min="${lokal(new Date())}"><button class="btn klein haupt" data-p="eigen">OK</button></div>
    ${aufheben ? `<button class="p-zeile" data-p="weg">${ic('x', 'k')}${esc(aufheben)}</button>` : ''}`, (z) => {
    if (z.dataset.p === 'z') { popZu(); beiWahl(liste[+z.dataset.i][1]); }
    if (z.dataset.p === 'eigen') { const d = new Date($('zEigen').value); if (Number.isNaN(d.getTime()) || d < new Date()) return toast('Bitte einen Zeitpunkt in der Zukunft wählen'); popZu(); beiWahl(d); }
    if (z.dataset.p === 'weg') { popZu(); beiWahl(null); }
  });
}

// ---------- Seitenleiste ----------
function seiteZeichnen() {
  const navZeile = (a) => {
    const z = a.z?.() || 0;
    return `<button class="nav" data-ansicht="${a.k}" aria-current="${ansicht === a.k}" title="${esc(a.t)}">${ic(a.i)}<span class="t">${esc(a.t)}</span>${z ? `<span class="z${a.voll ? ' voll' : ''}">${z}</span>` : ''}</button>`;
  };
  const kontoZeile = (k) => {
    let unter = k.email;
    if (k.status === 'fehler') unter = `Fehler: ${k.fehler || ''}`;
    else if (k.status === 'neu' || k.status === 'import') {
      const f = k.fortschritt || {};
      unter = f.gesamt ? `wird geladen … ${Math.min(100, Math.round((f.da / f.gesamt) * 100))} %` : 'wird verbunden …';
    }
    return `<button class="nav" data-konto="${k.id}" aria-current="${String(konto) === String(k.id)}" title="${esc(k.name)}"><span class="punkt" style="background:${kontoFarbe(k.id)}"></span><span class="t">${esc(k.name)}<small${k.status === 'fehler' ? ' class="fehler"' : ''}>${esc(unter)}</small></span>${k.offen ? `<span class="z">${k.offen}</span>` : ''}</button>`;
  };
  $('seite').innerHTML = `
    <button class="neu-btn" type="button" data-neu title="Neue Mail (C)">${ic('pen')}<span>Neue Mail</span></button>
    ${ANSICHTEN.map(navZeile).join('')}
    <div class="gruppe"><span>Mehr</span></div>
    ${MEHR_ANSICHTEN.map(navZeile).join('')}
    <div class="gruppe"><span>Postfächer</span><button type="button" data-einst="konten" aria-label="Postfächer verwalten">${ic('plus', 'k')}</button></div>
    ${S.konten.length > 1 ? `<button class="nav" data-konto="alle" aria-current="${konto === 'alle'}" title="Alle Postfächer">${ic('layers')}<span class="t">Alle Postfächer</span></button>` : ''}
    ${S.konten.map(kontoZeile).join('')}
    ${S.konten.length ? '' : `<p class="hinweis fuss-text" style="padding:6px 10px">Noch kein Postfach verknüpft.</p><button class="btn orange" style="margin:4px 10px" data-einst="konten">${ic('plus', 'k')} Postfach verknüpfen</button>`}
    <div class="gruppe"><span>Labels</span><button type="button" data-label-neu aria-label="Neues Label">${ic('plus', 'k')}</button></div>
    ${S.labels.map((l) => `<button class="nav" data-ansicht="label:${l.id}" aria-current="${ansicht === `label:${l.id}`}" title="${esc(l.name)}"><span class="punkt" style="background:${l.farbe}"></span><span class="t">${esc(l.name)}</span></button>`).join('')}
    ${S.labels.length ? '' : '<p class="hinweis fuss-text" style="padding:2px 10px 6px">Labels sortieren Mails fürs ganze Team, z. B. „Angebot“, „Reklamation“.</p>'}
    <div class="fuss">
      <button class="ikon" type="button" data-leiste aria-label="Seitenleiste ein-/ausklappen" title="Seitenleiste ein-/ausklappen">${ic('sidebar')}</button>
      <button class="ikon" type="button" data-hilfe aria-label="Tastenkürzel" title="Tastenkürzel (?)">${ic('keyboard')}</button>
      <button class="ikon" type="button" data-einst="darstellung" aria-label="Darstellung" title="Darstellung">${ic('regler')}</button>
    </div>`;
  const offen = ANSICHTEN[0].z();
  document.title = `${offen ? `(${offen}) ` : ''}Mail · ${window.MARKE?.name || 'Teampost'}`;
}

// ---------- Listenkopf, Tageszahlen, Filter, Stapel ----------
function kopfZeichnen() {
  const k = konto !== 'alle' ? kontoVon(+konto) : null;
  const zahl = ansicht === 'entwuerfe' || ansicht === 'geplant' ? entwuerfe.length : mails.length + (mehr ? '+' : '');
  const st = statistik;
  const zeigeHeute = ansicht === 'offen' && !suche && st && st.eingang_heute != null;
  let ring = '';
  if (zeigeHeute) {
    const gesamt = st.erledigt_heute + st.offen, anteil = gesamt ? st.erledigt_heute / gesamt : 1, u = 2 * Math.PI * 17;
    ring = `<svg class="ring" viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="17" stroke="var(--line2)"/><circle cx="21" cy="21" r="17" stroke="var(--brand)" stroke-dasharray="${u}" stroke-dashoffset="${u * (1 - anteil)}" transform="rotate(-90 21 21)" stroke-linecap="round"/><text x="21" y="25" text-anchor="middle" font-size="11" font-weight="800" fill="currentColor">${Math.round(anteil * 100)}%</text></svg>`;
  }
  $('listeKopf').innerHTML = `
    <div class="l-titel">
      <button class="ikon menue" type="button" data-leiste-mobil aria-label="Seitenleiste">${ic('menu')}</button>
      <h1>${esc(suche ? `Suche: ${suche}` : ansichtName())}${k ? ` <span class="hinweis" style="font-size:13px;font-weight:600">· ${esc(k.name)}</span>` : ''}</h1>
      <span class="hinweis">${zahl || ''}</span>
      ${!['entwuerfe', 'geplant'].includes(ansicht) ? `<label class="ikon" title="Alle auswählen"><input type="checkbox" data-alle aria-label="Alle auswählen" style="width:16px;height:16px;accent-color:var(--brand)"${mails.length && mails.every((m) => auswahl.has(m.id)) ? ' checked' : ''}></label>` : ''}
      <button class="ikon" type="button" data-neu-laden aria-label="Aktualisieren" title="Postfach jetzt abgleichen">${ic('refresh')}</button>
    </div>
    ${zeigeHeute ? `<div class="heute">${ring}
      <div class="zahl"><b>${st.offen}</b>offen</div><div class="zahl"><b>${st.erledigt_heute}</b>heute erledigt</div>
      <div class="zahl"><b>${st.eingang_heute}</b>heute neu</div><div class="zahl" title="Durchschnitt der letzten 7 Tage"><b>${dauer(st.antwort_minuten)}</b>Ø Antwort</div>
      ${st.team_heute?.length ? `<div class="augen" style="margin-left:auto" title="Heute erledigt: ${esc(st.team_heute.map((t) => `${name(t.email)} ${t.n}`).join(', '))}">${st.team_heute.slice(0, 4).map((t) => teamAva(t.email)).join('')}</div>` : ''}
    </div>` : ''}
    ${!['entwuerfe', 'geplant'].includes(ansicht) ? `<div class="filter" role="group" aria-label="Schnellfilter">
      ${[['ist:ungelesen', 'Ungelesen', 'mail'], ['hat:anhang', 'Mit Anhang', 'clip'], ['ist:markiert', 'Markiert', 'star'], ['ist:zugewiesen', 'Zugewiesen', 'user']].map(([f, t, i]) => `<button class="chip" type="button" data-filter="${f}" aria-pressed="${filter.has(f)}">${ic(i, 'k')}${t}</button>`).join('')}
    </div>` : ''}`;
}
function stapelZeichnen() {
  const s = $('stapel');
  document.body.classList.toggle('waehlen', auswahl.size > 0);
  if (!auswahl.size) { s.hidden = true; return; }
  s.hidden = false;
  s.innerHTML = `<button class="ikon" type="button" data-st="ab" aria-label="Auswahl aufheben">${ic('x')}</button><b>${auswahl.size} ausgewählt</b>
    <button class="ikon" type="button" data-st="erledigt" title="Erledigt (E)">${ic('checkc')}</button>
    <button class="ikon" type="button" data-st="gelesen" title="Als gelesen">${ic('mailopen')}</button>
    <button class="ikon" type="button" data-st="ungelesen" title="Als ungelesen">${ic('mail')}</button>
    <button class="ikon" type="button" data-st="stern" title="Markieren">${ic('star')}</button>
    <button class="ikon" type="button" data-st="zurueck" title="Zurückstellen">${ic('clock')}</button>
    <button class="ikon" type="button" data-st="zuweisen" title="Zuweisen">${ic('user')}</button>
    <button class="ikon" type="button" data-st="label" title="Label">${ic('tag')}</button>
    <button class="ikon" type="button" data-st="status" title="Status">${ic('more')}</button>
    <button class="ikon" type="button" data-st="spam" title="Spam" style="color:var(--bad)">${ic('spam')}</button>`;
}

// ---------- Liste ----------
function tagGruppe(iso) {
  const d = datum(iso), h = new Date(); h.setHours(0, 0, 0, 0);
  const t = (h - new Date(d).setHours(0, 0, 0, 0)) / 864e5;
  if (t <= 0) return 'Heute';
  if (t === 1) return 'Gestern';
  if (t < 7) return 'Diese Woche';
  return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}
function zeileHtml(m) {
  const neu = istNeu(m);
  const gesendet = m.art === 'gesendet';
  const wer = gesendet ? `An: ${(m.an || '').replace(/<[^>]+>/g, '').replace(/"/g, '')}` : (m.von_name || m.von_mail || '?');
  const info = [];
  if (m.zurueck_bis) info.push(`<span class="pill zurueck">${ic('clock')}${esc(zeitWann(datum(m.zurueck_bis)))}</span>`);
  if (m.status !== 'offen') info.push(`<span class="pill ${m.status}">${esc(S.status[m.status])}${m.status_von && !m.status_von.startsWith('konto:') ? ` · ${esc(vorname(m.status_von))}` : ''}</span>`);
  else if (m.beantwortet_von) info.push(`<span class="pill geantwortet">beantwortet</span>`);
  m.labels.forEach((id) => { const l = labelVon(id); if (l) info.push(`<span class="pill label" style="--lf:${l.farbe}">${esc(l.name)}</span>`); });
  if (konto === 'alle' && S.konten.length > 1) info.push(`<span class="pill konto"><span class="punkt" style="background:${kontoFarbe(m.konto_id)};width:7px;height:7px;margin:0"></span>${esc(kontoVon(m.konto_id)?.name || '')}</span>`);
  if (m.zugewiesen) info.push(`<span class="pill" title="Zugewiesen an ${esc(name(m.zugewiesen))}">${ic('user')}${esc(m.zugewiesen === S.ich ? 'mir' : vorname(m.zugewiesen))}</span>`);
  if (m.notizen) info.push(`<span class="pill" title="${m.notizen} Team-Notiz(en)">${ic('note')}${m.notizen}</span>`);
  if (m.geoeffnet.length) info.push(`<span class="augen" title="Geöffnet von: ${esc(m.geoeffnet.map((o, i) => `${i + 1}. ${name(o.email)}`).join(', '))}">${m.geoeffnet.slice(0, 4).map((o) => teamAva(o.email)).join('')}</span>`);
  return `<div class="zeile${neu ? ' neu' : ''}${auswahl.has(m.id) ? ' gewaehlt' : ''}" data-mail="${m.id}" role="option" aria-selected="${m.id === offenId}">
    <label class="wahl" title="Auswählen (X)"><input type="checkbox" data-wahl="${m.id}"${auswahl.has(m.id) ? ' checked' : ''} aria-label="Auswählen"></label>
    ${ava(gesendet ? m.an : (m.von_name || m.von_mail), gesendet ? m.an : m.von_mail)}
    <div style="min-width:0">
      <div class="z1"><span class="wer">${esc(wer)}</span>
        ${m.angeheftet ? `<span class="mini" title="Angeheftet">${ic('pin')}</span>` : ''}${m.anhaenge ? `<span class="mini" title="${m.anhaenge} Anhang/Anhänge">${ic('clip')}</span>` : ''}
        <span class="mini${m.markiert ? ' an' : ''}" ${m.markiert ? 'title="Markiert"' : 'hidden'}>${ic('star')}</span>
        <span class="zeit">${zeitKurz(m.datum)}</span></div>
      <div class="betreff">${esc(m.betreff || '(ohne Betreff)')}</div>
      <div class="vorschau">${esc(m.vorschau)}</div>
      ${info.length ? `<div class="info">${info.join('')}</div>` : ''}
    </div>
    <div class="schnell">
      ${m.art === 'eingang' && !S.erledigt.includes(m.status) ? `<button class="ikon" type="button" data-schnell="erledigt" title="Erledigt (E)" style="color:var(--ok)">${ic('check')}</button>` : ''}
      <button class="ikon" type="button" data-schnell="zurueck" title="Zurückstellen (H)">${ic('clock')}</button>
      <button class="ikon" type="button" data-schnell="stern" title="${m.markiert ? 'Markierung entfernen' : 'Markieren'} (S)"${m.markiert ? ' aria-pressed="true"' : ''}>${ic('star')}</button>
      <button class="ikon" type="button" data-schnell="${neu ? 'gelesen' : 'ungelesen'}" title="${neu ? 'Als gelesen' : 'Als ungelesen'} (U)">${ic(neu ? 'mailopen' : 'mail')}</button>
    </div>
  </div>`;
}
function entwurfZeileHtml(e) {
  const k = kontoVon(e.konto_id);
  const text = e.html.replace(/<blockquote[\s\S]*$/i, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return `<div class="zeile" data-entwurf="${e.id}">
    <span></span>${ava(e.an || '?', e.an)}
    <div style="min-width:0">
      <div class="z1"><span class="wer">${esc(e.an ? `An: ${e.an}` : '(noch kein Empfänger)')}</span>${e.anhaenge.length ? `<span class="mini">${ic('clip')}</span>` : ''}<span class="zeit">${e.senden_um ? zeitWann(datum(e.senden_um)) : zeitKurz(e.geaendert)}</span></div>
      <div class="betreff">${esc(e.betreff || '(ohne Betreff)')}</div>
      <div class="vorschau">${esc(text.slice(0, 160))}</div>
      <div class="info">${e.status === 'geplant' ? `<span class="pill gelesen">${ic('geplant')}geplant · ${esc(zeitLang(e.senden_um))}</span>` : e.status === 'fehler' ? `<span class="pill spam">${ic('alert')}nicht gesendet: ${esc(e.fehler || '')}</span>` : '<span class="pill">Entwurf</span>'}
        ${k ? `<span class="pill konto">${esc(k.name)}</span>` : ''}</div>
    </div>
    <div class="schnell">${e.status === 'geplant' ? `<button class="ikon" type="button" data-e-stopp="${e.id}" title="Planung aufheben">${ic('undo')}</button>` : ''}<button class="ikon" type="button" data-e-weg="${e.id}" title="Verwerfen">${ic('trash')}</button></div>
  </div>`;
}
function leerHtml() {
  const t = {
    offen: ['🎉', 'Posteingang leer', 'Alles erledigt – Zeit für einen Kaffee.'],
    mir: ['🙌', 'Nichts zugewiesen', 'Dir ist gerade keine offene Mail zugewiesen.'],
    markiert: ['⭐', 'Keine markierten Mails', 'Mit S oder dem Stern markieren.'],
    zurueck: ['⏰', 'Nichts zurückgestellt', 'Mit H kommt eine Mail später wieder.'],
    entwuerfe: ['📝', 'Keine Entwürfe', 'Angefangene Mails werden automatisch gespeichert.'],
    geplant: ['🗓', 'Nichts geplant', 'Beim Senden „Später senden“ wählen.'],
  }[ansicht] || ['📭', suche ? 'Nichts gefunden' : 'Keine Mails', suche ? 'Andere Suchwörter oder Filter probieren.' : ''];
  return `<div class="leer"><div class="bild">${t[0]}</div><b>${t[1]}</b>${t[2]}</div>`;
}
function listeZeichnen() {
  const l = $('liste');
  if (ansicht === 'entwuerfe' || ansicht === 'geplant') {
    const e = entwuerfe.filter((x) => (ansicht === 'geplant' ? x.status === 'geplant' : x.status !== 'geplant'));
    l.innerHTML = e.length ? e.map(entwurfZeileHtml).join('') : leerHtml();
    return;
  }
  if (laedt && !mails.length) { l.innerHTML = '<div class="skelett"></div>'.repeat(7); return; }
  if (!mails.length) { l.innerHTML = leerHtml(); return; }
  let gruppe = null, html = '';
  for (const m of mails) {
    const g = m.angeheftet ? 'Angeheftet' : ansicht === 'zurueck' ? 'Kommt zurück' : tagGruppe(m.datum);
    if (g !== gruppe) { html += `<div class="tag-kopf">${g === 'Angeheftet' ? `${ic('pin', 'k')} ` : ''}${esc(g)}</div>`; gruppe = g; }
    html += zeileHtml(m);
  }
  l.innerHTML = html + (mehr ? '<button class="mehr-laden" id="mehrLaden" type="button">Ältere Mails laden</button>' : '');
  if (tastaturIdx >= 0) l.querySelectorAll('.zeile')[tastaturIdx]?.classList.add('tastatur');
}
const qMitFilter = () => [suche, ...filter].filter(Boolean).join(' ');
let ladeNr = 0;
async function listeLaden(anhaengen = false) {
  const nr = ++ladeNr;
  if (ansicht === 'entwuerfe' || ansicht === 'geplant') {
    try { entwuerfe = (await api('GET', '/entwuerfe')).entwuerfe; } catch (e) { fehlerToast(e); }
    if (nr === ladeNr) { kopfZeichnen(); listeZeichnen(); }
    return;
  }
  const p = new URLSearchParams({ konto, ansicht });
  const q = qMitFilter();
  if (q) p.set('q', q);
  if (anhaengen && mails.length) p.set('vor', mails.filter((m) => !m.angeheftet).at(-1)?.datum || mails.at(-1).datum);
  laedt = true;
  if (!anhaengen && !mails.length) listeZeichnen();
  try {
    const d = await api('GET', `/nachrichten?${p}`);
    if (nr !== ladeNr) return;
    mails = anhaengen ? mails.concat(d.nachrichten.filter((n) => !mails.some((m) => m.id === n.id))) : d.nachrichten;
    mehr = d.mehr;
    const ids = new Set(mails.map((m) => m.id));
    [...auswahl].forEach((id) => { if (!ids.has(id)) auswahl.delete(id); });
  } catch (e) { fehlerToast(e); }
  laedt = false;
  if (nr === ladeNr) { kopfZeichnen(); listeZeichnen(); stapelZeichnen(); }
}
async function statistikLaden() {
  try { statistik = await api('GET', '/statistik'); if (ansicht === 'offen') kopfZeichnen(); } catch {}
}
function ansichtWechseln(a, k = konto) {
  ansicht = a; konto = k; merken('mail-ansicht', ansicht); merken('mail-konto', konto);
  auswahl.clear(); mails = []; tastaturIdx = -1;
  document.body.classList.remove('leiste-an');
  seiteZeichnen(); kopfZeichnen(); stapelZeichnen(); listeLaden();
  $('liste').scrollTop = 0;
}

// ---------- Lesebereich ----------
const STATUS_ICON = { gelesen: 'mailopen', unnoetig: 'x', spam: 'spam', bearbeitet: 'checkc', geantwortet: 'reply', offen: 'undo' };
const EREIGNIS = {
  geoeffnet: 'hat die Mail geöffnet', beantwortet: 'hat geantwortet', weitergeleitet: 'hat weitergeleitet', markiert: 'hat markiert', entmarkiert: 'hat die Markierung entfernt',
  angeheftet: 'hat angeheftet', losgeloest: 'hat losgelöst', zurueckgeholt: 'hat zurückgeholt', wieder_da: 'wurde an die Mail erinnert', zuweisung_weg: 'hat die Zuweisung entfernt',
};
function verlaufText(e) {
  if (e.art.startsWith('status:')) return `hat „${S.status[e.art.slice(7)] || e.art.slice(7)}“ gesetzt`;
  if (e.art === 'zurueckgestellt') return `hat zurückgestellt bis ${zeitWann(datum(e.text))}`;
  if (e.art === 'zugewiesen') return `hat ${e.text === e.email ? 'sich selbst' : name(e.text)} zugewiesen`;
  return EREIGNIS[e.art] || e.art;
}
function mailDokument(m) {
  const bilder = bilderErlaubt.has(m.id) || E.bilder.includes(String(m.von_mail || '').toLowerCase());
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:${bilder ? ' https: http:' : ''}; font-src data:`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">
    <style>body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;margin:16px 18px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{border-left:3px solid #ddd;margin:8px 0;padding-left:10px;color:#555}a{color:#2563EB}</style></head><body>${m.html}</body></html>`;
}
function textKoerper(t) {
  const zeilen = String(t || '(kein Text)').split('\n');
  const ab = zeilen.findIndex((z, i) => i > 0 && (/^(Am .+ schrieb|On .+ wrote|-{3,}\s*(Original|Ursprüngliche)|Von: .+|From: .+)/i.test(z.trim()) || (/^>/.test(z) && /^>/.test(zeilen[i + 1] || ''))));
  if (ab < 1) return `<pre>${linkify(esc(t || '(kein Text)'))}</pre>`;
  return `<pre>${linkify(esc(zeilen.slice(0, ab).join('\n').trimEnd()))}</pre><details style="padding:0 18px 14px"><summary class="hinweis" style="cursor:pointer">··· Zitat anzeigen</summary><pre style="padding:8px 0 0;color:var(--muted)">${linkify(esc(zeilen.slice(ab).join('\n')))}</pre></details>`;
}
function anhangTyp(a) {
  const e = (a.name.split('.').pop() || '').toUpperCase().slice(0, 4);
  const farbe = /PDF/.test(e) ? '#DC2626' : /DOC|ODT|RTF/.test(e) ? '#2563EB' : /XLS|CSV|ODS/.test(e) ? '#16A34A' : /ZIP|RAR|7Z/.test(e) ? '#CA8A04' : /DWG|DXF/.test(e) ? '#7C3AED' : '#6B7280';
  return { e, farbe, bild: /^image\/(png|jpe?g|gif|webp)$/i.test(a.typ || '') };
}
function anhaengeHtml(m) {
  if (!m.anhang_liste?.length) return '';
  return `<div class="anhaenge">${m.anhang_liste.map((a) => {
    const t = anhangTyp(a);
    const url = `/api/mail/nachrichten/${m.id}/anhang/${a.i}`;
    return `<a class="anhang" href="${url}" ${t.bild ? `data-bild="${url}?ansehen=1" data-name="${esc(a.name)}"` : /PDF/.test(t.e) ? `target="_blank" data-pdf="${url}?ansehen=1"` : ''} title="${esc(a.name)}">
      <span class="typ" style="background:${t.farbe}">${t.bild ? `<img src="${url}?ansehen=1" alt="" loading="lazy">` : esc(t.e || 'DATEI')}</span>
      <span style="min-width:0"><span class="nm">${esc(a.name)}</span><small>${groesse(a.groesse || 0)}</small></span></a>`;
  }).join('')}${m.anhang_liste.length > 1 ? `<span class="hinweis" style="align-self:center">${m.anhang_liste.length} Anhänge · ${groesse(m.anhang_liste.reduce((s, a) => s + (a.groesse || 0), 0))}</span>` : ''}</div>`;
}
function bannerHtml(m) {
  const b = [];
  if (m.zurueck_bis) b.push(`<div class="banner offen">${ic('clock')}<div>Zurückgestellt bis <b>${esc(zeitLang(m.zurueck_bis))}</b> – taucht dann wieder oben im Posteingang auf.</div><button class="btn klein" type="button" data-l="zurueckholen">Jetzt zurückholen</button></div>`);
  if (m.zugewiesen) b.push(`<div class="banner info">${ic('usercheck')}<div><b>${esc(m.zugewiesen === S.ich ? 'Dir' : name(m.zugewiesen))}</b> zugewiesen${m.zugewiesen_von && m.zugewiesen_von !== m.zugewiesen ? ` von ${esc(name(m.zugewiesen_von))}` : ''}.</div></div>`);
  if (m.beantwortet_von?.startsWith('konto:')) b.push(`<div class="banner ok">${ic('checkc')}<div><b>Beantwortet</b> über das Postfach ${esc(kontoVon(+m.beantwortet_von.slice(6))?.email || '')} – außerhalb des Tools (Outlook/Handy) · ${zeitLang(m.beantwortet_am)}</div></div>`);
  else if (m.beantwortet_von) b.push(`<div class="banner ok">${ic('checkc')}<div><b>${esc(name(m.beantwortet_von))}</b> hat geantwortet · ${zeitLang(m.beantwortet_am)}</div></div>`);
  else if (S.erledigt.includes(m.status)) b.push(`<div class="banner erl">${ic('checkc')}<div><b>${esc(name(m.status_von))}</b> hat „${esc(S.status[m.status])}“ gesetzt · ${zeitLang(m.status_am)}</div></div>`);
  else if (m.art === 'eingang' && m.geoeffnet.some((o) => o.email !== S.ich)) {
    const andere = m.geoeffnet.filter((o) => o.email !== S.ich);
    b.push(`<div class="banner offen">${ic('users')}<div>Noch offen – schon angesehen von ${andere.map((o) => `<b>${esc(vorname(o.email))}</b>`).join(', ')}. Absprechen, wer antwortet?</div></div>`);
  }
  return b.join('');
}
function teamHtml(m) {
  const notizen = m.verlauf.filter((e) => e.art === 'notiz');
  const sonst = m.verlauf.filter((e) => e.art !== 'notiz');
  const erste = new Map();
  sonst.forEach((e) => { if (e.art === 'geoeffnet' && !erste.has('x')) erste.set('x', e.id); });
  const notizText = (t) => linkify(esc(t)).replace(/@([\wäöüÄÖÜß]+)/g, '<span class="erw">@$1</span>');
  return `<div class="team">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-tab="notizen" aria-selected="${teamTab === 'notizen'}">${ic('note', 'k')} Team-Notizen${notizen.length ? ` (${notizen.length})` : ''}</button>
      <button type="button" role="tab" data-tab="verlauf" aria-selected="${teamTab === 'verlauf'}">${ic('history', 'k')} Wer hat was gemacht</button>
    </div>
    <div class="inhalt">${teamTab === 'notizen' ? `
      ${notizen.length ? `<ul class="zeitleiste">${notizen.map((e) => `<li>${teamAva(e.email, '')}<div><b>${esc(name(e.email))}</b><div class="notiz">${notizText(e.text)}</div></div><span class="wann">${zeitKurz(e.zeit)}${e.email === S.ich ? ` <button class="ikon" style="width:24px;height:24px" type="button" data-notiz-weg="${e.id}" aria-label="Notiz löschen">${ic('trash', 'k')}</button>` : ''}</span></li>`).join('')}</ul>` : '<p class="hinweis">Interne Notizen sieht nur das Team – sie gehen nie an den Kunden. Mit @Vorname jemanden benachrichtigen.</p>'}
      <form class="notiz-feld" id="notizForm"><textarea id="notizText" rows="1" placeholder="Notiz fürs Team … (@Name erwähnt)" aria-label="Team-Notiz"></textarea><button class="btn haupt" type="submit">${ic('send', 'k')}</button></form>`
    : `<ul class="zeitleiste">${sonst.map((e) => `<li>${e.email.startsWith('konto:') ? `<span class="ava" style="--h:200">${ic('mail', 'k')}</span>` : teamAva(e.email, '')}<div><b>${esc(name(e.email))}</b> ${esc(verlaufText(e))}${e.art === 'geoeffnet' && e.id === erste.get('x') ? ' <span class="pill">als Erste/r</span>' : ''}${e.text && !['zurueckgestellt', 'zugewiesen'].includes(e.art) ? ` <span class="hinweis">${esc(e.text)}</span>` : ''}</div><span class="wann">${zeitLang(e.zeit)}</span></li>`).join('') || '<li class="hinweis">Noch von niemandem im Tool geöffnet.</li>'}</ul>`}
    </div></div>`;
}
const threadKarte = (t) => `
  <div class="nachricht zu" data-thread="${t.id}"><div class="n-kopf">${ava(t.art === 'gesendet' ? name(S.ich) : (t.von_name || t.von_mail), t.art === 'gesendet' ? S.ich : t.von_mail)}
    <div class="n-wer"><div class="name">${esc(t.art === 'gesendet' ? `Gesendet → ${(t.an || '').replace(/<[^>]+>/g, '').replace(/"/g, '')}` : (t.von_name || t.von_mail))}</div><div class="vor">${esc(t.vorschau || '')}</div></div>
    <div class="n-zeit">${zeitKurz(t.datum)}</div></div></div>`;
function leserLeer() {
  $('leser').innerHTML = `<div class="leer" style="margin:auto"><div class="bild">✉️</div><b>Keine Mail ausgewählt</b>Mail anklicken oder mit <kbd>J</kbd> / <kbd>K</kbd> durchgehen.<br><br><span class="hinweis"><kbd>C</kbd> neue Mail · <kbd>/</kbd> suchen · <kbd>Strg</kbd>+<kbd>K</kbd> Befehle · <kbd>?</kbd> alle Kürzel</span></div>`;
}
function leserZeichnen() {
  const m = offenMail;
  if (!m) return leserLeer();
  const k = kontoVon(m.konto_id);
  const schreiben = ['schreiben', 'verwalten'].includes(m.recht);
  const erledigt = S.erledigt.includes(m.status);
  const idx = mails.findIndex((x) => x.id === m.id);
  const frueher = m.thread.filter((t) => t.id !== m.id);
  const sperre = schreiben ? '' : ' disabled title="Nur mit Schreibrecht"';
  $('leser').innerHTML = `
    <div class="l-leiste">
      <button class="ikon zurueck-btn" type="button" data-l="schliessen" aria-label="Zurück zur Liste">${ic('zurueck')}</button>
      ${m.art !== 'gesendet' ? `<button class="erledigt-btn${erledigt ? ' ist' : ''}" type="button" data-l="erledigt"${sperre}>${ic(erledigt ? 'undo' : 'check', 'k')}${erledigt ? 'Wieder öffnen' : 'Erledigt'}</button>
      <button class="ikon" type="button" data-l="status" title="Status setzen"${sperre}>${ic('runter')}</button><span class="trenn"></span>` : ''}
      <button class="ikon" type="button" data-l="antwort" title="Antworten (R)"${sperre}>${ic('reply')}</button>
      <button class="ikon nur-breit" type="button" data-l="allen" title="Allen antworten (A)"${sperre}>${ic('replyall')}</button>
      <button class="ikon" type="button" data-l="weiter" title="Weiterleiten (F)"${sperre}>${ic('forward')}</button>
      <span class="trenn"></span>
      <button class="ikon" type="button" data-l="zurueck" title="Zurückstellen (H)"${sperre}>${ic('clock')}</button>
      <button class="ikon" type="button" data-l="zuweisen" title="Zuweisen (I)"${sperre}>${ic('user')}</button>
      <button class="ikon" type="button" data-l="label" title="Label (L)"${sperre}>${ic('tag')}</button>
      <button class="ikon" type="button" data-l="stern" title="Markieren (S)" aria-pressed="${m.markiert}">${ic('star')}</button>
      <button class="ikon nur-breit" type="button" data-l="anheften" title="Anheften (P)" aria-pressed="${m.angeheftet}"${sperre}>${ic('pin')}</button>
      <button class="ikon" type="button" data-l="mehr" title="Mehr">${ic('more')}</button>
      <div class="rechts">
        ${idx >= 0 ? `<span class="nur-breit">${idx + 1} / ${mails.length}${mehr ? '+' : ''}</span>` : ''}
        <button class="ikon" type="button" data-l="vorher" title="Neuere (K)"${idx > 0 ? '' : ' disabled'}>${ic('hoch')}</button>
        <button class="ikon" type="button" data-l="nachher" title="Ältere (J)"${idx >= 0 && idx < mails.length - 1 ? '' : ' disabled'}>${ic('runter')}</button>
        <button class="ikon nur-breit" type="button" data-l="fokus" title="Fokusmodus (Z)" aria-pressed="${document.body.classList.contains('fokus')}">${ic('fokus')}</button>
      </div>
    </div>
    <div class="l-scroll" id="lScroll"><div class="l-innen">
      <h2 class="l-betreff">${esc(m.betreff || '(ohne Betreff)')}</h2>
      <div class="l-chips">
        ${m.art !== 'gesendet' ? `<span class="pill ${m.status}">${esc(S.status[m.status])}</span>` : '<span class="pill">Gesendet</span>'}
        ${m.labels.map((id) => { const l = labelVon(id); return l ? `<span class="pill label" style="--lf:${l.farbe}">${esc(l.name)}</span>` : ''; }).join('')}
        <span class="pill konto"><span class="punkt" style="background:${kontoFarbe(m.konto_id)};width:7px;height:7px;margin:0"></span>${esc(k?.name || '')}</span>
        ${frueher.length ? `<span class="pill">${ic('note')}${m.thread.length} in der Unterhaltung</span>` : ''}
      </div>
      ${bannerHtml(m)}
      ${frueher.filter((t) => datum(t.datum) <= datum(m.datum)).map(threadKarte).join('')}
      <article class="nachricht">
        <div class="n-kopf">
          ${ava(m.von_name || m.von_mail, m.von_mail, 'g')}
          <div class="n-wer">
            <div class="name"><button type="button" data-l="steckbrief" title="Absender-Steckbrief">${esc(m.von_name || m.von_mail || '')}</button><small>&lt;${esc(m.von_mail || '')}&gt;</small></div>
            <div class="an">an ${esc(m.an || '')}${m.cc ? ` · Cc: ${esc(m.cc)}` : ''}</div>
          </div>
          <div class="n-zeit"><span title="${esc(zeitLang(m.datum))}">${zeitKurz(m.datum)}</span></div>
        </div>
        ${anhaengeHtml(m)}
        <div class="n-body">${m.html
          ? `${bilderErlaubt.has(m.id) || E.bilder.includes(String(m.von_mail || '').toLowerCase()) ? '' : `<div class="bilder">${ic('spam', 'k')} Externe Bilder blockiert (Schutz vor Lesebestätigungen).<button class="btn klein" type="button" data-l="bilder">Anzeigen</button><button class="btn klein" type="button" data-l="bilder-immer">Immer von diesem Absender</button></div>`}<iframe id="mailRahmen" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin" title="Inhalt der Mail"></iframe>`
          : textKoerper(m.text)}</div>
      </article>
      ${frueher.filter((t) => datum(t.datum) > datum(m.datum)).map(threadKarte).join('')}
      <div class="antwort-leiste">
        ${schreiben ? `<button class="btn haupt" type="button" data-l="antwort">${ic('reply', 'k')} Antworten</button><button class="btn" type="button" data-l="allen">${ic('replyall', 'k')} Allen</button><button class="btn" type="button" data-l="weiter">${ic('forward', 'k')} Weiterleiten</button>
          <div class="vorschlaege" id="schnellAntworten"></div>` : '<span class="hinweis">Du hast nur Leserecht auf dieses Postfach.</span>'}
      </div>
      ${teamHtml(m)}
    </div></div>`;
  const rahmen = $('mailRahmen');
  if (rahmen) {
    rahmen.srcdoc = mailDokument(m);
    rahmen.addEventListener('load', () => {
      try {
        const doc = rahmen.contentDocument;
        rahmen.style.height = `${Math.min(20000, doc.documentElement.scrollHeight + 8)}px`;
        // Links im Rahmen immer in neuem Tab, ohne Verweis zurück
        doc.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
      } catch { rahmen.style.height = '70vh'; }
    });
  }
  if (schreiben) schnellAntwortenZeichnen();
}
async function schnellAntwortenZeichnen() {
  const v = await vorlagenHolen();
  const box = $('schnellAntworten');
  if (!box || !v.length) return;
  box.innerHTML = v.slice(0, 4).map((x) => `<button class="chip" type="button" data-schnellantwort="${x.id}" title="Mit Vorlage antworten">${ic('zap', 'k')}${esc(x.name)}</button>`).join('');
}
async function oeffnen(id, still = false) {
  const wechsel = offenId !== id;
  offenId = id;
  document.body.classList.add('lesen');
  if (!still) { $('liste').querySelectorAll('.zeile[aria-selected="true"]').forEach((z) => z.setAttribute('aria-selected', 'false')); $('liste').querySelector(`[data-mail="${id}"]`)?.setAttribute('aria-selected', 'true'); }
  if (wechsel) history.replaceState(null, '', `#m${id}`);
  try {
    const m = await api('GET', `/nachrichten/${id}${still ? '?still=1' : ''}`);
    if (offenId !== id) return;
    offenMail = m;
    const z = mails.find((x) => x.id === id);
    if (z) Object.assign(z, { geoeffnet: m.geoeffnet, status: m.status, status_von: m.status_von, beantwortet_von: m.beantwortet_von, ungelesen: m.ungelesen, markiert: m.markiert, angeheftet: m.angeheftet, labels: m.labels, zugewiesen: m.zugewiesen, zurueck_bis: m.zurueck_bis, notizen: m.notizen });
    const scroll = $('lScroll')?.scrollTop || 0;
    leserZeichnen();
    if (!wechsel) $('lScroll').scrollTop = scroll;
    const zeile = $('liste').querySelector(`[data-mail="${id}"]`);
    if (z && zeile) { zeile.outerHTML = zeileHtml(z); $('liste').querySelector(`[data-mail="${id}"]`)?.scrollIntoView({ block: 'nearest' }); }
  } catch (e) { fehlerToast(e); }
}
function schliessen() {
  offenId = null; offenMail = null;
  document.body.classList.remove('lesen', 'fokus');
  history.replaceState(null, '', location.pathname + location.search);
  leserLeer();
  $('liste').querySelectorAll('.zeile[aria-selected="true"]').forEach((z) => z.setAttribute('aria-selected', 'false'));
}
function nachbar(richtung) {
  const idx = mails.findIndex((x) => x.id === offenId);
  const n = mails[idx + richtung];
  if (n) oeffnen(n.id);
}

// ---------- Aktionen ----------
// Führt eine Aktion für Mails aus; bei Status-/Zurückstellen-Änderungen mit „Rückgängig“ in der Meldung
async function tun(ids, aktion, wert, { text, rueck } = {}) {
  ids = [].concat(ids);
  if (!ids.length) return;
  const vorher = ids.map((id) => mails.find((m) => m.id === id) || (offenMail?.id === id ? offenMail : null)).filter(Boolean);
  // Nach dem Erledigen der offenen Mail gleich zur nächsten (wie Gmail)
  const naechste = offenId && ids.includes(offenId) && ['status', 'zurueck'].includes(aktion) && E.weiter === 'naechste'
    ? mails.slice(mails.findIndex((m) => m.id === offenId) + 1).find((m) => !ids.includes(m.id)) || mails.slice(0, mails.findIndex((m) => m.id === offenId)).reverse().find((m) => !ids.includes(m.id)) : null;
  try {
    const r = await api('POST', '/stapel', { ids, aktion, wert });
    if (r.hinweis) toast(r.hinweis);
    const rueckgaengig = rueck && vorher.length ? async () => {
      // je alter Wert gruppiert zurücksetzen
      const gruppen = new Map();
      vorher.forEach((m) => { const w = JSON.stringify(rueck(m)); gruppen.set(w, [...(gruppen.get(w) || []), m.id]); });
      for (const [w, l] of gruppen) await api('POST', '/stapel', { ids: l, aktion, wert: JSON.parse(w) }).catch(fehlerToast);
      await nachAktion(); toast('Rückgängig gemacht');
    } : null;
    if (text) toast(typeof text === 'function' ? text(r.anzahl) : text, rueckgaengig ? { knopf: 'Rückgängig', aktion: rueckgaengig, dauer: 6000 } : {});
    auswahl.clear();
    await nachAktion();
    if (naechste && !mails.some((m) => m.id === offenId)) oeffnen(naechste.id);
    else if (naechste === null && offenId && ids.includes(offenId) && !mails.some((m) => m.id === offenId) && ['status', 'zurueck'].includes(aktion)) schliessen();
  } catch (e) { fehlerToast(e); }
}
async function nachAktion() {
  await Promise.all([listeLaden(), startLaden()]);
  if (offenId) await oeffnen(offenId, true);
  statistikLaden();
}
const erledigtStatus = (m) => (m.beantwortet_von ? 'geantwortet' : 'bearbeitet');
function erledigen(ids) {
  const liste = [].concat(ids).map((id) => mails.find((m) => m.id === id) || offenMail).filter((m) => m && m.art !== 'gesendet');
  if (!liste.length) return;
  const alleErledigt = liste.every((m) => S.erledigt.includes(m.status));
  tun(liste.map((m) => m.id), 'status', alleErledigt ? 'offen' : 'bearbeitet', { text: (n) => (alleErledigt ? `${n} wieder offen` : `${n === 1 ? 'Mail' : `${n} Mails`} erledigt`), rueck: (m) => m.status });
}
const sternUmschalten = (ids) => { const l = [].concat(ids); const an = !l.every((id) => (mails.find((m) => m.id === id) || offenMail)?.markiert); tun(l, 'markieren', an, { text: an ? 'Markiert' : 'Markierung entfernt' }); };
const gelesenSetzen = (ids, gelesen) => tun(ids, 'gelesen', gelesen, { text: gelesen ? 'Als gelesen markiert' : 'Als ungelesen markiert' });
function zurueckstellen(anker, ids) {
  zeitMenue(anker, 'Zurückstellen bis …', (d) => tun(ids, 'zurueck', d ? d.toISOString() : null, { text: d ? `Kommt ${zeitWann(d)} zurück` : 'Zurückgeholt', rueck: (m) => m.zurueck_bis || null }), { aufheben: [].concat(ids).some((id) => (mails.find((m) => m.id === id) || offenMail)?.zurueck_bis) ? 'Zurückstellen aufheben' : null });
}
function statusMenue(anker, ids) {
  const aktuell = [].concat(ids).length === 1 ? (mails.find((m) => m.id === [].concat(ids)[0]) || offenMail)?.status : null;
  pop(anker, `<div class="p-titel">Status setzen</div>${['offen', 'gelesen', 'bearbeitet', 'geantwortet', 'unnoetig', 'spam'].map((s) => `<button class="p-zeile" data-p="${s}">${ic(STATUS_ICON[s])}${esc(S.status[s])}${aktuell === s ? `<span class="haken">${ic('check', 'k')}</span>` : ''}</button>`).join('')}`,
    (z) => { popZu(); tun(ids, 'status', z.dataset.p, { text: z.dataset.p === 'spam' ? 'Als Spam markiert und in den Spam-Ordner verschoben' : `„${S.status[z.dataset.p]}“ gesetzt`, rueck: z.dataset.p === 'spam' ? null : (m) => m.status }); });
}
function zuweisenMenue(anker, ids) {
  const aktuell = [].concat(ids).length === 1 ? (mails.find((m) => m.id === [].concat(ids)[0]) || offenMail)?.zugewiesen : null;
  const ich = S.team.find((t) => t.email === S.ich);
  const andere = S.team.filter((t) => t.email !== S.ich);
  pop(anker, `<div class="p-titel">Zuweisen an</div>
    ${ich ? `<button class="p-zeile" data-p="${esc(ich.email)}">${teamAva(ich.email)}Mir${aktuell === ich.email ? `<span class="haken">${ic('check', 'k')}</span>` : ''}</button>` : ''}
    ${andere.map((t) => `<button class="p-zeile" data-p="${esc(t.email)}">${teamAva(t.email)}${esc(t.name)}${aktuell === t.email ? `<span class="haken">${ic('check', 'k')}</span>` : ''}</button>`).join('')}
    ${aktuell ? `<button class="p-zeile" data-p="">${ic('x', 'k')}Zuweisung entfernen</button>` : ''}`,
    (z) => { popZu(); tun(ids, 'zuweisen', z.dataset.p || null, { text: z.dataset.p ? `${z.dataset.p === S.ich ? 'Dir' : name(z.dataset.p)} zugewiesen` : 'Zuweisung entfernt', rueck: (m) => m.zugewiesen || null }); });
}
function labelMenue(anker, ids) {
  ids = [].concat(ids);
  const hat = (l) => ids.every((id) => (mails.find((m) => m.id === id) || offenMail)?.labels.includes(l.id));
  const zeichnen = () => `<div class="p-titel">Labels</div><div style="padding:0 6px 4px"><input type="text" id="labelSuche" placeholder="Suchen oder neu anlegen …" autocomplete="off"></div>
    <div id="labelListe">${S.labels.map((l) => `<button class="p-zeile" data-p="l" data-id="${l.id}" data-name="${esc(l.name.toLowerCase())}"><span class="punkt" style="background:${l.farbe}"></span>${esc(l.name)}${hat(l) ? `<span class="haken">${ic('check', 'k')}</span>` : ''}</button>`).join('')}</div>
    <button class="p-zeile" data-p="neu" id="labelNeu" hidden>${ic('plus', 'k')}<span></span></button>`;
  const el = pop(anker, zeichnen(), async (z) => {
    if (z.dataset.p === 'l') {
      const l = labelVon(+z.dataset.id);
      const an = !hat(l);
      await tun(ids, 'label', { id: l.id, an }, { text: `${an ? 'Label' : 'Label entfernt:'} „${l.name}“` });
      popZu();
    }
    if (z.dataset.p === 'neu') {
      const n = $('labelSuche').value.trim();
      try { const r = await api('POST', '/labels', { name: n }); await startLaden(); await tun(ids, 'label', { id: r.id, an: true }, { text: `Label „${n}“ angelegt` }); popZu(); } catch (e) { fehlerToast(e); }
    }
  });
  const s = el.querySelector('#labelSuche');
  s.addEventListener('input', () => {
    const q = s.value.trim().toLowerCase();
    el.querySelectorAll('#labelListe [data-name]').forEach((b) => { b.hidden = q && !b.dataset.name.includes(q); });
    const neu = el.querySelector('#labelNeu');
    neu.hidden = !q || S.labels.some((l) => l.name.toLowerCase() === q);
    neu.querySelector('span').textContent = `„${s.value.trim()}“ anlegen`;
  });
  s.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const sichtbar = [...el.querySelectorAll('#labelListe [data-name]:not([hidden])')]; (sichtbar.length === 1 ? sichtbar[0] : el.querySelector('#labelNeu:not([hidden])'))?.click(); } });
}
function neuesLabel(anker) {
  pop(anker, `<div class="p-titel">Neues Label</div><div style="padding:0 6px 6px;display:grid;gap:8px"><input type="text" id="lbName" placeholder="z. B. Angebot" maxlength="40">
    <div class="farben">${S.farben.map((f, i) => `<button type="button" data-p="farbe" data-f="${f}" style="background:${f}" aria-pressed="${i === S.labels.length % S.farben.length}" aria-label="Farbe"></button>`).join('')}</div>
    <button class="btn haupt" data-p="ok">Anlegen</button></div>`, async (z, el) => {
    if (z.dataset.p === 'farbe') { el.querySelectorAll('[data-f]').forEach((b) => b.setAttribute('aria-pressed', b === z)); return; }
    if (z.dataset.p === 'ok') {
      try { await api('POST', '/labels', { name: $('lbName').value, farbe: el.querySelector('[data-f][aria-pressed="true"]')?.dataset.f }); popZu(); await startLaden(); toast('Label angelegt'); } catch (e) { fehlerToast(e); }
    }
  });
  $('lbName').addEventListener('keydown', (e) => { if (e.key === 'Enter') popAktiv.el.querySelector('[data-p="ok"]').click(); });
}
async function steckbrief(anker, mail, nm) {
  const el = pop(anker, `<div class="steckbrief"><div class="hinweis">Lädt …</div></div>`, (z) => {
    if (z.dataset.p === 'mail') { popZu(); oeffnen(+z.dataset.id); }
    if (z.dataset.p === 'alle') { popZu(); $('suche').value = `von:${mail}`; suche = $('suche').value; ansichtWechseln('alle', 'alle'); }
    if (z.dataset.p === 'schreiben') { popZu(); schreiben({ an: nm ? `${nm} <${mail}>` : mail }); }
    if (z.dataset.p === 'kopieren') { navigator.clipboard?.writeText(mail).then(() => toast('Adresse kopiert')); }
  }, { breit: true });
  try {
    const d = await api('GET', `/absender?mail=${encodeURIComponent(mail)}`);
    el.innerHTML = `<div class="steckbrief"><div class="sb1">${ava(nm || mail, mail, 'g')}<div style="min-width:0"><b>${esc(nm || mail)}</b><div class="hinweis" style="overflow-wrap:anywhere">${esc(mail)}</div></div></div>
      <div class="zahlen"><div><b>${d.n || 0}</b>Mails von</div><div><b>${d.gesendet || 0}</b>Mails an</div><div><b>${d.offen || 0}</b>offen</div></div>
      <div class="hinweis">${d.erste ? `Kontakt seit ${esc(datum(d.erste).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }))}` : 'Erster Kontakt'}${d.domain ? ` · <a href="https://${esc(d.domain)}" target="_blank" rel="noopener noreferrer">${esc(d.domain)}</a>` : ''}</div>
      ${d.letzte?.length ? `<div class="p-titel" style="padding-left:0">Zuletzt</div>${d.letzte.map((l) => `<button class="p-zeile" data-p="mail" data-id="${l.id}">${ic(l.art === 'gesendet' ? 'send' : 'inbox', 'k')}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.betreff)}</span><small>${zeitKurz(l.datum)}</small></button>`).join('')}` : ''}
      <div class="p-fuss"><button class="btn klein" data-p="schreiben">${ic('pen', 'k')} Schreiben</button><button class="btn klein" data-p="alle">${ic('search', 'k')} Alle Mails</button><button class="btn klein" data-p="kopieren">Kopieren</button></div></div>`;
  } catch (e) { el.innerHTML = `<div class="steckbrief hinweis">${esc(e.message)}</div>`; }
}
function mehrMenue(anker, m) {
  const neu = istNeu(m);
  pop(anker, `
    <button class="p-zeile" data-p="gelesen">${ic(neu ? 'mailopen' : 'mail')}${neu ? 'Als gelesen markieren' : 'Als ungelesen markieren'}<small>U</small></button>
    <button class="p-zeile" data-p="aufgabe">${ic('aufgabe')}Aufgabe daraus machen<small>T</small></button>
    <button class="p-zeile" data-p="vorlage">${ic('vorlage')}Als Vorlage speichern</button>
    <button class="p-zeile" data-p="drucken">${ic('print')}Drucken</button>
    <button class="p-zeile" data-p="link">${ic('link')}Link kopieren</button>
    <button class="p-zeile" data-p="absender">${ic('search')}Alle Mails dieses Absenders</button>
    ${m.art !== 'gesendet' ? `<button class="p-zeile" data-p="spam" style="color:var(--bad)">${ic('spam')}Spam melden<small>#</small></button>` : ''}`, (z) => {
    popZu();
    const p = z.dataset.p;
    if (p === 'gelesen') gelesenSetzen(m.id, neu);
    if (p === 'aufgabe') aufgabeAusMail(m);
    if (p === 'vorlage') vorlageAusMail(m);
    if (p === 'drucken') drucken(m);
    if (p === 'link') navigator.clipboard?.writeText(`${location.origin}/mail#m${m.id}`).then(() => toast('Link kopiert – öffnet die Mail für alle mit Zugriff'));
    if (p === 'absender') { $('suche').value = `von:${m.von_mail}`; suche = $('suche').value; ansichtWechseln('alle', 'alle'); }
    if (p === 'spam') tun(m.id, 'status', 'spam', { text: 'Als Spam markiert und verschoben' });
  });
}
async function aufgabeAusMail(m) {
  try {
    const r = await fetch('/api/aufgaben', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titel: `Mail: ${m.betreff || '(ohne Betreff)'}`.slice(0, 300), zustaendig: S.ich, notiz: `Von: ${m.von_name || ''} <${m.von_mail}>\nDatum: ${zeitLang(m.datum)}\nMail öffnen: ${location.origin}/mail#m${m.id}\n\n${String(m.text || '').slice(0, 2000)}` }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.fehler || 'Aufgabe konnte nicht angelegt werden');
    await api('POST', `/nachrichten/${m.id}/notiz`, { text: `Als Aufgabe angelegt: ${location.origin}/aufgaben${d.id ? `#a${d.id}` : ''}` }).catch(() => {});
    toast('Aufgabe angelegt', { knopf: 'Öffnen', aktion: () => window.open(`/aufgaben${d.id ? `#a${d.id}` : ''}`, '_blank') });
    if (offenId === m.id) oeffnen(m.id, true);
  } catch (e) { fehlerToast(e); }
}
function drucken(m) {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-same-origin allow-modals');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  const kopf = `<div style="font-family:Arial,sans-serif;border-bottom:1px solid #ccc;padding-bottom:10px;margin-bottom:14px"><h2 style="margin:0 0 6px">${esc(m.betreff)}</h2><div style="font-size:12px;color:#444">Von: ${esc(m.von_name || '')} &lt;${esc(m.von_mail)}&gt;<br>An: ${esc(m.an)}${m.cc ? `<br>Cc: ${esc(m.cc)}` : ''}<br>Datum: ${esc(zeitLang(m.datum))}</div></div>`;
  f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: https:"></head><body style="font-family:Arial,sans-serif;font-size:13px">${kopf}${m.html || `<pre style="white-space:pre-wrap;font-family:inherit">${esc(m.text)}</pre>`}</body></html>`;
  f.onload = () => { try { f.contentWindow.print(); } catch { window.print(); } setTimeout(() => f.remove(), 2000); };
  document.body.appendChild(f);
}
function lightbox(url, nm) {
  const d = document.createElement('div');
  d.className = 'lightbox';
  d.innerHTML = `<div class="lb-leiste"><a href="${esc(url.replace('?ansehen=1', ''))}">${ic('download', 'k')} Herunterladen</a><button type="button">${ic('x', 'k')} Schließen</button></div><img src="${esc(url)}" alt="${esc(nm)}">`;
  d.addEventListener('click', (e) => { if (!e.target.closest('a')) d.remove(); });
  document.body.appendChild(d);
}

// ---------- Vorlagen ----------
async function vorlagenHolen(neu = false) {
  if (!vorlagenCache || neu) { try { vorlagenCache = (await api('GET', '/vorlagen')).vorlagen; } catch { vorlagenCache = []; } }
  return vorlagenCache;
}
function platzhalter(html, { an = '', bezug = null } = {}) {
  const erster = String(an).split(/,\s*/)[0] || '';
  const nm = (erster.match(/^"?([^"<]+?)"?\s*</)?.[1] || bezug?.von_name || '').trim();
  const ich = name(S.ich);
  const t = { name: nm, vorname: nm.split(' ')[0], nachname: nm.split(' ').slice(1).join(' '), ich, meinvorname: ich.split(' ')[0], datum: new Date().toLocaleDateString('de-DE'), betreff: bezug?.betreff || '' };
  return html.replace(/\{(\w+)\}/g, (all, k) => (k.toLowerCase() in t ? esc(t[k.toLowerCase()]) : all));
}
function vorlageAusMail(m) {
  einstellungen('vorlagen', { name: m.betreff?.slice(0, 60) || 'Neue Vorlage', html: textZuHtml(String(m.text || '').split(/\n(Am .+ schrieb|On .+ wrote)/)[0].trim()) });
}

// ---------- Editor ----------
let K = null; // offener Editor
const ANHANG_WOERTER = /\b(anbei|im anhang|angehängt|anhängend|beigefügt|attached|attachment|siehe anlage|in der anlage)\b/i;
const sigHtml = (k) => (k?.signatur ? `<div class="sig"><br>-- <br>${htmlRein(k.signatur)}</div>` : '');
function adressFeld(feld, start, beiAenderung) {
  const box = feld.querySelector('.adressen');
  let chips = String(start || '').split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
  let vor = [], aktiv = -1, t = null;
  const ok = (x) => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(x.replace(/^.*<|>$/g, '').trim());
  const zeichnen = () => {
    const wert = box.querySelector('input')?.value || '';
    box.innerHTML = chips.map((c, i) => `<span class="adr${ok(c) ? '' : ' falsch'}" title="${esc(c)}"><span>${esc(c.replace(/\s*<[^>]+>/, '') || c)}</span><button type="button" data-weg="${i}" aria-label="Entfernen">×</button></span>`).join('') + '<input type="text" autocomplete="off" spellcheck="false">';
    const inp = box.querySelector('input');
    inp.value = wert;
    inp.setAttribute('aria-label', feld.querySelector('label').textContent);
    binden(inp);
  };
  const vorschlagZu = () => { feld.querySelector('.vorschlag')?.remove(); vor = []; aktiv = -1; };
  const uebernehmen = (text) => {
    const neu = String(text).split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
    if (!neu.length) return;
    chips = [...chips, ...neu.filter((n) => !chips.some((c) => c.toLowerCase() === n.toLowerCase()))];
    box.querySelector('input').value = '';
    vorschlagZu(); zeichnen(); box.querySelector('input').focus(); beiAenderung();
  };
  const vorschlagZeichnen = () => {
    vorschlagZu();
    if (!vor.length) return;
    const d = document.createElement('div');
    d.className = 'vorschlag';
    d.innerHTML = vor.map((k, i) => `<button type="button" data-i="${i}" class="${i === aktiv ? 'aktiv' : ''}">${ava(k.name || k.email, k.email, 'k')}<span style="min-width:0">${esc(k.name || k.email)}<small>${esc(k.email)}${k.n ? ` · ${k.n} Mails` : ''}</small></span></button>`).join('');
    d.addEventListener('mousedown', (e) => { e.preventDefault(); const b = e.target.closest('[data-i]'); if (b) { const k = vor[+b.dataset.i]; uebernehmen(k.name ? `${k.name} <${k.email}>` : k.email); } });
    feld.appendChild(d);
  };
  const binden = (inp) => {
    inp.addEventListener('input', () => {
      if (/[,;]/.test(inp.value)) return uebernehmen(inp.value);
      clearTimeout(t);
      const q = inp.value.trim();
      if (!q) return vorschlagZu();
      t = setTimeout(async () => {
        try { const d = await api('GET', `/kontakte?q=${encodeURIComponent(q)}`); if (inp.value.trim() !== q) return; const team = S.team.filter((x) => `${x.name} ${x.email}`.toLowerCase().includes(q.toLowerCase()) && x.email.includes('@')).map((x) => ({ name: x.name, email: x.email })); vor = [...d.kontakte, ...team.filter((x) => !d.kontakte.some((k) => k.email === x.email))].slice(0, 8); aktiv = vor.length ? 0 : -1; vorschlagZeichnen(); } catch {}
      }, 140);
      beiAenderung();
    });
    inp.addEventListener('keydown', (e) => {
      if (vor.length && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); aktiv = (aktiv + (e.key === 'ArrowDown' ? 1 : -1) + vor.length) % vor.length; vorschlagZeichnen(); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && vor.length && aktiv >= 0 && inp.value.trim()) { e.preventDefault(); const k = vor[aktiv]; return uebernehmen(k.name ? `${k.name} <${k.email}>` : k.email); }
      if ((e.key === 'Enter' || e.key === ' ') && inp.value.trim() && ok(inp.value.trim())) { e.preventDefault(); return uebernehmen(inp.value); }
      if (e.key === 'Backspace' && !inp.value && chips.length) { chips.pop(); zeichnen(); box.querySelector('input').focus(); beiAenderung(); }
      if (e.key === 'Escape' && vor.length) { e.stopPropagation(); vorschlagZu(); }
    });
    inp.addEventListener('blur', () => setTimeout(() => { if (inp.isConnected && inp.value.trim()) uebernehmen(inp.value); vorschlagZu(); }, 120));
    inp.addEventListener('paste', (e) => { const t2 = e.clipboardData.getData('text'); if (/[,;\n]/.test(t2)) { e.preventDefault(); uebernehmen(t2.replace(/\n/g, ',')); } });
  };
  box.addEventListener('click', (e) => {
    const w = e.target.closest('[data-weg]');
    if (w) { chips.splice(+w.dataset.weg, 1); zeichnen(); beiAenderung(); }
    box.querySelector('input').focus();
  });
  zeichnen();
  return { wert: () => [...chips, box.querySelector('input').value.trim()].filter(Boolean).join(', '), fokus: () => box.querySelector('input').focus(), leer: () => !chips.length && !box.querySelector('input').value.trim(), ok: () => chips.every(ok) };
}

async function schreiben({ art = 'neu', mail = null, entwurf = null, an = '', vorlage = null } = {}) {
  const konten = schreibKonten();
  if (!konten.length) return toast('Du hast für kein Postfach Schreibrecht');
  if (K) await K.schliessen(true);
  let e = entwurf;
  if (typeof e === 'number') { try { e = await api('GET', `/entwuerfe/${e}`); } catch (x) { return fehlerToast(x); } }
  if (!e) {
    let kontoId = mail && kontoVon(mail.konto_id) && konten.some((k) => k.id === mail.konto_id) ? mail.konto_id : konto !== 'alle' && konten.some((k) => k.id === +konto) ? +konto : konten[0].id;
    let cc = '', betreff = '', html = '<p><br></p>', original = [];
    const k = kontoVon(kontoId);
    if (mail && art !== 'neu') {
      const eigene = S.konten.map((x) => x.email.toLowerCase());
      if (art === 'antwort' || art === 'allen') {
        an = mail.art === 'gesendet' ? mail.an : (mail.von_name ? `${mail.von_name} <${mail.von_mail}>` : mail.von_mail);
        betreff = /^(re|aw):/i.test(mail.betreff || '') ? mail.betreff : `Re: ${mail.betreff || ''}`;
        if (art === 'allen') cc = [mail.an, mail.cc].filter(Boolean).join(', ').split(/,\s*/).filter((x) => x && !eigene.some((em) => x.toLowerCase().includes(em)) && !x.toLowerCase().includes(String(mail.von_mail).toLowerCase())).join(', ');
        html += sigHtml(k) + `<p><br></p><div>Am ${esc(zeitLang(mail.datum))} schrieb ${esc(mail.von_name || mail.von_mail)}:</div><blockquote>${textZuHtml(String(mail.text || '').trim())}</blockquote>`;
      } else {
        betreff = /^(wg|fwd?):/i.test(mail.betreff || '') ? mail.betreff : `WG: ${mail.betreff || ''}`;
        original = (mail.anhang_liste || []).map((a) => a.i);
        html += sigHtml(k) + `<p><br></p><div>---------- Weitergeleitete Nachricht ----------<br>Von: ${esc(mail.von_name || '')} &lt;${esc(mail.von_mail)}&gt;<br>Datum: ${esc(zeitLang(mail.datum))}<br>Betreff: ${esc(mail.betreff)}<br>An: ${esc(mail.an)}</div><br><div>${mail.html ? textZuHtml(String(mail.text || '').trim()) : textZuHtml(mail.text || '')}</div>`;
      }
    } else html += sigHtml(k);
    if (vorlage) {
      const v = (await vorlagenHolen()).find((x) => x.id === vorlage);
      if (v) { html = `<div>${htmlRein(platzhalter(v.html, { an, bezug: mail }))}</div>` + html; if (!betreff && v.betreff) betreff = platzhalter(v.betreff, { an, bezug: mail }); }
    }
    try { e = await api('POST', '/entwuerfe', { konto_id: kontoId, art, bezug: mail?.id || null, an, cc, bcc: '', betreff, html, original_anhaenge: original }); } catch (x) { return fehlerToast(x); }
  }
  editorOeffnen(e, mail);
}

function editorOeffnen(e, bezug) {
  const konten = schreibKonten();
  const titel = { neu: 'Neue Mail', antwort: 'Antworten', allen: 'Allen antworten', weiter: 'Weiterleiten' }[e.art] || 'Neue Mail';
  const el = document.createElement('div');
  el.className = 'komp';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', titel);
  el.innerHTML = `
    <div class="k-kopf" data-k="klein"><b id="kTitel">${esc(e.betreff || titel)}</b><small id="kStand"></small>
      <button class="ikon" type="button" data-k="klein" aria-label="Minimieren">${ic('minus')}</button>
      <button class="ikon" type="button" data-k="voll" aria-label="Vollbild">${ic('max')}</button>
      <button class="ikon" type="button" data-k="zu" aria-label="Schließen (Entwurf bleibt)">${ic('x')}</button></div>
    <div class="k-feld"><label for="kVon">Von</label><select id="kVon">${konten.map((k) => `<option value="${k.id}"${k.id === e.konto_id ? ' selected' : ''}>${esc(k.absender || k.name)} &lt;${esc(k.email)}&gt;</option>`).join('')}</select></div>
    <div class="k-feld" id="fAn"><label>An</label><div class="adressen"></div><div class="zusatz"><button type="button" data-k="cc"${e.cc ? ' hidden' : ''}>Cc</button><button type="button" data-k="bcc"${e.bcc ? ' hidden' : ''}>Bcc</button></div></div>
    <div class="k-feld" id="fCc"${e.cc ? '' : ' hidden'}><label>Cc</label><div class="adressen"></div></div>
    <div class="k-feld" id="fBcc"${e.bcc ? '' : ' hidden'}><label>Bcc</label><div class="adressen"></div></div>
    <div class="k-feld"><label for="kBetreff">Betreff</label><input id="kBetreff" type="text" value="${esc(e.betreff)}" autocomplete="off"></div>
    <div class="k-werkzeug" role="toolbar" aria-label="Formatierung">
      <button class="ikon" type="button" data-cmd="bold" title="Fett (Strg+B)">${ic('bold')}</button>
      <button class="ikon" type="button" data-cmd="italic" title="Kursiv (Strg+I)">${ic('italic')}</button>
      <button class="ikon" type="button" data-cmd="underline" title="Unterstrichen (Strg+U)">${ic('underline')}</button>
      <button class="ikon" type="button" data-cmd="strikeThrough" title="Durchgestrichen">${ic('strike')}</button>
      <span class="trenn"></span>
      <button class="ikon" type="button" data-cmd="insertUnorderedList" title="Aufzählung">${ic('ul')}</button>
      <button class="ikon" type="button" data-cmd="insertOrderedList" title="Nummerierung">${ic('ol')}</button>
      <button class="ikon" type="button" data-cmd="link" title="Link (Strg+K)">${ic('link')}</button>
      <button class="ikon" type="button" data-cmd="zitat" title="Zitat">${ic('quote')}</button>
      <button class="ikon" type="button" data-cmd="removeFormat" title="Formatierung entfernen">${ic('eraser')}</button>
      <span class="trenn"></span>
      <button class="ikon" type="button" data-k="vorlage" title="Vorlage einfügen (oder ;kürzel tippen)">${ic('vorlage')}</button>
      <button class="ikon" type="button" data-k="datei" title="Datei anhängen">${ic('clip')}</button>
      <input type="file" id="kDatei" multiple hidden>
    </div>
    <div class="k-text" id="kText" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Text" data-platz="Schreib los … (;kürzel fügt eine Vorlage ein)"></div>
    <div class="k-anh" id="kAnh"></div>
    <div class="k-fuss">
      <div class="senden"><button type="button" data-k="senden" id="kSenden" title="Senden (Strg+Enter)">${ic('send', 'k')} Senden</button><button type="button" data-k="spaeter" title="Später senden" aria-label="Später senden">${ic('runter', 'k')}</button></div>
      <span class="hinweis nur-breit"><kbd>Strg</kbd>+<kbd>↵</kbd></span>
      <div class="rechts"><button class="ikon" type="button" data-k="verwerfen" title="Entwurf verwerfen">${ic('trash')}</button></div>
    </div>`;
  document.body.appendChild(el);
  const text = el.querySelector('#kText');
  text.innerHTML = htmlRein(e.html) || '<p><br></p>';
  let stand = JSON.stringify(e), speichernT = null, gespeichert = true, offenAnhaenge = 0;
  const anhaenge = [...e.anhaenge];
  const original = bezug?.anhang_liste?.filter((a) => e.original_anhaenge.includes(a.i)) || [];
  const geaendert = () => { gespeichert = false; el.querySelector('#kStand').textContent = ''; clearTimeout(speichernT); speichernT = setTimeout(speichern, 1200); };
  const an = adressFeld(el.querySelector('#fAn'), e.an, geaendert);
  const cc = adressFeld(el.querySelector('#fCc'), e.cc, geaendert);
  const bcc = adressFeld(el.querySelector('#fBcc'), e.bcc, geaendert);
  const daten = () => ({ konto_id: +el.querySelector('#kVon').value, an: an.wert(), cc: cc.wert(), bcc: bcc.wert(), betreff: el.querySelector('#kBetreff').value, html: text.innerHTML, original_anhaenge: original.map((a) => a.i) });
  async function speichern() {
    clearTimeout(speichernT);
    const d = daten();
    if (JSON.stringify(d) === stand) { gespeichert = true; return; }
    el.querySelector('#kStand').textContent = 'speichert …';
    try {
      await api('PUT', `/entwuerfe/${e.id}`, d);
      stand = JSON.stringify(d); gespeichert = true;
      el.querySelector('#kStand').textContent = `gespeichert ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (x) { el.querySelector('#kStand').textContent = 'nicht gespeichert'; fehlerToast(x); }
  }
  stand = JSON.stringify(daten());
  const anhZeichnen = () => {
    el.querySelector('#kAnh').innerHTML = [
      ...original.map((a) => `<span class="anhang" title="Aus der Original-Mail">${(() => { const t = anhangTyp(a); return `<span class="typ" style="background:${t.farbe}">${esc(t.e)}</span>`; })()}<span style="min-width:0"><span class="nm">${esc(a.name)}</span><small>${groesse(a.groesse || 0)} · Original</small></span><button type="button" data-org-weg="${a.i}" aria-label="Entfernen">×</button></span>`),
      ...anhaenge.map((a) => `<span class="anhang${a.laedt ? ' laedt' : ''}">${(() => { const t = anhangTyp(a); return `<span class="typ" style="background:${t.farbe}">${esc(t.e)}</span>`; })()}<span style="min-width:0"><span class="nm">${esc(a.name)}</span><small>${a.laedt ? 'lädt hoch …' : groesse(a.groesse)}</small></span>${a.laedt ? '' : `<button type="button" data-anh-weg="${a.id}" aria-label="Entfernen">×</button>`}</span>`),
    ].join('');
  };
  anhZeichnen();
  async function hochladen(dateien) {
    for (const f of dateien) {
      const summe = anhaenge.reduce((s, a) => s + (a.groesse || 0), 0) + original.reduce((s, a) => s + (a.groesse || 0), 0);
      if (summe + f.size > 25 * 1048576) { toast(`„${f.name}“ ist zu groß – zusammen höchstens 25 MB`, { fehler: true }); continue; }
      const platz = { id: `t${Math.random()}`, name: f.name, typ: f.type, groesse: f.size, laedt: true };
      anhaenge.push(platz); anhZeichnen(); offenAnhaenge += 1;
      try {
        const r = await fetch(`/api/mail/entwuerfe/${e.id}/anhang`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Dateiname': encodeURIComponent(f.name), 'X-Typ': f.type || 'application/octet-stream' }, body: f });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.fehler || 'Hochladen fehlgeschlagen');
        Object.assign(platz, d, { laedt: false });
      } catch (x) { anhaenge.splice(anhaenge.indexOf(platz), 1); fehlerToast(x); }
      offenAnhaenge -= 1; anhZeichnen();
    }
  }
  // Signatur beim Wechsel des Absenders tauschen
  el.querySelector('#kVon').addEventListener('change', () => {
    const k = kontoVon(+el.querySelector('#kVon').value);
    const alt = text.querySelector('.sig');
    if (alt) alt.outerHTML = sigHtml(k) || '';
    else if (k?.signatur) { const q = text.querySelector('blockquote'); if (q) q.insertAdjacentHTML('beforebegin', sigHtml(k)); else text.insertAdjacentHTML('beforeend', sigHtml(k)); }
    geaendert();
  });
  el.querySelector('#kBetreff').addEventListener('input', () => { el.querySelector('#kTitel').textContent = el.querySelector('#kBetreff').value || titel; geaendert(); });
  // ;kürzel + Leerzeichen → Vorlage
  text.addEventListener('input', async () => {
    geaendert();
    const sel = getSelection();
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3) return;
    const vorher = node.textContent.slice(0, sel.anchorOffset);
    const m = vorher.match(/;([\wäöüß-]+)[\s ]$/i);
    if (!m) return;
    const v = (await vorlagenHolen()).find((x) => x.kuerzel && x.kuerzel === m[1].toLowerCase());
    if (!v) return;
    const r = document.createRange();
    r.setStart(node, sel.anchorOffset - m[0].length); r.setEnd(node, sel.anchorOffset);
    sel.removeAllRanges(); sel.addRange(r);
    document.execCommand('insertHTML', false, htmlRein(platzhalter(v.html, { an: an.wert(), bezug })));
    if (!el.querySelector('#kBetreff').value && v.betreff) el.querySelector('#kBetreff').value = platzhalter(v.betreff, { an: an.wert(), bezug });
  });
  text.addEventListener('paste', (ev) => {
    const dateien = [...(ev.clipboardData?.files || [])];
    if (dateien.length) { ev.preventDefault(); hochladen(dateien); return; }
    // Eingefügtes HTML bereinigen: nur Text mit einfachen Absätzen (verhindert fremde Stile und Skripte)
    const html = ev.clipboardData?.getData('text/html');
    if (html) { ev.preventDefault(); document.execCommand('insertHTML', false, textZuHtml(ev.clipboardData.getData('text/plain'))); }
  });
  let tiefe = 0;
  el.addEventListener('dragenter', (ev) => { if (![...ev.dataTransfer.types].includes('Files')) return; tiefe += 1; if (!el.querySelector('.ablage')) el.insertAdjacentHTML('beforeend', '<div class="ablage">Dateien hier ablegen</div>'); });
  el.addEventListener('dragleave', () => { tiefe -= 1; if (tiefe <= 0) { tiefe = 0; el.querySelector('.ablage')?.remove(); } });
  el.addEventListener('dragover', (ev) => ev.preventDefault());
  el.addEventListener('drop', (ev) => { ev.preventDefault(); tiefe = 0; el.querySelector('.ablage')?.remove(); hochladen([...ev.dataTransfer.files]); });
  el.querySelector('#kDatei').addEventListener('change', (ev) => { hochladen([...ev.target.files]); ev.target.value = ''; });

  let gemerkteAuswahl = null;
  text.addEventListener('blur', () => { const s = getSelection(); if (s.rangeCount && text.contains(s.anchorNode)) gemerkteAuswahl = s.getRangeAt(0).cloneRange(); });
  const auswahlZurueck = () => { text.focus(); if (gemerkteAuswahl) { const s = getSelection(); s.removeAllRanges(); s.addRange(gemerkteAuswahl); } };
  function befehl(cmd) {
    auswahlZurueck();
    if (cmd === 'link') { const u = prompt('Link-Adresse:', 'https://'); if (u && /^(https?:|mailto:|tel:)/i.test(u)) document.execCommand(getSelection().isCollapsed ? 'insertHTML' : 'createLink', false, getSelection().isCollapsed ? `<a href="${esc(u)}">${esc(u)}</a>` : u); }
    else if (cmd === 'zitat') document.execCommand('formatBlock', false, 'blockquote');
    else document.execCommand(cmd, false, null);
    geaendert();
  }
  async function vorlageWaehlen(anker) {
    const v = await vorlagenHolen();
    pop(anker, `<div class="p-titel">Vorlage einfügen</div>${v.length ? v.map((x) => `<button class="p-zeile" data-p="v" data-id="${x.id}">${ic('vorlage', 'k')}${esc(x.name)}${x.kuerzel ? `<small>;${esc(x.kuerzel)}</small>` : ''}</button>`).join('') : '<p class="hinweis" style="padding:6px 10px">Noch keine Vorlagen.</p>'}
      <button class="p-zeile" data-p="neu">${ic('plus', 'k')}Vorlagen verwalten …</button>`, (z) => {
      popZu();
      if (z.dataset.p === 'neu') return einstellungen('vorlagen');
      const x = v.find((y) => y.id === +z.dataset.id);
      auswahlZurueck();
      document.execCommand('insertHTML', false, htmlRein(platzhalter(x.html, { an: an.wert(), bezug })));
      if (!el.querySelector('#kBetreff').value && x.betreff) el.querySelector('#kBetreff').value = platzhalter(x.betreff, { an: an.wert(), bezug });
      geaendert();
    });
  }
  async function absenden(um = null) {
    if (offenAnhaenge) return toast('Bitte warten, Anhänge werden noch hochgeladen');
    if (an.leer()) { toast('Bitte einen Empfänger eintragen', { fehler: true }); return an.fokus(); }
    if (!an.ok() || !cc.ok() || !bcc.ok()) return toast('Eine Adresse ist ungültig (rot markiert)', { fehler: true });
    if (!el.querySelector('#kBetreff').value.trim() && !confirm('Ohne Betreff senden?')) return;
    const eigenerText = text.innerHTML.replace(/<blockquote[\s\S]*$/i, '').replace(/<div class="sig">[\s\S]*$/i, '').replace(/<[^>]+>/g, ' ');
    if (ANHANG_WOERTER.test(eigenerText) && !anhaenge.length && !original.length && !confirm('Im Text steht etwas von einem Anhang, es ist aber keiner angehängt. Trotzdem senden?')) return;
    el.querySelector('#kSenden').disabled = true;
    await speichern();
    try {
      const r = await api('POST', `/entwuerfe/${e.id}/senden`, um ? { senden_um: um.toISOString() } : { verzoegerung: E.rueckgaengig });
      zu();
      const stopp = async () => { try { await api('POST', `/entwuerfe/${e.id}/stopp`); schreiben({ entwurf: e.id }); } catch (x) { fehlerToast(x); } };
      if (um) toast(`Geplant für ${zeitWann(datum(r.senden_um))}`, { knopf: 'Rückgängig', aktion: stopp, dauer: 8000 });
      else if (E.rueckgaengig > 0) toast('Wird gesendet …', { knopf: 'Rückgängig', aktion: stopp, dauer: E.rueckgaengig * 1000 });
      else toast('Wird gesendet …');
      startLaden();
      if (['entwuerfe', 'geplant'].includes(ansicht)) listeLaden();
    } catch (x) { el.querySelector('#kSenden').disabled = false; fehlerToast(x); }
  }
  async function zu() { el.remove(); K = null; }
  async function schliessen(still = false) {
    await speichern();
    const leer = an.leer() && cc.leer() && !el.querySelector('#kBetreff').value.trim() && !text.textContent.replace(/--\s*$/, '').trim() && !anhaenge.length;
    if (leer && e.art === 'neu') { await api('DELETE', `/entwuerfe/${e.id}`).catch(() => {}); }
    else if (!still) toast('Als Entwurf gespeichert', { knopf: 'Öffnen', aktion: () => schreiben({ entwurf: e.id }) });
    zu(); startLaden();
    if (['entwuerfe', 'geplant'].includes(ansicht)) listeLaden();
  }
  el.addEventListener('click', async (ev) => {
    const c = ev.target.closest('[data-cmd]');
    if (c) return befehl(c.dataset.cmd);
    const aw = ev.target.closest('[data-anh-weg]');
    if (aw) { const i = anhaenge.findIndex((a) => a.id === aw.dataset.anhWeg); if (i >= 0) { anhaenge.splice(i, 1); anhZeichnen(); api('DELETE', `/entwuerfe/${e.id}/anhang/${aw.dataset.anhWeg}`).catch(fehlerToast); } return; }
    const ow = ev.target.closest('[data-org-weg]');
    if (ow) { original.splice(original.findIndex((a) => a.i === +ow.dataset.orgWeg), 1); anhZeichnen(); geaendert(); return; }
    const b = ev.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'klein') { if (b.classList.contains('k-kopf') && !el.classList.contains('klein')) return; el.classList.toggle('klein'); el.classList.remove('voll'); }
    if (k === 'voll') { ev.stopPropagation(); el.classList.toggle('voll'); el.classList.remove('klein'); b.innerHTML = ic(el.classList.contains('voll') ? 'min' : 'max'); }
    if (k === 'zu') { ev.stopPropagation(); schliessen(); }
    if (k === 'cc' || k === 'bcc') { el.querySelector(k === 'cc' ? '#fCc' : '#fBcc').hidden = false; b.hidden = true; (k === 'cc' ? cc : bcc).fokus(); }
    if (k === 'datei') el.querySelector('#kDatei').click();
    if (k === 'vorlage') vorlageWaehlen(b);
    if (k === 'senden') absenden();
    if (k === 'spaeter') zeitMenue(b, 'Später senden', (d) => d && absenden(d));
    if (k === 'verwerfen') { if (!confirm('Entwurf verwerfen?')) return; await api('DELETE', `/entwuerfe/${e.id}`).catch(() => {}); zu(); toast('Entwurf verworfen'); startLaden(); if (['entwuerfe', 'geplant'].includes(ansicht)) listeLaden(); }
  });
  el.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); absenden(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k' && text.contains(ev.target)) { ev.preventDefault(); ev.stopPropagation(); befehl('link'); }
    else if (ev.key === 'Escape' && !popAktiv) { ev.stopPropagation(); schliessen(); }
  });
  K = { el, schliessen, speichern, id: e.id };
  window.addEventListener('beforeunload', () => { if (!gespeichert && K?.el === el) navigator.sendBeacon?.(`/api/mail/entwuerfe/${e.id}`); });
  if (an.leer()) an.fokus();
  else { text.focus(); const r = document.createRange(); r.setStart(text, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}
// Ungespeicherte Änderungen beim Verlassen sichern
window.addEventListener('pagehide', () => { K?.speichern(); });

// ---------- Einstellungen ----------
const VORLAGEN_SERVER = { IONOS: ['imap.ionos.de', 993, 'smtp.ionos.de', 465], Gmail: ['imap.gmail.com', 993, 'smtp.gmail.com', 465], 'Outlook/Office 365': ['outlook.office365.com', 993, 'smtp.office365.com', 587], Strato: ['imap.strato.de', 993, 'smtp.strato.de', 465] };
function kontoFormHtml(k = {}) {
  return `<form class="karte" id="kontoForm">
    <b>${k.id ? `${esc(k.name)} bearbeiten` : 'Postfach verknüpfen'}</b>
    ${k.id ? '' : `<div class="vorlagen">${Object.keys(VORLAGEN_SERVER).map((v) => `<button type="button" class="btn klein" data-server="${esc(v)}">${esc(v)}</button>`).join('')}</div>`}
    <div class="reihe"><div class="feld"><label for="kName">Name im Tool</label><input id="kName" value="${esc(k.name || '')}" placeholder="z. B. Info-Postfach"></div>
      <div class="feld"><label for="kAbs">Absendername</label><input id="kAbs" value="${esc(k.absender || '')}" placeholder="z. B. Muster GmbH"></div></div>
    <div class="reihe"><div class="feld"><label for="kMail">E-Mail-Adresse</label><input id="kMail" type="email" value="${esc(k.email || '')}" ${k.id ? 'disabled' : 'required'} autocomplete="off"></div>
      <div class="feld"><label for="kBen">Benutzername (meist die Adresse)</label><input id="kBen" value="${esc(k.benutzer || '')}" autocomplete="off"></div></div>
    <div class="feld"><label for="kPw">Passwort${k.id ? ' (leer lassen = unverändert)' : ''}</label><input id="kPw" type="password" autocomplete="new-password" ${k.id ? '' : 'required'}></div>
    <div class="reihe3"><div class="feld"><label for="kImap">IMAP-Server</label><input id="kImap" value="${esc(k.imap_host || '')}" required></div><div class="feld"><label for="kImapP">Port</label><input id="kImapP" type="number" value="${k.imap_port || 993}"></div></div>
    <div class="reihe3"><div class="feld"><label for="kSmtp">SMTP-Server (Senden)</label><input id="kSmtp" value="${esc(k.smtp_host || '')}" required></div><div class="feld"><label for="kSmtpP">Port</label><input id="kSmtpP" type="number" value="${k.smtp_port || 465}"></div></div>
    <p class="hinweis">Das Passwort wird verschlüsselt auf eurem Server gespeichert. Beim Speichern wird die Verbindung geprüft (Empfangen und Senden), danach wird das Postfach im Hintergrund geladen.</p>
    <div style="display:flex;gap:8px;align-items:center"><span id="kMeldung" class="hinweis" style="margin-right:auto"></span><button type="button" class="btn" data-abbr>Abbrechen</button><button class="btn haupt" id="kSpeichern">${k.id ? 'Speichern' : 'Verbinden & speichern'}</button></div>
  </form>`;
}
async function rechteHtml(k) {
  const d = await api('GET', `/konten/${k.id}/rechte`);
  const r = Object.fromEntries(d.rechte.map((x) => [x.email, x.recht]));
  return `<table class="rechte-tab"><tbody>${S.team.filter((t) => t.email !== d.besitzer).map((t) => `<tr><td>${teamAva(t.email)} ${esc(t.name)}</td><td style="text-align:right"><select data-recht="${esc(t.email)}" aria-label="Recht für ${esc(t.name)}">
    ${[['', 'kein Zugriff'], ['lesen', 'Lesen'], ['schreiben', 'Lesen + Antworten'], ['verwalten', 'Verwalten']].map(([v, l]) => `<option value="${v}"${(r[t.email] || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></td></tr>`).join('')}
    <tr><td colspan="2" class="hinweis">Besitzer: ${esc(name(d.besitzer))} · Admins sehen alle Postfächer.</td></tr></tbody></table>
    <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn haupt" type="button" data-rechte-speichern="${k.id}">Rechte speichern</button></div>`;
}
const EINST_TABS = [['konten', 'Postfächer', 'inbox'], ['signaturen', 'Signaturen', 'pen'], ['vorlagen', 'Vorlagen', 'vorlage'], ['labels', 'Labels', 'tag'], ['darstellung', 'Darstellung', 'regler'], ['tasten', 'Tastenkürzel', 'keyboard']];
const TASTEN = [['C', 'Neue Mail'], ['/', 'Suchen'], ['Strg K', 'Befehlspalette'], ['J / K', 'Nächste / vorherige Mail'], ['↵ / O', 'Mail öffnen'], ['Esc / U', 'Zurück zur Liste'], ['E', 'Erledigt / wieder öffnen'], ['R', 'Antworten'], ['A', 'Allen antworten'], ['F', 'Weiterleiten'], ['H', 'Zurückstellen'], ['I', 'Zuweisen'], ['L', 'Label'], ['S', 'Markieren (Stern)'], ['P', 'Anheften'], ['Shift U', 'Gelesen / ungelesen'], ['T', 'Aufgabe daraus machen'], ['N', 'Team-Notiz schreiben'], ['X', 'Auswählen'], ['#', 'Spam'], ['Z', 'Fokusmodus'], ['G dann I', 'Posteingang'], ['G dann D', 'Entwürfe'], ['G dann S', 'Gesendet'], ['?', 'Diese Hilfe'], ['Strg ↵', 'Senden (im Editor)']];
function einstellungen(tab = 'konten', neuVorlage = null) {
  let aktiv = tab;
  const hg = dialog(`<div class="f-kopf"><h2>Einstellungen</h2><button type="button" class="ikon" data-zu aria-label="Schließen">${ic('x')}</button></div>
    <div class="f-koerper"><div class="f-tabs" id="eTabs"></div><div class="f-inhalt" id="eInhalt"></div></div>`, { aufZu: () => { startLaden(); vorlagenHolen(true); } });
  const inhalt = hg.querySelector('#eInhalt');
  const tabsZeichnen = () => { hg.querySelector('#eTabs').innerHTML = EINST_TABS.map(([k, t, i]) => `<button class="nav" type="button" data-etab="${k}" aria-current="${aktiv === k}">${ic(i)}<span class="t">${t}</span></button>`).join(''); };
  async function zeichnen() {
    tabsZeichnen();
    if (aktiv === 'konten') {
      const eigene = S.konten.filter((k) => k.recht === 'verwalten');
      inhalt.innerHTML = `${eigene.map((k) => `<div class="karte" data-kk="${k.id}"><div class="k1"><span class="punkt" style="background:${kontoFarbe(k.id)}"></span><b>${esc(k.name)}</b><span class="pill ${k.status === 'fehler' ? 'spam' : k.status === 'ok' ? 'geantwortet' : 'gelesen'}">${k.status === 'ok' ? 'verbunden' : k.status === 'fehler' ? 'Fehler' : 'lädt'}</span>
          <button type="button" class="btn klein" data-k-abgleich="${k.id}">${ic('refresh', 'k')} Abgleichen</button><button type="button" class="btn klein" data-k-rechte="${k.id}">${ic('users', 'k')} Rechte</button><button type="button" class="btn klein" data-k-bearb="${k.id}">Bearbeiten</button><button type="button" class="btn klein rot" data-k-loeschen="${k.id}">Entfernen</button></div>
          <div class="hinweis">${esc(k.email)} · Besitzer ${esc(name(k.besitzer))}${k.abgleich ? ` · zuletzt abgeglichen ${zeitLang(k.abgleich)}` : ''}${k.fehler ? `<br><span style="color:var(--bad)">${esc(k.fehler)}</span>` : ''}</div>
          <div data-k-platz="${k.id}"></div></div>`).join('')}
        ${eigene.length ? '' : '<p class="hinweis">Du verwaltest noch kein Postfach.</p>'}
        <div id="neuPlatz"><button type="button" class="btn orange" id="kNeu">${ic('plus', 'k')} Postfach verknüpfen</button></div>
        ${S.konten.length > eigene.length ? `<p class="hinweis">Außerdem siehst du: ${S.konten.filter((k) => k.recht !== 'verwalten').map((k) => `${esc(k.name)} (${k.recht === 'schreiben' ? 'Lesen + Antworten' : 'Lesen'})`).join(', ')}</p>` : ''}`;
    }
    if (aktiv === 'signaturen') {
      const eigene = S.konten.filter((k) => k.recht === 'verwalten');
      inhalt.innerHTML = `<p class="hinweis">Die Signatur wird beim Schreiben automatisch eingefügt und wechselt mit dem Absender-Postfach. Sie gilt fürs ganze Team, das aus dem Postfach schreibt.</p>
        ${eigene.map((k) => `<div class="karte"><div class="k1"><span class="punkt" style="background:${kontoFarbe(k.id)}"></span><b>${esc(k.name)}</b><span class="hinweis">${esc(k.email)}</span></div>
          <div class="k-text" contenteditable="true" data-sig="${k.id}" style="border:1px solid var(--line2);border-radius:10px;min-height:110px" data-platz="z. B. Viele Grüße&#10;Muster GmbH · Tel. …">${htmlRein(k.signatur)}</div>
          <div style="display:flex;justify-content:flex-end"><button class="btn haupt klein" type="button" data-sig-speichern="${k.id}">Signatur speichern</button></div></div>`).join('') || '<p class="hinweis">Signaturen kann nur festlegen, wer ein Postfach verwaltet.</p>'}`;
    }
    if (aktiv === 'vorlagen') {
      const v = await vorlagenHolen(true);
      inhalt.innerHTML = `<p class="hinweis">Textbausteine für wiederkehrende Antworten. Im Editor über das Vorlagen-Symbol oder mit <b>;kürzel</b> + Leertaste einfügen. Platzhalter: <code>{vorname}</code> <code>{name}</code> <code>{nachname}</code> <code>{ich}</code> <code>{meinvorname}</code> <code>{datum}</code> <code>{betreff}</code>. Die ersten vier stehen als Schnellantwort unter jeder Mail.</p>
        <div id="vForm"></div>
        ${v.map((x) => `<div class="karte"><div class="k1">${ic('vorlage', 'k')}<b>${esc(x.name)}</b>${x.kuerzel ? `<span class="pill">;${esc(x.kuerzel)}</span>` : ''}${x.geteilt ? '<span class="pill gelesen">fürs Team</span>' : '<span class="pill">nur ich</span>'}
          ${x.besitzer === S.ich || S.admin ? `<button class="btn klein" type="button" data-v-bearb="${x.id}">Bearbeiten</button><button class="btn klein rot" type="button" data-v-weg="${x.id}">Löschen</button>` : `<span class="hinweis">von ${esc(vorname(x.besitzer))}</span>`}</div>
          <div class="hinweis" style="max-height:60px;overflow:hidden">${esc(x.html.replace(/<[^>]+>/g, ' ').slice(0, 220))}</div></div>`).join('')}
        <div><button class="btn orange" type="button" data-v-neu>${ic('plus', 'k')} Neue Vorlage</button></div>`;
      if (neuVorlage) { vorlageForm(neuVorlage); neuVorlage = null; }
    }
    if (aktiv === 'labels') {
      inhalt.innerHTML = `<p class="hinweis">Labels gelten fürs ganze Team. Löschen darf, wer das Label angelegt hat, oder ein Admin.</p>
        ${S.labels.map((l) => `<div class="karte"><div class="k1"><span class="punkt" style="background:${l.farbe}"></span><input value="${esc(l.name)}" data-l-name="${l.id}" style="border:1px solid var(--line2);border-radius:8px;padding:5px 8px;flex:1;min-width:120px" maxlength="40" aria-label="Name">
          <div class="farben">${S.farben.map((f) => `<button type="button" data-l-farbe="${l.id}" data-f="${f}" style="background:${f}" aria-pressed="${l.farbe === f}" aria-label="Farbe"></button>`).join('')}</div>
          ${l.erstellt_von === S.ich || S.admin ? `<button class="btn klein rot" type="button" data-l-weg="${l.id}">Löschen</button>` : ''}</div></div>`).join('') || '<p class="hinweis">Noch keine Labels.</p>'}
        <form class="karte" id="lNeuForm"><div class="k1"><input id="lNeuName" placeholder="Neues Label, z. B. Reklamation" maxlength="40" style="border:1px solid var(--line2);border-radius:8px;padding:7px 9px;flex:1"><button class="btn haupt">Anlegen</button></div></form>`;
    }
    if (aktiv === 'darstellung') {
      const wahl = (k, opts) => `<div class="wahlreihe">${opts.map(([v, t]) => `<button class="chip" type="button" data-e="${k}" data-v="${v}" aria-pressed="${String(E[k]) === String(v)}">${t}</button>`).join('')}</div>`;
      inhalt.innerHTML = `
        <div class="feld"><label>Farbschema</label>${wahl('theme', [['auto', 'Wie das System'], ['light', 'Hell'], ['dark', 'Dunkel']])}</div>
        <div class="feld"><label>Dichte der Liste</label>${wahl('dichte', [['komfort', 'Komfortabel'], ['kompakt', 'Kompakt']])}</div>
        <div class="feld"><label>Senden rückgängig machen – Frist</label>${wahl('rueckgaengig', [[0, 'Aus'], [5, '5 s'], [10, '10 s'], [20, '20 s'], [30, '30 s']])}</div>
        <div class="feld"><label>Nach „Erledigt“ / „Zurückstellen“</label>${wahl('weiter', [['naechste', 'Nächste Mail öffnen'], ['liste', 'Zurück zur Liste']])}</div>
        <div class="feld"><label>Bilder immer anzeigen von</label><div class="hinweis">${E.bilder.length ? E.bilder.map((b) => `<span class="pill" style="margin:2px">${esc(b)} <button type="button" data-bild-weg="${esc(b)}" aria-label="Entfernen">×</button></span>`).join('') : 'Noch niemand – beim Lesen „Immer von diesem Absender“ wählen.'}</div></div>
        <div class="feld"><label>Mitteilungen aufs Handy/Desktop</label><div><button class="btn" type="button" data-push>${ic('bell', 'k')} Push-Mitteilungen einstellen</button></div><span class="hinweis">Thema „Mail“: neue Mails, dir zugewiesene Mails, Erwähnungen in Notizen und Erinnerungen.</span></div>`;
    }
    if (aktiv === 'tasten') inhalt.innerHTML = `<div class="tasten">${TASTEN.map(([k, t]) => `<div><span>${esc(t)}</span><span>${k.split(' ').map((x) => (/^(dann|\/)$/.test(x) && x !== '/' ? ` ${x} ` : `<kbd>${esc(x)}</kbd>`)).join(' ')}</span></div>`).join('')}</div>`;
  }
  function vorlageForm(v = {}) {
    const platz = inhalt.querySelector('#vForm');
    platz.innerHTML = `<form class="karte" id="vorlageForm"><b>${v.id ? 'Vorlage bearbeiten' : 'Neue Vorlage'}</b>
      <div class="reihe"><div class="feld"><label for="vName">Name</label><input id="vName" value="${esc(v.name || '')}" required maxlength="80" placeholder="z. B. Angebot folgt"></div>
        <div class="feld"><label for="vKz">Kürzel (optional)</label><input id="vKz" value="${esc(v.kuerzel || '')}" maxlength="20" placeholder="z. B. angebot → ;angebot"></div></div>
      <div class="feld"><label for="vBetreff">Betreff (optional, nur für neue Mails)</label><input id="vBetreff" value="${esc(v.betreff || '')}"></div>
      <div class="feld"><label>Text</label><div class="k-text" id="vText" contenteditable="true" data-platz="Hallo {vorname}, …">${htmlRein(v.html)}</div></div>
      <label class="hinweis" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="vTeam"${v.geteilt === 0 ? '' : ' checked'}> Fürs ganze Team sichtbar</label>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-v-abbr>Abbrechen</button><button class="btn haupt">Speichern</button></div></form>`;
    platz.querySelector('#vName').focus();
    platz.querySelector('#vorlageForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const d = { name: $('vName').value, kuerzel: $('vKz').value, betreff: $('vBetreff').value, html: $('vText').innerHTML, geteilt: $('vTeam').checked };
      try { if (v.id) await api('PUT', `/vorlagen/${v.id}`, d); else await api('POST', '/vorlagen', d); toast('Vorlage gespeichert'); zeichnen(); } catch (x) { fehlerToast(x); }
    });
  }
  const formBinden = (form, k) => {
    form.addEventListener('click', (ev) => {
      const v = ev.target.closest('[data-server]');
      if (v) { const [ih, ip, sh, sp] = VORLAGEN_SERVER[v.dataset.server]; $('kImap').value = ih; $('kImapP').value = ip; $('kSmtp').value = sh; $('kSmtpP').value = sp; }
      if (ev.target.closest('[data-abbr]')) zeichnen();
    });
    $('kMail')?.addEventListener('input', () => { if (!$('kBen').dataset.geaendert) $('kBen').value = $('kMail').value; });
    $('kBen').addEventListener('input', () => { $('kBen').dataset.geaendert = '1'; });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      $('kSpeichern').disabled = true; $('kMeldung').style.color = ''; $('kMeldung').textContent = 'Verbindung wird geprüft …';
      const d = { name: $('kName').value, absender: $('kAbs').value, email: $('kMail').value, benutzer: $('kBen').value, imap_host: $('kImap').value, imap_port: $('kImapP').value, smtp_host: $('kSmtp').value, smtp_port: $('kSmtpP').value };
      if ($('kPw').value) d.passwort = $('kPw').value;
      try {
        if (k?.id) await api('PATCH', `/konten/${k.id}`, d); else await api('POST', '/konten', d);
        toast(k?.id ? 'Gespeichert' : 'Postfach verknüpft – Mails werden geladen');
        await startLaden(); zeichnen(); listeLaden();
      } catch (x) { $('kMeldung').style.color = 'var(--bad)'; $('kMeldung').textContent = x.message; $('kSpeichern').disabled = false; }
    });
  };
  hg.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-etab]');
    if (t) { aktiv = t.dataset.etab; return zeichnen(); }
    if (ev.target.closest('#kNeu')) { $('neuPlatz').innerHTML = kontoFormHtml(); formBinden($('kontoForm')); $('kName').focus(); return; }
    const b = ev.target.closest('[data-k-bearb]');
    if (b) { const k = kontoVon(+b.dataset.kBearb); hg.querySelector(`[data-k-platz="${k.id}"]`).innerHTML = kontoFormHtml(k); formBinden($('kontoForm'), k); return; }
    const ab = ev.target.closest('[data-k-abgleich]');
    if (ab) { try { await api('POST', `/konten/${ab.dataset.kAbgleich}/abgleich`); toast('Abgleich gestartet'); } catch (x) { fehlerToast(x); } return; }
    const r = ev.target.closest('[data-k-rechte]');
    if (r) { const k = kontoVon(+r.dataset.kRechte); const p = hg.querySelector(`[data-k-platz="${k.id}"]`); p.innerHTML = '<p class="hinweis">Lädt …</p>'; p.innerHTML = await rechteHtml(k).catch((x) => `<p class="hinweis">${esc(x.message)}</p>`); return; }
    const rs = ev.target.closest('[data-rechte-speichern]');
    if (rs) {
      const id = +rs.dataset.rechteSpeichern;
      const rechte = [...hg.querySelectorAll(`[data-k-platz="${id}"] [data-recht]`)].filter((s) => s.value).map((s) => ({ email: s.dataset.recht, recht: s.value }));
      try { await api('PUT', `/konten/${id}/rechte`, { rechte }); toast('Rechte gespeichert'); } catch (x) { fehlerToast(x); }
      return;
    }
    const l = ev.target.closest('[data-k-loeschen]');
    if (l) {
      const k = kontoVon(+l.dataset.kLoeschen);
      if (!confirm(`„${k.name}“ aus dem Tool entfernen?\n\nDie Mails bleiben im echten Postfach, nur die Verknüpfung, Status, Notizen und Verlauf im Tool werden gelöscht.`)) return;
      try { await api('DELETE', `/konten/${k.id}`); toast('Postfach entfernt'); if (String(konto) === String(k.id)) konto = 'alle'; await startLaden(); zeichnen(); listeLaden(); } catch (x) { fehlerToast(x); }
      return;
    }
    const ss = ev.target.closest('[data-sig-speichern]');
    if (ss) { try { await api('PATCH', `/konten/${ss.dataset.sigSpeichern}`, { signatur: hg.querySelector(`[data-sig="${ss.dataset.sigSpeichern}"]`).innerHTML }); toast('Signatur gespeichert'); await startLaden(); } catch (x) { fehlerToast(x); } return; }
    if (ev.target.closest('[data-v-neu]')) return vorlageForm();
    if (ev.target.closest('[data-v-abbr]')) { inhalt.querySelector('#vForm').innerHTML = ''; return; }
    const vb = ev.target.closest('[data-v-bearb]');
    if (vb) { vorlageForm((await vorlagenHolen()).find((x) => x.id === +vb.dataset.vBearb)); inhalt.scrollTop = 0; return; }
    const vw = ev.target.closest('[data-v-weg]');
    if (vw) { if (!confirm('Vorlage löschen?')) return; try { await api('DELETE', `/vorlagen/${vw.dataset.vWeg}`); zeichnen(); } catch (x) { fehlerToast(x); } return; }
    const lf = ev.target.closest('[data-l-farbe]');
    if (lf) { try { await api('PUT', `/labels/${lf.dataset.lFarbe}`, { farbe: lf.dataset.f }); await startLaden(); zeichnen(); } catch (x) { fehlerToast(x); } return; }
    const lw = ev.target.closest('[data-l-weg]');
    if (lw) { if (!confirm('Label löschen? Es verschwindet von allen Mails.')) return; try { await api('DELETE', `/labels/${lw.dataset.lWeg}`); if (ansicht === `label:${lw.dataset.lWeg}`) ansicht = 'offen'; await startLaden(); zeichnen(); listeLaden(); } catch (x) { fehlerToast(x); } return; }
    const ec = ev.target.closest('[data-e]');
    if (ec) { const k = ec.dataset.e; E[k] = k === 'rueckgaengig' ? +ec.dataset.v : ec.dataset.v; einstMerken(); darstellung(); zeichnen(); return; }
    const bw = ev.target.closest('[data-bild-weg]');
    if (bw) { E.bilder = E.bilder.filter((x) => x !== bw.dataset.bildWeg); einstMerken(); zeichnen(); return; }
    if (ev.target.closest('[data-push]')) { if (window.appFenster) window.appFenster(); else toast('Über das Konto-Menü oben links: „Apps & Mitteilungen“'); }
  });
  hg.addEventListener('change', async (ev) => {
    const ln = ev.target.closest('[data-l-name]');
    if (ln) { try { await api('PUT', `/labels/${ln.dataset.lName}`, { name: ln.value }); await startLaden(); toast('Label umbenannt'); } catch (x) { fehlerToast(x); } }
  });
  hg.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'lNeuForm') return;
    ev.preventDefault();
    try { await api('POST', '/labels', { name: $('lNeuName').value }); await startLaden(); zeichnen(); } catch (x) { fehlerToast(x); }
  });
  zeichnen();
}
function hilfe() {
  dialog(`<div class="f-kopf"><h2>${ic('keyboard')} Tastenkürzel</h2><button type="button" class="ikon" data-zu aria-label="Schließen">${ic('x')}</button></div>
    <div class="f-inhalt"><div class="tasten">${TASTEN.map(([k, t]) => `<div><span>${esc(t)}</span><span>${k.split(' ').map((x) => (x === 'dann' ? ' dann ' : `<kbd>${esc(x)}</kbd>`)).join(' ')}</span></div>`).join('')}</div>
    <p class="hinweis" style="margin-top:10px">Suche: <code>von:</code> <code>an:</code> <code>betreff:</code> <code>label:</code> <code>hat:anhang</code> <code>ist:markiert</code> <code>ist:ungelesen</code> <code>ist:zugewiesen</code> <code>nach:2026-10-01</code> <code>vor:2026-11-01</code> · Wörter in "Anführungszeichen" als Ganzes.</p></div>`);
}

// ---------- Befehlspalette ----------
function palette() {
  const befehle = [
    { t: 'Neue Mail schreiben', i: 'pen', k: 'c', run: () => schreiben() },
    ...[...ANSICHTEN, ...MEHR_ANSICHTEN].map((a) => ({ t: `Gehe zu: ${a.t}`, i: a.i, run: () => ansichtWechseln(a.k) })),
    ...S.konten.map((k) => ({ t: `Postfach: ${k.name}`, i: 'inbox', run: () => ansichtWechseln(ansicht, k.id) })),
    ...S.labels.map((l) => ({ t: `Label: ${l.name}`, i: 'tag', run: () => ansichtWechseln(`label:${l.id}`) })),
    ...(offenMail ? [
      { t: 'Antworten', i: 'reply', k: 'r', run: () => schreiben({ art: 'antwort', mail: offenMail }) },
      { t: 'Erledigt', i: 'checkc', k: 'e', run: () => erledigen(offenMail.id) },
      { t: 'Zurückstellen …', i: 'clock', k: 'h', run: () => zurueckstellen($('leser').querySelector('[data-l="zurueck"]'), offenMail.id) },
      { t: 'Aufgabe daraus machen', i: 'aufgabe', k: 't', run: () => aufgabeAusMail(offenMail) },
      { t: 'Drucken', i: 'print', run: () => drucken(offenMail) },
    ] : []),
    { t: 'Einstellungen: Postfächer', i: 'inbox', run: () => einstellungen('konten') },
    { t: 'Einstellungen: Signaturen', i: 'pen', run: () => einstellungen('signaturen') },
    { t: 'Einstellungen: Vorlagen', i: 'vorlage', run: () => einstellungen('vorlagen') },
    { t: 'Einstellungen: Labels', i: 'tag', run: () => einstellungen('labels') },
    { t: 'Darstellung', i: 'regler', run: () => einstellungen('darstellung') },
    { t: 'Hell / Dunkel umschalten', i: 'moon', run: themeUmschalten },
    { t: 'Kompakte Liste umschalten', i: 'ul', run: () => { E.dichte = E.dichte === 'kompakt' ? 'komfort' : 'kompakt'; einstMerken(); darstellung(); } },
    { t: 'Fokusmodus', i: 'fokus', k: 'z', run: () => document.body.classList.toggle('fokus') },
    { t: 'Tastenkürzel anzeigen', i: 'keyboard', k: '?', run: hilfe },
  ];
  const hg = dialog(`<input id="palIn" placeholder="Befehl oder Mail suchen …" autocomplete="off" spellcheck="false" aria-label="Befehl suchen"><div class="p-liste pop" style="position:static;box-shadow:none;border:0;max-height:420px;animation:none" id="palListe"></div>`, { klasse: 'palette' });
  const inp = hg.querySelector('#palIn');
  let treffer = [], aktiv = 0, mailT = null, mailTreffer = [];
  const zeichnen = () => {
    const q = inp.value.trim().toLowerCase();
    treffer = befehle.filter((b) => !q || b.t.toLowerCase().includes(q)).slice(0, 12);
    const alle = [...treffer, ...mailTreffer.map((m) => ({ t: m.betreff || '(ohne Betreff)', s: m.von_name || m.von_mail, i: 'mail', run: () => { if (!mails.some((x) => x.id === m.id)) mails.unshift(m); oeffnen(m.id); } })), ...(q ? [{ t: `Alle Mails durchsuchen nach „${inp.value.trim()}“`, i: 'search', run: () => { $('suche').value = inp.value.trim(); suche = $('suche').value; ansichtWechseln('alle'); } }] : [])];
    aktiv = Math.min(aktiv, alle.length - 1);
    hg.querySelector('#palListe').innerHTML = alle.map((b, i) => `<button class="p-zeile${i === aktiv ? ' aktiv' : ''}" data-i="${i}">${ic(b.i)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.t)}</span>${b.s ? `<small>${esc(b.s)}</small>` : b.k ? `<small><kbd>${esc(b.k.toUpperCase())}</kbd></small>` : ''}</button>`).join('') || '<p class="hinweis" style="padding:10px">Nichts gefunden</p>';
    hg.alle = alle;
  };
  const ausfuehren = (i) => { const b = hg.alle?.[i]; if (!b) return; hg.zu(); b.run(); };
  inp.addEventListener('input', () => {
    aktiv = 0; zeichnen();
    clearTimeout(mailT);
    const q = inp.value.trim();
    if (q.length < 2) { mailTreffer = []; return zeichnen(); }
    mailT = setTimeout(async () => { try { const d = await api('GET', `/nachrichten?ansicht=alle&konto=alle&q=${encodeURIComponent(q)}`); if (inp.value.trim() === q) { mailTreffer = d.nachrichten.slice(0, 6); zeichnen(); } } catch {} }, 200);
  });
  inp.addEventListener('keydown', (e) => {
    const n = hg.alle?.length || 0;
    if (e.key === 'ArrowDown') { e.preventDefault(); aktiv = (aktiv + 1) % n; zeichnen(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); aktiv = (aktiv - 1 + n) % n; zeichnen(); }
    if (e.key === 'Enter') { e.preventDefault(); ausfuehren(aktiv); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hg.zu(); }
  });
  hg.querySelector('#palListe').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) ausfuehren(+b.dataset.i); });
  zeichnen(); inp.focus();
}

// ---------- Darstellung ----------
function darstellung() {
  if (E.theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = E.theme;
  document.body.classList.toggle('kompakt', E.dichte === 'kompakt');
  document.body.classList.toggle('leiste-zu', !E.leiste);
  const dunkel = E.theme === 'dark' || (E.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('themeBtn').innerHTML = ic(dunkel ? 'sun' : 'moon');
  document.querySelector('meta[name="theme-color"]').content = dunkel ? '#16191D' : '#FFFFFF';
}
function themeUmschalten() {
  const dunkel = E.theme === 'dark' || (E.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  E.theme = dunkel ? 'light' : 'dark'; einstMerken(); darstellung();
}

// ---------- Start, Ereignisse, Live ----------
async function startLaden() {
  const neu = await api('GET', '/');
  S = neu;
  if (konto !== 'alle' && !kontoVon(+konto)) konto = 'alle';
  if (ansicht.startsWith('label:') && !labelVon(+ansicht.slice(6))) ansicht = 'offen';
  seiteZeichnen();
}

const zeileVon = (el) => +el.closest('[data-mail]')?.dataset.mail;
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('[data-neu]')) return schreiben();
  const ab = t.closest('[data-ansicht]');
  if (ab) { if (suche) { suche = ''; $('suche').value = ''; } return ansichtWechseln(ab.dataset.ansicht); }
  const kb = t.closest('[data-konto]');
  if (kb) return ansichtWechseln(ansicht === 'entwuerfe' || ansicht === 'geplant' ? 'offen' : ansicht, kb.dataset.konto === 'alle' ? 'alle' : +kb.dataset.konto);
  const es = t.closest('[data-einst]');
  if (es) return einstellungen(es.dataset.einst);
  if (t.closest('[data-label-neu]')) return neuesLabel(t.closest('[data-label-neu]'));
  if (t.closest('[data-hilfe]')) return hilfe();
  if (t.closest('[data-leiste]')) { E.leiste = !E.leiste; einstMerken(); return darstellung(); }
  if (t.closest('[data-leiste-mobil]')) return document.body.classList.toggle('leiste-an');
  if (document.body.classList.contains('leiste-an') && !t.closest('.seite')) document.body.classList.remove('leiste-an');
  const fi = t.closest('[data-filter]');
  if (fi) { filter.has(fi.dataset.filter) ? filter.delete(fi.dataset.filter) : filter.add(fi.dataset.filter); mails = []; kopfZeichnen(); return listeLaden(); }
  if (t.closest('[data-neu-laden]')) {
    const ziele = konto === 'alle' ? S.konten : [kontoVon(+konto)].filter(Boolean);
    ziele.forEach((k) => api('POST', `/konten/${k.id}/abgleich`).catch(() => {}));
    toast('Postfach wird abgeglichen …'); listeLaden(); statistikLaden(); return;
  }
  const alle = t.closest('[data-alle]');
  if (alle) { if (alle.checked) mails.forEach((m) => auswahl.add(m.id)); else auswahl.clear(); listeZeichnen(); return stapelZeichnen(); }
  // Liste
  const w = t.closest('[data-wahl]');
  if (w) { e.stopPropagation(); const id = +w.dataset.wahl; w.checked ? auswahl.add(id) : auswahl.delete(id); w.closest('.zeile').classList.toggle('gewaehlt', w.checked); kopfZeichnen(); return stapelZeichnen(); }
  if (t.closest('.wahl')) return;
  const sn = t.closest('[data-schnell]');
  if (sn) {
    const id = zeileVon(sn), a = sn.dataset.schnell;
    if (a === 'erledigt') erledigen(id);
    if (a === 'zurueck') zurueckstellen(sn, id);
    if (a === 'stern') sternUmschalten(id);
    if (a === 'gelesen' || a === 'ungelesen') gelesenSetzen(id, a === 'gelesen');
    return;
  }
  const z = t.closest('[data-mail]');
  if (z && z.classList.contains('zeile')) {
    const id = +z.dataset.mail;
    if (e.shiftKey || e.metaKey || e.ctrlKey) { auswahl.has(id) ? auswahl.delete(id) : auswahl.add(id); listeZeichnen(); kopfZeichnen(); return stapelZeichnen(); }
    tastaturIdx = [...$('liste').querySelectorAll('.zeile')].indexOf(z);
    return oeffnen(id);
  }
  const en = t.closest('[data-entwurf]');
  if (en && !t.closest('[data-e-weg],[data-e-stopp]')) return schreiben({ entwurf: +en.dataset.entwurf });
  const ew = t.closest('[data-e-weg]');
  if (ew) { if (!confirm('Entwurf verwerfen?')) return; await api('DELETE', `/entwuerfe/${ew.dataset.eWeg}`).catch(fehlerToast); startLaden(); return listeLaden(); }
  const est = t.closest('[data-e-stopp]');
  if (est) { try { await api('POST', `/entwuerfe/${est.dataset.eStopp}/stopp`); toast('Planung aufgehoben – liegt jetzt bei den Entwürfen'); } catch (x) { fehlerToast(x); } startLaden(); return listeLaden(); }
  if (t.closest('#mehrLaden')) return listeLaden(true);
  // Stapel
  const st = t.closest('[data-st]');
  if (st) {
    const ids = [...auswahl], a = st.dataset.st;
    if (a === 'ab') { auswahl.clear(); listeZeichnen(); kopfZeichnen(); return stapelZeichnen(); }
    if (a === 'erledigt') return erledigen(ids);
    if (a === 'gelesen' || a === 'ungelesen') return gelesenSetzen(ids, a === 'gelesen');
    if (a === 'stern') return sternUmschalten(ids);
    if (a === 'zurueck') return zurueckstellen(st, ids);
    if (a === 'zuweisen') return zuweisenMenue(st, ids);
    if (a === 'label') return labelMenue(st, ids);
    if (a === 'status') return statusMenue(st, ids);
    if (a === 'spam') { if (confirm(`${ids.length} Mail(s) als Spam markieren und in den Spam-Ordner verschieben?`)) tun(ids, 'status', 'spam', { text: (n) => `${n} als Spam verschoben` }); return; }
  }
  // Lesebereich
  const l = t.closest('[data-l]');
  if (l && offenMail && !l.disabled) {
    const m = offenMail, a = l.dataset.l;
    if (a === 'schliessen') return schliessen();
    if (a === 'erledigt') return erledigen(m.id);
    if (a === 'status') return statusMenue(l, m.id);
    if (a === 'antwort' || a === 'allen' || a === 'weiter') return schreiben({ art: a, mail: m });
    if (a === 'zurueck') return zurueckstellen(l, m.id);
    if (a === 'zurueckholen') return tun(m.id, 'zurueck', null, { text: 'Zurückgeholt' });
    if (a === 'zuweisen') return zuweisenMenue(l, m.id);
    if (a === 'label') return labelMenue(l, m.id);
    if (a === 'stern') return sternUmschalten(m.id);
    if (a === 'anheften') return tun(m.id, 'anheften', !m.angeheftet, { text: m.angeheftet ? 'Losgelöst' : 'Oben angeheftet' });
    if (a === 'mehr') return mehrMenue(l, m);
    if (a === 'vorher') return nachbar(-1);
    if (a === 'nachher') return nachbar(1);
    if (a === 'fokus') { document.body.classList.toggle('fokus'); return l.setAttribute('aria-pressed', document.body.classList.contains('fokus')); }
    if (a === 'bilder') { bilderErlaubt.add(m.id); return leserZeichnen(); }
    if (a === 'bilder-immer') { E.bilder = [...new Set([...E.bilder, String(m.von_mail || '').toLowerCase()])]; einstMerken(); toast(`Bilder von ${m.von_mail} werden künftig geladen`); return leserZeichnen(); }
    if (a === 'steckbrief') return steckbrief(l, m.von_mail, m.von_name);
  }
  const th = t.closest('[data-thread]');
  if (th) {
    const id = +th.dataset.thread;
    if (th.dataset.offen) { th.classList.add('zu'); th.querySelector('.n-body')?.remove(); delete th.dataset.offen; return; }
    try {
      const n = await api('GET', `/nachrichten/${id}?still=1`);
      th.classList.remove('zu'); th.dataset.offen = '1';
      th.insertAdjacentHTML('beforeend', `${anhaengeHtml(n)}<div class="n-body">${n.html ? '<iframe sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin" title="Frühere Mail"></iframe>' : textKoerper(n.text)}</div>`);
      const f = th.querySelector('iframe');
      if (f) { f.srcdoc = mailDokument(n); f.onload = () => { try { f.style.height = `${f.contentDocument.documentElement.scrollHeight + 8}px`; } catch {} }; }
    } catch (x) { fehlerToast(x); }
    return;
  }
  const tab = t.closest('[data-tab]');
  if (tab) { teamTab = tab.dataset.tab; return leserZeichnen(); }
  const nw = t.closest('[data-notiz-weg]');
  if (nw) { try { await api('DELETE', `/nachrichten/${offenMail.id}/notiz/${nw.dataset.notizWeg}`); oeffnen(offenMail.id, true); } catch (x) { fehlerToast(x); } return; }
  const sa = t.closest('[data-schnellantwort]');
  if (sa && offenMail) return schreiben({ art: 'antwort', mail: offenMail, vorlage: +sa.dataset.schnellantwort });
  const bild = t.closest('[data-bild]');
  if (bild) { e.preventDefault(); return lightbox(bild.dataset.bild, bild.dataset.name); }
  const pdf = t.closest('[data-pdf]');
  if (pdf) { e.preventDefault(); return window.open(pdf.dataset.pdf, '_blank', 'noopener'); }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'notizForm') return;
  e.preventDefault();
  const text = $('notizText').value.trim();
  if (!text || !offenMail) return;
  try {
    const r = await api('POST', `/nachrichten/${offenMail.id}/notiz`, { text });
    toast(r.erwaehnt?.length ? `Notiz gespeichert – ${r.erwaehnt.map(vorname).join(', ')} benachrichtigt` : 'Notiz gespeichert');
    teamTab = 'notizen'; oeffnen(offenMail.id, true);
  } catch (x) { fehlerToast(x); }
});
// @-Erwähnung im Notizfeld: Vorschläge aus dem Team, Enter speichert (Shift+Enter = neue Zeile)
document.addEventListener('input', (e) => {
  if (e.target.id !== 'notizText') return;
  const ta = e.target;
  ta.style.height = 'auto'; ta.style.height = `${Math.min(160, ta.scrollHeight)}px`;
  const m = ta.value.slice(0, ta.selectionStart).match(/@([\wäöüß]*)$/i);
  ta.parentElement.querySelector('.vorschlag')?.remove();
  if (!m) return;
  const treffer = S.team.filter((t) => t.email !== S.ich && t.name.toLowerCase().startsWith(m[1].toLowerCase())).slice(0, 5);
  if (!treffer.length) return;
  const d = document.createElement('div');
  d.className = 'vorschlag'; d.style.cssText = 'left:0;right:auto;top:auto;bottom:calc(100% + 4px);min-width:220px';
  d.innerHTML = treffer.map((t) => `<button type="button" data-erw="${esc(t.name.split(' ')[0])}">${teamAva(t.email)}${esc(t.name)}</button>`).join('');
  d.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    const b = ev.target.closest('[data-erw]');
    if (!b) return;
    const vor = ta.value.slice(0, ta.selectionStart).replace(/@[\wäöüß]*$/i, `@${b.dataset.erw} `);
    ta.value = vor + ta.value.slice(ta.selectionStart); ta.focus(); ta.selectionStart = ta.selectionEnd = vor.length; d.remove();
  });
  ta.parentElement.appendChild(d);
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'notizText' && e.key === 'Enter' && !e.shiftKey) {
    const v = e.target.parentElement.querySelector('.vorschlag button');
    e.preventDefault();
    if (v) v.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); else $('notizForm').requestSubmit();
  }
}, true);

// Suche
let sucheT = null;
$('suche').addEventListener('input', () => { clearTimeout(sucheT); sucheT = setTimeout(() => { suche = $('suche').value.trim(); mails = []; kopfZeichnen(); listeLaden(); }, 260); });
$('suche').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('suche').value = ''; suche = ''; $('suche').blur(); listeLaden(); kopfZeichnen(); } if (e.key === 'Enter') $('suche').blur(); });
$('sucheTipp').innerHTML = `Suche verfeinern:<br>${['von:', 'an:', 'betreff:', 'label:', 'hat:anhang', 'ist:markiert', 'ist:ungelesen', 'ist:zugewiesen', `nach:${new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)}`].map((o) => `<button type="button" data-op="${o}">${o}</button>`).join('')}`;
$('sucheTipp').addEventListener('mousedown', (e) => {
  const b = e.target.closest('[data-op]');
  if (!b) return;
  e.preventDefault();
  const i = $('suche');
  i.value = `${i.value.trim()} ${b.dataset.op}`.trim();
  if (!b.dataset.op.endsWith(':')) i.dispatchEvent(new Event('input'));
  i.focus();
});

// Wischen auf dem Handy: rechts = erledigt, links = zurückstellen
let wisch = null;
$('liste').addEventListener('touchstart', (e) => {
  const z = e.target.closest('.zeile[data-mail]');
  if (!z || e.touches.length > 1) return;
  wisch = { z, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, aktiv: false };
}, { passive: true });
$('liste').addEventListener('touchmove', (e) => {
  if (!wisch) return;
  const dx = e.touches[0].clientX - wisch.x, dy = e.touches[0].clientY - wisch.y;
  if (!wisch.aktiv && Math.abs(dy) > Math.abs(dx)) { wisch = null; return; }
  if (Math.abs(dx) > 12) wisch.aktiv = true;
  if (!wisch.aktiv) return;
  wisch.dx = dx;
  wisch.z.style.transform = `translateX(${dx}px)`;
  wisch.z.style.transition = 'none';
  wisch.z.style.boxShadow = dx > 0 ? 'inset 0 0 0 999px rgba(22,163,74,.12)' : 'inset 0 0 0 999px rgba(180,83,9,.12)';
}, { passive: true });
$('liste').addEventListener('touchend', () => {
  if (!wisch) return;
  const { z, dx, aktiv } = wisch;
  wisch = null;
  z.style.transition = ''; z.style.transform = ''; z.style.boxShadow = '';
  if (!aktiv) return;
  const id = +z.dataset.mail;
  if (dx > 90) erledigen(id);
  else if (dx < -90) zurueckstellen({ x: innerWidth / 2 - 120, y: z.getBoundingClientRect().top }, id);
});

// Tastenkürzel
let gPrefix = 0;
document.addEventListener('keydown', (e) => {
  const ziel0 = e.target instanceof Element ? e.target : document.body;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !ziel0.closest('.komp')) { e.preventDefault(); if (!document.querySelector('.palette')) palette(); return; }
  if (e.key === 'Escape') {
    if (popAktiv) { popZu(); return; }
    const hg = [...document.querySelectorAll('.hg')].pop();
    if (hg) { hg.zu(); return; }
    if (document.querySelector('.lightbox')) { document.querySelector('.lightbox').remove(); return; }
    if (auswahl.size) { auswahl.clear(); listeZeichnen(); kopfZeichnen(); stapelZeichnen(); return; }
    if (document.body.classList.contains('fokus')) { document.body.classList.remove('fokus'); return; }
    if (offenId) { schliessen(); return; }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (ziel0.closest('input,textarea,select,[contenteditable="true"]') || document.querySelector('.hg,.lightbox')) return;
  const k = e.key;
  const zeilen = () => [...$('liste').querySelectorAll('.zeile')];
  const markieren = (i) => {
    const z = zeilen();
    if (!z.length) return;
    tastaturIdx = Math.max(0, Math.min(z.length - 1, i));
    z.forEach((x) => x.classList.remove('tastatur'));
    z[tastaturIdx].classList.add('tastatur');
    z[tastaturIdx].scrollIntoView({ block: 'nearest' });
  };
  const ziel = () => (auswahl.size ? [...auswahl] : offenId ? [offenId] : (() => { const z = zeilen()[tastaturIdx]; return z?.dataset.mail ? [+z.dataset.mail] : []; })());
  const anker = (sel) => $('leser').querySelector(sel) || zeilen()[tastaturIdx] || $('liste');
  if (gPrefix && Date.now() - gPrefix < 1200) {
    gPrefix = 0;
    const g = { i: 'offen', d: 'entwuerfe', s: 'gesendet', m: 'mir', a: 'alle', e: 'erledigt', z: 'zurueck', f: 'markiert' }[k];
    if (g) { e.preventDefault(); ansichtWechseln(g); }
    return;
  }
  if (k === 'g') { gPrefix = Date.now(); return; }
  if (k === '/') { e.preventDefault(); $('suche').focus(); return; }
  if (k === '?') { e.preventDefault(); hilfe(); return; }
  if (k === 'c') { e.preventDefault(); schreiben(); return; }
  if (k === 'j' || k === 'ArrowDown') {
    e.preventDefault();
    if (offenId && k === 'j') return nachbar(1);
    return markieren(tastaturIdx + 1);
  }
  if (k === 'k' || k === 'ArrowUp') {
    e.preventDefault();
    if (offenId && k === 'k') return nachbar(-1);
    return markieren(tastaturIdx - 1);
  }
  if (k === 'Enter' || k === 'o') { const z = zeilen()[tastaturIdx]; if (z?.dataset.mail) { e.preventDefault(); oeffnen(+z.dataset.mail); } else if (z?.dataset.entwurf) schreiben({ entwurf: +z.dataset.entwurf }); return; }
  if (k === 'u' && offenId) { schliessen(); return; }
  if (k === 'x') { const z = zeilen()[tastaturIdx]; const id = +z?.dataset.mail; if (id) { auswahl.has(id) ? auswahl.delete(id) : auswahl.add(id); listeZeichnen(); kopfZeichnen(); stapelZeichnen(); } return; }
  if (k === 'z' && offenId) { document.body.classList.toggle('fokus'); return; }
  const ids = ziel();
  if (!ids.length) return;
  const m = offenMail && ids.length === 1 && ids[0] === offenMail.id ? offenMail : mails.find((x) => x.id === ids[0]);
  if (k === 'e') return erledigen(ids);
  if (k === 's') return sternUmschalten(ids);
  if (k === 'U') return gelesenSetzen(ids, istNeu(m || {}));
  if (k === 'h') return zurueckstellen(anker('[data-l="zurueck"]'), ids);
  if (k === 'i') return zuweisenMenue(anker('[data-l="zuweisen"]'), ids);
  if (k === 'l') return labelMenue(anker('[data-l="label"]'), ids);
  if (k === 'p') return tun(ids, 'anheften', !m?.angeheftet, { text: m?.angeheftet ? 'Losgelöst' : 'Angeheftet' });
  if (k === '#') { if (confirm('Als Spam markieren und verschieben?')) tun(ids, 'status', 'spam', { text: 'Als Spam verschoben' }); return; }
  if (!offenMail || ids[0] !== offenMail.id) return;
  if (k === 'r') { e.preventDefault(); schreiben({ art: 'antwort', mail: offenMail }); }
  if (k === 'a') { e.preventDefault(); schreiben({ art: 'allen', mail: offenMail }); }
  if (k === 'f') { e.preventDefault(); schreiben({ art: 'weiter', mail: offenMail }); }
  if (k === 't') aufgabeAusMail(offenMail);
  if (k === 'n') { e.preventDefault(); teamTab = 'notizen'; leserZeichnen(); $('notizText')?.focus(); $('notizText')?.scrollIntoView({ block: 'center' }); }
});

$('fab').innerHTML = ic('pen');
$('fab').addEventListener('click', () => schreiben());
$('markeIkon').innerHTML = ic('mail', 'k');
$('sucheIkon').innerHTML = ic('search', 'k');
$('paletteBtn').innerHTML = ic('cmd');
$('paletteBtn').addEventListener('click', palette);
$('themeBtn').addEventListener('click', themeUmschalten);
$('einstBtn').innerHTML = ic('regler');
$('einstBtn').addEventListener('click', () => einstellungen());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', darstellung);
darstellung();

// Live
const socket = io();
let nachT = null;
const nachladen = (d, neu) => {
  clearTimeout(nachT);
  nachT = setTimeout(async () => {
    await Promise.all([listeLaden(), startLaden()]);
    statistikLaden();
    if (offenMail && d?.ids?.includes(offenMail.id)) oeffnen(offenMail.id, true);
    if (neu && d?.ids?.length && ansicht !== 'offen') toast(`${d.ids.length === 1 ? 'Neue Mail' : `${d.ids.length} neue Mails`} im Posteingang`, { knopf: 'Ansehen', aktion: () => ansichtWechseln('offen') });
  }, 400);
};
socket.on('mail-neu', (d) => nachladen(d, true));
socket.on('mail-geaendert', (d) => nachladen(d));
socket.on('mail-labels', () => startLaden().then(() => { listeZeichnen(); if (offenMail) leserZeichnen(); }));
socket.on('mail-gesendet', (d) => { toast(`Gesendet ✓ ${d.betreff ? `„${d.betreff}“` : ''}`); startLaden(); if (['gesendet', 'entwuerfe', 'geplant'].includes(ansicht)) setTimeout(listeLaden, 1500); });
socket.on('mail-sendefehler', (d) => { toast(`Nicht gesendet: ${d.fehler}`, { fehler: true, knopf: 'Öffnen', aktion: () => schreiben({ entwurf: d.id }), dauer: 10000 }); startLaden(); });
socket.on('mail-zugewiesen', (d) => { toast(`${vorname(d.von)} hat dir „${d.betreff}“ zugewiesen`, { knopf: 'Öffnen', aktion: () => oeffnen(d.id), dauer: 8000 }); startLaden(); });
socket.on('mail-erwaehnt', (d) => toast(`${vorname(d.von)} hat dich bei „${d.betreff}“ erwähnt`, { knopf: 'Öffnen', aktion: () => { teamTab = 'notizen'; oeffnen(d.id); }, dauer: 8000 }));
socket.on('mail-erinnerung', (d) => toast(`⏰ Erinnerung: „${d.betreff}“`, { knopf: 'Öffnen', aktion: () => oeffnen(d.id), dauer: 10000 }));
setInterval(() => { if (S.konten.some((k) => k.status === 'neu' || k.status === 'import')) startLaden(); }, 15000);
setInterval(statistikLaden, 120000);

function hashOeffnen() {
  const m = location.hash.match(/^#m(\d+)$/);
  if (m) oeffnen(+m[1]);
  if (location.hash === '#entwuerfe') ansichtWechseln('entwuerfe');
}
window.addEventListener('hashchange', hashOeffnen);

kontoMenue('konto').then(async (ich) => {
  if (!ich) return;
  try { await startLaden(); } catch (e) { return fehlerToast(e); }
  kopfZeichnen(); leserLeer();
  await listeLaden();
  statistikLaden();
  hashOeffnen();
  vorlagenHolen();
});
})();
