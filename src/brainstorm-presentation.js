/*
 * 核心功能
 * 校验并写入脑暴模式的展示文案，让 brainstorm.html 使用稳定的 presentation 契约渲染。
 *
 * 输入
 * 接收当前项目脑暴状态和 Agent 生成的 presentation JSON。
 *
 * 输出
 * 返回校验结果，在通过时写回 brainstormPresentation 与 meta，并重渲染脑暴页面。
 *
 * 定位
 * 位于脑暴模式展示治理层，类似 review-presentation，但作用对象是 brainstorm.json。
 *
 * 依赖
 * 依赖 brainstorm-artifacts 的契约与反馈逻辑，以及 brainstorm.js 的状态加载和重渲染能力。
 *
 * 维护规则
 * 修改 presentation 契约时，必须同步维护模板、反馈信息、写回元数据和测试。
 */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  BRAINSTORM_PRESENTATION_CONTRACT,
  buildBrainstormPresentationFeedback,
} from './brainstorm-artifacts.js';
import { loadBrainstormState, renderBrainstormWorkspaceArtifacts } from './brainstorm.js';

export const BRAINSTORM_PRESENTATION_TEMPLATE = {
  hero: {
    summary: '120 字内说明这次到底在讨论什么、为什么现在值得先想清楚。',
    direction: '40 字内说明目前更建议怎么做。',
    confidence: '28 字内说明还差什么确认或先停条件。',
  },
  visualScenes: [
    {
      type: 'focus-strip',
      title: '一眼看懂这次讨论',
      subtitle: '把核心诉求、目标、当前做法和推荐方向串起来。',
      items: [
        { label: '核心诉求', title: '先说清要解决什么', detail: '先把这次真正要解决的问题讲明白。', tone: 'function' },
        { label: '目标结果', title: '先定义第一版结果', detail: '先想清楚第一版最想换来的结果。', tone: 'flow' },
        { label: '当前做法', title: '先回到现状', detail: '先说清现在主要靠什么办法在解决。', tone: 'guardrail' },
        { label: '推荐方向', title: '先收敛第一版做法', detail: '先缩小范围，再决定怎么进入 PRD。', tone: 'success' },
      ],
    },
    {
      type: 'validation-ladder',
      title: '先验证什么',
      subtitle: '把关键前提、低成本验证、过关标准和止损线摆出来。',
      items: [
        { label: '关键前提', title: '先确认什么必须为真', detail: '优先挑最影响方向判断的一条前提。', tone: 'risk' },
        { label: '先怎么验', title: '先做最低成本验证', detail: '不要先写大方案，先定一个最便宜的验证动作。', tone: 'map' },
        { label: '什么算过', title: '先定义通过标准', detail: '先说清看到什么结果，才算值得继续做。', tone: 'success' },
        { label: '什么先停', title: '提前约定止损线', detail: '先想清楚什么情况出现时，就先暂停。', tone: 'guardrail' },
      ],
    },
  ],
  panels: {
    userSignals: [
      { summary: '真实场景', detail: '先抓最近一次真实案例，不要泛泛而谈。' },
      { summary: '现在怎么做', detail: '先说清现在主要靠什么办法在解决。' },
      { summary: '为什么现在做', detail: '先说清这次为什么是现在，不是以后。' },
    ],
    marketSignals: [
      { summary: '推荐方向', detail: '先说清当前更建议怎么做，为什么先走这条路。' },
      { summary: '备选方向', detail: '至少给一条备选路，方便用户比较取舍。' },
    ],
    validationLoop: [
      { summary: '先找谁验', detail: '先补第一批最容易触达、最可能给真实反馈的人。' },
      { summary: '为什么是你', detail: '先说清你为什么算这个社区里的自己人、为什么现在就能触达。' },
      { summary: '当前替代', detail: '先说清用户现在主要靠什么办法在解决，以及这个办法到底多痛。' },
      { summary: '手工作战卡', detail: '把触发条件、步骤、工具、耗时和交接点先写清楚。' },
    ],
    businessViability: [
      { summary: '承诺信号', detail: '先定义什么真实承诺最能证明值得继续。' },
      { summary: '付费证明', detail: '先补有没有 10 个样本、3/10 愿意付费或更强交易信号。' },
      { summary: '最低成本验证', detail: '优先写最便宜的验证动作，不要一上来做全套方案。' },
      { summary: '先怎么收费', detail: '先给一个从第一个客户开始就成立的收费假设。' },
      { summary: '增长纪律', detail: '先约束什么时候不该 launch、什么时候别急着花钱或扩团队。' },
    ],
    minimalistReview: [
      { summary: '更小的执行', detail: '先判断能不能继续用 spreadsheet、表单或 no-code 保持小；如果必须开始做产品，也只自动化最重复的一步并先压成 forms / lists / CRUD 骨架，不要先为假想中的未来客户造复杂能力。' },
      { summary: '产品化门槛', detail: '先写清达到什么条件才允许继续产品化或加功能。' },
      { summary: '是否可逆', detail: '先判断验证结果一般时，这条路是不是容易回退，避免先做重招聘、长期绑定或重平台化。' },
      { summary: '客户真问题', detail: '先看这更像客户痛点，还是团队自己的技术冲动。' },
      { summary: '价值观一致', detail: '先确认这条路是否符合团队想坚持的做法，以及它是不是你愿意长期住进去的业务形态。' },
    ],
    reuseOpportunities: [
      { summary: '现有基础', detail: '指出现在已经有什么能直接借，不要默认从零开始。' },
      { summary: '关键参与方', detail: '补谁会拍板、谁会受影响、谁需要一起参与。' },
    ],
    risks: [
      { summary: '关键前提', detail: '把这件事要成立必须为真的条件摆出来。' },
      { summary: '先怎么验证', detail: '优先写最低成本验证动作，不要只写开放问题。' },
      { summary: '止损线', detail: '先说清什么情况下先停，避免投入失控。' },
    ],
  },
};

