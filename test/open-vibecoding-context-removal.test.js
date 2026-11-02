import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { parseCommandArgs, usage } from '../src/cli/args.js';
import { initWorkspace } from '../src/open-vibecoding.js';
import { makeCodexHookProject, runCodexHook } from './helpers/requirement-gate-helpers.js';

test('run CLI no longer exposes context-management flags', () => {
  assert.doesNotMatch(usage(), /--context|--hook-inject/);
  const parsed = parseCommandArgs(['run', '.', '--context', '--hook-inject']);
  assert.equal('context' in parsed.flags, false);
  assert.equal('hookInject' in parsed.flags, false);
});

test('UserPromptSubmit records the prompt with a lightweight scenario reminder, not a context capsule', async () => {
  const { project } = await makeCodexHookProject();
  const payload = runCodexHook(project, 'UserPromptSubmit', {
    prompt: '继续实现当前任务，并处理发布。',
  });
  assert.equal(payload.continue, true);
  assert.match(payload.hookSpecificOutput?.additionalContext, /open-vibecoding-router/);
  assert.doesNotMatch(payload.hookSpecificOutput?.additionalContext, /ContextCapsule|--hook-inject/);
  const events = await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'events.jsonl'), 'utf8');
  assert.match(events, /prompt-observed/);
  assert.doesNotMatch(events, /context-injected/);
});

test('generated hooks contain no context command or capsule renderer', async () => {
  const { project } = await makeCodexHookProject();
  await initWorkspace(project, { templatePack: 'agent' });
  const hook = await fs.readFile(path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), 'utf8');
  assert.doesNotMatch(hook, /--context|--hook-inject|ContextCapsule|context-injected/);
});
