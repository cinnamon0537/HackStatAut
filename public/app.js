const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatLog = document.getElementById('chat-log');
const activityLog = document.getElementById('activity-log');
const opencodeStatus = document.getElementById('opencode-status');
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
  node.textContent = text;
  node.dataset.tone = tone;
}

function setBusy(isBusy) {
  state.busy = isBusy;
  setStatusPill(opencodeStatus, isBusy ? 'arbeitet ...' : state.sessionId ? 'verbunden' : 'bereit', isBusy ? 'busy' : state.sessionId ? 'connected' : 'idle');
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
      setMeta(`${result.visualization.kind || 'visual'} · ${result.visualization.title || 'OpenCode'}`);
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
      setMeta(`${result.visualization.kind || 'python'} · ${result.visualization.title || 'OpenCode'}`);
      setVizStatus('aktualisiert', 'ok');
      return;
    }
  }

  if (result.text) {
    vizRoot.innerHTML = '<div class="muted">Keine Visualisierung erzeugt.</div>';
    setMeta('OpenCode hat eine Textantwort geliefert.');
    setVizStatus('leer', 'idle');
    return;
  }

  vizRoot.innerHTML = '<div class="muted">Keine Ausgabe erhalten.</div>';
  setMeta('Keine Visualisierung erzeugt.');
  setVizStatus('leer', 'idle');
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

function ensureAssistantMessage() {
  hideChatIntro();
  if (state.activeAssistant) return state.activeAssistant;

  const { card, body } = createCard('assistant', 'OpenCode');
  card.classList.add('assistant-stream');
  body.className = 'event-body assistant-live';
  body.innerHTML = '<span class="assistant-cursor">▍</span>';
  chatLog.append(card);
  scrollBottom(chatLog);

  state.activeAssistant = {
    card,
    body,
    text: '',
  };

  return state.activeAssistant;
}

function setAssistantText(nextText, { append = false } = {}) {
  const assistant = ensureAssistantMessage();
  assistant.text = append ? `${assistant.text}${nextText}` : nextText;
  assistant.body.innerHTML = `${escapeHtml(assistant.text).replaceAll('\n', '<br>')}<span class="assistant-cursor">▍</span>`;
  scrollBottom(chatLog);
}

function finishAssistantText(finalText) {
  const assistant = ensureAssistantMessage();
  assistant.text = finalText;
  assistant.body.innerHTML = escapeHtml(finalText).replaceAll('\n', '<br>');
  assistant.card.classList.add('done');
  scrollBottom(chatLog);
  state.activeAssistant = null;
}

function appendActivity(kind, title, text = '') {
  const { card, body } = createCard(kind, title, text);
  body.classList.add('activity-text');
  if (text) {
    body.innerHTML = escapeHtml(text).replaceAll('\n', '<br>');
  }
  activityLog.append(card);
  scrollBottom(activityLog);
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
  if (kind === 'error' || rawType === 'error') return { type: 'error', text: text || 'Fehler' };
  return { type: 'event', text: text || JSON.stringify(event.raw || event, null, 2) };
}

function resetRunUi() {
  activityLog.innerHTML = '';
  state.activeAssistant = null;
  vizRoot.innerHTML = '<div class="muted">Warte auf Ausgabe ...</div>';
  setMeta('OpenCode verarbeitet den Prompt.');
  setVizStatus('läuft', 'busy');
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

  if (payload.type === 'event') {
    const event = classifyEvent(payload.event);

    if (event.type === 'text') {
      setAssistantText(event.text, { append: true });
      setStreamStatus('streaming', 'busy');
      return;
    }

    if (event.type === 'assistant-final') {
      finishAssistantText(state.activeAssistant?.text || event.text || 'Antwort erhalten.');
      setStreamStatus('fertig', 'ok');
      return;
    }

    if (event.type === 'thinking') {
      appendActivity('thinking', 'Thinking', event.text || 'denkt nach ...');
      return;
    }

    if (event.type === 'command') {
      appendActivity('command', 'Command', event.text || 'command');
      return;
    }

    if (event.type === 'tool') {
      appendActivity('tool', 'Tool', event.text || 'tool');
      return;
    }

    if (event.type === 'output') {
      appendActivity('output', 'Output', event.text || '');
      return;
    }

    if (event.type === 'error') {
      appendActivity('error', 'Error', event.text || 'Unbekannter Fehler');
      return;
    }

    appendActivity('event', 'Event', event.text || '');
    return;
  }

  if (payload.type === 'final') {
    state.sessionId = payload.sessionId || state.sessionId;
    opencodeStatus.textContent = state.sessionId ? 'verbunden' : 'bereit';
    const assistantText = payload.text || (payload.visualization ? 'Visualisierung erzeugt.' : 'Antwort erhalten.');
    finishAssistantText(assistantText);
    renderVisualization(payload);
    setBusy(false);
    return;
  }

  if (payload.type === 'error') {
    appendActivity('error', 'Error', payload.error || 'Unbekannter Fehler');
    setBusy(false);
  }
}

async function sendMessage(message) {
  const body = {
    message,
    sessionId: state.sessionId,
  };

  if (shouldVisualize(message)) {
    setVizStatus('erkennt visuell', 'busy');
  }

  resetRunUi();
  setBusy(true);
  renderUserMessage(message);
  ensureAssistantMessage();

  try {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Stream fehlgeschlagen');
    }

    await readNdjson(response, handleStreamPayload);
  } catch (error) {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unbekannter Fehler');

      state.sessionId = data.sessionId || state.sessionId;
      opencodeStatus.textContent = state.sessionId ? 'verbunden' : 'bereit';
      finishAssistantText(data.text || (data.visualization ? 'Visualisierung erzeugt.' : 'Antwort erhalten.'));
      renderVisualization(data);
    } catch (fallbackError) {
      finishAssistantText(`Fehler: ${fallbackError.message || error.message}`);
      vizRoot.innerHTML = '<div class="muted">Keine Visualisierung verfügbar.</div>';
      setMeta('Fehler beim Ausführen des OpenCode-Prompts.');
      setVizStatus('fehler', 'error');
    }
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
setVizStatus('wartet', 'idle');
setMeta('Bereit für eine Visualisierung oder eine normale Antwort.');
syncComposerHeight();
