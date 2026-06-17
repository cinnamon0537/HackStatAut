const ALLOWED_VIZ_TYPES = new Set(['bar', 'pie', 'table', 'tree', 'python']);

function coerceNumericStrings(value) {
  if (Array.isArray(value)) {
    return value.map(coerceNumericStrings);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, coerceNumericStrings(item)]),
    );
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
  }

  return value;
}

function normalizeVizSpec(spec) {
  const normalized = coerceNumericStrings(spec);
  return {
    ...normalized,
    title: typeof normalized.title === 'string' && normalized.title.trim()
      ? normalized.title.trim()
      : 'Visualization',
    type: String(normalized.type || '').toLowerCase(),
  };
}

function isVisualizationSpec(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const type = String(candidate.type || '').toLowerCase();
  return ALLOWED_VIZ_TYPES.has(type);
}

function extractFencedVizSpecs(text) {
  const specs = [];
  const blocks = String(text || '').matchAll(/```vizjson\s*([\s\S]*?)```/gi);
  for (const match of blocks) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (isVisualizationSpec(parsed)) specs.push(normalizeVizSpec(parsed));
    } catch {
      // ignore invalid fenced blocks
    }
  }
  return specs;
}

function extractPlainJsonObjects(text) {
  const input = String(text || '');
  const matches = [];

  for (let start = 0; start < input.length; start += 1) {
    if (input[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < input.length; index += 1) {
      const char = input[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;

      if (depth === 0) {
        const candidate = input.slice(start, index + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (isVisualizationSpec(parsed)) {
            matches.push(normalizeVizSpec(parsed));
            start = index;
          }
        } catch {
          // ignore non-json object text
        }
        break;
      }
    }
  }

  return matches;
}

export function extractVisualizationSpecs(text) {
  const unique = new Map();

  for (const spec of [...extractFencedVizSpecs(text), ...extractPlainJsonObjects(text)]) {
    const key = JSON.stringify(spec);
    if (!unique.has(key)) unique.set(key, spec);
  }

  return [...unique.values()];
}

export function stripFencedVizSpecs(text) {
  return String(text || '').replace(/```vizjson\s*[\s\S]*?```/gi, '').trim();
}
