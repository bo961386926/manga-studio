// Author: forsearch | Updated: 2026-04-30
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const http = require('http');

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
    },
    show: false,
  });

  const url = `http://localhost:${port}/`;
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
