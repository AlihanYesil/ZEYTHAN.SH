const { app, BrowserWindow, ipcMain, dialog, safeStorage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { Client } = require('ssh2');

let win;
// id -> { conn, stream, forwards: Map, remoteMap: Map, sftpP }
const sessions = new Map();

const dataFile = (name) => path.join(app.getPath('userData'), name);
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); } catch { return fallback; }
}
function writeJson(name, value) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(dataFile(name), JSON.stringify(value, null, 2), { mode: 0o600 });
}
function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}
const pify = (fn) => new Promise((res, rej) => fn((e, v) => (e ? rej(e) : res(v))));
// IPC cevaplarını { data } veya { error } biçimine sokar
async function wrap(fn) {
  try { return { data: await fn() }; } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
}
// Sunucudan gelen dosya adlarına güvenme: yol atlatma (../) engeli
const unsafeName = (n) => !n || n === '.' || n === '..' || n.includes('/') || n.includes('\\');

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 860,
    minHeight: 500,
    backgroundColor: '#0b0d1a',
    title: 'Nexterm',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile('index.html');
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// ---------- Profiller ----------
const publicProfile = (p) => {
  const { secret, ...rest } = p;
  return { ...rest, forwards: rest.forwards || [], hasSecret: !!secret };
};

ipcMain.handle('profiles:list', () => readJson('profiles.json', []).map(publicProfile));

ipcMain.handle('profiles:save', (_e, p) => {
  const list = readJson('profiles.json', []);
  const old = list.find((x) => x.id === p.id);
  const host = String(p.host || '').trim();
  const username = String(p.username || '').trim();
  if (!host || !username) return { error: 'Sunucu ve kullanıcı adı zorunlu.' };

  const rec = {
    id: old ? old.id : crypto.randomUUID(),
    name: String(p.name || '').trim() || host,
    host,
    port: Number(p.port) || 22,
    username,
    authType: p.authType === 'key' ? 'key' : 'password',
    keyPath: p.keyPath || '',
    colorSetup: p.colorSetup !== false,
    secret: old ? old.secret : undefined,
    forwards: old ? old.forwards || [] : [],
  };
  if (p.clearSecret) rec.secret = undefined;
  if (p.secret) {
    if (!safeStorage.isEncryptionAvailable()) {
      return { error: 'Bu sistemde güvenli parola deposu yok; parola kaydedilemedi. Boş bırakıp her bağlantıda girebilirsiniz.' };
    }
    rec.secret = safeStorage.encryptString(p.secret).toString('base64');
  }
  const idx = list.findIndex((x) => x.id === rec.id);
  if (idx >= 0) list[idx] = rec; else list.push(rec);
  writeJson('profiles.json', list);
  return { ok: true };
});

ipcMain.handle('profiles:delete', (_e, id) => {
  writeJson('profiles.json', readJson('profiles.json', []).filter((x) => x.id !== id));
  return { ok: true };
});

const validPort = (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 65535;
ipcMain.handle('profiles:saveForwards', (_e, profileId, rules) => {
  const list = readJson('profiles.json', []);
  const p = list.find((x) => x.id === profileId);
  if (!p) return { error: 'Profil bulunamadı.' };
  p.forwards = (Array.isArray(rules) ? rules : [])
    .filter((r) => r && validPort(r.listenPort) && validPort(r.targetPort) && String(r.targetHost || '').trim())
    .map((r) => ({
      id: String(r.id || crypto.randomUUID()),
      type: r.type === 'remote' ? 'remote' : 'local',
      listenPort: Number(r.listenPort),
      targetHost: String(r.targetHost).trim().slice(0, 255),
      targetPort: Number(r.targetPort),
      autoStart: !!r.autoStart,
    }));
  writeJson('profiles.json', list);
  return { ok: true };
});

ipcMain.handle('dialog:pickKey', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Özel anahtar dosyası seç',
    defaultPath: path.join(os.homedir(), '.ssh'),
    properties: ['openFile', 'showHiddenFiles'],
  });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- Sunucu parmak izi doğrulama (TOFU) ----------
