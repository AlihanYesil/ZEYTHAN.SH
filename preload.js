const { contextBridge, ipcRenderer, clipboard, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Profiller
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfile: (p) => ipcRenderer.invoke('profiles:save', p),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  saveForwards: (profileId, rules) => ipcRenderer.invoke('profiles:saveForwards', profileId, rules),
  pickKey: () => ipcRenderer.invoke('dialog:pickKey'),

  // SSH
  connect: (opts) => ipcRenderer.invoke('ssh:connect', opts),
  write: (id, data) => ipcRenderer.send('ssh:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('ssh:resize', id, cols, rows),
  close: (id) => ipcRenderer.send('ssh:close', id),
  onData: (cb) => ipcRenderer.on('ssh:data', (_e, id, data) => cb(id, data)),
  onClosed: (cb) => ipcRenderer.on('ssh:closed', (_e, id) => cb(id)),

  // SFTP
  sftpList: (id, dir) => ipcRenderer.invoke('sftp:list', id, dir),
  sftpUpload: (id, dir, paths) => ipcRenderer.invoke('sftp:upload', id, dir, paths),
  sftpDownload: (id, remote, isDir) => ipcRenderer.invoke('sftp:download', id, remote, isDir),
  sftpMkdir: (id, dir) => ipcRenderer.invoke('sftp:mkdir', id, dir),
  sftpRename: (id, from, to) => ipcRenderer.invoke('sftp:rename', id, from, to),
  sftpDelete: (id, target) => ipcRenderer.invoke('sftp:delete', id, target),
  onProgress: (cb) => ipcRenderer.on('sftp:progress', (_e, id, info) => cb(id, info)),
  // Sürüklenen/seçilen dosyanın gerçek yolu
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },

  // Tüneller
  fwdStart: (id, rule) => ipcRenderer.invoke('fwd:start', id, rule),
  fwdStop: (id, ruleId) => ipcRenderer.invoke('fwd:stop', id, ruleId),
  fwdStatus: (id) => ipcRenderer.invoke('fwd:status', id),

  // Pano
  copy: (text) => clipboard.writeText(text),
  paste: () => clipboard.readText(),
});
