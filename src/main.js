const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'FactoryIO Simülatör',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#0f1117'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  const menu = Menu.buildFromTemplate([
    {
      label: 'Dosya',
      submenu: [
        {
          label: 'Sahneyi Kaydet',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu-save')
        },
        {
          label: 'Sahneyi Aç',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog({ filters: [{ name: 'JSON', extensions: ['json'] }] });
            if (!result.canceled) {
              const data = fs.readFileSync(result.filePaths[0], 'utf8');
              mainWindow.webContents.send('menu-load', JSON.parse(data));
            }
          }
        },
        { type: 'separator' },
        { label: 'Çıkış', role: 'quit' }
      ]
    },
    {
      label: 'Görünüm',
      submenu: [
        { label: 'Geliştirici Araçları', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
        { label: 'Tam Ekran', role: 'togglefullscreen' },
        { label: 'Yakınlaştır', role: 'zoomIn' },
        { label: 'Uzaklaştır', role: 'zoomOut' }
      ]
    },
    {
      label: 'Simülasyon',
      submenu: [
        { label: 'Başlat / Durdur', accelerator: 'Space', click: () => mainWindow.webContents.send('menu-toggle') },
        { label: 'Sıfırla', accelerator: 'CmdOrCtrl+R', click: () => mainWindow.webContents.send('menu-reset') }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

ipcMain.on('save-scene', async (event, data) => {
  const result = await dialog.showSaveDialog({ filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath: 'sahne.json' });
  if (!result.canceled) {
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    event.reply('save-done');
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
