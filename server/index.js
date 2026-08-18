import express from 'express';
import cors from 'cors';
import {
  initDB,
  getAllProjects,
  getProject,
  saveProject,
  deleteProject,
  getAllAssets,
  saveAsset,
  deleteAsset,
  getConfig,
  setConfig,
  removeConfig,
} from './db.js';

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || '3001');

app.use(cors());
app.use(express.json({ limit: '200mb' }));

// ==================== Projects ====================

app.get('/api/projects', async (_req, res) => {
  try {
    const projects = await getAllProjects();
    res.json(projects);
  } catch (e) {
    console.error('[API] getAllProjects error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (e) {
    console.error('[API] getProject error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { id, ...data } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const payloadSize = JSON.stringify(req.body).length;
    const title = data.title || '(untitled)';
    const shotsCount = Array.isArray(data.shots) ? data.shots.length : 0;
    const renderLogsCount = Array.isArray(data.renderLogs) ? data.renderLogs.length : 0;
    console.log(`[API] saveProject - id: ${id}, title: "${title}", payload: ${(payloadSize / 1024 / 1024).toFixed(2)}MB, shots: ${shotsCount}, renderLogs: ${renderLogsCount}`);
    await saveProject(id, { id, ...data });
    console.log(`[API] saveProject - 保存成功: ${id}`);
    res.json({ success: true });
  } catch (e) {
    console.error('[API] saveProject error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await deleteProject(req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('[API] deleteProject error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== Assets ====================

app.get('/api/assets', async (_req, res) => {
  try {
    const assets = await getAllAssets();
    res.json(assets);
  } catch (e) {
    console.error('[API] getAllAssets error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/assets', async (req, res) => {
  try {
    const { id, ...data } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    await saveAsset(id, { id, ...data });
    res.json({ success: true });
  } catch (e) {
    console.error('[API] saveAsset error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/assets/:id', async (req, res) => {
  try {
    await deleteAsset(req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('[API] deleteAsset error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== Config ====================

app.get('/api/config/:key', async (req, res) => {
  try {
    const value = await getConfig(req.params.key);
    if (value === null) return res.status(404).json({ error: 'Config not found' });
    res.json(value);
  } catch (e) {
    console.error('[API] getConfig error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/config/:key', async (req, res) => {
  try {
    const { value } = req.body;
    await setConfig(req.params.key, value);
    res.json({ success: true });
  } catch (e) {
    console.error('[API] setConfig error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/config/:key', async (req, res) => {
  try {
    await removeConfig(req.params.key);
    res.json({ success: true });
  } catch (e) {
    console.error('[API] removeConfig error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== AI Proxy Forwarding ====================

app.post('/api/ai-forward', async (req, res) => {
  const { targetUrl, method, headers, body } = req.body;
  
  const fs = await import('fs');
  const logToFile = (msg) => {
    try {
      fs.appendFileSync('forward.log', `[${new Date().toISOString()}] ${msg}\n`);
    } catch (err) {
      console.error(err);
    }
  };

  if (!targetUrl) {
    console.error(`[Backend API] [Error] targetUrl is missing`);
    return res.status(400).json({ error: 'targetUrl is required' });
  }

  console.log(`\n[Backend API] ========= Forwarding AI Request =========`);
  console.log(`[Backend API] Target URL: ${targetUrl}`);
  console.log(`[Backend API] Method: ${method || 'POST'}`);
  console.log(`[Backend API] Headers:`, JSON.stringify({ ...headers, Authorization: headers?.Authorization ? 'Bearer ***' : undefined }, null, 2));

  if (body) {
    if (body.isFormData) {
      console.log(`[Backend API] Payload: [FormData] fields:`, JSON.stringify(body.fields), `files:`, Object.keys(body.files || {}));
    } else {
      const serialized = typeof body === 'string' ? body : JSON.stringify(body);
      console.log(`[Backend API] Payload: ${serialized.substring(0, 500)}...`);
    }
  }

  try {
    let fetchBody = undefined;
    const fetchHeaders = { ...headers };

    if (body) {
      if (body.isFormData) {
        const form = new FormData();
        if (body.fields) {
          for (const [k, v] of Object.entries(body.fields)) {
            form.append(k, v);
          }
        }
        if (body.files) {
          for (const [k, file] of Object.entries(body.files)) {
            const buffer = Buffer.from(file.data, 'base64');
            const blob = new Blob([buffer], { type: file.type });
            form.append(k, blob, file.name);
          }
        }
        fetchBody = form;
        delete fetchHeaders['content-type'];
        delete fetchHeaders['Content-Type'];
      } else {
        fetchBody = typeof body === 'string' ? body : JSON.stringify(body);
      }
    }

    const abortController = new AbortController();
    req.socket.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
        console.log(`[Backend API] Client socket closed prematurely, aborting upstream fetch for ${targetUrl}`);
      }
    });

    const fetchOptions = {
      method: method || 'POST',
      headers: fetchHeaders,
      body: fetchBody,
      signal: abortController.signal
    };

    console.log(`[Backend API] Initiating fetch to upstream...`);
    const fetchRes = await fetch(targetUrl, fetchOptions);
    console.log(`[Backend API] Fetch completed. Response status: ${fetchRes.status} ${fetchRes.statusText}`);
    
    if (!res.writableEnded) {
      const ignoreHeaders = new Set([
        'connection',
        'transfer-encoding',
        'content-encoding',
        'content-length',
        'keep-alive',
        'host',
        'accept-encoding',
        'upgrade'
      ]);

      fetchRes.headers.forEach((value, key) => {
        if (!ignoreHeaders.has(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });
      res.status(fetchRes.status);
    }

    if (!fetchRes.ok) {
      const errorText = await fetchRes.text();
      console.error(`[Backend API] [Error] Upstream error response:`, errorText.substring(0, 500));
      if (!res.writableEnded) {
        return res.send(errorText);
      }
      return;
    }

    const contentType = fetchRes.headers.get('content-type') || '';
    const isStream = contentType.includes('text/event-stream');
    console.log(`[Backend API] Content-Type: ${contentType}, IsStream: ${isStream}`);

    if (isStream && fetchRes.body) {
      console.log(`[Backend API] Entering stream piping (pump)...`);
      const reader = fetchRes.body.getReader();
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done || req.socket.destroyed || res.writableEnded) {
              console.log(`[Backend API] Stream completed or socket destroyed. done: ${done}, destroyed: ${req.socket.destroyed}`);
              if (!res.writableEnded) {
                res.end();
              }
              break;
            }
            res.write(value);
          }
        } catch (streamErr) {
          console.error(`[Backend API] Stream piping error:`, streamErr.message);
          if (!res.writableEnded) {
            try { res.end(); } catch (_) {}
          }
        }
      };
      await pump();
    } else {
      console.log(`[Backend API] Entering non-stream body retrieval...`);
      const arrayBuffer = await fetchRes.arrayBuffer();
      console.log(`[Backend API] Retrieved body bytes length: ${arrayBuffer.byteLength}`);
      // 诊断日志:JSON 小响应打印内容(图片/视频等二进制不打印),便于排查上游返回
      const ct = (contentType || '').toLowerCase();
      if (ct.includes('application/json') || ct.includes('text/plain')) {
        const bodyText = Buffer.from(arrayBuffer).toString('utf-8');
        if (arrayBuffer.byteLength < 4096) {
          console.log(`[Backend API] Response body: ${bodyText}`);
        } else {
          console.log(`[Backend API] Response body (first 1500): ${bodyText.substring(0, 1500)}`);
        }
      }
      if (!res.writableEnded) {
        res.send(Buffer.from(arrayBuffer));
        console.log(`[Backend API] Sent non-stream response successfully`);
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`[Backend API] Upstream fetch aborted successfully`);
      return;
    }
    console.error(`[Backend API] [Error] Fetch error (Network/TLS):`, err);
    res.status(500).json({ error: `Backend Proxy Error: ${err.message}`, stack: err.stack });
  }
});

// ==================== Health ====================

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// ==================== Start ====================

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[Server] API server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[Server] Failed to initialize database:', err);
    process.exit(1);
  });