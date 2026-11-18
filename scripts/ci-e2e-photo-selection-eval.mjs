import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const [root, engine, fixedRunId] = process.argv.slice(2);
assert.ok(root && fixedRunId && ['playwright', 'maestro'].includes(engine),
  'Expected report directory, engine, and fixed run ID');

const originalIds = Array.from({ length: 9 }, (_, index) => 'P0' + (index + 1));
const replacementIds = ['P10', ...originalIds.slice(1)];
const fixedValues = {
  count: 9,
  blocked: { notice: true, tenthSelected: false },
  selection: originalIds,
  returned: originalIds,
};
const defectValues = {
  blocked: { notice: false, tenthSelected: true },
  selection: replacementIds,
  returned: replacementIds,
};

async function readRun(directory, id) {
  const base = path.join(root, directory);
  const report = JSON.parse(await readFile(path.join(base, 'results.json'), 'utf8'));
  const matched = report.runs.filter(run => run.id === id && run.engine === engine);
  assert.equal(matched.length, 1, id);
  const [run] = matched;
  const evidence = [...new Set([...run.evidence, ...run.dataPreparation.evidence])];
  assert.ok(evidence.length > 0, id + ' has no evidence');
  for (const file of evidence) {
    assert.ok((await stat(path.join(base, file))).isFile(), file);
  }
  return run;
}

function checkData(run, photos) {
  assert.deepEqual(Object.fromEntries(run.dataPreparation.checks.map(check => [check.id, check.actual])),
    { 'photo-ids': photos, 'selected-ids': [] });
}

function checkCases(run, expected, status) {
  assert.deepEqual(run.cases.map(item => item.id).sort(), Object.keys(expected).sort());
  for (const item of run.cases) {
    assert.equal(item.status, status, item.id);
    assert.equal(item.attempts[0]?.status, status, item.id + ' first attempt');
    assert.deepEqual(item.actual, expected[item.id], item.id);
  }
  assert.ok(run.evidence.some(file => file.endsWith(engine === 'playwright' ? '/playwright.json' : '/maestro.xml')),
    'Missing raw runner output');
}

const fixed = await readRun('.', fixedRunId);
assert.equal(fixed.status, 'passed');
checkData(fixed, [...originalIds, 'P10']);
checkCases(fixed, fixedValues, 'passed');

const count = await readRun('defect-count', engine + '-defect-count');
assert.equal(count.status, 'passed');
checkCases(count, { count: 9 }, 'passed');

const defect = await readRun('defect-identity', engine + '-defect-identity');
assert.equal(defect.status, 'assertion_failed');
checkCases(defect, defectValues, 'assertion_failed');

let missingPhoto;
if (engine === 'playwright') {
  const missing = await readRun('missing-photo', fixedRunId);
  assert.equal(missing.status, 'environment_error');
  assert.equal(missing.dataPreparation.status, 'verify_failed');
  checkData(missing, originalIds);
  assert.deepEqual(missing.cases.map(item => item.id).sort(), Object.keys(fixedValues).sort());
  assert.ok(missing.cases.every(item => item.status === 'not_run' && item.attempts.length === 0));
  assert.ok(!missing.evidence.some(file => /\/(?:playwright\.json|runner\.log)$/.test(file)));
  missingPhoto = { blockedBeforeRunner: true, casesNotRun: missing.cases.length };
}

console.log(JSON.stringify({
  gitSha: process.env.GITHUB_SHA ?? null,
  gitRef: process.env.GITHUB_REF ?? null,
  engine,
  fixed: { firstAttemptPassed: fixed.cases.length, required: Object.keys(fixedValues).length, durationMs: fixed.durationMs },
  defect: { countOnlyPassed: true, mismatchesDetected: defect.cases.length },
  missingPhoto,
}, null, 2));
