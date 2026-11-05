const {app, BrowserWindow, session} = require('electron');
const path = require('node:path');

app.whenReady().then(() => {
  // The converter is fully local. Do not allow remote resources or navigation.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({cancel: !details.url.startsWith('file:') && !details.url.startsWith('blob:') && !details.url.startsWith('devtools:')});
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  function openWindow() {
    const win = new BrowserWindow({
      width: 1080, height: 820, minWidth: 540, minHeight: 600,
      backgroundColor: '#101724', autoHideMenuBar: true,
      webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true}
    });
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.loadFile(path.join(__dirname, 'index.html'));
  }
  openWindow();
  app.on('activate', () => {if (!BrowserWindow.getAllWindows().length) openWindow();});
});
app.on('window-all-closed', () => {if (process.platform !== 'darwin') app.quit();});
