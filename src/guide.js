import fs from 'node:fs/promises';
import path from 'node:path';

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
    description: '把已确认的信息整理成一份可评审的 PRD 草稿。',
    nextAction: '让 Agent 运行 openprd synthesize，生成 PRD 草稿和评审页面。',
  },
  {
    id: 'review',
    title: '评审确认',
    description: '打开 review.html，逐块确认主流程、功能、护栏和风险。',
    nextAction: '打开评审页面逐块看完，用底部按钮告诉 Agent「认可并继续」或「需要调整」。',
  },
  {
    id: 'direction',
    title: '交互方向选择',
    description: '界面类需求会给出 2 到 4 个交互稿方向，选定一个再继续。',
    nextAction: '在评审页面或画布里比较各方向，点「选这个方向」把选择发回 Agent。',
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
    description: '运行质量门禁，确认全部任务完成且验证通过。',
    nextAction: '让 Agent 运行 openprd quality . --verify 和 openprd run . --verify 收口。',
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

function taskProgressFromMarkdown(text) {
  const done = (text.match(/^\s*-\s*\[x\]/gim) ?? []).length;
  const open = (text.match(/^\s*-\s*\[ \]/gim) ?? []).length;
  return { done, total: done + open };
}

async function latestQualityReadiness(projectRoot) {
  const reportsDir = path.join(projectRoot, '.openprd', 'quality', 'reports');
  const entries = await fs.readdir(reportsDir).catch(() => []);
  const evalReports = entries.filter((name) => name.startsWith('eval-') && name.endsWith('.json')).sort();
  if (evalReports.length === 0) return null;
  const latest = await readJson(path.join(reportsDir, evalReports[evalReports.length - 1]));
  return latest?.readiness ?? null;
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
    const tasksText = await fs.readFile(
      path.join(resolvedRoot, '.openprd', 'changes', activeChange, 'tasks.md'),
      'utf8',
    ).catch(() => null);
    if (tasksText !== null) {
      taskProgress = taskProgressFromMarkdown(tasksText);
    }
  }
  const tasksReady = reviewConfirmed && taskProgress !== null && taskProgress.total > 0;
  const buildDone = tasksReady && taskProgress.done === taskProgress.total;

  const readiness = await latestQualityReadiness(resolvedRoot);
  const wrappedUp = buildDone && readiness?.productionReady === true;

  const completion = {
    clarify: clarified,
    draft: drafted,
    review: reviewConfirmed,
    direction: directionApplicable ? directionChosen : null,
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
    } else if (spec.id === 'review' && reviewStatus) {
      detail = reviewConfirmed ? `评审版本 ${versionId} 已确认。` : `评审版本 ${versionId} 等待确认。`;
    } else if (spec.id === 'direction') {
      if (!directionApplicable) {
        detail = '本次需求不涉及界面方向选择，自动跳过。';
      } else if (directionChosen) {
        detail = `已选定方向「${reviewStatus.designDirection.title ?? reviewStatus.designDirection.id}」。`;
      } else {
        detail = `${designDirections.length} 个交互方向等待选择。`;
      }
    } else if (spec.id === 'tasks' && activeChange && taskProgress) {
      detail = `变更 ${activeChange} 已有 ${taskProgress.total} 个任务。`;
    } else if (spec.id === 'build' && taskProgress) {
      detail = `任务进度 ${taskProgress.done}/${taskProgress.total}。`;
    } else if (spec.id === 'wrapup' && readiness && buildDone) {
      detail = readiness.productionReady ? '质量门禁已通过。' : '质量门禁尚未全部通过。';
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
