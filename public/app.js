const opencodeFrame = document.getElementById('opencode-frame');
const opencodeStatus = document.getElementById('opencode-status');
const visualizeNext = document.getElementById('visualize-next');
const visualizeMode = document.getElementById('visualize-mode');
const vizRoot = document.getElementById('viz-root');
const vizMeta = document.getElementById('viz-meta');

const VIZ_PROMPT = [
  'Wenn die Aufgabe eine Visualisierung, Tabelle, ein Diagramm oder eine andere strukturierte Ausgabe verlangt, antworte zusätzlich mit genau einem fenced code block ```vizjson```.',
  'Das JSON darin muss valide sein.',
  'Erlaubte Typen: table, tree, bar, pie, python.',
  'Für type=table: {"type":"table","title":"...","rows":[{"col":1}]}',
  'Für type=tree: {"type":"tree","title":"...","tree":{}}',
  'Für type=bar oder pie: {"type":"bar|pie","title":"...","data":[{"label":"A","value":1}]}',
  'Für type=python: {"type":"python","title":"...","code":"...","output":"svg"}',
  'Wenn keine Visualisierung nötig ist, antworte normal ohne vizjson-Block.',
].join(' ');

const state = {
  visualizeNext: false,
  opencodePatched: false,
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
  opencodeStatus.textContent = isBusy ? 'arbeitet ...' : 'bereit';
}

function setMeta(text) {
  vizMeta.textContent = text;
}

function setVisualizationMode(active) {
  state.visualizeNext = active;
  visualizeMode.textContent = active ? 'wartet auf nächsten prompt' : 'bereit';
  visualizeMode.classList.toggle('active', active);
  visualizeNext.setAttribute('aria-pressed', String(active));
}

function patchOpenCodeFetch() {
  if (state.opencodePatched) return;

  let win;
  try {
    win = opencodeFrame.contentWindow;
    if (!win) return;
    void win.location.href;
  } catch {
    return;
  }

  try {
    const originalFetch = win.fetch?.bind(win);
    if (originalFetch) {
      win.fetch = async (input, init = {}) => {
        if (state.visualizeNext) {
          const url = typeof input === 'string' ? input : input?.url || '';
          if (/\/session\/[^/]+\/(message|prompt_async)/.test(url)) {
            let bodyText = '';
            if (typeof init.body === 'string') {
              bodyText = init.body;
            } else if (init.body instanceof URLSearchParams) {
              bodyText = init.body.toString();
            } else if (input instanceof Request) {
              bodyText = await input.clone().text();
            }

            if (bodyText) {
              try {
                const payload = JSON.parse(bodyText);
                const system = String(payload.system || '').trim();
                payload.system = system ? `${system}\n\n${VIZ_PROMPT}` : VIZ_PROMPT;
                init = { ...init, body: JSON.stringify(payload) };
                setVisualizationMode(false);
                setMeta('Visualisierung für den nächsten OpenCode-Prompt ist aktiv.');
              } catch {
                // leave request unchanged
              }
            }
          }
        }

        return originalFetch(input, init);
      };
    }

    const xhrProto = win.XMLHttpRequest?.prototype;
    if (xhrProto && !xhrProto.__vizPatched) {
      const originalOpen = xhrProto.open;
      const originalSend = xhrProto.send;
      xhrProto.open = function (...args) {
        this.__vizUrl = String(args[1] || '');
        return originalOpen.apply(this, args);
      };
      xhrProto.send = function (body) {
        if (state.visualizeNext && /\/session\/[^/]+\/(message|prompt_async)/.test(String(this.__vizUrl || ''))) {
          try {
            const payload = typeof body === 'string' ? JSON.parse(body) : null;
            if (payload && typeof payload === 'object') {
              const system = String(payload.system || '').trim();
              payload.system = system ? `${system}\n\n${VIZ_PROMPT}` : VIZ_PROMPT;
              body = JSON.stringify(payload);
              setVisualizationMode(false);
              setMeta('Visualisierung für den nächsten OpenCode-Prompt ist aktiv.');
            }
          } catch {
            // leave request unchanged
          }
        }
        return originalSend.call(this, body);
      };
      xhrProto.__vizPatched = true;
    }

    state.opencodePatched = true;
    setMeta('OpenCode ist verbunden.');
  } catch {
    // same-origin hook not ready yet
  }
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

opencodeFrame.addEventListener('load', () => {
  opencodeStatus.textContent = 'bereit';
  state.opencodePatched = false;
  patchOpenCodeFetch();
});

visualizeNext.addEventListener('click', () => {
  setVisualizationMode(!state.visualizeNext);
  setMeta(state.visualizeNext ? 'Der nächste Prompt im OpenCode-Fenster wird als Visualisierung behandelt.' : 'Visualisierungsmodus ist aus.');
  patchOpenCodeFetch();
});

setVisualizationMode(false);
setMeta('Bereit für den nächsten Prompt.');
