const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatLog = document.getElementById('chat-log');
const chatIntro = document.getElementById('chat-intro');
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

function scrollBottom(node) {
  node.scrollTop = node.scrollHeight;
}

function hideChatIntro() {
  if (chatIntro) chatIntro.hidden = true;
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

function setBusy(isBusy) {
  state.busy = isBusy;
  if (chatInput) chatInput.disabled = isBusy;
  const submit = chatForm?.querySelector('button[type="submit"]');
  if (submit) submit.disabled = isBusy;
}

function syncComposerHeight() {
  if (!chatInput) return;
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 180)}px`;
}

async function sendMessage(message) {
  setBusy(true);
  renderUserMessage(message);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId: state.sessionId }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');

    state.sessionId = data.sessionId || state.sessionId;
    finishAssistantText(data.text || 'Response received.');
  } catch (error) {
    finishAssistantText(`Error: ${error.message || 'Unknown error'}`);
  } finally {
    setBusy(false);
    chatInput?.focus();
    syncComposerHeight();
  }
}

chatForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || state.busy) return;
  chatInput.value = '';
  syncComposerHeight();
  void sendMessage(message);
});

chatInput?.addEventListener('input', syncComposerHeight);
chatInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

setBusy(false);
syncComposerHeight();
