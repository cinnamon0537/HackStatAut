import test from 'node:test';
import assert from 'node:assert/strict';

import { extractVisualizationSpecs } from '../lib/vizjson.js';

test('extracts one visualization from plain JSON inside explanation text', () => {
  const input = `text before

{
  "type":"bar",
  "title":"Test",
  "data":[
    {"label":"A","value":3},
    {"label":"B","value":7}
  ]
}

text after`;

  const specs = extractVisualizationSpecs(input);

  assert.equal(specs.length, 1);
  assert.equal(specs[0].type, 'bar');
  assert.equal(specs[0].title, 'Test');
  assert.deepEqual(specs[0].data, [
    { label: 'A', value: 3 },
    { label: 'B', value: 7 },
  ]);
});

test('normalizes missing title and numeric strings', () => {
  const input = `{"type":"bar","data":[{"label":"A","value":"3"},{"label":"B","value":"7"}]}`;
  const specs = extractVisualizationSpecs(input);

  assert.equal(specs.length, 1);
  assert.equal(specs[0].title, 'Visualization');
  assert.equal(specs[0].data[0].value, 3);
  assert.equal(specs[0].data[1].value, 7);
});

test('returns empty list when no visualization JSON is present', () => {
  const input = 'Balkengrafik erwuenscht, aber kein parsebares Visualisierungsobjekt vorhanden.';
  const specs = extractVisualizationSpecs(input);
  assert.deepEqual(specs, []);
});
