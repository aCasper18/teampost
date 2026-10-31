// Konto-Menü oben links: wer ist angemeldet, Profil & Passwort, Team verwalten (Admins), Handy-App & Mitteilungen, Abmelden.
// Fenster für Mitteilungen über window.appFenster().
(function () {
  const css = `
  .konto{position:relative;flex:none}
  .konto>button{display:flex;align-items:center;gap:8px;border:1px solid #D9DCE1;background:#fff;border-radius:999px;padding:3px 10px 3px 3px;font:600 12px "Plus Jakarta Sans",system-ui,sans-serif;color:#111318;cursor:pointer}
  .konto>button:hover{border-color:#B8BEC7}
  .konto .av{width:26px;height:26px;border-radius:50%;background:#111318;color:#fff;display:grid;place-items:center;font-size:11px;font-weight:800}
  .konto .pf{font-size:9px;color:#6B7280}
  .konto-menue{position:absolute;left:0;top:calc(100% + 6px);min-width:220px;max-height:calc(100vh - 80px);overflow:auto;background:#fff;border:1px solid #D9DCE1;border-radius:12px;box-shadow:0 10px 30px rgba(16,24,40,.12);padding:6px;z-index:100;display:none}
  .konto.offen .konto-menue{display:block}
  .konto-menue .wer{padding:8px 10px 10px;border-bottom:1px solid #E5E7EB;margin-bottom:6px}
  .konto-menue .wer b{display:block;font-size:13px}
  .konto-menue .wer span{display:block;font-size:11px;color:#6B7280;margin-top:2px}
  .konto-menue button{width:100%;text-align:left;border:0;background:none;padding:9px 10px;border-radius:8px;font:600 13px "Plus Jakarta Sans",system-ui,sans-serif;color:#B42323;cursor:pointer}
  .konto-menue button:hover{background:#FDECEC}
  .konto-menue button[data-app],.konto-menue a{color:#111318}
  .konto-menue button[data-app]:hover,.konto-menue a:hover{background:#F3F4F6}
  .konto-menue a{display:block;padding:9px 10px;border-radius:8px;font:600 13px "Plus Jakarta Sans",system-ui,sans-serif;text-decoration:none}
  .app-box label.feld{display:block;font-size:12px;font-weight:700;margin:10px 0 4px}
  .app-box input.feld{width:100%;padding:10px 12px;border:1px solid #D9DCE1;border-radius:10px;font:14px inherit}
  .app-hg{position:fixed;inset:0;background:rgba(17,19,24,.4);display:grid;place-items:center;z-index:1000;padding:16px}
  .app-box{background:#fff;color:#111318;border-radius:18px;width:min(440px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,.25);font:14px/1.45 "Plus Jakarta Sans",system-ui,sans-serif}
  .app-box h2{font-size:18px;font-weight:800;margin:0 0 4px;display:flex;align-items:center;gap:10px}
  .app-box h2 img{width:34px;height:34px;border-radius:9px}
  .app-box h3{font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#6B7280;margin:18px 0 8px}
  .app-box p{margin:0 0 8px;color:#4B5563}
  .app-box .zu{float:right;border:0;background:#F2F4F7;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px}
  .app-box .knopf{border:0;border-radius:10px;padding:10px 16px;font:700 14px "Plus Jakarta Sans",system-ui,sans-serif;cursor:pointer;background:#111318;color:#fff}
  .app-box .knopf.hell{background:#fff;color:#111318;border:1px solid #D9DCE1}
  .app-box .knopf:disabled{opacity:.5;cursor:not-allowed}
  .app-box .reihe{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .app-box label.thema{display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid #F0F1F3;cursor:pointer}
  .app-box label.thema input{width:18px;height:18px;accent-color:var(--brand,#2563EB)}
  .app-box .hinweis{background:#FFF1E6;color:#7A3500;border-radius:10px;padding:10px 12px;font-size:13px}
  .app-box .ok{background:#E3F6EA;color:#127A3E;border-radius:10px;padding:10px 12px;font-size:13px}
  .app-box ol{margin:0 0 8px 18px;padding:0;color:#4B5563}
  .app-box .status{font-size:12.5px;color:#6B7280;margin-top:8px;min-height:18px}
  /* Handy: der Knopf zeigt die aktuelle App statt des Namens */
  @media (max-width:760px){
    .konto>button{padding:4px 12px 4px 4px;font-size:13px;min-height:36px}
    .konto-menue{min-width:240px;max-width:calc(100vw - 24px)}
    .konto-menue button{padding:11px 10px;font-size:14px}
    .app-hg{align-items:end;padding:0}
    .app-box{width:100%;border-radius:18px 18px 0 0;max-height:88vh;padding-bottom:max(20px,env(safe-area-inset-bottom))}
  }
  /* iOS zoomt bei Eingabefeldern unter 16 px hinein */
  @media (max-width:760px) and (pointer:coarse){input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea{font-size:16px!important}}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const appSchonOffen = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const zumLogin = () => { location.href = `/login?weiter=${encodeURIComponent(location.pathname + location.search)}`; };
  const kuerzel = (n) => String(n || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const cssRein = () => { if (!document.getElementById('konto-css')) document.head.insertAdjacentHTML('beforeend', `<style id="konto-css">${css}</style>`); };

  window.kontoMenue = async function (ziel) {
    const el = typeof ziel === 'string' ? document.getElementById(ziel) : ziel;
    if (!el) return null;
    cssRein();
    const r = await fetch('/api/ich');
    if (r.status === 401) { zumLogin(); return null; }
    const ich = await r.json();
    el.classList.add('konto');
    const hier = location.pathname;
    el.innerHTML = `<button type="button" aria-haspopup="menu" aria-expanded="false"><span class="av">${esc(kuerzel(ich.name))}</span><span class="name">${esc(ich.name.split(' ')[0])}</span><span class="pf">▾</span></button>
      <div class="konto-menue" role="menu"><div class="wer"><b>${esc(ich.name)}</b><span>${esc(ich.sub)}${ich.rolle === 'admin' ? ' · Admin' : ''}</span></div>
      ${hier !== '/mail' ? '<a href="/mail" role="menuitem">✉️ Mail</a>' : ''}
      ${ich.rolle === 'admin' && hier !== '/team' ? '<a href="/team" role="menuitem">👥 Team verwalten</a>' : ''}
      <button type="button" role="menuitem" data-app="profil">👤 Profil & Passwort</button>
      <button type="button" role="menuitem" data-app="push">📱 Handy-App & Mitteilungen</button>
      <button type="button" role="menuitem" data-abmelden>Abmelden</button></div>`;
    const knopf = el.querySelector('button');
    const auf = (offen) => { el.classList.toggle('offen', offen); knopf.setAttribute('aria-expanded', offen); };
    knopf.addEventListener('click', (e) => { e.stopPropagation(); auf(!el.classList.contains('offen')); });
    document.addEventListener('click', (e) => { if (!el.contains(e.target)) auf(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') auf(false); });
    el.querySelector('[data-app="push"]').addEventListener('click', () => { auf(false); window.appFenster(); });
    el.querySelector('[data-app="profil"]').addEventListener('click', () => { auf(false); profilFenster(ich); });
    el.querySelector('[data-abmelden]').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      zumLogin();
    });
    return ich;
  };

  // Fenster-Gerüst für Profil und Mitteilungen
  function fenster(titel) {
    cssRein();
    document.querySelector('.app-hg')?.remove();
    const hg = document.createElement('div');
    hg.className = 'app-hg';
    hg.innerHTML = `<div class="app-box" role="dialog" aria-label="${esc(titel)}"><p>Lädt …</p></div>`;
    document.body.appendChild(hg);
    const schliessen = () => { hg.remove(); document.removeEventListener('keydown', taste); };
    const taste = (e) => { if (e.key === 'Escape') schliessen(); };
    document.addEventListener('keydown', taste);
    hg.addEventListener('click', (e) => { if (e.target === hg || e.target.closest('.zu')) schliessen(); });
    return { box: hg.firstElementChild, schliessen };
  }

  function profilFenster(ich) {
    const { box } = fenster('Profil & Passwort');
    box.innerHTML = `<button class="zu" type="button" aria-label="Schließen">×</button><h2>Profil & Passwort</h2>
      <form data-profil><label class="feld" for="pName">Name</label><input class="feld" id="pName" value="${esc(ich.name === ich.sub ? '' : ich.name)}" autocomplete="name">
      <h3>Passwort ändern</h3>
      <label class="feld" for="pAlt">Bisheriges Passwort</label><input class="feld" id="pAlt" type="password" autocomplete="current-password">
      <label class="feld" for="pNeu">Neues Passwort (mind. 8 Zeichen)</label><input class="feld" id="pNeu" type="password" autocomplete="new-password" minlength="8">
      <div class="reihe" style="margin-top:14px"><button class="knopf" type="submit">Speichern</button></div>
      <div class="status" role="status"></div></form>`;
    box.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const st = box.querySelector('.status');
      const body = { name: box.querySelector('#pName').value.trim() || null };
      if (box.querySelector('#pNeu').value) Object.assign(body, { passwort: box.querySelector('#pNeu').value, altesPasswort: box.querySelector('#pAlt').value });
      const r = await fetch('/api/ich', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      st.textContent = r.ok ? 'Gespeichert ✓' : (await r.json().catch(() => ({}))).fehler || 'Hat nicht geklappt';
    });
  }

  // ---------- Handy-App ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  let installAngebot = null; // Android/Chrome: eigenes „Installieren“
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installAngebot = e; });
  const istApp = appSchonOffen;
  const istIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pushMoeglich = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const geraetName = () => {
    const u = navigator.userAgent;
    const g = /iphone/i.test(u) ? 'iPhone' : /ipad/i.test(u) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /android/i.test(u) ? 'Android' : /mac/i.test(u) ? 'Mac' : /windows/i.test(u) ? 'Windows' : 'Gerät';
    return `${g}${istApp() ? ' · App' : ' · Browser'}`;
  };
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  const api = async (method, url, body) => {
    const r = await fetch('/api/push' + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).fehler || 'Fehler');
    return r.json();
  };

  window.appFenster = async function () {
    const { box, schliessen } = fenster('App und Mitteilungen');

    let info;
    try { info = await api('GET', '/'); } catch (e) { box.innerHTML = `<p>${esc(e.message)}</p>`; return; }
    // ready wartet ewig, wenn der Service Worker nicht startet – nach 3 s aufgeben
    const reg = pushMoeglich() ? await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 3000))]).catch(() => null) : null;
    let abo = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;

    const name = window.MARKE?.name || 'Teampost';
    const zeichnen = (status = '') => {
      const installTeil = istApp()
        ? '<div class="ok">✓ Läuft als App auf diesem Gerät.</div>'
        : installAngebot
          ? `<p>Hol dir <b>${esc(name)}</b> als App auf den Startbildschirm – eigenes Symbol, ohne Browserleiste.</p><button class="knopf" type="button" data-installieren>${esc(name)} installieren</button>`
          : istIOS()
            ? `<p>So kommt ${esc(name)} auf den Home-Bildschirm (in Safari):</p><ol><li>Unten auf <b>Teilen</b> tippen (Quadrat mit Pfeil)</li><li><b>Zum Home-Bildschirm</b> wählen</li><li>Die App über das neue <b>${esc(name)}</b>-Symbol öffnen und dort Mitteilungen einschalten</li></ol>`
            : `<p>Am Handy diese Seite öffnen und dort installieren – Android: Menü ⋮ → <b>App installieren</b>, iPhone: Teilen → <b>Zum Home-Bildschirm</b>. Am Rechner (Chrome/Edge): Symbol „Installieren“ rechts in der Adressleiste.</p>`;
      let pushTeil;
      if (!pushMoeglich()) pushTeil = istIOS() && !istApp()
        ? '<div class="hinweis">Auf dem iPhone gehen Mitteilungen nur in der installierten App (ab iOS 16.4). Erst wie oben beschrieben installieren.</div>'
        : '<div class="hinweis">Dieser Browser kann keine Mitteilungen empfangen.</div>';
      else if (!reg) pushTeil = '<div class="hinweis">Der Hintergrunddienst der App ist nicht gestartet. Seite neu laden – hilft das nicht, die App einmal schließen und neu öffnen.</div>';
      else if (Notification.permission === 'denied') pushTeil = '<div class="hinweis">Mitteilungen sind für diese Seite blockiert. In den Einstellungen des Handys (bzw. Browsers) für diese Seite wieder erlauben.</div>';
      else pushTeil = abo
        ? `<div class="ok">✓ Mitteilungen sind auf diesem Gerät an.</div><div class="reihe" style="margin-top:10px"><button class="knopf hell" type="button" data-test>Test senden</button><button class="knopf hell" type="button" data-aus>Auf diesem Gerät ausschalten</button></div>`
        : '<p>Neue Mails, Zuweisungen und Erinnerungen direkt aufs Handy – auch wenn die App zu ist.</p><button class="knopf" type="button" data-an>Mitteilungen einschalten</button>';
      box.innerHTML = `<button class="zu" type="button" aria-label="Schließen">×</button>
        <h2><img src="/app/icon.svg" alt="">Handy-App & Mitteilungen</h2>
        <h3>App</h3>${installTeil}
        <h3>Mitteilungen auf diesem Gerät</h3>${pushTeil}
        <h3>Worüber? (gilt für alle deine Geräte)</h3>
        ${info.themen.map((t) => `<label class="thema"><input type="checkbox" data-thema="${t.id}"${info.meine.includes(t.id) ? ' checked' : ''}>${esc(t.name)}</label>`).join('')}
        <p style="font-size:12px;color:#9CA3AF;margin-top:10px">${info.geraete.length ? `Aktiv auf ${info.geraete.length} Gerät${info.geraete.length > 1 ? 'en' : ''}: ${info.geraete.map((g) => esc(g.geraet || 'Gerät')).join(', ')}` : 'Noch auf keinem Gerät eingeschaltet.'}</p>
        <div class="status" role="status">${esc(status)}</div>`;
    };
    zeichnen();
    const neuLaden = async (status) => { info = await api('GET', '/').catch(() => info); zeichnen(status); };

    box.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('zu')) return schliessen();
      try {
        if (b.dataset.installieren != null && installAngebot) {
          installAngebot.prompt();
          await installAngebot.userChoice; installAngebot = null; zeichnen();
        }
        if (b.dataset.an != null) {
          b.disabled = true;
          const erlaubt = await Notification.requestPermission();
          if (erlaubt !== 'granted') return zeichnen('Mitteilungen wurden nicht erlaubt.');
          abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(info.publicKey) });
          await api('POST', '/abo', { abo: abo.toJSON(), geraet: geraetName() });
          await api('POST', '/test');
          await neuLaden('Eingeschaltet – eine Test-Mitteilung ist unterwegs.');
        }
        if (b.dataset.aus != null) {
          const ep = abo?.endpoint;
          await abo?.unsubscribe().catch(() => {});
          if (ep) await api('DELETE', '/abo', { endpoint: ep });
          abo = null; await neuLaden('Auf diesem Gerät ausgeschaltet.');
        }
        if (b.dataset.test != null) {
          const r = await api('POST', '/test');
          zeichnen(`Test an ${r.geraete} Gerät${r.geraete === 1 ? '' : 'e'} gesendet.`);
        }
      } catch (err) { zeichnen(`Hat nicht geklappt: ${err.message}`); }
    });
    box.addEventListener('change', async (e) => {
      if (!e.target.dataset.thema) return;
      const t = [...box.querySelectorAll('[data-thema]:checked')].map((x) => x.dataset.thema);
      try { await api('PUT', '/themen', { themen: t }); info.meine = t; box.querySelector('.status').textContent = 'Gespeichert'; } catch (err) { box.querySelector('.status').textContent = err.message; }
    });
  };
})();
