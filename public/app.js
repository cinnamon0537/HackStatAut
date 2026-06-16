const opencodeFrame = document.getElementById('opencode-frame');
const opencodeStatus = document.getElementById('opencode-status');
const visualizeNext = document.getElementById('visualize-next');
const visualizeMode = document.getElementById('visualize-mode');
const vizRoot = document.getElementById('viz-root');
const vizMeta = document.getElementById('viz-meta');

const state = {
  sessionId: '',
  visualizeNext: false,
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

function setBusy(isBusy) {
  opencodeStatus.textContent = isBusy ? 'arbeitet ...' : 'bereit';
}

function setMeta(text) {
  vizMeta.textContent = text;
}

function setVisualizationMode(active) {
  state.visualizeNext = active;
  visualizeMode.textContent = active ? 'visualisieren' : 'normal';
  visualizeMode.classList.toggle('active', active);
  visualizeNext.textContent = active ? 'Visualisieren: an' : 'Visualisieren';
}

function renderVisualization(result) {
  if (result.visualization) {
    if (result.visualization.html) {
      vizRoot.innerHTML = result.visualization.html;
      setMeta(`${result.visualization.kind || 'visual'} · ${result.visualization.title || 'OpenCode'}`);
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
      setMeta(`${result.visualization.kind || 'python'} · ${result.visualization.title || 'OpenCode'}`);
      return;
    }
  }

  if (result.text) {
    vizRoot.innerHTML = `<pre>${escapeHtml(result.text)}</pre>`;
    setMeta('OpenCode hat eine Textantwort geliefert.');
    return;
  }

  vizRoot.innerHTML = '<div class="muted">Keine Ausgabe erhalten.</div>';
  setMeta('Keine Visualisierung erzeugt.');
}

visualizeNext.addEventListener('click', () => {
  setVisualizationMode(!state.visualizeNext);
  setMeta(state.visualizeNext ? 'Der nächste Prompt im OpenCode-Fenster wird als Visualisierung behandelt.' : 'Visualisierungsmodus ist aus.');
});

setVisualizationMode(false);
setMeta('Bereit für den nächsten Prompt.');
