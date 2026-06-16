const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatLog = document.getElementById('chat-log');
const opencodeStatus = document.getElementById('opencode-status');
const vizStatus = document.getElementById('viz-status');
const vizRoot = document.getElementById('viz-root');
const vizMeta = document.getElementById('viz-meta');

const state = {
  sessionId: '',
  busy: false,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setBusy(isBusy) {
  state.busy = isBusy;
  opencodeStatus.textContent = isBusy ? 'arbeitet ...' : state.sessionId ? 'verbunden' : 'bereit';
  chatInput.disabled = isBusy;
  chatForm.querySelector('button[type="submit"]').disabled = isBusy;
}

function setMeta(text) {
  vizMeta.textContent = text;
}

function setVizStatus(text) {
  vizStatus.textContent = text;
}

function shouldVisualize(message) {
  return /visual|diagram|chart|plot|graph|graf|tabelle|table|tree|baum|pie|balken|heatmap|matrix|map|render|viz|dashboard/i.test(message);
}

function renderVisualization(result) {
  if (result.visualization) {
    if (result.visualization.html) {
      vizRoot.innerHTML = result.visualization.html;
      setMeta(`${result.visualization.kind || 'visual'} · ${result.visualization.title || 'OpenCode'}`);
      setVizStatus('aktualisiert');
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
      setVizStatus('aktualisiert');
      return;
    }
  }

  if (result.text) {
    vizRoot.innerHTML = '<div class="muted">Keine Visualisierung erzeugt.</div>';
    setMeta('OpenCode hat eine Textantwort geliefert.');
    setVizStatus('leer');
    return;
  }

  vizRoot.innerHTML = '<div class="muted">Keine Ausgabe erhalten.</div>';
  setMeta('Keine Visualisierung erzeugt.');
  setVizStatus('leer');
}

function renderMessage(role, text) {
  const item = document.createElement('article');
  item.className = `message ${role}`;

  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'Du' : 'OpenCode';

  const body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = escapeHtml(text).replaceAll('\n', '<br>');

  item.append(label, body);
  chatLog.append(item);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function syncComposerHeight() {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 180)}px`;
}

async function sendMessage(message) {
  const body = {
    message,
    sessionId: state.sessionId,
  };

  if (shouldVisualize(message)) {
    setVizStatus('erkennt visuell');
  }

  setBusy(true);
  renderMessage('user', message);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Unbekannter Fehler');
    }

    state.sessionId = data.sessionId || state.sessionId;
    opencodeStatus.textContent = state.sessionId ? 'verbunden' : 'bereit';

    const assistantText = data.text || (data.visualization ? 'Visualisierung erzeugt.' : 'Antwort erhalten.');
    renderMessage('assistant', assistantText || '');
    renderVisualization(data);
  } catch (error) {
    renderMessage('assistant', `Fehler: ${error.message}`);
    vizRoot.innerHTML = '<div class="muted">Keine Visualisierung verfügbar.</div>';
    setMeta('Fehler beim Ausführen des OpenCode-Prompts.');
    setVizStatus('fehler');
  } finally {
    setBusy(false);
    chatInput.focus();
    syncComposerHeight();
  }
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || state.busy) return;
  chatInput.value = '';
  syncComposerHeight();
  void sendMessage(message);
});

chatInput.addEventListener('input', syncComposerHeight);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

setBusy(false);
setVizStatus('wartet');
setMeta('Bereit für eine Visualisierung oder eine normale Antwort.');
syncComposerHeight();
