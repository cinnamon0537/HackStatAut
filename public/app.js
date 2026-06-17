const opencodeFrame = document.getElementById('opencode-frame');
const dataRootLabel = document.getElementById('data-root-label');
const vizRoot = document.getElementById('viz-root');
const vizMeta = document.getElementById('viz-meta');
const reloadButton = document.getElementById('reload-opencode');
const clearVizButton = document.getElementById('clear-viz');
let lastVizVersion = -1;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setMeta(text) {
  if (vizMeta) vizMeta.textContent = text;
}

function renderVisualizationItem(visualization) {
  if (!visualization || !vizRoot) return false;

  if (visualization.html) {
    vizRoot.insertAdjacentHTML('beforeend', visualization.html);
    return true;
  }

  if (visualization.artifact) {
    const { artifact } = visualization;
    if (artifact.mime === 'image/png' || artifact.mime === 'image/svg+xml') {
      vizRoot.insertAdjacentHTML('beforeend', `<img src="/api/raw?path=${encodeURIComponent(artifact.path)}" alt="${escapeHtml(artifact.name)}" class="viz-image">`);
    } else if (artifact.mime === 'text/html') {
      vizRoot.insertAdjacentHTML('beforeend', `<iframe sandbox srcdoc="${escapeHtml(artifact.content || '')}" class="viz-frame"></iframe>`);
    } else {
      vizRoot.insertAdjacentHTML('beforeend', `<pre>${escapeHtml(artifact.content || visualization.stdout || visualization.stderr || '')}</pre>`);
    }
    return true;
  }

  return false;
}

function buildDemoVisualizationHtml() {
  const values = [
    { label: 'A', value: 12, color: '#ff9d00' },
    { label: 'B', value: 8, color: '#7dbb7d' },
    { label: 'C', value: 15, color: '#ffbf4d' },
  ];
  const max = Math.max(...values.map((item) => item.value), 1);

  return `
    <div class="artifact-card">
      <div class="artifact-title">Demo Values</div>
      <svg viewBox="0 0 360 220" style="width:100%;height:auto;display:block" role="img" aria-label="Demo bar chart">
        <line x1="44" y1="22" x2="44" y2="176" stroke="#4a4a4a" stroke-width="1.2"></line>
        <line x1="44" y1="176" x2="326" y2="176" stroke="#4a4a4a" stroke-width="1.2"></line>
        ${values.map((item, index) => {
          const barHeight = Math.round((item.value / max) * 118);
          const x = 74 + index * 86;
          const y = 176 - barHeight;
          return `
            <g>
              <rect x="${x}" y="${y}" width="42" height="${barHeight}" rx="4" fill="${item.color}"></rect>
              <text x="${x + 21}" y="196" text-anchor="middle" fill="#c8c8c8" font-size="11">${escapeHtml(item.label)}</text>
              <text x="${x + 21}" y="${y - 8}" text-anchor="middle" fill="#f2f2f2" font-size="11">${item.value}</text>
            </g>
          `;
        }).join('')}
      </svg>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
        ${values.map((item) => `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #2a2a2a;border-radius:4px;background:#121212;">
            <span style="width:10px;height:10px;border-radius:2px;flex:0 0 auto;background:${item.color}"></span>
            <span style="color:#c8c8c8">${escapeHtml(item.label)}</span>
            <strong style="margin-left:auto;font-size:12px;color:#f2f2f2">${item.value}</strong>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderLocalDemoVisualization() {
  if (!vizRoot) return;
  vizRoot.innerHTML = buildDemoVisualizationHtml();
  setMeta('Demo-Grafik · Beispielansicht');
}

function renderStoredVisualizations(items) {
  if (!vizRoot) return;

  if (!Array.isArray(items) || !items.length) {
    vizRoot.innerHTML = '<div class="muted">Visualizations appear here.</div>';
    setMeta('Ready for the next visualization.');
    return;
  }

  vizRoot.innerHTML = '';
  let count = 0;
  for (const item of items) {
    if (renderVisualizationItem(item.visualization)) count += 1;
  }
  setMeta(count > 1 ? `${count} visualizations rendered.` : '1 visualization rendered.');
}

async function clearVisualizations() {
  try {
    await fetch('/api/vizjson', { method: 'DELETE' });
  } catch {
    // ignore and still clear locally
  }
  lastVizVersion = -1;
  if (!vizRoot) return;
  vizRoot.innerHTML = '<div class="muted">Visualizations appear here.</div>';
  setMeta('Visualization panel cleared.');
}

function reloadOpenCode() {
  if (!opencodeFrame?.src) return;
  opencodeFrame.src = opencodeFrame.src;
}

async function loadRuntimeConfig() {
  const fallback = 'http://127.0.0.1:4096/';

  try {
    const response = await fetch('/api/config');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Config request failed');

    if (opencodeFrame) {
      opencodeFrame.src = data.opencodeWebUrl || fallback;
    }

    if (dataRootLabel) {
      dataRootLabel.textContent = data.dataRoot || 'database';
    }
  } catch {
    if (opencodeFrame) {
      opencodeFrame.src = fallback;
    }

    if (dataRootLabel) {
      dataRootLabel.textContent = 'database';
    }
  }
}

async function syncVisualizationState() {
  try {
    const response = await fetch('/api/vizjson');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Visualization sync failed');

    if (typeof data.version === 'number' && data.version !== lastVizVersion) {
      lastVizVersion = data.version;
      renderStoredVisualizations(data.items);
    }
  } catch {
    // keep current panel content
  }
}

reloadButton?.addEventListener('click', reloadOpenCode);
clearVizButton?.addEventListener('click', () => { void clearVisualizations(); });

renderLocalDemoVisualization();
void loadRuntimeConfig();
void syncVisualizationState();
window.setInterval(() => {
  void syncVisualizationState();
}, 2000);
