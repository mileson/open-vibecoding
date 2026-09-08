import fs from 'node:fs/promises';
import path from 'node:path';
import { listOpenSpecTaskWorkspace } from './openspec/execute.js';

const PLACEHOLDER_TEXT = /^待(补充|澄清|确认)/u;

export const GUIDE_STAGES = [
  {
    id: 'clarify',
    title: '需求澄清',
    description: '把要解决的问题、目标用户和这次的目标讲清楚。',
    nextAction: '把想法直接告诉 Agent：要解决什么问题、给谁用、这次想达成什么。Agent 会用 openprd capture 记录下来。',
  },
  {
    id: 'draft',
    title: '需求摘要',
    description: '把当前可验证信息和可逆假设整理成一份 PRD 草稿。',
    nextAction: '让 Agent 运行 openprd synthesize，生成 PRD 草稿和评审页面。',
  },
  {
    id: 'review',
    title: '后台评审记录',
    description: 'Agent 用 review.html 记录主流程、功能、护栏和风险；它不是实现授权门禁。',
    nextAction: '让 Agent 在后台生成或更新 review.html；只有真实不可逆歧义才需要提问。',
  },
  {
    id: 'direction',
    title: '交互方向参考',
    description: '界面类需求会给出 2 到 4 个交互稿方向，Agent 采用可逆默认方向继续，用户后续可覆盖。',
    nextAction: '让 Agent 展示候选并说明默认方向；无需等待选择即可继续当前安全范围。',
  },
  {
    id: 'tasks',
    title: '任务拆解',
    description: '把已确认的需求拆成一份带验证要求的任务清单。',
    nextAction: '让 Agent 运行 openprd change . --generate 生成变更提案和任务清单。',
  },
  {
    id: 'build',
    title: '实现执行',
    description: 'Agent 按任务清单实现，每个任务完成后留下验证证据。',
    nextAction: '让 Agent 按任务清单继续实现；你可以随时问「现在做到哪一步了」。',
  },
  {
    id: 'wrapup',
    title: '验证收口',
    description: '汇总任务证据与结构校验，确认本次工作已经完成。',
    nextAction: '让 Agent 运行本任务测试、openprd standards . --verify 和 openprd run . --verify 收口。',
  },
];

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8').catch(() => null);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function guideWorkspace(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot);
  const stateDir = path.join(resolvedRoot, '.openprd', 'state');
  const current = await readJson(path.join(stateDir, 'current.json'));
  const changesState = await readJson(path.join(stateDir, 'changes.json'));

  const problemStatement = String(current?.problemStatement ?? '').trim();
  const clarified = problemStatement.length > 0 && !PLACEHOLDER_TEXT.test(problemStatement);

  const prdVersion = Number(current?.prdVersion ?? 0);
  const drafted = clarified && prdVersion >= 1;

  const reviewStatus = current?.reviewStatus ?? null;
  const reviewConfirmed = drafted && reviewStatus?.status === 'confirmed';

  let designDirections = null;
  const versionId = reviewStatus?.versionId ?? null;
  if (versionId) {
    const snapshot = await readJson(path.join(stateDir, 'versions', `${versionId}.json`));
    const block = snapshot?.reviewPresentation?.designDirections;
    if (block && Array.isArray(block.directions) && block.directions.length > 0) {
      designDirections = block.directions;
    }
  }
  const directionApplicable = designDirections !== null;
  const directionChosen = Boolean(reviewStatus?.designDirection?.id);

  const activeChange = changesState?.activeChange ?? null;
  let taskProgress = null;
  if (activeChange) {
    const taskState = await listOpenSpecTaskWorkspace(resolvedRoot, { change: activeChange }).catch(() => null);
    if (taskState) {
      const blockingTotal = Number(taskState.summary?.blockingTotal ?? taskState.summary?.total ?? 0);
      const blockingPending = Number(taskState.summary?.blockingPending ?? taskState.summary?.pending ?? 0);
      taskProgress = {
        done: Math.max(0, blockingTotal - blockingPending),
        total: blockingTotal,
        pending: blockingPending,
        backgroundPending: Number(taskState.summary?.backgroundPending ?? 0),
      };
    }
  }
  const tasksReady = taskProgress !== null;
  const buildDone = tasksReady && taskProgress.pending === 0;

  const runState = await readJson(path.join(resolvedRoot, '.openprd', 'harness', 'run-state.json'));
  const readiness = runState?.lastVerification ?? null;
  const wrappedUp = buildDone && readiness?.taskReady === true;

  const completion = {
    clarify: clarified,
    draft: drafted,
    review: drafted,
    direction: directionApplicable ? true : null,
    tasks: tasksReady,
    build: buildDone,
    wrapup: wrappedUp,
  };

  const stages = [];
  let currentStage = null;
  for (let index = 0; index < GUIDE_STAGES.length; index += 1) {
    const spec = GUIDE_STAGES[index];
    const completed = completion[spec.id];
    let status;
    if (spec.id === 'direction' && !directionApplicable) {
      status = 'skipped';
    } else if (completed) {
      status = 'done';
    } else if (currentStage === null) {
      status = 'current';
      currentStage = spec.id;
    } else {
      status = 'pending';
    }

    let detail = null;
    if (spec.id === 'clarify' && clarified) {
      detail = '问题定义已记录。';
    } else if (spec.id === 'draft' && drafted) {
      detail = `已生成第 ${prdVersion} 版需求摘要。`;
    } else if (spec.id === 'review' && drafted) {
      detail = reviewStatus
        ? (reviewConfirmed
            ? `评审版本 ${versionId} 已记录用户选择。`
            : `评审版本 ${versionId} 已作为后台材料记录，不阻断实现。`)
        : '评审材料待 Agent 后台补齐，不阻断任务拆解或实现。';
    } else if (spec.id === 'direction') {
      if (!directionApplicable) {
        detail = '本次需求不涉及界面方向选择，自动跳过。';
      } else if (directionChosen) {
        detail = `已选定方向「${reviewStatus.designDirection.title ?? reviewStatus.designDirection.id}」。`;
      } else {
        detail = `${designDirections.length} 个交互方向可供参考；Agent 可采用可逆默认方向继续。`;
      }
    } else if (spec.id === 'tasks' && activeChange && taskProgress) {
      detail = `变更 ${activeChange} 已有 ${taskProgress.total} 个当前动作任务${taskProgress.backgroundPending > 0 ? `，另有 ${taskProgress.backgroundPending} 个后台维护项` : ''}。`;
    } else if (spec.id === 'build' && taskProgress) {
      detail = `任务进度 ${taskProgress.done}/${taskProgress.total}。`;
    } else if (spec.id === 'wrapup' && buildDone) {
      detail = readiness?.taskReady ? '任务验证摘要已通过。' : '任务已完成，仍需运行 run --verify 汇总验证状态。';
    }

    stages.push({
      id: spec.id,
      index: index + 1,
      title: spec.title,
      description: spec.description,
      status,
      detail,
    });
  }

  if (currentStage === null) {
    currentStage = 'wrapup';
  }
  const currentSpec = GUIDE_STAGES.find((spec) => spec.id === currentStage);
  const currentEntry = stages.find((stage) => stage.id === currentStage);

  return {
    ok: true,
    action: 'guide',
    projectRoot: resolvedRoot,
    totalStages: GUIDE_STAGES.length,
    currentStage: {
      id: currentStage,
      index: currentEntry?.index ?? GUIDE_STAGES.length,
      title: currentSpec?.title ?? '验证收口',
    },
    nextAction: currentEntry?.status === 'done' ? '全部阶段已完成，可以开始下一个需求。' : currentSpec?.nextAction ?? null,
    reviewPath: reviewStatus?.entryPath ?? reviewStatus?.reviewPath ?? null,
    stages,
  };
}

export function printGuideResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`OpenPrd 流程指引: 第 ${result.currentStage.index}/${result.totalStages} 步 · ${result.currentStage.title}`);
  for (const stage of result.stages) {
    const marker = stage.status === 'done'
      ? '[完成]'
      : stage.status === 'current'
        ? '[当前]'
        : stage.status === 'skipped'
          ? '[跳过]'
          : '[待办]';
    console.log(`${marker} ${stage.index}. ${stage.title} — ${stage.description}`);
    if (stage.detail) {
      console.log(`       ${stage.detail}`);
    }
  }
  if (result.nextAction) {
    console.log(`下一步: ${result.nextAction}`);
  }
  if (result.reviewPath) {
    console.log(`评审页面: ${result.reviewPath}`);
  }
}
