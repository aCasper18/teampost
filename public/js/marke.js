// Name und Markenfarbe der Installation (APP_NAME, APP_FARBE) auf jede Seite übertragen – Schriftfarbe auf der Marke je nach Helligkeit.
(function () {
  const anwenden = (m) => {
    window.MARKE = m;
    const r = document.documentElement.style;
    r.setProperty('--brand', m.farbe);
    const [R, G, B] = [1, 3, 5].map((i) => parseInt(m.farbe.slice(i, i + 2), 16));
    r.setProperty('--on-brand', 0.299 * R + 0.587 * G + 0.114 * B > 165 ? '#111318' : '#fff');
    document.querySelectorAll('[data-app-name]').forEach((el) => { el.textContent = m.name; });
    if (document.title && !document.title.includes(m.name)) document.title = `${document.title} · ${m.name}`;
  };
  try { const m = JSON.parse(localStorage.getItem('teampost-marke')); if (m) anwenden(m); } catch {}
  fetch('/api/app').then((r) => r.json()).then((m) => { anwenden(m); try { localStorage.setItem('teampost-marke', JSON.stringify(m)); } catch {} }).catch(() => {});
})();
