import path from 'node:path';
import { buildCapabilityCatalog } from './capability-catalog.js';

// 兼容旧的 guide 数据形状，但不再把能力域解释成必经阶段。
export const GUIDE_STAGES = buildCapabilityCatalog().domains.map((domain) => ({
  id: domain.id,
  title: domain.title,
  description: domain.responsibility,
}));

export async function guideWorkspace(projectRoot) {
  return {
    ok: true,
    action: 'guide',
    projectRoot: path.resolve(projectRoot),
    mode: 'contextual',
    totalStages: null,
    currentStage: { id: 'contextual', index: null, title: '按当前任务选择能力' },
    nextAction: '直接描述目标；Agent 按上下文选择产品、交互设计、研发、测试或 Vibe Coding 增强能力，自主拆解与执行。',
    reviewPath: null,
    stages: GUIDE_STAGES.map((domain) => ({ ...domain, status: 'available', detail: null })),
  };
}

export function printGuideResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log('Open VibeCoding 场景指引（非固定流程）');
  for (const domain of result.stages) console.log(`- ${domain.title}：${domain.description}`);
  console.log(`建议：${result.nextAction}`);
}
