/* Read-only compatibility for historical task files. */
import { resolveOpenSpecChangeId } from './change-validate.js';
import { resolveChangeDir } from './paths.js';
import {
  isOpenSpecTaskBlocking,
  listOpenSpecStructuredTasks,
  parseOpenSpecTaskDeps,
  summarizeOpenSpecTaskTypes,
} from './tasks.js';

export async function listOpenSpecTaskWorkspace(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const { tasks, taskById } = await listOpenSpecStructuredTasks(projectRoot, { changeId });
  const pending = tasks.filter((task) => !task.checked);
  const dependencyState = (task) => {
    const deps = parseOpenSpecTaskDeps(task.metadata.deps);
    return {
      missing: deps.filter((id) => !taskById.has(id)),
      incomplete: deps.filter((id) => taskById.has(id) && !taskById.get(id).checked),
    };
  };
  const blockedTasks = pending.flatMap((task) => {
    const state = dependencyState(task);
    return state.missing.length || state.incomplete.length
      ? [{ id: task.id, title: task.title, ...state }]
      : [];
  });
  const nextTask = pending.find((task) => {
    const state = dependencyState(task);
    return state.missing.length === 0 && state.incomplete.length === 0 && isOpenSpecTaskBlocking(task);
  }) ?? pending.find((task) => {
    const state = dependencyState(task);
    return state.missing.length === 0 && state.incomplete.length === 0;
  }) ?? null;
  const taskTypes = summarizeOpenSpecTaskTypes(tasks);
  return {
    ok: true,
    action: 'list',
    projectRoot,
    changeId,
    changeDir: await resolveChangeDir(projectRoot, changeId),
    tasks,
    summary: {
      total: tasks.length,
      completed: tasks.length - pending.length,
      pending: pending.length,
      blockingTotal: tasks.filter(isOpenSpecTaskBlocking).length,
      blockingPending: pending.filter(isOpenSpecTaskBlocking).length,
      backgroundTotal: tasks.filter((task) => !isOpenSpecTaskBlocking(task)).length,
      backgroundPending: pending.filter((task) => !isOpenSpecTaskBlocking(task)).length,
      blocked: blockedTasks.length,
      taskTypes,
      implementation: taskTypes.implementation ?? { total: 0, completed: 0, pending: 0 },
    },
    nextTask,
    blockedTasks,
  };
}
