/* Electron main process (see requirements §68). */
const path = require('node:path');

const { app, BrowserWindow, shell, Menu, ipcMain, session } = require('electron');

const APP_NAME = 'Achakan';
const isDev = !app.isPackaged;
const startUrl =
  process.env.ELECTRON_START_URL ||
  `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    backgroundColor: '#FFFFFF',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(startUrl);

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setName(APP_NAME);
    Menu.setApplicationMenu(null);

    // Auto-grant camera / microphone for barcode scanning so users aren't
    // prompted inside the Electron shell (we bundle our own UI for it).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      if (permission === 'media' || permission === 'camera' || permission === 'microphone') {
        cb(true);
        return;
      }
      cb(false);
    });
    if (typeof session.defaultSession.setPermissionCheckHandler === 'function') {
      session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
        return permission === 'media' || permission === 'camera' || permission === 'microphone';
      });
    }

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:get-platform', () => process.platform);
