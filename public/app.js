const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatLog = document.getElementById('chat-log');
const connectionStatus = document.getElementById('connection-status');
const streamStatus = document.getElementById('stream-status');
const vizStatus = document.getElementById('viz-status');
const vizRoot = document.getElementById('viz-root');
const vizMeta = document.getElementById('viz-meta');
const chatIntro = document.getElementById('chat-intro');

const state = {
  sessionId: '',
  busy: false,
  activeAssistant: null,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function scrollBottom(node) {
  node.scrollTop = node.scrollHeight;
}

function hideChatIntro() {
  if (chatIntro) chatIntro.hidden = true;
}

function setStatusPill(node, text, tone = '') {
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

function setBusy(isBusy) {
  state.busy = isBusy;
  setStatusPill(connectionStatus, isBusy ? 'working ...' : state.sessionId ? 'connected' : 'ready', isBusy ? 'busy' : state.sessionId ? 'connected' : 'idle');
  setStatusPill(streamStatus, isBusy ? 'streaming' : 'idle', isBusy ? 'busy' : 'idle');
  chatInput.disabled = isBusy;
  chatForm.querySelector('button[type="submit"]').disabled = isBusy;
}

function setMeta(text) {
  vizMeta.textContent = text;
}

function setVizStatus(text, tone = 'idle') {
  setStatusPill(vizStatus, text, tone);
}

function setStreamStatus(text, tone = 'idle') {
  setStatusPill(streamStatus, text, tone);
}

function shouldVisualize(message) {
  return /visual|diagram|chart|plot|graph|graf|tabelle|table|tree|baum|pie|balken|heatmap|matrix|map|render|viz|dashboard/i.test(message);
}

function renderVisualization(result) {
  if (result.visualization) {
    if (result.visualization.html) {
      vizRoot.innerHTML = result.visualization.html;
      setMeta(`${result.visualization.kind || 'visual'} · ${result.visualization.title || 'ChatWithYourData'}`);
      setVizStatus('aktualisiert', 'ok');
      return;
    }

    if (result.visualization.artifact) {
      const { artifact } = result.visualization;
      if (artifact.mime === 'image/png' || artifact.mime === 'image/svg+xml') {
        vizRoot.innerHTML = `<img src="/api/raw?path=${encodeURIComponent(artifact.path)}" alt="${escapeHtml(artifact.name)}" class="viz-image">`;
      } else if (artifact.mime === 'text/html') {
        vizRoot.innerHTML = `<iframe sandbox srcdoc="${escapeHtml(artifact.content || '')}" class="viz-frame"></iframe>`;
      } else {
        vizRoot.innerHTML = `<pre>${escapeHtml(artifact.content || result.visualization.stdout || result.visualization.stderr || '')}</pre>`;
      }
      setMeta(`${result.visualization.kind || 'python'} · ${result.visualization.title || 'ChatWithYourData'}`);
      setVizStatus('aktualisiert', 'ok');
      return;
    }
  }

  if (result.text) {
    vizRoot.innerHTML = '<div class="muted">No visualization generated.</div>';
    setMeta('The assistant returned text only.');
    setVizStatus('empty', 'idle');
    return;
  }

  vizRoot.innerHTML = '<div class="muted">No output received.</div>';
  setMeta('No visualization generated.');
  setVizStatus('empty', 'idle');
}

function createCard(kind, title, text = '') {
  const card = document.createElement('article');
  card.className = `event-card ${kind}`;

  const header = document.createElement('div');
  header.className = 'event-header';

  const badge = document.createElement('div');
  badge.className = 'event-badge';
  badge.textContent = title;

  header.append(badge);

  const body = document.createElement('div');
  body.className = 'event-body';
  if (text) body.textContent = text;

  card.append(header, body);
  return { card, body };
}

function renderUserMessage(text) {
  hideChatIntro();
  const { card, body } = createCard('user', 'Du');
  body.innerHTML = escapeHtml(text).replaceAll('\n', '<br>');
  chatLog.append(card);
  scrollBottom(chatLog);
}

function finishAssistantText(finalText) {
  hideChatIntro();
  const { card, body } = createCard('assistant', 'ChatWithYourData');
  body.innerHTML = escapeHtml(finalText).replaceAll('\n', '<br>');
  card.classList.add('done');
  chatLog.append(card);
  scrollBottom(chatLog);
}

function appendActivity(kind, title, text = '') {
  const { card, body } = createCard(kind, title, text);
  body.classList.add('activity-text');
  if (text) {
    body.innerHTML = escapeHtml(text).replaceAll('\n', '<br>');
  }
  chatLog.append(card);
  scrollBottom(chatLog);
}

function classifyEvent(event) {
  const rawType = String(event?.type || '').toLowerCase();
  const kind = String(event?.kind || '').toLowerCase();
  const text = String(event?.text || event?.message || '');

  if (kind === 'assistant-final') return { type: 'assistant-final', text };
  if (kind === 'text' || rawType === 'text') return { type: 'text', text };
  if (kind === 'thinking' || rawType.includes('think') || rawType.includes('reason')) return { type: 'thinking', text: text || 'denkt nach ...' };
  if (kind === 'command' || rawType.includes('command') || rawType.includes('shell') || rawType.includes('exec')) return { type: 'command', text: text || rawType };
  if (kind === 'tool' || rawType.includes('tool')) return { type: 'tool', text: text || rawType };
  if (kind === 'output' || rawType.includes('stdout') || rawType.includes('stderr') || rawType.includes('output')) return { type: 'output', text };
  if (kind === 'error' || rawType === 'error') return { type: 'error', text: text || 'Error' };
  return { type: 'event', text: text || JSON.stringify(event.raw || event, null, 2) };
}

function resetRunUi() {
  vizRoot.innerHTML = '<div class="muted">Waiting for output ...</div>';
  setMeta('ChatWithYourData is processing the prompt.');
  setVizStatus('running', 'busy');
}

async function readNdjson(response, onLine) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          onLine(JSON.parse(line));
        } catch {
          onLine({ type: 'event', text: line });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function handleStreamPayload(payload) {
  if (!payload) return;

  if (payload.type === 'session') {
    state.sessionId = payload.sessionId || state.sessionId;
    setBusy(true);
    return;
  }

  if (payload.type === 'final') {
    state.sessionId = payload.sessionId || state.sessionId;
    setStatusPill(connectionStatus, state.sessionId ? 'connected' : 'ready', state.sessionId ? 'connected' : 'idle');
    const assistantText = payload.text || (payload.visualization ? 'Visualization generated.' : 'Response received.');
    finishAssistantText(assistantText);
    renderVisualization(payload);
    setBusy(false);
    return;
  }

  if (payload.type === 'error') {
    appendActivity('error', 'Error', payload.error || 'Unknown error');
    setBusy(false);
  }
}

async function sendMessage(message) {
  const body = {
    message,
    sessionId: state.sessionId,
  };

  if (shouldVisualize(message)) {
    setVizStatus('visualizing', 'busy');
  }

  resetRunUi();
  setBusy(true);
  renderUserMessage(message);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');

    state.sessionId = data.sessionId || state.sessionId;
    setStatusPill(connectionStatus, state.sessionId ? 'connected' : 'ready', state.sessionId ? 'connected' : 'idle');
    finishAssistantText(data.text || (data.visualization ? 'Visualization generated.' : 'Response received.'));
    renderVisualization(data);
  } catch (error) {
    finishAssistantText(`Error: ${error.message || 'Unknown error'}`);
    vizRoot.innerHTML = '<div class="muted">No visualization available.</div>';
    setMeta('Error while running the prompt.');
    setVizStatus('error', 'error');
  } finally {
    setBusy(false);
    chatInput.focus();
    syncComposerHeight();
  }
}

function syncComposerHeight() {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 180)}px`;
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
syncComposerHeight();
