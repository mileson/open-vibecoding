import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenSpecTaskFile } from '../src/openspec/tasks.js';

test('parseOpenSpecTaskFile captures oracle metadata', () => {
  const parsed = parseOpenSpecTaskFile([
    '- [ ] T001.01 Match legacy preview output',
    '  - done: preview matches legacy output',
    '  - verify: node -e "process.exit(0)"',
    '  - oracle: compare fixtures/golden-preview.json against the legacy preview',
    '',
  ].join('\n'));

  assert.equal(parsed.structuredTasks.length, 1);
  assert.equal(
    parsed.structuredTasks[0].metadata.oracle,
    'compare fixtures/golden-preview.json against the legacy preview',
  );
});
