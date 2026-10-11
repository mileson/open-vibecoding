import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { setupOpenPrdAgentIntegration } from '../src/agent-integration.js';

const fragment = await fs.readFile(new URL('../skills/open-vibecoding-harness/references/review-handoff.html', import.meta.url), 'utf8');
const script = fragment.match(/<script>([\s\S]*?)<\/script>/)[1];
function environment(writeText = async () => {}) {
  const home = { appendChild(node) { node.parentNode = this; } };
  const elements = Object.fromEntries(['copy', 'toast', 'dialog', 'manual', 'close'].map((name) => [`ovc-review-${name}`, {
    disabled: name === 'copy', attributes: {}, className: '', textContent: '', parentNode: home,
    appendChild(node) { node.parentNode = this; },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    focus() { this.focused = true; }, select() { this.selected = true; },
    showModal() { this.open = true; }, close() { this.open = false; },
  }]));
  const timers = new Map(); let id = 0;
  const space = {};
  const footer = { className: '', parentNode: home };
  elements['ovc-review-copy'].parentNode = footer;
  const context = { window: {}, document: { getElementById: (key) => elements[key], querySelector: () => space }, navigator: { clipboard: { writeText } },
    setTimeout(callback, ms) { const key = ++id; timers.set(key, { callback, ms }); return key; },
    clearTimeout(key) { timers.delete(key); },
  };
  vm.runInNewContext(script, context);
  return { api: context.window.OpenVibeCodingReview, window: context.window, elements, timers, space, footer };
}
function input() {
  return { document_id: 'example-review', version: 'v002', title: '回答恢复方案', notes: '保留问题原文', decisions: [
    { id: 'restore', label: '断网恢复', reviewed: true, value: '采用', notes: '回来后显示同一条回答' },
    { id: 'scope', label: '首版范围', reviewed: false, value: '采用', recommendation: '先做文字咨询' },
  ] };
}

test('existing top toolbar reuses one copy button without a duplicate bottom action', async () => {
  const { api, elements, space, footer } = environment();
  const toolbar = { appendChild(node) { node.parentNode = this; } };
  const controller = api.mount({ getSelection: input, toolbar });
  assert.equal(footer.parentNode, toolbar);
  assert.equal(footer.className, 'ovc-review-footer in-toolbar');
  assert.equal(space.hidden, true);
  await controller.copy();
  assert.equal(elements['ovc-review-toast'].className, 'ovc-review-toast show in-toolbar');
});

test('unreviewed defaults cannot become user decisions; readable text and JSON use one snapshot', () => {
  const { api } = environment();
  const selected = api.snapshot(input());
  assert.equal(selected.decisions[1].value, null);
  assert.equal(selected.review_only, true);
  const text = api.format(selected);
  assert.ok(text.startsWith('评审结果\n主题：回答恢复方案\n页面版本：v002\n已明确选择 1 项，待评审 1 项。'));
  assert.ok(text.includes('首版范围：待评审'));
  assert.deepEqual(JSON.parse(text.split('结构化评审数据\n')[1]), JSON.parse(JSON.stringify(selected)));
});

test('copy reads latest edits, supports deselection and keeps content as plain text', async () => {
  const copied = [];
  const { api, window, elements, timers } = environment(async (text) => copied.push(text));
  const state = input();
  const controller = api.mount({ getSelection: () => state });
  state.notes = '<script>this is a user note</script>\n最新意见';
  assert.equal((await controller.copy()).status, 'copied');
  assert.ok(copied[0].includes(state.notes));
  state.decisions[0].reviewed = false;
  state.notes = '改选后还需要讨论';
  await controller.copy();
  assert.ok(copied[1].includes('已明确选择 0 项，待评审 2 项。'));
  assert.equal(window.getReviewSelection().notes, state.notes);
  assert.equal(elements['ovc-review-copy'].disabled, false);
  assert.equal(elements['ovc-review-toast'].className, 'ovc-review-toast show');
  assert.equal(timers.size, 1);
  const timer = [...timers.values()][0];
  assert.equal(timer.ms, 2300);
  timer.callback();
  assert.equal(elements['ovc-review-toast'].textContent, '');
});

test('clipboard denial shows complete selectable content without a false success', async () => {
  const { api, elements } = environment(async () => { throw new Error('Denied'); });
  const controller = api.mount({ getSelection: input });
  const result = await controller.copy();
  assert.equal(result.status, 'manual');
  assert.equal(elements['ovc-review-dialog'].open, true);
  assert.equal(elements['ovc-review-manual'].selected, true);
  assert.equal(elements['ovc-review-manual'].scrollTop, 0);
  assert.equal(elements['ovc-review-toast'].parentNode, elements['ovc-review-dialog']);
  assert.equal(elements['ovc-review-manual'].value, api.format(result.selection));
  assert.ok(elements['ovc-review-toast'].className.includes('warning'));
  assert.ok(!elements['ovc-review-toast'].textContent.includes('已复制'));
  elements['ovc-review-close'].onclick();
  assert.equal(elements['ovc-review-dialog'].open, false);
  assert.equal(elements['ovc-review-copy'].focused, true);
  assert.notEqual(elements['ovc-review-toast'].parentNode, elements['ovc-review-dialog']);
});

test('invalid state does not copy, and an in-flight copy cannot be submitted twice', async () => {
  let calls = 0; let release;
  const { api } = environment(() => { calls++; return new Promise((resolve) => { release = resolve; }); });
  const state = input();
  const controller = api.mount({ getSelection: () => state });
  state.version = '';
  assert.equal((await controller.copy()).status, 'invalid');
  assert.equal(calls, 0);
  state.version = 'v003';
  const pending = controller.copy();
  assert.equal((await controller.copy()).status, 'busy');
  assert.equal(calls, 1);
  release();
  assert.equal((await pending).status, 'copied');
  assert.throws(() => api.snapshot({ ...input(), decisions: [input().decisions[0], input().decisions[0]] }), /Duplicate/);
});

test('installed internal harness carries runnable component and contract without exposing a new menu skill', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-handoff-install-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, '.gitignore'), '.open-vibecoding/harness/\n.open-vibecoding/learning/\n.open-vibecoding/quality/reports/\n');
  const result = await setupOpenPrdAgentIntegration(root, { tools: 'codex,claude,cursor', enableUserCodexConfig: false, openprdHome: path.join(root, 'registry') });
  assert.equal(result.ok, true);
  assert.ok((await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).includes('references/review-handoff.md'));
  for (const base of ['.open-vibecoding/harness/internal-skills', '.claude/skills']) {
    const installed = await fs.readFile(path.join(root, base, 'open-vibecoding-harness/references/review-handoff.html'), 'utf8');
    new vm.Script(installed.match(/<script>([\s\S]*?)<\/script>/)[1]);
    assert.ok(installed.includes('复制评审结果给 AI'));
    await fs.access(path.join(root, base, 'open-vibecoding-harness/references/review-handoff.md'));
  }
  assert.equal((await fs.readdir(path.join(root, '.codex/skills'))).some((name) => name.includes('handoff')), false);
});
