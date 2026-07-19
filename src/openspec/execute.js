import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveOpenSpecChangeId } from './change-validate.js';
import { cjoin, resolveChangeDir } from './paths.js';
import { timestamp } from '../time.js';
import {
  listOpenSpecStructuredTasks,
  isOpenSpecTaskBlocking,
  parseOpenSpecTaskDeps,
  summarizeOpenSpecTaskTypes,
} from './tasks.js';

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function appendJsonl(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function getDependencyState(task, taskById) {
  const deps = parseOpenSpecTaskDeps(task.metadata.deps);
  const missing = [];
  const incomplete = [];

  for (const depId of deps) {
    const dependency = taskById.get(depId);
    if (!dependency) {
      missing.push(depId);
      continue;
    }
    if (!dependency.checked) {
      incomplete.push(depId);
    }
  }

  return {
    deps,
    missing,
    incomplete,
    ready: missing.length === 0 && incomplete.length === 0,
  };
}

function summarizeOpenSpecTasks(tasks, taskById) {
  const pending = tasks.filter((task) => !task.checked);
  const completed = tasks.filter((task) => task.checked);
  const taskTypes = summarizeOpenSpecTaskTypes(tasks);
  const blocked = pending
    .map((task) => ({
      task,
      dependencyState: getDependencyState(task, taskById),
    }))
    .filter((item) => !item.dependencyState.ready);
  const ready = pending.filter((task) => getDependencyState(task, taskById).ready);
  const nextReady = ready.find((task) => isOpenSpecTaskBlocking(task)) ?? ready[0] ?? null;
  const blockingTasks = tasks.filter((task) => isOpenSpecTaskBlocking(task));
  const backgroundTasks = tasks.filter((task) => !isOpenSpecTaskBlocking(task));
  const blockingPending = pending.filter((task) => isOpenSpecTaskBlocking(task));
  const backgroundPending = pending.filter((task) => !isOpenSpecTaskBlocking(task));

  return {
    total: tasks.length,
    completed: completed.length,
    pending: pending.length,
    blockingTotal: blockingTasks.length,
    blockingPending: blockingPending.length,
    backgroundTotal: backgroundTasks.length,
    backgroundPending: backgroundPending.length,
    blocked: blocked.length,
    taskTypes,
    implementation: taskTypes.implementation ?? { total: 0, completed: 0, pending: 0 },
    nextReady,
    blockedTasks: blocked,
  };
}

async function loadTaskState(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const { files, tasks, taskById } = await listOpenSpecStructuredTasks(projectRoot, { changeId });
  const summary = summarizeOpenSpecTasks(tasks, taskById);

  return {
    projectRoot,
    changeId,
    changeDir: await resolveChangeDir(projectRoot, changeId),
    files,
    tasks,
    taskById,
    summary,
  };
}

function resolveTaskSelection(state, options = {}) {
  const requestedId = options.item ?? options.id ?? null;
  const task = requestedId
    ? state.taskById.get(requestedId)
    : state.summary.nextReady;

  if (!task) {
    if (requestedId) {
      throw new Error(`Unknown OpenPrd task: ${requestedId}`);
    }
    throw new Error('No ready OpenPrd task is available.');
  }

  return task;
}

function assertTaskReady(task, state) {
  const dependencyState = getDependencyState(task, state.taskById);
  if (dependencyState.missing.length > 0) {
    throw new Error(`${task.id} depends on unknown task(s): ${dependencyState.missing.join(', ')}`);
  }
  if (dependencyState.incomplete.length > 0) {
    throw new Error(`${task.id} 被未完成任务阻塞: ${dependencyState.incomplete.join(', ')}`);
  }
  return dependencyState;
}

function isTaskEvidenceRequiredCommand(command) {
  return /^openprd\s+tasks\s+\./i.test(String(command ?? ''))
    && /\s--evidence-required\b/i.test(String(command ?? ''));
}

function isLegacyPerTaskFullVerifyCommand(command) {
  return /^openprd\s+run\s+\.\s+--verify\s*$/i.test(String(command ?? '').replace(/\s+/g, ' ').trim());
}

function taskEvidenceState(task, options = {}) {
  const metadata = task?.metadata ?? {};
  const evidence = String(options.evidence ?? metadata.evidence ?? '').trim();
  const waiver = String(metadata.waiver ?? metadata['waiver-reason'] ?? '').trim();
  return {
    evidence,
    waiver,
    ok: Boolean(evidence || waiver),
  };
}

function buildTaskEvidenceVerification(command, task, options = {}) {
  const evidenceState = taskEvidenceState(task, options);
  const legacyHint = isLegacyPerTaskFullVerifyCommand(command)
    ? '旧任务里的 per-task openprd run . --verify 已保留给阶段或最终门禁，不会在任务推进时触发全局 quality。'
    : null;
  const hint = `${legacyHint ? `${legacyHint} ` : ''}先运行本任务最小足够测试或审查，再通过 --evidence <路径或摘要> 传入证据，或在 tasks.md 写入 evidence:/waiver-reason:。`;
  return {
    ok: evidenceState.ok,
    command,
    exitCode: evidenceState.ok ? 0 : 1,
    stdout: evidenceState.ok
      ? [
          'OpenPrd task evidence: passed',
          evidenceState.evidence ? `evidence: ${evidenceState.evidence}` : null,
          evidenceState.waiver ? `waiver: ${evidenceState.waiver}` : null,
          legacyHint,
          'scope: task-only; workspace quality is reserved for phase/final gates',
          '',
        ].filter(Boolean).join('\n')
      : '',
    stderr: evidenceState.ok
      ? ''
      : `OpenPrd task evidence: missing evidence for ${task?.id ?? 'task'}. ${hint}\n`,
  };
}

async function runVerifyCommand(command, cwd, context = {}) {
  if ((isTaskEvidenceRequiredCommand(command) || isLegacyPerTaskFullVerifyCommand(command)) && context.task) {
    return buildTaskEvidenceVerification(command, context.task, context);
  }

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-64000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-64000);
    });
    child.on('error', (error) => {
      resolve({
        ok: false,
        command,
        exitCode: null,
        stdout,
        stderr: `${stderr}${error.message}`,
      });
    });
    child.on('close', (exitCode) => {
      resolve({
        ok: exitCode === 0,
        command,
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

export async function checkOpenSpecTaskEvidenceWorkspace(projectRoot, options = {}) {
  const state = await loadTaskState(projectRoot, options);
  const task = resolveTaskSelection(state, options);
  assertTaskReady(task, state);
  const command = `openprd tasks . --change ${state.changeId} --item ${task.id} --evidence-required`;
  const verification = buildTaskEvidenceVerification(command, task, options);
  return {
    ok: verification.ok,
    action: 'evidence-check',
    projectRoot,
    changeId: state.changeId,
    task,
    verification,
  };
}

async function markTaskComplete(task) {
  const text = await readText(task.absolutePath);
  const lines = text.split(/\r?\n/);
  const index = task.lineNumber - 1;
  if (!lines[index]) {
    throw new Error(`Cannot update ${task.relativePath}:${task.lineNumber}; line is missing.`);
  }
  if (!lines[index].startsWith('- [x]') && !lines[index].startsWith('- [X]')) {
    lines[index] = lines[index].replace(/^- \[ \]/, '- [x]');
  }
  await writeText(task.absolutePath, lines.join('\n'));
}

async function appendTaskEvent(state, event) {
  await appendJsonl(cjoin(state.changeDir, 'task-events.jsonl'), {
    version: 1,
    at: timestamp(),
    changeId: state.changeId,
    ...event,
  });
}

export async function listOpenSpecTaskWorkspace(projectRoot, options = {}) {
  const state = await loadTaskState(projectRoot, options);
  return {
    ok: true,
    action: 'list',
    projectRoot,
    changeId: state.changeId,
    changeDir: state.changeDir,
    tasks: state.tasks,
    summary: {
      total: state.summary.total,
      completed: state.summary.completed,
      pending: state.summary.pending,
      blockingTotal: state.summary.blockingTotal,
      blockingPending: state.summary.blockingPending,
      backgroundTotal: state.summary.backgroundTotal,
      backgroundPending: state.summary.backgroundPending,
      blocked: state.summary.blocked,
      taskTypes: state.summary.taskTypes,
      implementation: state.summary.implementation,
    },
    nextTask: state.summary.nextReady,
    blockedTasks: state.summary.blockedTasks.map(({ task, dependencyState }) => ({
      id: task.id,
      title: task.title,
      missing: dependencyState.missing,
      incomplete: dependencyState.incomplete,
    })),
  };
}

export async function verifyOpenSpecTaskWorkspace(projectRoot, options = {}) {
  const state = await loadTaskState(projectRoot, options);
  const task = resolveTaskSelection(state, options);
  assertTaskReady(task, state);
  if (!task.metadata.verify) {
    throw new Error(`${task.id} is missing verify command.`);
  }
  const verification = await runVerifyCommand(task.metadata.verify, projectRoot, {
    task,
    state,
    evidence: options.evidence,
    notes: options.notes,
  });
  await appendTaskEvent(state, {
    action: 'verify',
    taskId: task.id,
    taskTitle: task.title,
    ok: verification.ok,
    verify: verification,
    evidence: options.evidence ?? null,
    notes: options.notes ?? null,
  });

  return {
    ok: verification.ok,
    action: 'verify',
    projectRoot,
    changeId: state.changeId,
    task,
    verification,
  };
}

export async function advanceOpenSpecTaskWorkspace(projectRoot, options = {}) {
  const state = await loadTaskState(projectRoot, options);
  const task = resolveTaskSelection(state, options);
  const dependencyState = assertTaskReady(task, state);
  let verification = null;

  if (options.verify) {
    if (!task.metadata.verify) {
      throw new Error(`${task.id} is missing verify command.`);
    }
    verification = await runVerifyCommand(task.metadata.verify, projectRoot, {
      task,
      state,
      evidence: options.evidence,
      notes: options.notes,
    });
    if (!verification.ok) {
      await appendTaskEvent(state, {
        action: 'advance_failed',
        taskId: task.id,
        taskTitle: task.title,
        ok: false,
        verify: verification,
        evidence: options.evidence ?? null,
        notes: options.notes ?? null,
      });
      return {
        ok: false,
        action: 'advance',
        projectRoot,
        changeId: state.changeId,
        task,
        dependencyState,
        verification,
        advanced: false,
      };
    }
  }

  await markTaskComplete(task);
  await appendTaskEvent(state, {
    action: 'advance',
    taskId: task.id,
    taskTitle: task.title,
    ok: true,
    verify: verification,
    evidence: options.evidence ?? null,
    notes: options.notes ?? null,
  });

  const updatedState = await loadTaskState(projectRoot, { change: state.changeId });
  return {
    ok: true,
    action: 'advance',
    projectRoot,
    changeId: state.changeId,
    task: {
      ...task,
      checked: true,
    },
    dependencyState,
    verification,
    advanced: true,
    nextTask: updatedState.summary.nextReady,
    summary: {
      total: updatedState.summary.total,
      completed: updatedState.summary.completed,
      pending: updatedState.summary.pending,
      blockingTotal: updatedState.summary.blockingTotal,
      blockingPending: updatedState.summary.blockingPending,
      backgroundTotal: updatedState.summary.backgroundTotal,
      backgroundPending: updatedState.summary.backgroundPending,
      blocked: updatedState.summary.blocked,
      taskTypes: updatedState.summary.taskTypes,
      implementation: updatedState.summary.implementation,
    },
  };
}
