const opencodeFrame = document.getElementById('opencode-frame');
const reloadButton = document.getElementById('reload-opencode');

function reloadOpenCode() {
  if (!opencodeFrame?.src) return;
  opencodeFrame.src = opencodeFrame.src;
}

async function loadRuntimeConfig() {
  const fallback = 'http://127.0.0.1:4096/';
  if (opencodeFrame) {
    opencodeFrame.src = fallback;
  }
}

reloadButton?.addEventListener('click', reloadOpenCode);

void loadRuntimeConfig();
