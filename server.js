import express from 'express';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const app = express();
const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const OPENCODE_WEB_PORT = Number(process.env.OPENCODE_WEB_PORT || 4096);
const OPENCODE_WEB_URL = `http://127.0.0.1:${OPENCODE_WEB_PORT}`;
const VIZ_ROOT = path.join(ROOT, 'tmp', 'viz');
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const PYTHON_TIMEOUT_MS = 20000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

async function ensureOpenCodeWeb() {
  try {
    const response = await fetch(`${OPENCODE_WEB_URL}/api/health`);
    if (response.ok) return;
  } catch {
    // start below
  }

  const child = spawn('opencode', ['web', '--port', String(OPENCODE_WEB_PORT), '--hostname', '127.0.0.1', '--pure'], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.unref();
}

void ensureOpenCodeWeb();

const IGNORED_DIRS = new Set(['.git', '.secrets', 'node_modules', 'playwright-report', 'test-results', 'tmp']);

const VIZ_PROMPT = [
  'Wenn die Aufgabe eine Visualisierung, Tabelle, ein Diagramm oder eine andere strukturierte Ausgabe verlangt, antworte zusätzlich mit genau einem fenced code block ```vizjson```.',
  'Das JSON darin muss valide sein.',
  'Erlaubte Typen: table, tree, bar, pie, python.',
  'Für type=table: {"type":"table","title":"...","rows":[{"col":1}]}',
  'Für type=tree: {"type":"tree","title":"...","tree":{}}',
  'Für type=bar oder pie: {"type":"bar|pie","title":"...","data":[{"label":"A","value":1}]}',
  'Für type=python: {"type":"python","title":"...","code":"...","output":"svg"}',
  'Der Python-Code soll nur stdlib benutzen und im aktuellen Arbeitsordner `artifact.svg`, `artifact.png`, `artifact.html`, `artifact.json` oder `artifact.txt` schreiben.',
  'Wenn keine Visualisierung nötig ist, antworte normal ohne vizjson-Block.',
].join(' ');

const OPENCODE_AGENT = 'build';
const OPENCODE_MODEL = { providerID: 'opencode', modelID: 'north-mini-code-free' };
let openCodeSessionId = '';
let openCodeSessionInit = null;

function makeMessageId() {
  return `msg_${randomUUID().replaceAll('-', '')}`;
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  return search.toString();
}

async function opencodeRequest(pathname, { method = 'GET', body, query } = {}) {
  const url = new URL(pathname, OPENCODE_WEB_URL);
  const search = buildQuery(query);
  if (search) url.search = search;

  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = data?.message || data?.error || data?._tag || response.statusText || 'OpenCode request failed';
    const error = new Error(message);
    error.statusCode = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function ensureOpenCodeSession() {
  if (openCodeSessionId) return openCodeSessionId;
  if (openCodeSessionInit) return openCodeSessionInit;

  openCodeSessionInit = (async () => {
    const created = await opencodeRequest('/api/session', {
      method: 'POST',
      body: { location: { directory: ROOT } },
    });
    openCodeSessionId = created?.data?.id || created?.id || '';
    if (!openCodeSessionId) throw new Error('OpenCode session could not be created');

    await opencodeRequest(`/session/${openCodeSessionId}/init`, {
      method: 'POST',
      query: { directory: ROOT },
      body: { providerID: OPENCODE_MODEL.providerID, modelID: OPENCODE_MODEL.modelID, messageID: makeMessageId() },
    });

    return openCodeSessionId;
  })();

  try {
    return await openCodeSessionInit;
  } finally {
    openCodeSessionInit = null;
  }
}

function readMessageText(messageDetail) {
  return (messageDetail?.parts || [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

async function waitForAssistantResponse(eventResponse, sessionId, userMessageId, timeoutMs = 120000) {
  const response = eventResponse || await fetch(`${OPENCODE_WEB_URL}/api/event`);
  if (!response.ok || !response.body) {
    throw new Error('OpenCode event stream unavailable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const startedAt = Date.now();

  try {
    while (Date.now() - startedAt < timeoutMs) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        if (!rawEvent) continue;

        const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data: '));
        if (!dataLine) continue;

        let event;
        try {
          event = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }

        if (event?.data?.sessionID !== sessionId) continue;
        if (event.type === 'message.updated' && event.data?.info?.role === 'assistant' && event.data?.info?.parentID === userMessageId && event.data?.info?.finish === 'stop') {
          const assistantId = event.data.info.id;
          const detail = await opencodeRequest(`/session/${sessionId}/message/${assistantId}`, {
            query: { directory: ROOT },
          });
          return {
            assistantId,
            text: readMessageText(detail),
            detail,
          };
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  throw new Error('Timed out waiting for OpenCode response');
}

async function submitOpenCodePrompt(sessionId, message, { visualize = false } = {}) {
  const userMessageId = makeMessageId();
  const eventStreamPromise = fetch(`${OPENCODE_WEB_URL}/api/event`);
  const body = {
    messageID: userMessageId,
    agent: OPENCODE_AGENT,
    model: OPENCODE_MODEL,
    noReply: true,
    parts: [{ type: 'text', text: message }],
  };

  if (visualize) {
    body.system = VIZ_PROMPT;
  }

  void opencodeRequest(`/session/${sessionId}/prompt_async`, {
    method: 'POST',
    query: { directory: ROOT },
    body,
  }).catch(() => {});

  return waitForAssistantResponse(await eventStreamPromise, sessionId, userMessageId);
}

function safeResolve(requestPath = '') {
  const resolved = path.resolve(ROOT, requestPath || '.');
  const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : `${ROOT}${path.sep}`;
  if (resolved !== ROOT && !resolved.startsWith(rootPrefix)) {
    const err = new Error('Invalid path');
    err.statusCode = 400;
    throw err;
  }
  return resolved;
}

function isVizRequest(message) {
  return /visual|diagram|chart|plot|graf|tabelle|table|tree|baum|pie|balken|render|viz/i.test(message);
}

function extractVizSpec(text) {
  const match = text.match(/```vizjson\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function stripVizSpec(text) {
  return text.replace(/```vizjson\s*[\s\S]*?```/i, '').trim();
}

function renderTableHtml(rows, title = 'Tabelle') {
  const data = Array.isArray(rows) ? rows : [];
  const headers = [...new Set(data.flatMap((row) => Object.keys(row || {})))];
  const body = data.length
    ? data.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row?.[header] ?? '')}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="muted">Keine Daten</td></tr>`;

  return `
    <div class="artifact-card">
      <div class="artifact-title">${escapeHtml(title)}</div>
      <table class="viz-table">
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function buildTreeHtml(tree, title = 'Baum') {
  const renderNode = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') {
      return `<li>${escapeHtml(String(node))}</li>`;
    }
    if (Array.isArray(node)) {
      return `<li><span class="muted">Array</span><ul>${node.map(renderNode).join('')}</ul></li>`;
    }
    return `<li><strong>${escapeHtml(Object.keys(node).join(', ') || 'node')}</strong><ul>${Object.entries(node).map(([key, value]) => `<li><span class="muted">${escapeHtml(key)}:</span><ul>${renderNode(value)}</ul></li>`).join('')}</ul></li>`;
  };

  return `
    <div class="artifact-card">
      <div class="artifact-title">${escapeHtml(title)}</div>
      <div class="tree-view"><ul>${renderNode(tree)}</ul></div>
    </div>
  `;
}

function buildBarSvg(data, title = 'Balken') {
  const items = Array.isArray(data) ? data : [];
  const values = items
    .map((item) => ({
      label: String(item?.label ?? item?.name ?? item?.key ?? 'Value'),
      value: Number(item?.value ?? item?.amount ?? item?.count ?? 0),
    }))
    .filter((item) => Number.isFinite(item.value));
  if (!values.length) return `<div class="muted">Keine Balkendaten gefunden.</div>`;

  const max = Math.max(...values.map((item) => item.value), 1);
  return `
    <div class="artifact-card">
      <div class="artifact-title">${escapeHtml(title)}</div>
      <div class="chart">${values.map((item) => `
        <div class="bar">
          <div>${escapeHtml(item.label)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(item.value / max) * 100}%"></div></div>
          <div class="muted">${escapeHtml(item.value)}</div>
        </div>
      `).join('')}</div>
    </div>
  `;
}

function buildPieSvg(data, title = 'Pie') {
  const items = Array.isArray(data) ? data : [];
  const values = items
    .map((item) => ({
      label: String(item?.label ?? item?.name ?? item?.key ?? 'Value'),
      value: Number(item?.value ?? item?.amount ?? item?.count ?? 0),
    }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0);
  if (!values.length) return `<div class="muted">Keine Werte für das Piechart gefunden.</div>`;

  const colors = ['#84ccff', '#6ee7b7', '#fbbf24', '#f472b6', '#a78bfa', '#fb7185'];
  const total = values.reduce((sum, item) => sum + item.value, 0);
  let start = 0;
  const slices = values.map((item, index) => {
    const angle = (item.value / total) * Math.PI * 2;
    const end = start + angle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const cx = 110;
    const cy = 110;
    const r = 88;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const pathData = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    start = end;
    return `<path d="${pathData}" fill="${colors[index % colors.length]}"></path>`;
  }).join('');

  return `
    <div class="artifact-card">
      <div class="artifact-title">${escapeHtml(title)}</div>
      <div class="pie-wrap">
        <svg viewBox="0 0 220 220" class="pie-chart" aria-label="Pie chart">
          ${slices}
          <circle cx="110" cy="110" r="42" fill="rgba(8, 17, 29, 0.92)"></circle>
        </svg>
        <div class="pie-legend">
          ${values.map((item, index) => `
            <div class="pie-legend-row">
              <span class="pie-dot" style="background:${colors[index % colors.length]}"></span>
              <span>${escapeHtml(item.label)}</span>
              <span class="muted">${escapeHtml(item.value)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

async function ensureVizRoot() {
  await fs.mkdir(VIZ_ROOT, { recursive: true });
}

function rejectDangerousPython(code) {
  const banned = [
    /\bimport\s+os\b/i,
    /\bimport\s+subprocess\b/i,
    /\bimport\s+socket\b/i,
    /\bimport\s+shutil\b/i,
    /\bimport\s+urllib/i,
    /\bimport\s+requests\b/i,
    /\bimport\s+http\b/i,
    /\bimport\s+ctypes\b/i,
    /\bimport\s+multiprocessing\b/i,
  ];
  for (const pattern of banned) {
    if (pattern.test(code)) {
      const err = new Error('Python visualization code uses a blocked import');
      err.statusCode = 400;
      throw err;
    }
  }
}

async function copySelectedFile(workdir, filePath) {
  if (!filePath) return null;
  const resolved = safeResolve(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) return null;
  if (stat.size > MAX_INPUT_BYTES) return null;

  const ext = path.extname(resolved) || '.txt';
  const target = path.join(workdir, `input${ext}`);
  await fs.copyFile(resolved, target);
  return { source: filePath, target: path.basename(target) };
}

async function runPythonVisualization(spec, filePath) {
  rejectDangerousPython(String(spec.code || ''));
  await ensureVizRoot();
  const runDir = path.join(VIZ_ROOT, randomUUID());
  await fs.mkdir(runDir, { recursive: true });
  const inputFile = await copySelectedFile(runDir, filePath);
  const scriptPath = path.join(runDir, 'viz.py');
  const code = String(spec.code || '').trim();
  const prelude = [
    'from pathlib import Path',
    'import json',
    'WORKDIR = Path(__file__).resolve().parent',
    `INPUT_FILE = ${JSON.stringify(inputFile ? inputFile.target : '')}`,
    'def write_text(name, text):\n    (WORKDIR / name).write_text(text, encoding="utf-8")',
    'def write_json(name, value):\n    (WORKDIR / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")',
  ].join('\n');
  await fs.writeFile(scriptPath, `${prelude}\n\n${code}\n`, 'utf8');

  const child = spawn('python3', ['-I', '-B', 'viz.py'], {
    cwd: runDir,
    env: { PYTHONNOUSERSITE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: -1, timeout: true });
    }, PYTHON_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timeout: false });
    });
  });

  const candidates = ['artifact.svg', 'artifact.png', 'artifact.html', 'artifact.json', 'artifact.txt'];
  let artifact = null;
  for (const candidate of candidates) {
    const candidatePath = path.join(runDir, candidate);
    try {
      const stat = await fs.stat(candidatePath);
      if (!stat.isFile()) continue;
      artifact = {
        name: candidate,
        path: path.relative(ROOT, candidatePath),
        mime: candidate.endsWith('.svg') ? 'image/svg+xml' : candidate.endsWith('.png') ? 'image/png' : candidate.endsWith('.html') ? 'text/html' : candidate.endsWith('.json') ? 'application/json' : 'text/plain',
        content: candidate.endsWith('.png') ? null : await fs.readFile(candidatePath, 'utf8'),
      };
      break;
    } catch {
      // keep looking
    }
  }

  return {
    kind: 'python',
    title: spec.title || 'Python Visualisierung',
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    code: exit.code,
    timeout: exit.timeout,
    artifact,
    inputFile,
  };
}

async function renderVisualizationSpec(spec, filePath) {
  if (!spec || typeof spec !== 'object') {
    return null;
  }

  const type = String(spec.type || '').toLowerCase();
  if (type === 'table') return { kind: 'table', html: renderTableHtml(spec.rows, spec.title) };
  if (type === 'tree') return { kind: 'tree', html: buildTreeHtml(spec.tree, spec.title) };
  if (type === 'bar') return { kind: 'bar', html: buildBarSvg(spec.data, spec.title) };
  if (type === 'pie') return { kind: 'pie', html: buildPieSvg(spec.data, spec.title) };
  if (type === 'python') return runPythonVisualization(spec, filePath);

  return null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function walk(dir, base = ROOT) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const items = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath) || entry.name;
    if (entry.isDirectory()) {
      items.push({
        name: entry.name,
        path: relPath,
        type: 'dir',
        children: await walk(fullPath, base),
      });
    } else {
      const stat = await fs.stat(fullPath);
      items.push({
        name: entry.name,
        path: relPath,
        type: 'file',
        size: stat.size,
      });
    }
  }
  return items;
}

app.get('/api/files', async (_req, res) => {
  try {
    res.json({ root: ROOT, tree: await walk(ROOT) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/api/file', async (req, res) => {
  try {
    const filePath = safeResolve(String(req.query.path || ''));
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('Not a file');
    const content = await fs.readFile(filePath, 'utf8');
    res.json({ path: path.relative(ROOT, filePath), content });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/api/raw', async (req, res) => {
  try {
    const filePath = safeResolve(String(req.query.path || ''));
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('Not a file');
    res.setHeader('Content-Length', stat.size);
    res.sendFile(filePath);
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message);
  }
});

app.post('/api/exec', async (req, res) => {
  try {
    const command = String(req.body?.command || '').trim();
    if (!command) return res.status(400).json({ error: 'Command missing' });

    const startedAt = Date.now();
    const child = spawn(command, {
      cwd: ROOT,
      shell: true,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      res.status(500).json({ error: error.message });
    });

    child.on('close', (code) => {
      res.json({
        code,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

function runOpenCode({ message, sessionId, filePath }) {
  return new Promise((resolve, reject) => {
    const args = ['run', message, '--format', 'json', '--dir', ROOT];
    if (sessionId) {
      args.push('--session', sessionId);
    }
    if (filePath) {
      args.push('--file', filePath);
    }

    const child = spawn('opencode', args, {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const events = [];
    const rl = readline.createInterface({ input: child.stdout });
    let nextSessionId = sessionId || '';
    let text = '';
    let stderr = '';

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed);
        events.push(event);
        if (event.sessionID) nextSessionId = event.sessionID;
        if (event.type === 'text' && event.part?.text) text += event.part.text;
        if (event.type === 'error' && event.part?.message) stderr += `${event.part.message}\n`;
      } catch {
        stderr += `${trimmed}\n`;
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      rl.close();
      resolve({ code, text: text.trim(), stderr: stderr.trim(), sessionId: nextSessionId, events });
    });
  });
}

app.post('/api/chat', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!message) return res.status(400).json({ error: 'Message missing' });

    const activeSessionId = sessionId || await ensureOpenCodeSession();
    const result = await submitOpenCodePrompt(activeSessionId, message, {
      visualize: isVizRequest(message),
    });

    const vizSpec = extractVizSpec(result.text);
    const assistantText = stripVizSpec(result.text);
    const visualization = vizSpec ? await renderVisualizationSpec(vizSpec, undefined) : null;

    res.json({
      ...result,
      text: assistantText,
      vizSpec,
      visualization,
      sessionId: activeSessionId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`HackStatAut running on http://localhost:${PORT}`);
});
