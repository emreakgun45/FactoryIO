const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let opcuaServer = null;

function startOpcUaServer() {
  try {
    const { FactoryIOOpcUaServer } = require('./opcua-server');
    opcuaServer = new FactoryIOOpcUaServer(4840);
    opcuaServer.onTagWrite = (tag, val) => {
      if (mainWindow) mainWindow.webContents.send('opcua-tag-write', { tag, val });
    };
    opcuaServer.start().then(() => {
      console.log('[OPC UA] Server hazır: opc.tcp://localhost:4840');
      if (mainWindow) mainWindow.webContents.send('opcua-ready', true);
    }).catch(e => {
      console.warn('[OPC UA] Başlatılamadı:', e.message);
      if (mainWindow) mainWindow.webContents.send('opcua-ready', false);
    });
  } catch(e) {
    console.warn('[OPC UA] node-opcua bulunamadı:', e.message);
  }
}

// IPC: Simülatörden tag güncelle
ipcMain.on('opcua-update-tag', (event, { tag, val }) => {
  if (opcuaServer) opcuaServer.updateTag(tag, val);
});

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
        { label: 'Sahneyi Kaydet', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu-save') },
        {
          label: 'Sahneyi Aç', accelerator: 'CmdOrCtrl+O',
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
    },
    {
      label: 'OPC UA',
      submenu: [
        { label: 'Server Durumu', click: () => {
          const status = opcuaServer ? 'Çalışıyor: opc.tcp://localhost:4840' : 'Çalışmıyor';
          dialog.showMessageBox({ title: 'OPC UA Server', message: status });
        }},
        { label: 'Yeniden Başlat', click: () => {
          if (opcuaServer) opcuaServer.stop().then(() => startOpcUaServer());
        }}
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

app.whenReady().then(() => {
  createWindow();
  startOpcUaServer();
});

app.on('window-all-closed', async () => {
  if (opcuaServer) await opcuaServer.stop();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// Ladder kaydet/yükle
const { ipcMain: ipc2 } = require('electron');
ipcMain.on('save-ladder', async (event, json) => {
  const result = await dialog.showSaveDialog({ filters: [{ name: 'Ladder', extensions: ['ladder.json'] }], defaultPath: 'ladder.json' });
  if (!result.canceled) { fs.writeFileSync(result.filePath, json); event.reply('ladder-saved'); }
});
ipcMain.on('load-ladder', async (event) => {
  const result = await dialog.showOpenDialog({ filters: [{ name: 'Ladder', extensions: ['json'] }] });
  if (!result.canceled) {
    const json = fs.readFileSync(result.filePaths[0], 'utf8');
    mainWindow.webContents.send('ladder-loaded', json);
  }
});