export function buildBrainstormPresentationTemplatePayload() {
  return {
    intent: 'Agent 先按这个模板写 brainstormPresentation，再用本脚本校验；页面重点不只是整理需求，还要把当前替代方案、社区契合、痛点证据、手工作战卡、一件事 MVP、最小工具桥接、首批成交、产品化门槛、增长纪律、关键前提、验证动作和止损线说清楚。除了正文卡片，还可以用 visualScenes 生成更灵活的可视化区域，但仍然要走统一契约，不直接手写任意 SVG。',
    presentationTemplate: BRAINSTORM_PRESENTATION_TEMPLATE,
    presentationContract: BRAINSTORM_PRESENTATION_CONTRACT,
  };
}

export async function brainstormPresentationWorkspace(projectRoot, options = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const { ws, record } = await loadBrainstormState(resolvedProjectRoot);
  let presentationSource = record.brainstormPresentation ? 'state' : null;

  if (options.presentationPath) {
    const presentationPath = path.resolve(options.presentationPath);
    record.brainstormPresentation = normalizeBrainstormPresentationInput(await readJson(presentationPath));
    delete record.brainstormPresentationMeta;
    presentationSource = presentationPath;
  }

  if (options.write && !options.presentationPath) {
    throw new Error('--write 需要配合 --presentation，避免误写没有更新的展示文案。');
  }

  const feedback = buildBrainstormPresentationFeedback(record);
  if (options.write && options.presentationPath && feedback.violations.length === 0) {
    record.brainstormPresentationMeta = buildBrainstormPresentationMeta({
      presentation: record.brainstormPresentation,
      feedback,
      source: presentationSource,
    });
  }

  const gate = getBrainstormPresentationGate(record, feedback);
  const result = {
    ok: gate.ok,
    artifactId: record.artifactId,
    title: record.title,
    topic: record.topic,
    statePath: ws.paths.activeBrainstormState,
    presentationSource,
    presentationContract: feedback.contract,
    presentationFeedback: feedback.violations,
    brainstormPresentationGate: gate,
  };

  if (options.write) {
    if (!gate.ok) {
      result.writeBlocked = true;
      return result;
    }
    await fs.writeFile(ws.paths.activeBrainstormState, `${JSON.stringify(record, null, 2)}\n`);
    result.written = ws.paths.activeBrainstormState;
    const rendered = await renderBrainstormWorkspaceArtifacts(resolvedProjectRoot, record, { open: false });
    result.htmlPath = rendered.htmlPath;
    result.bundleHtmlPath = rendered.bundleHtmlPath;
    result.markdownPath = rendered.markdownPath;
    result.patchPath = rendered.patchPath;
  }

  return result;
}

export function getBrainstormPresentationGate(record, feedback = buildBrainstormPresentationFeedback(record)) {
  const errors = [];
  const presentation = record?.brainstormPresentation;
  const meta = record?.brainstormPresentationMeta;
  if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
    errors.push('缺少已由脚本写入的 brainstormPresentation。先运行 open-vibecoding brainstorm-presentation . --template，再填写 presentation JSON。');
  }
  if (feedback.violations.length > 0) {
    errors.push(`brainstormPresentation 仍有 ${feedback.violations.length} 个超限或格式问题。请按 presentationFeedback 中的 jsonPath 重写后再写入。`);
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    errors.push('缺少 brainstormPresentationMeta。必须通过 open-vibecoding brainstorm-presentation --presentation <json> --write --fail-on-violation 写入，不能手工改状态文件。');
  } else {
    const expectedPresentationHash = hashStableJson(presentation ?? null);
    const expectedViolationsHash = hashStableJson(feedback.violations);
    if (meta.presentationHash !== expectedPresentationHash) {
      errors.push('brainstormPresentationMeta.presentationHash 与当前 brainstormPresentation 不一致，请重新运行 brainstorm-presentation 写入。');
    }
    if (meta.violationsHash !== expectedViolationsHash) {
      errors.push('brainstormPresentationMeta.violationsHash 与当前校验结果不一致，请重新运行 brainstorm-presentation 写入。');
    }
    if (!meta.validatedAt) {
      errors.push('brainstormPresentationMeta.validatedAt 缺失，请重新运行 brainstorm-presentation 写入。');
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    violations: feedback.violations,
    requiredCommand: 'open-vibecoding brainstorm-presentation . --presentation <brainstorm-presentation.json> --write --fail-on-violation',
  };
}

function buildBrainstormPresentationMeta({ presentation, feedback, source }) {
  return {
    validatedAt: new Date().toISOString(),
    source: source ?? 'state',
    presentationHash: hashStableJson(presentation ?? null),
    violationsHash: hashStableJson(feedback.violations),
    validator: 'open-vibecoding brainstorm-presentation',
  };
}

function hashStableJson(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function normalizeBrainstormPresentationInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('presentation JSON 必须是对象。');
  }
  if (value.brainstormPresentation && typeof value.brainstormPresentation === 'object' && !Array.isArray(value.brainstormPresentation)) {
    return value.brainstormPresentation;
  }
  return value;
}