async function verifyHost(p, hexHash) {
  const fp = 'SHA256:' + Buffer.from(hexHash, 'hex').toString('base64').replace(/=+$/, '');
  const known = readJson('known_hosts.json', {});
  const key = `${p.host}:${p.port}`;
  if (known[key] === fp) return true;
  if (known[key]) {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: 'Güvenlik uyarısı',
      message: `${key} için sunucu parmak izi DEĞİŞMİŞ!`,
      detail: `Kayıtlı:\n${known[key]}\n\nGelen:\n${fp}\n\nBu, ortadaki adam saldırısı olabilir ya da sunucu yeniden kurulmuş olabilir. Bağlantı kesildi.`,
      buttons: ['Tamam'],
    });
    return false;
  }
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Yeni sunucu',
    message: `${key} adresine ilk kez bağlanıyorsunuz`,
    detail: `Parmak izi:\n${fp}\n\nBeklediğiniz sunucuya aitse devam edin.`,
    buttons: ['Güven ve bağlan', 'İptal'],
    defaultId: 1,
    cancelId: 1,
  });
  if (r.response !== 0) return false;
  known[key] = fp;
  writeJson('known_hosts.json', known);
  return true;
}

// ---------- Oturum yönetimi ----------
function cleanup(id) {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);
  for (const f of s.forwards.values()) {
    try { f.close(); } catch { /* yok say */ }
  }
  s.forwards.clear();
  s.remoteMap.clear();
  return true;
}

// ---------- SSH ----------
ipcMain.handle('ssh:connect', (_e, { id, profileId, secret, cols, rows }) => {
  const p = readJson('profiles.json', []).find((x) => x.id === profileId);
  if (!p) return { error: 'Profil bulunamadı.' };

  let pass = secret;
  if (!pass && p.secret) {
    try { pass = safeStorage.decryptString(Buffer.from(p.secret, 'base64')); } catch { /* yok say */ }
  }

  const cfg = {
    host: p.host,
    port: p.port,
    username: p.username,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    hostHash: 'sha256',
    hostVerifier: (hash, cb) => { verifyHost(p, hash).then(cb, () => cb(false)); },
  };
  if (p.authType === 'key') {
    try { cfg.privateKey = fs.readFileSync(p.keyPath); }
    catch (e) { return { error: 'Anahtar dosyası okunamadı: ' + e.message }; }
    if (pass) cfg.passphrase = pass;
  } else {
    cfg.password = pass;
    cfg.tryKeyboard = true;
  }

  return new Promise((resolve) => {
    const conn = new Client();
    let done = false;
    const fail = (msg) => { if (!done) { done = true; resolve({ error: msg }); } };

    conn.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => pass || '')));

    // Uzak tünel (-R): sunucuya gelen bağlantıyı bu bilgisayardaki hedefe aktar
    conn.on('tcp connection', (info, accept, reject) => {
      const sess = sessions.get(id);
      const rule = sess && sess.remoteMap.get(info.destPort);
      if (!rule) return reject();
      const ch = accept();
      const sock = net.connect(Number(rule.targetPort), rule.targetHost);
      sock.on('error', () => ch.destroy());
      ch.on('error', () => sock.destroy());
      ch.on('close', () => sock.destroy());
      sock.on('close', () => ch.destroy());
      ch.pipe(sock).pipe(ch);
    });

    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols: cols || 80, rows: rows || 24 }, (err, stream) => {
        if (err) { conn.end(); return fail(err.message); }
        done = true;
        sessions.set(id, { conn, stream, forwards: new Map(), remoteMap: new Map(), sftpP: null });
        stream.on('data', (d) => send('ssh:data', id, d));
        stream.stderr.on('data', (d) => send('ssh:data', id, d));
        stream.on('close', () => conn.end());
        resolve({ ok: true });
      });
    });
    conn.on('error', (e) => {
      fail(e.level === 'client-authentication' ? 'Kimlik doğrulama başarısız (kullanıcı/parola/anahtar).' : e.message);
    });
    conn.on('close', () => {
      fail('Bağlantı kapandı veya reddedildi.');
      if (cleanup(id)) send('ssh:closed', id);
    });
    try { conn.connect(cfg); } catch (e) { fail(e.message); }
  });
});

