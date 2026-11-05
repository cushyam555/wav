const {app, BrowserWindow, session, desktopCapturer, ipcMain, dialog, powerSaveBlocker} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const {pathToFileURL} = require('node:url');
const localPage = pathToFileURL(path.join(__dirname, 'index.html')).href;
const folders = new Map(), blockers = new Map();
function trusted(event) {
  if(event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== localPage) throw Error('Unauthorized frame');
}
ipcMain.handle('recording:folder', async event => {
  trusted(event);
  const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'เลือกโฟลเดอร์บันทึก WAV จาก Kontakt',properties:['openDirectory','createDirectory']});
  if(result.canceled) return null;
  const folder=await fs.mkdtemp(path.join(result.filePaths[0],`Kontakt-${new Date().toISOString().replace(/[:.]/g,'-')}-`));
  folders.set(event.sender.id,folder);return folder;
});
ipcMain.handle('recording:save', async (event,name,bytes) => {
  trusted(event);const folder=folders.get(event.sender.id);
  if(!folder || typeof name!=='string' || !/^[A-Za-z0-9_-]+\.wav$/.test(name) || !(bytes instanceof Uint8Array) || bytes.length<44 || bytes.length>128*1024*1024) throw Error('Invalid recording');
  const file=path.join(folder,name);await fs.writeFile(file,bytes,{flag:'wx'});return file;
});
ipcMain.handle('recording:manifest', async (event,data) => {
  trusted(event);const folder=folders.get(event.sender.id);
  if(!folder || typeof data!=='string' || data.length>4*1024*1024) throw Error('Invalid manifest');
  JSON.parse(data);await fs.writeFile(path.join(folder,'manifest.json'),data);
});
ipcMain.handle('recording:active', (event,active) => {
  trusted(event);const id=event.sender.id;
  if(active===true && !blockers.has(id)) blockers.set(id,powerSaveBlocker.start('prevent-display-sleep'));
  if(active!==true && blockers.has(id)) {powerSaveBlocker.stop(blockers.get(id));blockers.delete(id);}
});

app.whenReady().then(() => {
  // The converter is fully local. Do not allow remote resources or navigation.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({cancel: !details.url.startsWith('file:') && !details.url.startsWith('blob:') && !details.url.startsWith('devtools:')});
  });
  const allowed=(contents,permission)=>contents?.getURL()===localPage && ['midi','media','display-capture'].includes(permission);
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback) => callback(allowed(contents,permission)));
  session.defaultSession.setPermissionCheckHandler((contents,permission)=>allowed(contents,permission));
  session.defaultSession.setDisplayMediaRequestHandler(async (request,callback) => {
    if(process.platform!=='win32' || request.frame?.url!==localPage || !request.audioRequested) {callback(null);return;}
    try {const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});callback(sources.length?{video:sources[0],audio:'loopback'}:null);}
    catch {callback(null);}
  });
  function openWindow() {
    const win = new BrowserWindow({
      width: 1080, height: 820, minWidth: 540, minHeight: 600,
      backgroundColor: '#101724', autoHideMenuBar: true,
      webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, preload:path.join(__dirname,'preload.cjs'),backgroundThrottling:false}
    });
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    const id=win.webContents.id;
    win.webContents.on('destroyed',()=>{folders.delete(id);if(blockers.has(id)){powerSaveBlocker.stop(blockers.get(id));blockers.delete(id);}});
    win.loadFile(path.join(__dirname, 'index.html'));
  }
  openWindow();
  app.on('activate', () => {if (!BrowserWindow.getAllWindows().length) openWindow();});
});
app.on('window-all-closed', () => {if (process.platform !== 'darwin') app.quit();});
