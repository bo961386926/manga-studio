// Author: forsearch | Updated: 2026-04-30
const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

function getDistRoot() {
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    return path.join(__dirname, '../dist');
  }
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'dist');
}

const API_PROXY_TARGET = 'http://api.gitcc.com';
const DEFAULT_PORT = 39628;

let mainWindow = null;
let server = null;

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    show: false,
  });

  // Remote HTTPS deployment: when REMOTE_APP_URL is set, load the remote Web
  // app instead of the bundled dist (stage-3 gate). webSecurity stays on.
  const remoteUrl = process.env.REMOTE_APP_URL;
  const url = remoteUrl
    ? new URL(remoteUrl).href
    : `http://localhost:${port}/`;
  win.loadURL(url);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { mainWindow = null; });

  mainWindow = win;
}

function tryListen(server, port) {
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve(port));
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') reject(err);
      else reject(err);
    });
  });
}

function findFreePort(startPort) {
  return new Promise((resolve) => {
    const s = require('net').createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const express = require('express');
  const { createProxyMiddleware } = require('http-proxy-middleware');

  const distRoot = getDistRoot();
  const app = express();

  app.use(
    '/api-proxy',
    createProxyMiddleware({
      target: API_PROXY_TARGET,
      changeOrigin: true,
      pathRewrite: { '^/api-proxy': '' },
      onError(err, req, res) {
        console.error('Proxy error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
      },
    })
  );

  app.use(express.static(distRoot, { index: false }));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distRoot, 'index.html'));
  });

  const httpServer = http.createServer(app);
  let port = DEFAULT_PORT;
  try {
    await tryListen(httpServer, port);
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      port = await findFreePort(port);
      await tryListen(httpServer, port);
    } else {
      throw e;
    }
  }
  server = httpServer;
  console.log('Server listening on http://127.0.0.1:' + port);
  return port;
}

async function main() {
  Menu.setApplicationMenu(null);

  // Legacy config export: seal localStorage payload into an encrypted v1
  // envelope and save it. The envelope module lives under server/ (ESM);
  // argon2 resolves from server/node_modules. Packaged builds must include
  // server/migration + argon2 (see stage-3 hardening task).
  ipcMain.handle('legacy:export', async (_event, { data, password }) => {
    try {
      if (!data || typeof password !== 'string' || password.length < 8) {
        return { ok: false, reason: '需要至少 8 位的导出密码' };
      }
      const { sealEnvelope } = await import('../server/migration/envelope.js');
      const envelope = await sealEnvelope(
        {
          exportId: crypto.randomUUID(),
          config: data,
          purpose: 'legacy-model-config',
        },
        password
      );
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: '导出迁移包',
        defaultPath: `manga-studio-export-${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (canceled || !filePath) return { ok: false, reason: '已取消' };
      await fs.promises.writeFile(filePath, JSON.stringify(envelope, null, 2));
      return { ok: true, path: filePath };
    } catch (err) {
      console.error('[export] failed:', err.message);
      return { ok: false, reason: `导出失败: ${err.message}` };
    }
  });

  const port = await startServer();
  createWindow(port);
}

app.whenReady().then(main).catch((err) => {
  console.error('Failed to start:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});
