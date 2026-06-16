const opencodeFrame = document.getElementById('opencode-frame');
const opencodeStatus = document.getElementById('opencode-status');
const modeSelect = document.getElementById('mode-select');
const fileTree = document.getElementById('file-tree');
const selectedFile = document.getElementById('selected-file');
const vizRoot = document.getElementById('viz-root');
const vizMeta = document.getElementById('viz-meta');
const refreshFiles = document.getElementById('refresh-files');
const visualizeFile = document.getElementById('visualize-file');
const vizPrompt = document.getElementById('viz-prompt');

const state = {
  tree: [],
  currentPath: '',
  currentContent: '',
  currentMode: 'auto',
};

opencodeFrame.addEventListener('load', () => {
  opencodeStatus.textContent = 'bereit';
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setMeta(text) {
  vizMeta.innerHTML = `<div class="viz-meta">${escapeHtml(text)}</div>`;
}

function renderTable(rows, title = 'Tabelle') {
  const data = Array.isArray(rows) ? rows : [];
  if (!data.length) {
    vizRoot.innerHTML = '<div class="muted">Keine Tabellendaten gefunden.</div>';
    return;
  }
  const headers = [...new Set(data.flatMap((row) => Object.keys(row || {})))];
  vizRoot.innerHTML = `
    <div class="artifact-card">
      <div class="artifact-title">${escapeHtml(title)}</div>
      <table class="viz-table">
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${data.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row?.[header] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
  `;
}

function renderBarChart(items, title = 'Balken') {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => ({
      label: String(item?.label ?? item?.name ?? item?.key ?? 'Value'),
      value: Number(item?.value ?? item?.amount ?? item?.count ?? 0),
    }))
    .filter((item) => Number.isFinite(item.value));

  if (!values.length) {
    vizRoot.innerHTML = '<div class="muted">Keine numerischen Werte gefunden.</div>';
    return;
  }

  const max = Math.max(...values.map((item) => item.value), 1);
  vizRoot.innerHTML = `
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

function renderPieChart(items, title = 'Pie') {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => ({
      label: String(item?.label ?? item?.name ?? item?.key ?? 'Value'),
      value: Number(item?.value ?? item?.amount ?? item?.count ?? 0),
    }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0);

  if (!values.length) {
    vizRoot.innerHTML = '<div class="muted">Keine Werte für das Piechart gefunden.</div>';
    return;
  }

  const colors = ['#a00014', '#c44d58', '#d97b42', '#f0d9cc', '#7d1d25', '#5d0f18'];
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
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    start = end;
    return `<path d="${path}" fill="${colors[index % colors.length]}"></path>`;
  }).join('');

  vizRoot.innerHTML = `
    <div class="artifact-card">
      <div class="artifact-title">${escapeHtml(title)}</div>
      <div class="pie-wrap">
        <svg viewBox="0 0 220 220" class="pie-chart" aria-label="Pie chart">
          ${slices}
          <circle cx="110" cy="110" r="42" fill="rgba(10, 12, 16, 0.88)"></circle>
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

function renderJsonTree(value, key = null) {
  if (value === null || typeof value !== 'object') {
    return `<li><span class="muted">${key ? `${escapeHtml(key)}: ` : ''}</span>${escapeHtml(JSON.stringify(value))}</li>`;
  }
  const entries = Array.isArray(value)
    ? value.map((item, index) => renderJsonTree(item, String(index))).join('')
    : Object.entries(value).map(([childKey, childValue]) => renderJsonTree(childValue, childKey)).join('');
  return `<li>${key ? `<strong>${escapeHtml(key)}</strong>` : '<strong>root</strong>'}<ul>${entries}</ul></li>`;
}

function parseCSV(text) {
  const rows = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (!rows.length) return [];
  const split = (line) => line.split(',').map((value) => value.trim());
  const headers = split(rows[0]);
  return rows.slice(1).map((row) => {
    const values = split(row);
    return headers.reduce((acc, header, index) => {
      acc[header || `col${index + 1}`] = values[index] ?? '';
      return acc;
    }, {});
  });
}

function renderContent(path, content) {
  const ext = path.split('.').pop().toLowerCase();
  setMeta(`${path}${ext ? ` · .${ext}` : ''}`);

  if (!content) {
    vizRoot.innerHTML = '<div class="muted">Datei leer.</div>';
    return;
  }

  if (state.currentMode === 'image' || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    vizRoot.innerHTML = `<img src="/api/raw?path=${encodeURIComponent(path)}" alt="${escapeHtml(path)}" style="max-width:100%;height:auto;border-radius:12px;display:block;">`;
    return;
  }

  if (state.currentMode === 'json' || ext === 'json') {
    try {
      const json = JSON.parse(content);
      vizRoot.innerHTML = `<div class="tree-view"><ul>${renderJsonTree(json)}</ul></div>`;
      return;
    } catch {
      vizRoot.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
      return;
    }
  }

  if (state.currentMode === 'table' || ext === 'csv') {
    try {
      if (ext === 'csv') {
        renderTable(parseCSV(content), path);
        return;
      }
      const json = JSON.parse(content);
      renderTable(Array.isArray(json) ? json : [json], path);
      return;
    } catch {
      vizRoot.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
      return;
    }
  }

  if (state.currentMode === 'chart') {
    try {
      if (ext === 'csv') {
        renderBarChart(parseCSV(content), path);
        return;
      }
      const json = JSON.parse(content);
      renderBarChart(Array.isArray(json) ? json : [json], path);
      return;
    } catch {
      const numericLines = content
        .split(/\r?\n/)
        .map((line, index) => ({ label: String(index + 1), value: Number(line) }))
        .filter((item) => Number.isFinite(item.value));
      renderBarChart(numericLines, path);
      return;
    }
  }

  if (state.currentMode === 'pie') {
    try {
      if (ext === 'csv') {
        renderPieChart(parseCSV(content), path);
        return;
      }
      const json = JSON.parse(content);
      renderPieChart(Array.isArray(json) ? json : [json], path);
      return;
    } catch {
      vizRoot.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
      return;
    }
  }

  vizRoot.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
}

function renderTree(nodes, container, depth = 0) {
  for (const node of nodes) {
    const item = document.createElement('div');
    item.className = `tree-item tree-${node.type}`;
    item.style.paddingLeft = `${10 + depth * 14}px`;
    item.dataset.path = node.path;
    item.innerHTML = node.type === 'dir'
      ? `📁 ${escapeHtml(node.name)}`
      : `📄 ${escapeHtml(node.name)} <span class="muted">${node.size}b</span>`;

    item.addEventListener('click', async () => {
      if (node.type === 'dir') return;
      state.currentPath = node.path;
      selectedFile.textContent = node.path;
      document.querySelectorAll('.tree-item').forEach((el) => el.classList.toggle('active', el.dataset.path === node.path));
      const response = await fetch(`/api/file?path=${encodeURIComponent(node.path)}`);
      const data = await response.json();
      state.currentContent = data.content || '';
      renderContent(node.path, state.currentContent);
    });

    container.append(item);
    if (node.children) renderTree(node.children, container, depth + 1);
  }
}

async function loadFiles() {
  const response = await fetch('/api/files');
  const data = await response.json();
  state.tree = data.tree || [];
  fileTree.innerHTML = '';
  renderTree(state.tree, fileTree);

  if (!state.currentPath) {
    const firstFile = findFirstFile(state.tree);
    if (firstFile) {
      state.currentPath = firstFile.path;
      selectedFile.textContent = firstFile.path;
      const fileResponse = await fetch(`/api/file?path=${encodeURIComponent(firstFile.path)}`);
      const fileData = await fileResponse.json();
      state.currentContent = fileData.content || '';
      renderContent(firstFile.path, state.currentContent);
    } else {
      vizRoot.innerHTML = '<div class="muted">Noch keine Dateien im Ordner.</div>';
    }
  }
}

function findFirstFile(nodes) {
  for (const node of nodes) {
    if (node.type === 'file') return node;
    const nested = findFirstFile(node.children || []);
    if (nested) return nested;
  }
  return null;
}

async function visualizeCurrentFile() {
  const prompt = vizPrompt.value.trim();
  if (!state.currentPath) return;

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prompt || 'visualisier die ausgewählte Datei sinnvoll',
      filePath: state.currentPath,
      sessionId: '',
    }),
  });

  const result = await response.json();
  if (result.visualization) {
    if (result.visualization.html) {
      vizRoot.innerHTML = result.visualization.html;
      setMeta(`${result.visualization.kind || 'visual'} · ${result.visualization.title || state.currentPath}`);
      return;
    }

    if (result.visualization.artifact) {
      const { artifact } = result.visualization;
      if (artifact.mime === 'image/png' || artifact.mime === 'image/svg+xml') {
        vizRoot.innerHTML = `<img src="/api/raw?path=${encodeURIComponent(artifact.path)}" alt="${escapeHtml(artifact.name)}" style="max-width:100%;height:auto;border-radius:12px;display:block;">`;
      } else if (artifact.mime === 'text/html') {
        vizRoot.innerHTML = `<iframe sandbox srcdoc="${escapeHtml(artifact.content || '')}" style="width:100%;height:100%;min-height:520px;border:0;border-radius:12px;background:#fff;"></iframe>`;
      } else {
        vizRoot.innerHTML = `<pre>${escapeHtml(artifact.content || result.visualization.stdout || result.visualization.stderr || '')}</pre>`;
      }
      setMeta(`${result.visualization.kind || 'python'} · ${result.visualization.title || state.currentPath}`);
      return;
    }
  }

  if (result.text) {
    vizRoot.innerHTML = `<pre>${escapeHtml(result.text)}</pre>`;
  }
}

modeSelect.addEventListener('change', () => {
  state.currentMode = modeSelect.value;
  if (state.currentPath) renderContent(state.currentPath, state.currentContent);
});

refreshFiles.addEventListener('click', loadFiles);
visualizeFile.addEventListener('click', visualizeCurrentFile);

loadFiles();