ipcMain.on('ssh:write', (_e, id, data) => {
  const s = sessions.get(id);
  if (s) s.stream.write(data);
});
ipcMain.on('ssh:resize', (_e, id, cols, rows) => {
  const s = sessions.get(id);
  if (s && cols > 0 && rows > 0) s.stream.setWindow(rows, cols, 0, 0);
});
ipcMain.on('ssh:close', (_e, id) => {
  const s = sessions.get(id);
  if (s) { cleanup(id); s.conn.end(); }
});

// ---------- SFTP ----------
function getSftp(id) {
  const s = sessions.get(id);
  if (!s) return Promise.reject(new Error('Oturum açık değil.'));
  if (!s.sftpP) {
    s.sftpP = new Promise((res, rej) => s.conn.sftp((e, sf) => (e ? rej(e) : res(sf))));
    s.sftpP.catch(() => { s.sftpP = null; });
  }
  return s.sftpP;
}

ipcMain.handle('sftp:list', (_e, id, dir) => wrap(async () => {
  const sf = await getSftp(id);
  const abs = await pify((cb) => sf.realpath(dir || '.', cb));
  const list = await pify((cb) => sf.readdir(abs, cb));
  const entries = await Promise.all(list
    .filter((i) => !unsafeName(i.filename))
    .map(async (i) => {
      let isDir = i.attrs.isDirectory();
      const isLink = i.attrs.isSymbolicLink();
      if (isLink) {
        try { isDir = (await pify((cb) => sf.stat(path.posix.join(abs, i.filename), cb))).isDirectory(); } catch { /* kırık link */ }
      }
      return { name: i.filename, isDir, isLink, size: i.attrs.size, mtime: (i.attrs.mtime || 0) * 1000 };
    }));
  return { path: abs, entries };
}));

ipcMain.handle('sftp:upload', (_e, id, remoteDir, localPaths) => wrap(async () => {
  const sf = await getSftp(id);
  let count = 0;
  const putFile = async (local, remote) => {
    const name = path.basename(local);
    send('sftp:progress', id, { name, done: 0, total: 1 });
    await pify((cb) => sf.fastPut(local, remote, {
      step: (done, _chunk, total) => send('sftp:progress', id, { name, done, total }),
    }, cb));
    count++;
  };
  const putPath = async (local, remoteBase) => {
    const st = fs.statSync(local);
    const remote = path.posix.join(remoteBase, path.basename(local));
    if (st.isDirectory()) {
      try { await pify((cb) => sf.mkdir(remote, cb)); } catch { /* zaten var */ }
      for (const n of fs.readdirSync(local)) await putPath(path.join(local, n), remote);
    } else if (st.isFile()) {
      await putFile(local, remote);
    }
  };
  try {
    for (const l of localPaths || []) await putPath(String(l), remoteDir);
  } finally {
    send('sftp:progress', id, null);
  }
  return { count };
}));

