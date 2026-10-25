(() => {
  const api = window.api;
  const $ = (s) => document.querySelector(s);

  const THEMES = {
    dark: {
      background: '#0b0d1a', foreground: '#eef1ff', cursor: '#38d4f5', cursorAccent: '#0b0d1a', selectionBackground: '#3a4280',
      black: '#1a1e38', red: '#ff6b8a', green: '#3ddc97', yellow: '#ffd479',
      blue: '#8ba4ff', magenta: '#c792ff', cyan: '#38d4f5', white: '#eef1ff',
      brightBlack: '#6b739c', brightRed: '#ff8fa8', brightGreen: '#6ff0b5', brightYellow: '#ffe6a3',
      brightBlue: '#b0c1ff', brightMagenta: '#dcb5ff', brightCyan: '#7fe6fa', brightWhite: '#ffffff',
    },
    light: {
      background: '#fbfbfe', foreground: '#1a1d33', cursor: '#5b4be0', cursorAccent: '#fbfbfe', selectionBackground: '#cfd6ff',
      black: '#1a1d33', red: '#d12c55', green: '#17935c', yellow: '#a8650a',
      blue: '#3a56d4', magenta: '#8a3fc7', cyan: '#0c8fb0', white: '#d5daf0',
      brightBlack: '#565d82', brightRed: '#e0446b', brightGreen: '#25a870', brightYellow: '#c27d0e',
      brightBlue: '#5a74e8', brightMagenta: '#a15ae0', brightCyan: '#1aa3c4', brightWhite: '#ffffff',
    },
  };

  let theme = localStorage.getItem('theme') || 'dark';
  let fontSize = Number(localStorage.getItem('fontSize')) || 15;
  let profiles = [];
  let editingId = null;
  let editingHasSecret = false;
  const sessions = new Map();
  let activeId = null;
  let panelOpen = false;
  let panelTab = 'files';
  let hlOn = localStorage.getItem('highlight') !== 'off';

  const hueOf = (str) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const fmtSize = (n) => {
    if (n < 1024) return `${n} B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
  };
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const joinPath = (a, b) => (a.endsWith('/') ? a + b : a + '/' + b);
  const parentPath = (p) => { const i = p.replace(/\/+$/, '').lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };

  function toast(msg, kind = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
  }

  // Dosya bırakınca tarayıcının dosyayı açmasını engelle
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // ---------- Çıktı renklendirme (Tabby tarzı) ----------
  // <<ENGINE
  // Kaçış dizilerini (renk, imleç, başlık vb.) bozmadan yalnızca düz metni boyar.
  const SEQ = /\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-2AB]|[@-Z\\-_=>78])/g;
  const SEQ_HEAD = /^\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-2AB]|[@-Z\\-_=>78])/;
  const TOKENS = new RegExp([
    '(?<url>https?:\\/\\/[^\\s\'")\\]>]+)',
    '(?<ip6>(?<![\\w:])(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}(?![\\w:]))',
    '(?<ip4>\\b(?:\\d{1,3}\\.){3}\\d{1,3}(?:\\/\\d{1,2})?(?::\\d{1,5})?\\b)',
    '(?<time>\\b\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?\\b)',
    '(?<size>\\b\\d+(?:\\.\\d+)?\\s?[KMGTP]i?B\\b)',
    '(?<pct>\\b\\d+(?:\\.\\d+)?%)',
    '(?<str>\'[^\'\\n]{1,60}\'|"[^"\\n]{1,60}")',
    '(?<err>\\b(?:errors?|failed|failure|fatal|denied|refused|critical|panic|unreachable|cannot|unable|no such file(?: or directory)?|not found|segfault)\\b)',
    '(?<warn>\\b(?:warning|warn|deprecated|timeout|timed out)\\b|\\*{3} [^*\\n]+ \\*{3})',
    '(?<ok>\\b(?:success|successful|successfully|passed|enabled|active|running|started|done|ready)\\b)',
    '(?<path>(?<![\\w:\\/.-])(?:~|\\.{1,2})?\\/[\\w.+@%~-]+(?:\\/[\\w.+@%~-]*)*)',
    '(?<num>(?<![\\w.])\\d+(?:\\.\\d+)?(?![\\w.%:\\/-]))',
  ].join('|'), 'gi');

  const paint = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
  function colorToken(m, g) {
    if (g.url) return paint('4;34', m);
    if (g.ip6 || g.ip4) return paint('1;35', m);
    if (g.time) return paint('36', m);
    if (g.size) return paint('1;33', m);
    if (g.pct) { const v = parseFloat(m); return paint(v >= 90 ? '1;31' : v >= 70 ? '33' : '32', m); }
    if (g.str) return paint('33', m);
    if (g.err) return paint('1;31', m);
    if (g.warn) return paint('1;33', m);
    if (g.ok) return paint('32', m);
    if (g.path) return paint('34', m);
    if (g.num) return paint('33', m);
    return m;
  }
  const colorTokens = (t) => t.replace(TOKENS, (...a) => colorToken(a[0], a[a.length - 1]));

  function colorLine(line, atStart) {
    if (line.length < 3) return line;
    if (atStart) {
      // kullanici@sunucu:~/yol# prompt'u
      let m = /^([\w.-]+@[\w.-]+)(:)([~\/][^\s#$%]*)?([#$%])(\s)/.exec(line);
      if (m) {
        return paint('1;32', m[1]) + m[2] + (m[3] ? paint('1;34', m[3]) : '') + m[4] + m[5] + colorTokens(line.slice(m[0].length));
      }
      if (/^Welcome to /.test(line)) return paint('1;32', line);
      // "Başlık:   değer" satırları (MOTD, ip/df çıktıları vb.)
      m = /^(\s*(?:\* )?)([A-Za-z][\w.\/()-]*(?: [A-Za-z\/][\w.\/()-]*){0,3})(:)(\s+)(?=\S)/.exec(line);
      if (m && !/^(error|warning|warn|fatal|failed)$/i.test(m[2])) {
        return m[1] + paint('1;36', m[2]) + m[3] + m[4] + colorTokens(line.slice(m[0].length));
      }
    }
    return colorTokens(line);
  }

  function colorSegment(s, str) {
    const atStart = s.atLineStart;
    if (str.length) s.atLineStart = /[\r\n]$/.test(str);
    // Zaten renkli çıktıya, tam ekran uygulamalara (nano/htop/vim) ve satır düzenlemeye dokunma
    if (!hlOn || s.sgr || s.alt || str.length > 20000 || str.includes('\x08')) return str;
    const parts = str.split(/(\r\n|\n|\r)/);
    for (let k = 0; k < parts.length; k += 2) parts[k] = colorLine(parts[k], k === 0 ? atStart : true);
    return parts.join('');
  }

  function sgrTrack(s, seq) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(seq);
    if (m) {
      const ps = m[1] === '' ? [0] : m[1].split(';').map((x) => Number(x || 0));
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (p === 38 || p === 48) { s.sgr = true; i += ps[i + 1] === 5 ? 2 : ps[i + 1] === 2 ? 4 : 0; continue; }
        if (p === 0) s.sgr = false;
        else if (![22, 23, 24, 25, 27, 28, 29, 39, 49].includes(p)) s.sgr = true;
      }
      return;
    }
    const a = /^\x1b\[\?(?:1049|1047|47)([hl])$/.exec(seq);
    if (a) s.alt = a[1] === 'h';
  }

  function highlight(s, chunk) {
    let text = s.carry + chunk;
    s.carry = '';
    const i = text.lastIndexOf('\x1b');
    if (i >= 0 && !SEQ_HEAD.test(text.slice(i)) && text.length - i < 512) {
      s.carry = text.slice(i); // yarım kalmış kaçış dizisi: sonraki parçayla birleşsin
      text = text.slice(0, i);
    }
    let out = '';
    let last = 0;
    let m;
    SEQ.lastIndex = 0;
    while ((m = SEQ.exec(text))) {
      if (m.index > last) out += colorSegment(s, text.slice(last, m.index));
      out += m[0];
      sgrTrack(s, m[0]);
      last = SEQ.lastIndex;
    }
    if (last < text.length) out += colorSegment(s, text.slice(last));
    return out;
  }
  // ENGINE>>

  const writeOut = (s, txt) => s.term.write(highlight(s, txt));

  function updateHlBtn() {
    $('#btn-hl').textContent = `🎨 Renklendirme: ${hlOn ? 'Açık' : 'Kapalı'}`;
  }
  $('#btn-hl').onclick = () => {
    hlOn = !hlOn;
    localStorage.setItem('highlight', hlOn ? 'on' : 'off');
    updateHlBtn();
  };
  updateHlBtn();

  // Sunucuda ls/grep renklerini aç: komut gizlice gönderilir, yankısı ekrana yansıtılmaz
  const colorSetupCmd = (marker) => ' ' + [
    'export COLORTERM=truecolor',
    'command -v dircolors >/dev/null 2>&1 && eval "$(dircolors -b 2>/dev/null)"',
    'ls --color=auto -d . >/dev/null 2>&1 && alias ls=\'ls --color=auto\'',
    'echo x | grep --color=auto -q x 2>/dev/null && alias grep=\'grep --color=auto\'',
    'ip -c link show lo >/dev/null 2>&1 && alias ip=\'ip -c\'',
    'printf \'%s\\n\' "' + marker.slice(0, 3) + '""' + marker.slice(3) + '"',
  ].join('; ');

  function armPromptCheck(s, txt) {
    const su = s.setup;
    su.tail = (su.tail + txt).slice(-300);
    clearTimeout(su.timer);
    su.timer = setTimeout(() => checkPrompt(s), 600);
  }
  function checkPrompt(s) {
    const su = s.setup;
    if (!su || su.state !== 'waiting' || !sessions.has(s.id)) return;
    if (!s.connected) { su.timer = setTimeout(() => checkPrompt(s), 300); return; }
    const plain = su.tail.replace(SEQ, '');
    if (/[#$%] $/.test(plain)) { startColorSetup(s); return; }
    if (Date.now() - su.t0 > 10000) { su.state = 'done'; return; }
    su.timer = setTimeout(() => checkPrompt(s), 1000);
  }
  function startColorSetup(s) {
    const su = s.setup;
    su.state = 'hiding';
    su.buf = '';
    s.term.write('\r\x1b[2K'); // eski prompt satırını sil; yenisi çıkacak
    s.atLineStart = true;
    su.timer = setTimeout(() => {
      if (su.state !== 'hiding') return;
      su.state = 'done';
      writeOut(s, su.buf); // beklenmedik bir kabuk: gizlenenleri göster
    }, 4000);
    api.write(s.id, colorSetupCmd(su.marker) + '\n');
  }

  function handleOutput(s, txt) {
    const su = s.setup;
    if (su && su.state === 'hiding') {
      su.buf += txt;
      const i = su.buf.indexOf(su.marker);
      if (i < 0) return;
      const rest = su.buf.slice(i + su.marker.length);
      const nl = rest.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(su.timer);
      su.state = 'done';
      writeOut(s, rest.slice(nl + 1));
      return;
    }
    writeOut(s, txt);
    if (su && su.state === 'waiting') armPromptCheck(s, txt);
  }

  // ---------- Tema / yazı boyutu ----------
  function applyLook() {
    document.documentElement.dataset.theme = theme;
    for (const s of sessions.values()) {
      s.term.options.theme = THEMES[theme];
      s.term.options.fontSize = fontSize;
    }
    fitActive();
  }
  $('#btn-theme').onclick = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', theme);
    applyLook();
  };
  $('#btn-font-plus').onclick = () => setFont(fontSize + 1);
  $('#btn-font-minus').onclick = () => setFont(fontSize - 1);
  function setFont(n) {
    fontSize = Math.max(10, Math.min(30, n));
    localStorage.setItem('fontSize', String(fontSize));
    applyLook();
  }

  // ---------- Diyalog yardımcıları ----------
  function askText(title, { password = false, value = '', ok = 'Tamam', hint = '' } = {}) {
    return new Promise((resolve) => {
      const dlg = $('#dlg-input');
      const input = $('#input-field');
      $('#input-title').textContent = title;
      $('#input-ok').textContent = ok;
      $('#input-hint').textContent = hint;
      $('#input-hint').hidden = !hint;
      input.type = password ? 'password' : 'text';
      input.value = value;
      dlg.returnValue = '';
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? input.value : null), { once: true });
      dlg.showModal();
      input.focus();
      input.select();
    });
  }
  function askConfirm(title, msg, ok = 'Sil') {
    return new Promise((resolve) => {
      const dlg = $('#dlg-confirm');
      $('#confirm-title').textContent = title;
      $('#confirm-msg').textContent = msg;
      $('#confirm-ok').textContent = ok;
      dlg.returnValue = '';
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
      dlg.showModal();
    });
  }

  // ---------- Profil listesi ----------
  async function loadProfiles() {
    profiles = await api.listProfiles();
    renderProfiles();
  }
  function renderProfiles() {
    const q = $('#search').value.trim().toLowerCase();
    const ul = $('#profiles');
    ul.textContent = '';
    const list = profiles.filter((p) => !q || `${p.name} ${p.host} ${p.username}`.toLowerCase().includes(q));
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty-list';
      li.textContent = profiles.length ? 'Sonuç yok' : 'Henüz bağlantı yok. “Yeni bağlantı” ile ekleyin.';
      ul.appendChild(li);
      return;
    }
    for (const p of list) {
      const li = document.createElement('li');
      const av = document.createElement('div');
      av.className = 'avatar';
      av.style.setProperty('--hue', hueOf(p.name));
      av.textContent = (p.name[0] || '?').toLocaleUpperCase('tr-TR');
      const info = document.createElement('div');
      info.className = 'info';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = p.name;
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = `${p.username}@${p.host}${p.port !== 22 ? ':' + p.port : ''}`;
      info.append(name, sub);
      const edit = document.createElement('button');
      edit.className = 'edit';
      edit.textContent = '✎';
      edit.title = 'Düzenle';
      edit.onclick = (e) => { e.stopPropagation(); openEditor(p); };
      li.append(av, info, edit);
      li.onclick = () => openProfile(p);
      ul.appendChild(li);
    }
  }
  $('#search').oninput = renderProfiles;

  // ---------- Profil düzenleyici ----------
  const dlgProfile = $('#dlg-profile');
  function syncAuthFields() {
    const key = $('#f-auth').value === 'key';
    $('#grp-key').hidden = !key;
    $('#grp-password').hidden = key;
  }
  $('#f-auth').onchange = syncAuthFields;

  function openEditor(p) {
    editingId = p ? p.id : null;
    editingHasSecret = !!(p && p.hasSecret);
    $('#profile-title').textContent = p ? 'Bağlantıyı düzenle' : 'Yeni bağlantı';
    $('#f-name').value = p ? p.name : '';
    $('#f-host').value = p ? p.host : '';
    $('#f-port').value = p ? p.port : 22;
    $('#f-user').value = p ? p.username : '';
    $('#f-auth').value = p ? p.authType : 'password';
    $('#f-key').value = p ? p.keyPath : '';
    $('#f-pass').value = '';
    $('#f-passphrase').value = '';
    $('#f-clear').checked = false;
    $('#f-color').checked = p ? p.colorSetup !== false : true;
    const ph = editingHasSecret ? '(kayıtlı — değiştirmek için yazın)' : '';
    $('#f-pass').placeholder = ph;
    $('#f-passphrase').placeholder = ph;
    $('#lbl-clear').hidden = !editingHasSecret;
    $('#btn-delete').hidden = !p;
    $('#form-error').hidden = true;
    syncAuthFields();
    dlgProfile.showModal();
    $('#f-host').focus();
  }
  $('#btn-new').onclick = () => openEditor(null);
  $('#btn-cancel').onclick = () => dlgProfile.close();
  $('#btn-browse').onclick = async () => {
    const f = await api.pickKey();
    if (f) $('#f-key').value = f;
  };
  $('#btn-delete').onclick = async () => {
    if (!editingId) return;
    if (!(await askConfirm('Bağlantıyı sil', 'Bu bağlantı ve ona ait tüneller silinsin mi?'))) return;
    await api.deleteProfile(editingId);
    dlgProfile.close();
    loadProfiles();
  };
  $('#form-profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const auth = $('#f-auth').value;
    const r = await api.saveProfile({
      id: editingId,
      name: $('#f-name').value,
      host: $('#f-host').value,
      port: $('#f-port').value,
      username: $('#f-user').value,
      authType: auth,
      keyPath: $('#f-key').value.trim(),
      secret: auth === 'key' ? $('#f-passphrase').value : $('#f-pass').value,
      clearSecret: $('#f-clear').checked,
      colorSetup: $('#f-color').checked,
    });
    if (r.error) {
      $('#form-error').textContent = r.error;
      $('#form-error').hidden = false;
      return;
    }
    dlgProfile.close();
    loadProfiles();
  });

  // ---------- Oturumlar / sekmeler ----------
  function createSession(id, p) {
    const pane = document.createElement('div');
    pane.className = 'term-pane';
    $('#terms').appendChild(pane);

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace',
      fontSize,
      lineHeight: 1.15,
      minimumContrastRatio: 4,
      cursorBlink: true,
      scrollback: 10000,
      theme: THEMES[theme],
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(pane);

    const tab = document.createElement('div');
    tab.className = 'tab connecting';
    tab.style.setProperty('--hue', hueOf(p.name));
    const dot = document.createElement('span');
    dot.className = 'dot';
    const title = document.createElement('span');
    title.textContent = p.name;
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '×';
    x.title = 'Kapat';
    tab.append(dot, title, x);
    tab.onclick = () => activate(id);
    x.onclick = (e) => { e.stopPropagation(); closeTab(id); };
    tab.onauxclick = (e) => { if (e.button === 1) closeTab(id); };
    $('#tabs').appendChild(tab);

    const s = {
      id, profile: p, term, fit, pane, tab, connected: false, cwd: undefined, entries: [],
      dec: new TextDecoder(), carry: '', sgr: false, alt: false, atLineStart: true,
      setup: p.colorSetup !== false
        ? { state: 'waiting', tail: '', buf: '', t0: Date.now(), timer: null, marker: 'NXTDN' + Math.random().toString(16).slice(2, 8) }
        : null,
    };
    sessions.set(id, s);

    term.onData((d) => { if (s.connected) api.write(id, d); });
    term.onResize(({ cols, rows }) => { if (s.connected) api.resize(id, cols, rows); });
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey) return true;
      const k = e.key.toLowerCase();
      if (e.shiftKey && k === 'c') { api.copy(term.getSelection()); return false; }
      if (e.shiftKey && k === 'v') { term.paste(api.paste()); return false; }
      if (!e.shiftKey && k === 'c' && term.hasSelection()) {
        api.copy(term.getSelection());
        term.clearSelection();
        return false;
      }
      return true;
    });
    pane.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (term.hasSelection()) { api.copy(term.getSelection()); term.clearSelection(); }
      else term.paste(api.paste());
    });

    activate(id);
    return s;
  }

  function activate(id) {
    activeId = id;
    for (const s of sessions.values()) {
      const on = s.id === id;
      s.pane.classList.toggle('active', on);
      s.tab.classList.toggle('active', on);
    }
    $('#empty').style.display = sessions.size ? 'none' : 'flex';
    renderPanel();
    requestAnimationFrame(() => {
      fitActive();
      const s = sessions.get(id);
      if (s) s.term.focus();
    });
  }

  function fitActive() {
    const s = sessions.get(activeId);
    if (!s) return;
    try { s.fit.fit(); } catch { /* gizliyken boyutlanamaz */ }
  }
  new ResizeObserver(fitActive).observe($('#terms'));

  function closeTab(id) {
    const s = sessions.get(id);
    if (!s) return;
    api.close(id);
    s.term.dispose();
    s.pane.remove();
    s.tab.remove();
    sessions.delete(id);
    if (activeId === id) {
      const next = [...sessions.keys()].pop();
      activeId = null;
      if (next) activate(next);
    }
    $('#empty').style.display = sessions.size ? 'none' : 'flex';
    renderPanel();
  }

  async function openProfile(p) {
    let secret;
    if (p.authType === 'password' && !p.hasSecret) {
      secret = await askText(`${p.username}@${p.host} parolası`, { password: true, ok: 'Bağlan' });
      if (secret === null) return;
    }
    // Yazı tipi yüklenmeden terminal açılırsa karakter ölçüleri bozulur
    try {
      await Promise.all([
        document.fonts.load(`400 ${fontSize}px "JetBrains Mono"`),
        document.fonts.load(`700 ${fontSize}px "JetBrains Mono"`),
      ]);
    } catch { /* yoksa varsayılan yazı tipi kullanılır */ }

    const id = crypto.randomUUID();
    const s = createSession(id, p);
    s.term.writeln(`\x1b[90m${p.username}@${p.host}:${p.port} bağlanılıyor…\x1b[0m`);
    const r = await api.connect({
      id,
      profileId: p.id,
      secret: secret || undefined,
      cols: s.term.cols,
      rows: s.term.rows,
    });
    if (!sessions.has(id)) return; // bağlanırken sekme kapatıldı
    s.tab.classList.remove('connecting');
    if (r.error) {
      s.tab.classList.add('dead');
      s.term.writeln(`\r\n\x1b[31m✖ ${r.error}\x1b[0m`);
      return;
    }
    s.connected = true;
    api.resize(id, s.term.cols, s.term.rows);
    s.term.focus();
    renderPanel();

    // Otomatik başlayacak tüneller
    const fresh = profiles.find((x) => x.id === p.id) || p;
    for (const rule of fresh.forwards || []) {
      if (!rule.autoStart) continue;
      const fr = await api.fwdStart(id, rule);
      if (fr.error) toast(`Tünel başlatılamadı (${rule.listenPort}): ${fr.error}`, 'error');
    }
    if (activeId === id && panelOpen && panelTab === 'tunnels') renderTunnels();
  }

  api.onData((id, data) => {
    const s = sessions.get(id);
    if (s) handleOutput(s, s.dec.decode(new Uint8Array(data), { stream: true }));
  });
  api.onClosed((id) => {
    const s = sessions.get(id);
    if (!s) return;
    s.connected = false;
    s.tab.classList.add('dead');
    s.term.writeln('\r\n\x1b[90m[Bağlantı kapandı — sekmeyi kapatabilirsiniz]\x1b[0m');
    renderPanel();
  });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Tab') {
      const ids = [...sessions.keys()];
      if (ids.length > 1) {
        const i = ids.indexOf(activeId);
        activate(ids[(i + (e.shiftKey ? ids.length - 1 : 1)) % ids.length]);
        e.preventDefault();
      }
    }
  });

  // ---------- Yan panel ----------
  function togglePanel(tab) {
    if (panelOpen && panelTab === tab) panelOpen = false;
    else { panelOpen = true; panelTab = tab; }
    renderPanel();
  }
  $('#btn-files').onclick = () => togglePanel('files');
  $('#btn-tunnels').onclick = () => togglePanel('tunnels');
  $('#btn-panel-close').onclick = () => { panelOpen = false; renderPanel(); };
  document.querySelectorAll('.seg button').forEach((b) => {
    b.onclick = () => { panelTab = b.dataset.tab; renderPanel(); };
  });

  function renderPanel() {
    $('#sidepanel').hidden = !panelOpen;
    $('#btn-files').classList.toggle('on', panelOpen && panelTab === 'files');
    $('#btn-tunnels').classList.toggle('on', panelOpen && panelTab === 'tunnels');
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.tab === panelTab));
    $('#pane-files').hidden = panelTab !== 'files';
    $('#pane-tunnels').hidden = panelTab !== 'tunnels';
    if (!panelOpen) return;

    const s = sessions.get(activeId);
    const ok = !!(s && s.connected);
    $('#files-msg').hidden = ok;
    $('#files-ui').hidden = !ok;
    $('#tun-msg').hidden = ok;
    $('#tun-ui').hidden = !ok;
    if (!ok) return;

    if (panelTab === 'files') {
      if (s.cwd === undefined) loadDir(null);
      else renderFiles();
    } else {
      renderTunnels();
      updateExplain();
    }
  }

  // ---------- SFTP dosya gezgini ----------
  async function loadDir(dir) {
    const s = sessions.get(activeId);
    if (!s || !s.connected) return;
    $('#file-list').classList.add('loading');
    const r = await api.sftpList(s.id, dir);
    $('#file-list').classList.remove('loading');
    if (r.error) {
      toast('Klasör açılamadı: ' + r.error, 'error');
      if (s.cwd === undefined) s.cwd = '';
    } else {
      s.cwd = r.data.path;
      s.entries = r.data.entries;
    }
    if (activeId === s.id && panelOpen && panelTab === 'files') renderFiles();
  }

  function fileIcon(e) {
    if (e.isDir) return '📁';
    if (e.isLink) return '🔗';
    const ext = (e.name.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
    if (['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'].includes(ext)) return '🗜️';
    if (['js', 'ts', 'py', 'sh', 'c', 'cpp', 'h', 'go', 'rs', 'java', 'php', 'rb', 'json', 'yml', 'yaml', 'html', 'css', 'conf', 'ini'].includes(ext)) return '📜';
    if (['log', 'txt', 'md', 'csv'].includes(ext)) return '📄';
    if (['mp4', 'mkv', 'avi', 'mov', 'mp3', 'wav', 'flac'].includes(ext)) return '🎞️';
    return '📄';
  }

  function renderFiles() {
    const s = sessions.get(activeId);
    if (!s) return;
    $('#f-path').value = s.cwd || '';
    const list = $('#file-list');
    list.textContent = '';
    const entries = [...(s.entries || [])].sort((a, b) =>
      (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'tr', { sensitivity: 'base' }));
    if (!entries.length) {
      const d = document.createElement('div');
      d.className = 'fempty';
      d.textContent = 'Bu klasör boş. Dosyaları buraya sürükleyip bırakabilirsiniz.';
      list.appendChild(d);
      return;
    }
    for (const e of entries) {
      const full = joinPath(s.cwd, e.name);
      const row = document.createElement('div');
      row.className = 'frow' + (e.isDir ? ' dir' : '');

      const ic = document.createElement('span');
      ic.className = 'ficon';
      ic.textContent = fileIcon(e);
      const main = document.createElement('div');
      main.className = 'fmain';
      const nm = document.createElement('div');
      nm.className = 'fname';
      nm.textContent = e.name;
      nm.title = e.name;
      const meta = document.createElement('div');
      meta.className = 'fmeta';
      meta.textContent = [e.isDir ? 'Klasör' : fmtSize(e.size), fmtDate(e.mtime)].filter(Boolean).join(' · ');
      main.append(nm, meta);

      const act = document.createElement('div');
      act.className = 'fact';
      const mk = (txt, title, cls, fn) => {
        const b = document.createElement('button');
        b.textContent = txt;
        b.title = title;
        if (cls) b.className = cls;
        b.onclick = (ev) => { ev.stopPropagation(); fn(); };
        return b;
      };
      act.append(
        mk('⬇', 'İndir', '', () => downloadEntry(s, full, e)),
        mk('✎', 'Yeniden adlandır', '', () => renameEntry(s, full, e)),
        mk('🗑', 'Sil', 'del', () => deleteEntry(s, full, e)),
      );

      row.append(ic, main, act);
      if (e.isDir) {
        row.onclick = () => loadDir(full);
        // Klasör satırına bırakılan dosyalar o klasöre yüklenir
        row.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.stopPropagation(); row.classList.add('drop'); });
        row.addEventListener('dragleave', () => row.classList.remove('drop'));
        row.addEventListener('drop', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          row.classList.remove('drop');
          list.classList.remove('drag');
          uploadDropped(ev.dataTransfer.files, full);
        });
      }
      list.appendChild(row);
    }
  }

  const fileList = $('#file-list');
  fileList.addEventListener('dragover', (e) => { e.preventDefault(); fileList.classList.add('drag'); });
  fileList.addEventListener('dragleave', (e) => { if (e.target === fileList) fileList.classList.remove('drag'); });
  fileList.addEventListener('drop', (e) => {
    e.preventDefault();
    fileList.classList.remove('drag');
    const s = sessions.get(activeId);
    if (s && s.cwd) uploadDropped(e.dataTransfer.files, s.cwd);
  });

  async function uploadDropped(fileListLike, remoteDir) {
    const paths = [...fileListLike].map((f) => api.pathForFile(f)).filter(Boolean);
    if (!paths.length) { toast('Dosya yolu okunamadı.', 'error'); return; }
    await uploadPaths(paths, remoteDir);
  }
  async function uploadPaths(paths, remoteDir) {
    const s = sessions.get(activeId);
    if (!s) return;
    const r = await api.sftpUpload(s.id, remoteDir, paths);
    if (r.error) toast('Yükleme hatası: ' + r.error, 'error');
    else toast(`${r.data.count} dosya yüklendi.`, 'ok');
    if (sessions.get(activeId) === s && s.cwd === remoteDir) loadDir(s.cwd);
    else if (sessions.get(activeId) === s) loadDir(s.cwd);
  }

  async function downloadEntry(s, full, e) {
    const r = await api.sftpDownload(s.id, full, e.isDir);
    if (r.error) toast('İndirme hatası: ' + r.error, 'error');
    else if (!r.data.canceled) toast(`“${e.name}” indirildi.`, 'ok');
  }
  async function renameEntry(s, full, e) {
    const name = await askText('Yeni ad', { value: e.name, ok: 'Yeniden adlandır' });
    if (!name || name === e.name) return;
    if (name.includes('/')) { toast('Ad “/” içeremez.', 'error'); return; }
    const r = await api.sftpRename(s.id, full, joinPath(s.cwd, name));
    if (r.error) toast('Yeniden adlandırılamadı: ' + r.error, 'error');
    loadDir(s.cwd);
  }
  async function deleteEntry(s, full, e) {
    const msg = e.isDir ? `“${e.name}” klasörü içindekilerle birlikte silinecek. Bu işlem geri alınamaz.` : `“${e.name}” silinecek. Bu işlem geri alınamaz.`;
    if (!(await askConfirm('Silinsin mi?', msg))) return;
    const r = await api.sftpDelete(s.id, full);
    if (r.error) toast('Silinemedi: ' + r.error, 'error');
    loadDir(s.cwd);
  }

  $('#f-up').onclick = () => { const s = sessions.get(activeId); if (s && s.cwd) loadDir(parentPath(s.cwd)); };
  $('#f-refresh').onclick = () => { const s = sessions.get(activeId); if (s) loadDir(s.cwd || null); };
  $('#f-mkdir').onclick = async () => {
    const s = sessions.get(activeId);
    if (!s || !s.cwd) return;
    const name = await askText('Yeni klasör', { ok: 'Oluştur' });
    if (!name) return;
    if (name.includes('/')) { toast('Ad “/” içeremez.', 'error'); return; }
    const r = await api.sftpMkdir(s.id, joinPath(s.cwd, name));
    if (r.error) toast('Klasör oluşturulamadı: ' + r.error, 'error');
    loadDir(s.cwd);
  };
  $('#f-upload').onclick = () => $('#f-picker').click();
  $('#f-picker').onchange = (e) => {
    const s = sessions.get(activeId);
    const files = [...e.target.files];
    e.target.value = '';
    if (s && s.cwd) uploadDropped(files, s.cwd);
  };
  $('#f-path').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadDir($('#f-path').value.trim() || null);
  });

  api.onProgress((id, info) => {
    if (id !== activeId) return;
    const box = $('#progress');
    if (!info) { box.hidden = true; return; }
    box.hidden = false;
    const pct = info.total ? Math.min(100, Math.round((info.done / info.total) * 100)) : 0;
    $('#progress-fill').style.width = pct + '%';
    $('#progress-text').textContent = `${info.name} — %${pct}`;
  });

  // ---------- Tüneller ----------
  function describeRule(r) {
    return r.type === 'remote'
      ? { head: `Sunucu:${r.listenPort}`, tail: `Bu bilgisayar → ${r.targetHost}:${r.targetPort}`, sub: 'Sunucudaki port bu bilgisayardaki servise açılır' }
      : { head: `localhost:${r.listenPort}`, tail: `Sunucu → ${r.targetHost}:${r.targetPort}`, sub: 'Bu bilgisayardaki port sunucu üzerinden hedefe gider' };
  }

  async function renderTunnels() {
    const s = sessions.get(activeId);
    if (!s || !s.connected) return;
    const prof = profiles.find((p) => p.id === s.profile.id) || s.profile;
    const rules = prof.forwards || [];
    const st = await api.fwdStatus(s.id);
    if (activeId !== s.id) return;
    const active = new Set(st.data || []);
    const box = $('#tun-list');
    box.textContent = '';
    if (!rules.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Bu bağlantı için henüz tünel yok. Aşağıdan ekleyebilirsiniz.';
      box.appendChild(p);
      return;
    }
    for (const r of rules) {
      const d = describeRule(r);
      const card = document.createElement('div');
      card.className = 'card tun';
      const main = document.createElement('div');
      main.className = 'tmain';
      const badge = document.createElement('span');
      badge.className = 'badge' + (r.type === 'remote' ? ' remote' : '');
      badge.textContent = r.type === 'remote' ? 'UZAK' : 'YEREL';
      const txt = document.createElement('div');
      txt.className = 'ttext';
      txt.textContent = `${d.head}  →  ${d.tail}`;
      const sub = document.createElement('div');
      sub.className = 'tsub';
      sub.textContent = d.sub + (r.autoStart ? ' · otomatik başlar' : '');
      main.append(badge, txt, sub);

      const sw = document.createElement('label');
      sw.className = 'switch';
      sw.title = active.has(r.id) ? 'Çalışıyor — durdurmak için tıklayın' : 'Durdu — başlatmak için tıklayın';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = active.has(r.id);
      cb.onchange = async () => {
        const res = cb.checked ? await api.fwdStart(s.id, r) : await api.fwdStop(s.id, r.id);
        if (res.error) toast(res.error, 'error');
        renderTunnels();
      };
      sw.appendChild(cb);

      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.textContent = '🗑';
      del.title = 'Tüneli sil';
      del.onclick = async () => {
        await api.fwdStop(s.id, r.id);
        await api.saveForwards(prof.id, rules.filter((x) => x.id !== r.id));
        await loadProfiles();
        renderTunnels();
      };
      card.append(main, sw, del);
      box.appendChild(card);
    }
  }

  function updateExplain() {
    const type = $('#t-type').value;
    const lp = $('#t-listen').value || 'X';
    const tp = $('#t-port').value || 'Y';
    const host = $('#t-host').value || '127.0.0.1';
    $('#t-explain').textContent = type === 'remote'
      ? `Sunucuda ${lp} portu açılır; oraya gelen trafik bu bilgisayardaki ${host}:${tp} adresine iletilir.`
      : `Bu bilgisayarda localhost:${lp} açılır; trafik sunucu üzerinden ${host}:${tp} adresine gider. (Hedef adres sunucudan erişilebilir olmalı.)`;
  }
  ['#t-type', '#t-listen', '#t-port', '#t-host'].forEach((sel) => $(sel).addEventListener('input', updateExplain));

  $('#tun-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = sessions.get(activeId);
    if (!s || !s.connected) return;
    const rule = {
      id: crypto.randomUUID(),
      type: $('#t-type').value,
      listenPort: Number($('#t-listen').value),
      targetHost: $('#t-host').value.trim(),
      targetPort: Number($('#t-port').value),
      autoStart: $('#t-auto').checked,
    };
    const prof = profiles.find((p) => p.id === s.profile.id) || s.profile;
    const res = await api.fwdStart(s.id, rule);
    if (res.error) { toast('Tünel başlatılamadı: ' + res.error, 'error'); return; }
    await api.saveForwards(prof.id, [...(prof.forwards || []), rule]);
    await loadProfiles();
    $('#t-listen').value = '';
    $('#t-port').value = '';
    $('#t-auto').checked = false;
    updateExplain();
    toast('Tünel başlatıldı.', 'ok');
    renderTunnels();
  });

  applyLook();
  loadProfiles();
})();