ipcMain.handle('sftp:download', (_e, id, remotePath, isDir) => wrap(async () => {
  const sf = await getSftp(id);
  const name = path.posix.basename(remotePath);
  const getFile = (remote, local) => pify((cb) => sf.fastGet(remote, local, {
    step: (done, _c, total) => send('sftp:progress', id, { name: path.posix.basename(remote), done, total }),
  }, cb));
  const getDir = async (remote, local) => {
    fs.mkdirSync(local, { recursive: true });
    const list = await pify((cb) => sf.readdir(remote, cb));
    for (const i of list) {
      if (unsafeName(i.filename)) continue;
      const r = path.posix.join(remote, i.filename);
      const l = path.join(local, i.filename);
      if (i.attrs.isDirectory()) await getDir(r, l);
      else if (i.attrs.isFile()) await getFile(r, l);
    }
  };
  try {
    if (isDir) {
      const r = await dialog.showOpenDialog(win, { title: 'Klasörün indirileceği yer', properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled) return { canceled: true };
      await getDir(remotePath, path.join(r.filePaths[0], name));
    } else {
      const r = await dialog.showSaveDialog(win, { title: 'Dosyayı kaydet', defaultPath: path.join(app.getPath('downloads'), name) });
      if (r.canceled) return { canceled: true };
      await getFile(remotePath, r.filePath);
    }
  } finally {
    send('sftp:progress', id, null);
  }
  return { canceled: false };
}));

ipcMain.handle('sftp:mkdir', (_e, id, dir) => wrap(async () => {
  const sf = await getSftp(id);
  await pify((cb) => sf.mkdir(dir, cb));
}));

ipcMain.handle('sftp:rename', (_e, id, from, to) => wrap(async () => {
  const sf = await getSftp(id);
  await pify((cb) => sf.rename(from, to, cb));
}));

ipcMain.handle('sftp:delete', (_e, id, target) => wrap(async () => {
  const sf = await getSftp(id);
  const rm = async (remote) => {
    const st = await pify((cb) => sf.lstat(remote, cb));
    if (st.isDirectory()) {
      const list = await pify((cb) => sf.readdir(remote, cb));
      for (const i of list) {
        if (!unsafeName(i.filename)) await rm(path.posix.join(remote, i.filename));
      }
      await pify((cb) => sf.rmdir(remote, cb));
    } else {
      await pify((cb) => sf.unlink(remote, cb));
    }
  };
  await rm(target);
}));

// ---------- Port yönlendirme (tüneller) ----------
ipcMain.handle('fwd:start', (_e, id, rule) => wrap(async () => {
  const s = sessions.get(id);
  if (!s) throw new Error('Oturum açık değil.');
  if (s.forwards.has(rule.id)) return null;
  if (!validPort(rule.listenPort) || !validPort(rule.targetPort)) throw new Error('Port numarası 1-65535 arasında olmalı.');
  const targetHost = String(rule.targetHost || '').trim();
  if (!targetHost) throw new Error('Hedef adres boş olamaz.');
  const lp = Number(rule.listenPort);
  const tp = Number(rule.targetPort);

  if (rule.type === 'remote') {
    // Sunucuda lp portunu aç, gelen trafiği bu bilgisayardaki targetHost:tp'ye ilet
    await pify((cb) => s.conn.forwardIn('127.0.0.1', lp, (e) => cb(e)));
    s.remoteMap.set(lp, { targetHost, targetPort: tp });
    s.forwards.set(rule.id, {
      close: () => new Promise((res) => {
        s.remoteMap.delete(lp);
        try { s.conn.unforwardIn('127.0.0.1', lp, () => res()); } catch { res(); }
      }),
    });
  } else {
    // Bu bilgisayarda lp portunu aç, trafiği sunucu üzerinden targetHost:tp'ye ilet
    const socks = new Set();
    const server = net.createServer((sock) => {
      socks.add(sock);
      sock.on('close', () => socks.delete(sock));
      sock.on('error', () => {});
      s.conn.forwardOut('127.0.0.1', 0, targetHost, tp, (err, ch) => {
        if (err) { sock.destroy(); return; }
        ch.on('error', () => sock.destroy());
        ch.on('close', () => sock.destroy());
        sock.on('close', () => ch.destroy());
        sock.pipe(ch).pipe(sock);
      });
    });
    await new Promise((res, rej) => {
      server.once('error', (e) => rej(new Error(e.code === 'EADDRINUSE' ? `${lp} portu zaten kullanımda.` : e.message)));
      server.listen(lp, '127.0.0.1', res);
    });
    server.on('error', () => {});
    s.forwards.set(rule.id, {
      close: () => { server.close(); for (const k of socks) k.destroy(); },
    });
  }
  return null;
}));

ipcMain.handle('fwd:stop', (_e, id, ruleId) => wrap(async () => {
  const s = sessions.get(id);
  const f = s && s.forwards.get(ruleId);
  if (!f) return null;
  s.forwards.delete(ruleId);
  await f.close();
  return null;
}));

ipcMain.handle('fwd:status', (_e, id) => wrap(async () => {
  const s = sessions.get(id);
  return s ? [...s.forwards.keys()] : [];
}));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => {
  for (const id of [...sessions.keys()]) {
    const s = sessions.get(id);
    cleanup(id);
    s.conn.end();
  }
  app.quit();
});
