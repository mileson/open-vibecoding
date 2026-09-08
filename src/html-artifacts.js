import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildReviewFallbackPanelItems, CHANGE_SUMMARY_VERBS, USER_CHANGE_SUMMARY_GUIDE } from './change-summary.js';
import { cjoin, writeText } from './fs-utils.js';
import { escapeHtml, listMarkup, slugify } from './html-artifact-utils.js';
import { buildReviewModel, projectReviewModel } from './review-model.js';
export { learningPackagePaths, renderLearningArtifact } from './learning-html-artifact.js';

function leafName(value) {
  return String(value ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? String(value ?? '');
}

function card(title, body) {
  return `
    <section class="card">
      <div class="card-header">${escapeHtml(title)}</div>
      <div class="card-body">${body}</div>
    </section>
  `;
}

function pageShell({ title, subtitle, eyebrow, summaryCards = [], sections = [], footer = '', statusBadge = null, topMeta = [], bottomActions = [] }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f8fb;
        --panel: #ffffff;
        --text: #172033;
        --muted: #667085;
        --line: #d8dee8;
        --accent: #2563eb;
        --accent-soft: rgba(37,99,235,0.1);
        --danger: #dc2626;
        --danger-soft: rgba(220,38,38,0.08);
        --ok: #15803d;
        --ok-soft: rgba(21,128,61,0.08);
        --mono: "JetBrains Mono","SFMono-Regular",Menlo,monospace;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .page {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 24px 56px;
      }
      .hero {
        display: grid;
        gap: 16px;
        margin-bottom: 28px;
      }
      .eyebrow {
        display: inline-flex;
        width: fit-content;
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: #ffffff;
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .hero-topline {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        width: fit-content;
        padding: 8px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.03em;
        border: 2px solid transparent;
        box-shadow: 0 10px 24px rgba(15,23,42,0.08);
      }
      .status-badge::before {
        content: "";
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 0 0 4px rgba(255,255,255,0.35);
      }
      .status-pass {
        color: #166534;
        background: #dcfce7;
        border-color: #22c55e;
      }
      .status-fail {
        color: #991b1b;
        background: #fee2e2;
        border-color: #ef4444;
      }
      .status-warn {
        color: #92400e;
        background: #fef3c7;
        border-color: #f59e0b;
      }
      .mini-status {
        padding: 4px 10px;
        font-size: 11px;
        border-width: 1.5px;
        box-shadow: none;
      }
      .mini-status::before {
        width: 7px;
        height: 7px;
        box-shadow: none;
      }
      h1 {
        margin: 0;
        font-size: clamp(30px, 4.4vw, 46px);
        line-height: 1.15;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .subtitle {
        max-width: 880px;
        margin: 0;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.7;
      }
      .summary-grid,
      .section-grid {
        display: grid;
        gap: 16px;
      }
      .summary-grid {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin-bottom: 28px;
      }
      .evidence-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
        margin-bottom: 14px;
      }
      .section-grid {
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--panel);
        box-shadow: 0 10px 24px rgba(23,32,51,0.06);
        overflow: hidden;
      }
      .card-header {
        padding: 14px 18px 0;
        font-size: 12px;
        letter-spacing: 0.08em;
        color: var(--muted);
        text-transform: uppercase;
      }
      .card-body {
        padding: 12px 18px 18px;
      }
      .metric {
        font-size: 28px;
        line-height: 1.15;
        font-weight: 700;
      }
      .metric-sub {
        margin-top: 8px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }
      .mini-metric {
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: #fbfcfe;
      }
      .mini-metric-value {
        font-size: 18px;
        line-height: 1.25;
        font-weight: 750;
        word-break: break-word;
      }
      .mini-metric-label {
        margin-bottom: 5px;
        color: var(--muted);
        font-size: 12px;
      }
      .mini-metric-sub {
        margin-top: 5px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
        word-break: break-word;
      }
      ul {
        margin: 0;
        padding-left: 18px;
        line-height: 1.7;
      }
      li + li { margin-top: 8px; }
      .empty { color: var(--muted); }
      .qa-item,
      .option-item,
      .export-item,
      .evidence-item {
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: #fbfcfe;
      }
      .qa-label,
      .option-title,
      .export-title,
      .evidence-title {
        font-weight: 600;
      }
      .qa-status-row {
        display: flex;
        justify-content: flex-start;
        margin-top: 8px;
      }
      .qa-meta,
      .option-meta,
      .export-meta,
      .evidence-meta {
        margin-top: 6px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }
      .warning {
        border-color: rgba(220,38,38,0.18);
        background: var(--danger-soft);
      }
      .success {
        border-color: rgba(21,128,61,0.18);
        background: var(--ok-soft);
      }
      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: white;
        color: var(--muted);
        font-size: 12px;
        font-family: var(--mono);
      }
      .code-block {
        overflow-x: auto;
        padding: 14px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: #f9fafb;
        color: var(--text);
        font-family: var(--mono);
        font-size: 13px;
        line-height: 1.6;
      }
      .footer {
        margin-top: 28px;
        color: var(--muted);
        font-size: 13px;
      }
      .page-bottom-bar {
        position: fixed;
        inset-inline: 0;
        bottom: 0;
        z-index: 30;
        padding: 14px 24px calc(14px + env(safe-area-inset-bottom));
        background: rgba(246,248,251,0.92);
        backdrop-filter: blur(8px);
        border-top: 1px solid var(--line);
      }
      .page-bottom-bar-inner {
        max-width: 980px;
        margin: 0 auto;
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }
      .page-bottom-action {
        appearance: none;
        border-radius: 12px;
        padding: 10px 22px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid var(--line);
        background: #ffffff;
        color: var(--text);
      }
      .page-bottom-action.primary {
        border-color: rgba(21,128,61,0.35);
        background: var(--ok-soft);
        color: var(--ok);
      }
      .page-bottom-action.danger {
        border-color: rgba(220,38,38,0.35);
        background: var(--danger-soft);
        color: var(--danger);
      }
      .page-bottom-action:hover { filter: brightness(0.97); }
      .has-bottom-bar { padding-bottom: 96px; }
      @media (max-width: 700px) {
        .page { padding: 20px 14px 40px; }
        .subtitle { font-size: 16px; }
      }
    </style>
  </head>
  <body>
    <main class="page${bottomActions.length ? ' has-bottom-bar' : ''}">
      <header class="hero">
        <div class="hero-topline">
          <div class="eyebrow">${escapeHtml(eyebrow)}</div>
          ${statusBadge ? `<div class="status-badge ${escapeHtml(statusBadge.className)}">${escapeHtml(statusBadge.label)}</div>` : ''}
        </div>
        <h1>${escapeHtml(title)}</h1>
        ${topMeta.length ? `<div class="top-meta">${topMeta.map((item) => `<div class="meta-chip">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
        <p class="subtitle">${escapeHtml(subtitle)}</p>
      </header>
      <section class="summary-grid">${summaryCards.join('\n')}</section>
      <section class="section-grid">${sections.join('\n')}</section>
      ${footer ? `<div class="footer">${escapeHtml(footer)}</div>` : ''}
      ${bottomActions.length ? `
      <nav class="page-bottom-bar" aria-label="下一步反馈">
        <div class="page-bottom-bar-inner">
          ${bottomActions.map((action) => `
          <button type="button" class="page-bottom-action ${escapeHtml(action.tone ?? 'primary')}" data-copy-value="${escapeHtml(action.copyText)}">
            ${escapeHtml(action.label)}
          </button>`).join('')}
        </div>
      </nav>` : ''}
      <script>
        document.querySelectorAll('[data-copy-target]').forEach((button) => {
          button.addEventListener('click', async () => {
            const block = button.closest('.export-item')?.querySelector('[data-copy-block]');
            if (!block) return;
            await navigator.clipboard.writeText(block.textContent || '');
            const old = button.textContent;
            button.textContent = '✓ 已复制';
            setTimeout(() => { button.textContent = old; }, 1200);
          });
        });
        document.querySelectorAll('[data-copy-value]').forEach((button) => {
          button.addEventListener('click', async () => {
            await navigator.clipboard.writeText(button.dataset.copyValue || '');
            const old = button.textContent;
            button.textContent = '✓ 已复制，回到对话里粘贴给我';
            setTimeout(() => { button.textContent = old; }, 1600);
          });
        });
      </script>
    </main>
  </body>
</html>`;
}

function metricCard(title, metric, subtext) {
  return card(title, `
    <div class="metric">${escapeHtml(metric)}</div>
    <div class="metric-sub">${escapeHtml(subtext)}</div>
  `);
}

function formatClarificationQuestion(item) {
  return `
    <div class="qa-item ${item.reason === 'missing' ? 'warning' : ''}">
      <div class="qa-label">${escapeHtml(item.prompt)}</div>
      <div class="qa-meta">来源: ${escapeHtml(item.reason)} · 字段: ${escapeHtml(item.id)}</div>
    </div>
  `;
}

function formatOption(option) {
  return `
    <div class="option-item">
      <div class="option-title">${escapeHtml(option.title)}</div>
      <div class="option-meta">${escapeHtml(option.summary)}</div>
      <ul>${listMarkup(option.tradeoffs, '暂无明确 tradeoff')}</ul>
    </div>
  `;
}

function formatExportItem(item) {
  return `
    <div class="export-item success">
      <div class="export-title">${escapeHtml(item.title)}</div>
      <div class="export-meta">${escapeHtml(item.description)}</div>
      <div class="code-block" data-copy-block>${escapeHtml(item.payload)}</div>
      <div class="actions">
        <button type="button" class="copy-button" data-copy-target>⧉ 复制</button>
      </div>
    </div>
  `;
}

function formatEvidenceItem(item) {
  return `
    <div class="evidence-item">
      <div class="evidence-title">${escapeHtml(item.title)}</div>
      <div class="evidence-meta">${escapeHtml(item.description)}</div>
      <ul>${listMarkup(item.items, '暂无')}</ul>
    </div>
  `;
}


export function buildReviewExportPayload(snapshot) {
  const sections = snapshot.sections ?? {};
  const presentation = buildReviewPresentationFeedback(snapshot);
  const reviewModel = buildReviewModel(snapshot);
  return {
    versionId: snapshot.versionId,
    title: snapshot.title,
    digest: snapshot.digest ?? null,
    workUnitId: snapshot.workUnitId ?? null,
    targetRoot: snapshot.targetRoot ?? null,
    reviewStatus: 'pending-confirmation',
    recommendedActions: [
      '查看问题与目标',
      '查看范围内 / 范围外',
      '查看主流程与失败路径',
      '补充关键风险与开放问题',
    ],
    summaryStyle: USER_CHANGE_SUMMARY_GUIDE,
    sectionKeys: Object.keys(sections),
    presentationContract: presentation.contract,
    presentationFeedback: presentation.violations,
    reviewModel: {
      schema: reviewModel.schema,
      digest: reviewModel.digest,
      approvalContract: reviewModel.approvalContract,
    },
    exportedAt: new Date().toISOString(),
  };
}

const REVIEW_PRESENTATION_CONTRACT = {
  intent: '这些限制用于反馈给 Agent 重新概括，不由 HTML 模板截断原文。',
  summaryStyle: USER_CHANGE_SUMMARY_GUIDE,
  expectedDataShape: {
    reviewPresentation: {
      diagram: {
        type: 'map',
        note: '默认用关系图；只有明确为线性流程时改为 flow，并用 flowEdges 明确哪些节点有箭头。',
      },
      mapNodes: {
        problem: { title: '问题定义', text: '30 字以内的图中正文' },
        goal: { title: '15 字以内标题', text: '30 字以内的图中正文' },
        scope: { title: '15 字以内标题', text: '30 字以内的图中正文' },
        flow: { title: '15 字以内标题', text: '30 字以内的图中正文' },
        risk: { title: '15 字以内标题', text: '30 字以内的图中正文' },
      },
      flowNodes: [
        { id: 'step1', text: '30 字以内的流程卡片正文' },
        { id: 'step2', text: '30 字以内的流程卡片正文' },
        { id: 'step3', text: '30 字以内的流程卡片正文' },
      ],
      flowEdges: [
        { from: 'step1', to: 'step2' },
        { from: 'step2', to: 'step3' },
      ],
      panels: {
        flow: [
          USER_CHANGE_SUMMARY_GUIDE.panelExamples.flow,
        ],
        function: [
          USER_CHANGE_SUMMARY_GUIDE.panelExamples.function,
        ],
        guardrail: [
          USER_CHANGE_SUMMARY_GUIDE.panelExamples.guardrail,
        ],
        risk: [
          USER_CHANGE_SUMMARY_GUIDE.panelExamples.risk,
        ],
      },
      designDirections: {
        note: '可选；只有需求涉及界面/页面/交互时提供。先用 imagegen 生成 3 个差异足够大的交互稿，再把图片路径写进来。',
        directions: [
          {
            id: 'direction-1',
            title: '15 字以内方向名',
            image: '.openprd/design/active/direction-1.png',
            summary: '30 字以内一句话说明这个方向的核心体验',
            tradeoff: '30 字以内说明取舍或适用场景',
          },
        ],
      },
    },
  },
  rules: [
    {
      id: 'review-design-direction-count',
      area: '交互方向评审',
      target: '方向数量',
      action: '涉及界面时提供 2 到 4 个差异足够大的方向（默认 3 个），写入 reviewPresentation.designDirections.directions[]。',
    },
    {
      id: 'review-design-direction-fields',
      area: '交互方向评审',
      target: '每个方向的字段',
      action: '每个方向必须有唯一 id、image 图片路径；title 15 字内、summary 30 字内、tradeoff 30 字内。',
    },
    {
      id: 'review-map-card-text',
      area: '需求关系图 / 需求流程图',
      target: '图中每个卡片的正文',
      maxChars: 30,
      action: '请写入 reviewPresentation.mapNodes.*.text 或 reviewPresentation.flowNodes[].text，重写成用户一眼能扫懂的短句，不要靠省略号或截断。',
    },
    {
      id: 'review-map-card-title',
      area: '需求关系图 / 需求流程图',
      target: '图中卡片标题胶囊',
      maxChars: 15,
      action: '请写入 reviewPresentation.mapNodes.*.title，重写成短标题，优先使用业务词，不使用内部技术词。',
    },
    {
      id: 'review-highlight-chip',
      area: '四个评审卡片',
      target: '重点摘要胶囊',
      maxChars: 15,
      action: `请重写成短标签，优先使用 ${CHANGE_SUMMARY_VERBS.join(' / ')} 这类用户能一眼看懂的动作词，再补必要对象。`,
    },
    {
      id: 'review-panel-detail-format',
      area: '四个评审卡片',
      target: '明细分点',
      format: '- **摘要内容**：明细一句话',
      action: `请写入 reviewPresentation.panels.<kind>[]，把每个明细改写为“加粗短摘要 + 一句话说明”，短摘要优先使用 ${CHANGE_SUMMARY_VERBS.join(' / ')}。`,
    },
  ],
};

function reviewPanelExample(kind) {
  const example = USER_CHANGE_SUMMARY_GUIDE.panelExamples[kind] ?? { summary: '15字内标签', detail: '一句话说明' };
  return `{ "summary": "${example.summary}", "detail": "${example.detail}" }`;
}

export function buildReviewPresentationFeedback(snapshot) {
  const sectionsData = snapshot.sections ?? {};
  const violations = [];
  const addViolation = ({ ruleId, area, target, value, maxChars, jsonPath = null }) => {
    const text = normalizedReviewVisibleText(value);
    const currentChars = reviewVisibleChars(text);
    if (currentChars <= maxChars) return;
    violations.push({
      ruleId,
      area,
      target,
      jsonPath,
      currentChars,
      maxChars,
      currentText: text,
      action: '请让 Agent 重新提炼这段内容，生成更短、更完整的表达；不要由 HTML 模板直接裁剪。',
    });
  };

  const primaryFlows = reviewList(sectionsData.scenarios?.primaryFlows);
  if (reviewPresentationDiagramType(snapshot) === 'flow' && primaryFlows.length >= 2) {
    primaryFlows.slice(0, 4).forEach((item, index) => {
      addViolation({
        ruleId: 'review-map-card-text',
        area: '需求流程图',
        target: `流程卡片 ${index + 1}`,
        value: reviewPresentationFlowNode(snapshot, index, reviewMapText(item)),
        maxChars: 30,
        jsonPath: `reviewPresentation.flowNodes[${index}].text`,
      });
    });
  } else {
    const relationshipNodes = [
      ['problem', '问题定义', sectionsData.problem?.problemStatement || '待完善问题定义'],
      ['goal', '目标', firstReviewMapValue(sectionsData.goals?.goals, sectionsData.goals?.successMetrics, '待完善目标')],
      ['scope', '范围', firstReviewMapValue(sectionsData.scope?.inScope, sectionsData.scope?.outOfScope, '待完善范围')],
      ['flow', '流程', firstReviewMapValue(sectionsData.scenarios?.primaryFlows, sectionsData.scenarios?.edgeCases, '待完善流程')],
      ['risk', '风险', firstReviewMapValue(sectionsData.risks?.risks, sectionsData.risks?.openQuestions, '待完善风险')],
    ];
    relationshipNodes.forEach(([key, fallbackLabel, fallbackValue]) => {
      const node = reviewPresentationMapNode(snapshot, key, fallbackLabel, reviewMapText(fallbackValue));
      addViolation({
        ruleId: 'review-map-card-title',
        area: '需求关系图',
        target: `${fallbackLabel}卡片标题`,
        value: node.label,
        maxChars: 15,
        jsonPath: `reviewPresentation.mapNodes.${key}.title`,
      });
      addViolation({
        ruleId: 'review-map-card-text',
        area: '需求关系图',
        target: `${fallbackLabel}卡片正文`,
        value: node.value,
        maxChars: 30,
        jsonPath: `reviewPresentation.mapNodes.${key}.text`,
      });
    });
  }

  reviewPanelDetailGroups(sectionsData).forEach((group) => {
    const panelItems = reviewPresentationPanelItems(snapshot, group.kind, group.items);
    group.items.forEach((_item, index) => {
      if (hasReviewPresentationPanel(snapshot, group.kind)) return;
      violations.push({
        ruleId: 'review-panel-detail-format',
        area: group.area,
        target: `明细 ${index + 1}`,
        jsonPath: `reviewPresentation.panels.${group.kind}[${index}]`,
        expectedFormat: '- **摘要内容**：明细一句话',
        currentText: normalizedReviewVisibleText(group.items[index]),
        action: `请写入 reviewPresentation.panels.${group.kind}[${index}]，格式例如 ${reviewPanelExample(group.kind)}。`,
      });
    });
    panelItems.forEach((item, index) => {
      const parsed = parseReviewPanelDetail(item);
      addViolation({
        ruleId: 'review-highlight-chip',
        area: `${group.area}重点摘要`,
        target: `明细 ${index + 1}摘要`,
        value: parsed.summary,
        maxChars: 15,
        jsonPath: `reviewPresentation.panels.${group.kind}[${index}].summary`,
      });
      if (isStructuredReviewPanelDetail(item)) return;
      violations.push({
        ruleId: 'review-panel-detail-format',
        area: group.area,
        target: `明细 ${index + 1}`,
        jsonPath: `reviewPresentation.panels.${group.kind}[${index}]`,
        expectedFormat: '- **摘要内容**：明细一句话',
        currentText: normalizedReviewVisibleText(item),
        action: `请写入 reviewPresentation.panels.${group.kind}[${index}]，格式例如 ${reviewPanelExample(group.kind)}。`,
      });
    });
  });

  validateReviewDesignDirections(snapshot, violations, addViolation);

  return {
    contract: REVIEW_PRESENTATION_CONTRACT,
    violations,
  };
}

export function reviewDesignDirections(snapshot) {
  const block = snapshot?.reviewPresentation?.designDirections;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const directions = Array.isArray(block.directions) ? block.directions : [];
  if (directions.length === 0) return null;
  return { ...block, directions };
}

function validateReviewDesignDirections(snapshot, violations, addViolation) {
  const rawBlock = snapshot?.reviewPresentation?.designDirections;
  if (rawBlock == null) return;
  if (typeof rawBlock !== 'object' || Array.isArray(rawBlock) || !Array.isArray(rawBlock.directions)) {
    violations.push({
      ruleId: 'review-design-direction-fields',
      area: '交互方向评审',
      target: 'designDirections 结构',
      jsonPath: 'reviewPresentation.designDirections',
      action: 'designDirections 必须是对象，且 directions 为数组。参考 openprd review-presentation . --template。',
    });
    return;
  }
  const directions = rawBlock.directions;
  if (directions.length < 2 || directions.length > 4) {
    violations.push({
      ruleId: 'review-design-direction-count',
      area: '交互方向评审',
      target: '方向数量',
      jsonPath: 'reviewPresentation.designDirections.directions',
      action: `当前 ${directions.length} 个方向；请提供 2 到 4 个差异足够大的方向（默认 3 个）。`,
    });
  }
  const seenIds = new Set();
  directions.forEach((direction, index) => {
    const basePath = `reviewPresentation.designDirections.directions[${index}]`;
    if (!direction || typeof direction !== 'object' || Array.isArray(direction)) {
      violations.push({
        ruleId: 'review-design-direction-fields',
        area: '交互方向评审',
        target: `方向 ${index + 1}`,
        jsonPath: basePath,
        action: '每个方向必须是对象，包含 id、title、image、summary 字段。',
      });
      return;
    }
    if (/字以内/u.test(`${direction.title ?? ''}${direction.summary ?? ''}${direction.tradeoff ?? ''}`)) {
      violations.push({
        ruleId: 'review-design-direction-fields',
        area: '交互方向评审',
        target: `方向 ${index + 1}`,
        jsonPath: basePath,
        action: '仍是模板占位文案；请填入真实方向内容，或在不涉及界面时删除 designDirections 字段。',
      });
    }
    const id = normalizedReviewVisibleText(direction.id);
    if (!id) {
      violations.push({
        ruleId: 'review-design-direction-fields',
        area: '交互方向评审',
        target: `方向 ${index + 1} id`,
        jsonPath: `${basePath}.id`,
        action: '缺少方向 id；请使用 direction-1 这类稳定标识。',
      });
    } else if (seenIds.has(id)) {
      violations.push({
        ruleId: 'review-design-direction-fields',
        area: '交互方向评审',
        target: `方向 ${index + 1} id`,
        jsonPath: `${basePath}.id`,
        action: `方向 id ${id} 重复；每个方向必须使用唯一 id。`,
      });
    } else {
      seenIds.add(id);
    }
    if (!normalizedReviewVisibleText(direction.image)) {
      violations.push({
        ruleId: 'review-design-direction-fields',
        area: '交互方向评审',
        target: `方向 ${index + 1} 图片`,
        jsonPath: `${basePath}.image`,
        action: '缺少 image 图片路径；请先用 imagegen 生成交互稿，再写入项目内相对路径。',
      });
    }
    addViolation({
      ruleId: 'review-design-direction-fields',
      area: '交互方向评审',
      target: `方向 ${index + 1} 名称`,
      value: direction.title,
      maxChars: 15,
      jsonPath: `${basePath}.title`,
    });
    addViolation({
      ruleId: 'review-design-direction-fields',
      area: '交互方向评审',
      target: `方向 ${index + 1} 卖点`,
      value: direction.summary,
      maxChars: 30,
      jsonPath: `${basePath}.summary`,
    });
    if (direction.tradeoff != null) {
      addViolation({
        ruleId: 'review-design-direction-fields',
        area: '交互方向评审',
        target: `方向 ${index + 1} 取舍`,
        value: direction.tradeoff,
        maxChars: 30,
        jsonPath: `${basePath}.tradeoff`,
      });
    }
  });
}

function normalizedReviewVisibleText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function reviewVisibleChars(value) {
  return Array.from(normalizedReviewVisibleText(value)).length;
}

function reviewPresentation(snapshot) {
  const presentation = snapshot?.reviewPresentation;
  return presentation && typeof presentation === 'object' && !Array.isArray(presentation) ? presentation : {};
}

function reviewPresentationMapNodes(snapshot) {
  const nodes = reviewPresentation(snapshot).mapNodes;
  return nodes && typeof nodes === 'object' && !Array.isArray(nodes) ? nodes : {};
}

function reviewPresentationMapNode(snapshot, key, fallbackLabel, fallbackValue) {
  const node = reviewPresentationMapNodes(snapshot)[key];
  const candidate = node && typeof node === 'object' && !Array.isArray(node) ? node : {};
  return {
    label: normalizedReviewVisibleText(candidate.title ?? candidate.label ?? fallbackLabel) || fallbackLabel,
    value: normalizedReviewVisibleText(candidate.text ?? candidate.value ?? fallbackValue) || fallbackValue,
  };
}

function reviewPresentationFlowNode(snapshot, index, fallbackValue) {
  const nodes = reviewPresentation(snapshot).flowNodes;
  const node = Array.isArray(nodes) ? nodes[index] : null;
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return fallbackValue;
  }
  return normalizedReviewVisibleText(node.text ?? node.value ?? fallbackValue) || fallbackValue;
}

function reviewPresentationDiagramType(snapshot) {
  const diagram = reviewPresentation(snapshot).diagram;
  if (!diagram || typeof diagram !== 'object' || Array.isArray(diagram)) {
    return 'map';
  }
  return diagram.type === 'flow' ? 'flow' : 'map';
}

function reviewPresentationFlowNodeId(snapshot, index) {
  const nodes = reviewPresentation(snapshot).flowNodes;
  const node = Array.isArray(nodes) ? nodes[index] : null;
  return node && typeof node === 'object' && !Array.isArray(node)
    ? normalizedReviewVisibleText(node.id ?? node.key ?? `step${index + 1}`)
    : `step${index + 1}`;
}

function reviewPresentationFlowEdges(snapshot) {
  const edges = reviewPresentation(snapshot).flowEdges;
  if (!Array.isArray(edges)) return [];
  return edges
    .map((edge) => edge && typeof edge === 'object' && !Array.isArray(edge)
      ? {
          from: normalizedReviewVisibleText(edge.from ?? edge.fromId ?? edge.source ?? edge.sourceId),
          to: normalizedReviewVisibleText(edge.to ?? edge.toId ?? edge.target ?? edge.targetId),
        }
      : null)
    .filter((edge) => edge?.from && edge?.to);
}

function reviewPresentationPanels(snapshot) {
  const panels = reviewPresentation(snapshot).panels;
  return panels && typeof panels === 'object' && !Array.isArray(panels) ? panels : {};
}

function hasReviewPresentationPanel(snapshot, kind) {
  return Array.isArray(reviewPresentationPanels(snapshot)[kind]);
}

function reviewPanelFallbackType(kind) {
  if (kind === 'function') return '新增';
  if (kind === 'flow') return '优化';
  return '调整';
}

function normalizeReviewPresentationPanelItem(item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const summary = normalizedReviewVisibleText(item.summary ?? item.title ?? item.label);
    const detail = normalizedReviewVisibleText(item.detail ?? item.text ?? item.value);
    if (summary && detail) {
      return `**${summary}**：${detail}`;
    }
    return summary || detail;
  }
  return normalizedReviewVisibleText(item);
}

function reviewPresentationPanelItems(snapshot, kind, fallbackItems) {
  const items = reviewPresentationPanels(snapshot)[kind];
  if (!Array.isArray(items)) {
    return buildReviewFallbackPanelItems(fallbackItems, {
      fallbackType: reviewPanelFallbackType(kind),
      summaryMaxLength: 15,
    });
  }
  return items.map(normalizeReviewPresentationPanelItem).filter(Boolean);
}

function reviewPanelDetailGroups(sectionsData) {
  return [
    {
      kind: 'flow',
      area: '主流程与边界情况',
      items: [
        ...reviewList(sectionsData.scenarios?.primaryFlows),
        ...reviewList(sectionsData.scenarios?.edgeCases),
        ...reviewList(sectionsData.scenarios?.failureModes),
      ],
    },
    {
      kind: 'function',
      area: '功能与约束',
      items: [
        ...reviewList(sectionsData.requirements?.functional),
        ...reviewList(sectionsData.requirements?.nonFunctional),
        ...reviewList(sectionsData.constraints?.technical),
        ...reviewList(sectionsData.constraints?.compliance),
        ...reviewList(sectionsData.constraints?.dependencies),
      ],
    },
    {
      kind: 'guardrail',
      area: '业务成本与滥用护栏',
      items: [
        ...reviewList(sectionsData.businessGuardrails?.rateLimits),
        ...reviewList(sectionsData.businessGuardrails?.abusePrevention),
        ...reviewList(sectionsData.businessGuardrails?.costControls),
      ],
    },
    {
      kind: 'risk',
      area: '开放问题与风险',
      items: [
        ...reviewList(sectionsData.risks?.risks),
        ...reviewList(sectionsData.risks?.openQuestions),
      ],
    },
  ];
}

function isStructuredReviewPanelDetail(value) {
  const text = normalizedReviewVisibleText(value);
  return /^\*\*[^*]{1,24}\*\*\s*[：:]\s*\S+/u.test(text);
}

function reviewList(items) {
  return Array.isArray(items) ? items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [];
}

function splitSvgLines(value, maxChars = 17) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim() || '待补充';
  const tokens = text.match(/[A-Za-z0-9_./:-]+|[\u4e00-\u9fff]|[^\s]/g) ?? [text];
  const lines = [];
  let line = '';
  let length = 0;
  const visualLength = (token) => /^[A-Za-z0-9_./:-]+$/.test(token)
    ? Math.max(1, token.length * 0.62)
    : 1;
  for (const token of tokens) {
    const nextLength = visualLength(token);
    if (line && length + nextLength > maxChars) {
      lines.push(line);
      line = token;
      length = nextLength;
    } else {
      line += token;
      length += nextLength;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

function svgText(value, x, y, className, maxChars = 17, lineHeight = 16, anchor = 'middle') {
  const lines = splitSvgLines(value, maxChars);
  return `<text class="${className}" x="${x}" y="${y}" text-anchor="${anchor}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
}

function reviewIcon(kind) {
  const icons = {
    flow: '<svg viewBox="0 0 24 24" role="img" aria-label="流程"><path d="M5 6.5h6.4a3.6 3.6 0 0 1 3.6 3.6v.8" /><path d="M15 17.5H8.6A3.6 3.6 0 0 1 5 13.9v-.8" /><path d="m12 8.5 3-3 3 3" /><path d="m8 15.5-3 3-3-3" /></svg>',
    function: '<svg viewBox="0 0 24 24" role="img" aria-label="功能"><path d="M5 7h14" /><path d="M5 12h14" /><path d="M5 17h14" /><circle cx="8" cy="7" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="11" cy="17" r="2" /></svg>',
    guardrail: '<svg viewBox="0 0 24 24" role="img" aria-label="护栏"><path d="M12 3 5 6v5c0 4.4 2.8 8.4 7 9.8 4.2-1.4 7-5.4 7-9.8V6l-7-3Z" /><path d="M9 12.2 11 14l4-4.4" /></svg>',
    risk: '<svg viewBox="0 0 24 24" role="img" aria-label="风险"><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 9v4" /><path d="M12 16.5h.01" /></svg>',
    map: '<svg viewBox="0 0 24 24" role="img" aria-label="图谱"><path d="M12 5v14" /><path d="M5 8h14" /><path d="M7 16h10" /><circle cx="12" cy="5" r="2" /><circle cx="5" cy="8" r="2" /><circle cx="19" cy="8" r="2" /><circle cx="7" cy="16" r="2" /><circle cx="17" cy="16" r="2" /></svg>',
  };
  return `<span class="review-icon review-icon-${escapeHtml(kind)}" aria-hidden="true">${icons[kind] ?? icons.flow}</span>`;
}

function reviewReleaseStatusLabel(status) {
  const labels = {
    draft: '草稿版本',
    current: '当前版本',
    released: '已发布版本',
  };
  return labels[status] ?? '版本轨道';
}

function resolveReviewProjectRelease(projectRelease) {
  if (!projectRelease || typeof projectRelease !== 'object' || Array.isArray(projectRelease)) {
    return null;
  }
  const version = typeof projectRelease.currentVersion === 'string' ? projectRelease.currentVersion.trim() : '';
  if (!version) return null;
  return {
    version,
    status: typeof projectRelease.currentStatus === 'string' ? projectRelease.currentStatus.trim() : '',
    itemCount: Number.isFinite(projectRelease.itemCount) ? projectRelease.itemCount : null,
  };
}

function renderReviewProjectVersion(projectRelease) {
  if (!projectRelease) return '';
  const meta = [];
  if (projectRelease.status) {
    meta.push(reviewReleaseStatusLabel(projectRelease.status));
  }
  if (projectRelease.itemCount > 0) {
    meta.push(`${projectRelease.itemCount} 条变化`);
  }
  return `
        <div class="review-project-version" aria-label="项目版本">
          <span class="review-project-version-label">项目版本</span>
          <strong class="review-project-version-value">${escapeHtml(projectRelease.version)}</strong>
          ${meta.length ? `<span class="review-project-version-meta">${escapeHtml(meta.join(' · '))}</span>` : ''}
        </div>
  `;
}

function renderReviewStageRail(reviewModel) {
  const stages = reviewModel.timeline;
  const items = stages.map((stage, index) => `
        <li class="review-stage ${stage.status}" data-review-timeline-step="${escapeHtml(stage.id)}">
          <span class="review-stage-dot">${stage.status === 'done' ? '✓' : index + 1}</span>
          <span class="review-stage-name">${escapeHtml(stage.title)}</span>
          ${stage.status === 'current' ? '<span class="review-stage-badge">你在这里</span>' : ''}
        </li>`);
  return `
      <nav class="review-stage-rail" aria-label="共享决策时间线" data-review-model-digest="${escapeHtml(reviewModel.digest)}">
        <ol>
          ${items.join('\n')}
        </ol>
      </nav>`;
}

function renderReviewOverview(snapshot, sectionsData, agenda = []) {
  const rawProblem = sectionsData.problem?.problemStatement || '尚未形成明确问题定义';
  const rawGoal = reviewList(sectionsData.goals?.goals)[0] ?? null;
  const problem = reviewPresentationMapNode(snapshot, 'problem', '问题定义', rawProblem).value;
  const goal = rawGoal
    ? reviewPresentationMapNode(snapshot, 'goal', '目标', rawGoal).value
    : null;
  const agendaMarkup = agenda.length === 0 ? '' : `
      <aside class="review-agenda" aria-label="评审清单">
        <p class="review-agenda-title">这份参考包含 ${agenda.length} 块内容</p>
        <ol class="review-agenda-list">
          ${agenda.map((item) => `
          <li>
            <a href="#review-panel-${escapeHtml(item.kind)}">
              <span class="review-agenda-name">${escapeHtml(item.title)}</span>
              <span class="review-agenda-count${item.count === 0 ? ' empty' : ''}">${item.count === 0 ? '暂无内容' : `${item.count} ${escapeHtml(item.unit || '条')}`}</span>
            </a>
          </li>`).join('')}
        </ol>
        <p class="review-agenda-foot">如有不同意见，直接在页面底部反馈即可；Agent 会记录并覆盖当前默认方向，不影响已经开始的实现。</p>
      </aside>
  `;
  return `
    <section class="review-overview" aria-labelledby="reviewOverviewTitle">
      <div class="review-overview-copy">
        <p class="review-kicker">需求概览</p>
        <h1 id="reviewOverviewTitle">${escapeHtml(snapshot.title || 'PRD 评审')}</h1>
        <p class="review-problem">${escapeHtml(problem)}</p>
        ${goal ? `<p class="review-goal"><span class="review-goal-label">这次的目标</span>${escapeHtml(goal)}</p>` : ''}
      </div>
      ${agendaMarkup}
    </section>
  `;
}

const REVIEW_GAP_PLACEHOLDER = /^待(补充|澄清|确认)/;

const REVIEW_GAP_FIELDS = [
  { path: ['problem', 'problemStatement'], label: '问题定义', hint: '还没说清楚这次要解决什么问题', priority: 1 },
  { path: ['goals', 'goals'], label: '目标', hint: '还没说清楚这次想达成什么', priority: 1 },
  { path: ['scope', 'inScope'], label: '范围内', hint: '还没列出这次要做的内容', priority: 1 },
  { path: ['scenarios', 'primaryFlows'], label: '主流程', hint: '还没把用户怎么走完整个流程讲清楚', priority: 1 },
  { path: ['goals', 'successMetrics'], label: '成功指标', hint: '还没定义怎么算做成了', priority: 2 },
  { path: ['scope', 'outOfScope'], label: '范围外', hint: '还没说清楚这次明确不做什么', priority: 2 },
  { path: ['requirements', 'functional'], label: '功能需求', hint: '还没列出必须交付的功能', priority: 2 },
  { path: ['scenarios', 'edgeCases'], label: '边界情况', hint: '还没考虑特殊情况怎么处理', priority: 3 },
  { path: ['scenarios', 'failureModes'], label: '失败路径', hint: '还没说清楚出错后怎么恢复', priority: 3 },
];

function reviewGapFieldMissing(sectionsData, field) {
  const raw = sectionsData?.[field.path[0]]?.[field.path[1]];
  if (Array.isArray(raw)) {
    const items = reviewList(raw);
    return items.length === 0 || items.every((item) => REVIEW_GAP_PLACEHOLDER.test(item));
  }
  const text = String(raw ?? '').trim();
  return !text || REVIEW_GAP_PLACEHOLDER.test(text);
}

export function collectReviewGaps(sectionsData) {
  return REVIEW_GAP_FIELDS
    .filter((field) => reviewGapFieldMissing(sectionsData ?? {}, field))
    .sort((a, b) => a.priority - b.priority);
}

function renderReviewGapPanel(sectionsData) {
  const gaps = collectReviewGaps(sectionsData);
  if (gaps.length === 0) {
    return `
    <section class="review-gap review-gap-clear" aria-label="信息完整度">
      <div class="review-gap-headline">
        <span class="review-gap-dot" aria-hidden="true"></span>
        <strong>核心信息已记录</strong>
        <span class="review-gap-sub">Agent 可按当前内容继续推进；后续反馈会覆盖相应记录。</span>
      </div>
    </section>
  `;
  }
  const blocking = gaps.filter((gap) => gap.priority === 1).length;
  const subText = blocking > 0
    ? 'Agent 会优先采用可逆默认方向补齐；你的反馈可随时覆盖，当前实现不因此停下。'
    : '这些内容由 Agent 在后台逐步补充；你的反馈可随时覆盖，当前实现不因此停下。';
  return `
    <section class="review-gap review-gap-pending" aria-label="信息完整度">
      <div class="review-gap-headline">
        <span class="review-gap-dot" aria-hidden="true"></span>
        <strong>待完善信息 ${gaps.length} 项</strong>
        <span class="review-gap-sub">${escapeHtml(subText)}</span>
      </div>
      <ol class="review-gap-list">
        ${gaps.map((gap) => `
        <li class="review-gap-item">
          <span class="review-gap-tag${gap.priority === 1 ? ' review-gap-tag-key' : ''}">${gap.priority === 1 ? '优先' : '建议'}</span>
          <strong>${escapeHtml(gap.label)}</strong>
          <span class="review-gap-hint">${escapeHtml(gap.hint)}</span>
        </li>`).join('')}
      </ol>
    </section>
  `;
}

function renderReviewFlowSvg(snapshot, sectionsData) {
  const flowItems = reviewList(sectionsData.scenarios?.primaryFlows);
  if (reviewPresentationDiagramType(snapshot) !== 'flow' || flowItems.length < 2) {
    return renderReviewMindMapSvg(snapshot, sectionsData);
  }
  const nodes = (flowItems.length ? flowItems : [
    '梳理问题定义',
    '梳理范围与边界',
    '梳理主流程',
    '记录风险与开放问题',
  ]).slice(0, 4);
  const positions = [116, 360, 604, 848].slice(0, nodes.length);
  const nodeIds = nodes.map((_item, index) => reviewPresentationFlowNodeId(snapshot, index));
  const edges = reviewPresentationFlowEdges(snapshot);
  const arrows = edges.map((edge) => {
    const fromIndex = nodeIds.indexOf(edge.from);
    const toIndex = nodeIds.indexOf(edge.to);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return '';
    const fromX = positions[fromIndex] + (fromIndex < toIndex ? 112 : -112);
    const toX = positions[toIndex] + (fromIndex < toIndex ? -118 : 118);
    const y = fromIndex === toIndex ? 124 : 124;
    return `<path class="review-map-arrow" d="M ${fromX} ${y} H ${toX}" marker-end="url(#reviewArrow)" />`;
  }).join('');
  const nodeMarkup = nodes.map((item, index) => `
    <g>
      <rect class="review-map-node node-${index + 1}" x="${positions[index] - 104}" y="72" width="208" height="118" rx="8" />
      <text class="review-map-step" x="${positions[index] - 78}" y="102">${index + 1}</text>
      ${svgText(reviewMapCardText(reviewPresentationFlowNode(snapshot, index, reviewMapText(item))), positions[index], 126, 'review-map-label', 13, 15)}
    </g>
  `).join('');
  const overflowNote = flowItems.length > nodes.length
    ? `<p class="review-map-note">还有 ${flowItems.length - nodes.length} 条流程在下方“主流程与边界情况”里查看。</p>`
    : '';
  return `
    <section class="review-map" aria-labelledby="reviewMapTitle">
      <div class="review-section-heading">
        ${reviewIcon('map')}
        <div>
          <h2 id="reviewMapTitle">需求流程图</h2>
        </div>
      </div>
      <div class="review-map-canvas">
        <svg viewBox="0 0 960 280" role="img" aria-label="需求流程图" preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="reviewArrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
              <path d="M 0 0 L 12 6 L 0 12 z" fill="#4f46e5" />
            </marker>
          </defs>
          <rect class="review-map-bg" x="2" y="2" width="956" height="276" rx="8" />
          ${arrows}
          ${nodeMarkup}
        </svg>
      </div>
      ${overflowNote}
    </section>
  `;
}

function renderReviewMindMapSvg(snapshot, sectionsData) {
  const problem = sectionsData.problem?.problemStatement || '待完善问题定义';
  const center = { x: 480, y: 168 };
  const nodes = [
    {
      key: 'goal',
      label: '目标',
      value: firstReviewMapValue(sectionsData.goals?.goals, sectionsData.goals?.successMetrics, '待完善目标'),
      x: 250,
      y: 94,
      className: 'node-1',
    },
    {
      key: 'scope',
      label: '范围',
      value: firstReviewMapValue(sectionsData.scope?.inScope, sectionsData.scope?.outOfScope, '待完善范围'),
      x: 710,
      y: 94,
      className: 'node-2',
    },
    {
      key: 'flow',
      label: '流程',
      value: firstReviewMapValue(sectionsData.scenarios?.primaryFlows, sectionsData.scenarios?.edgeCases, '待完善流程'),
      x: 250,
      y: 242,
      className: 'node-3',
    },
    {
      key: 'risk',
      label: '风险',
      value: firstReviewMapValue(sectionsData.risks?.risks, sectionsData.risks?.openQuestions, '待完善风险'),
      x: 710,
      y: 242,
      className: 'node-4',
    },
  ];
  const links = nodes.map((node) => `<path class="review-map-link" d="M ${center.x} ${center.y} L ${node.x} ${node.y}" />`).join('');
  const satelliteNodes = nodes.map((node) => {
    const displayNode = reviewPresentationMapNode(snapshot, node.key, node.label, reviewMapText(node.value));
    return `
    <g>
      <rect class="review-map-node ${node.className}" x="${node.x - 122}" y="${node.y - 43}" width="244" height="86" rx="8" />
      ${reviewMapTagPill(displayNode.label, node.x, node.y - 22, node.className)}
      ${svgText(reviewMapCardText(displayNode.value), node.x - 94, node.y + 6, 'review-map-label', 15, 14, 'start')}
    </g>
  `;
  }).join('');
  const centerDisplayNode = reviewPresentationMapNode(snapshot, 'problem', '问题定义', reviewMapText(problem));
  const centerNode = `
    <g class="review-map-center-group">
      <rect class="review-map-center" x="330" y="124" width="300" height="88" rx="8" />
      ${reviewMapTagPill(centerDisplayNode.label, center.x, 146, 'center')}
      ${svgText(reviewMapCardText(centerDisplayNode.value), 360, 176, 'review-map-label center', 16, 14, 'start')}
    </g>
  `;
  return `
    <section class="review-map" aria-labelledby="reviewMapTitle">
      <div class="review-section-heading">
        ${reviewIcon('map')}
        <div>
          <h2 id="reviewMapTitle">需求关系图</h2>
        </div>
      </div>
      <div class="review-map-canvas">
        <svg viewBox="0 0 960 336" role="img" aria-label="需求关系图" preserveAspectRatio="xMidYMid meet">
          <rect class="review-map-bg" x="2" y="2" width="956" height="332" rx="8" />
          ${links}
          ${satelliteNodes}
          ${centerNode}
        </svg>
      </div>
    </section>
  `;
}

function reviewMapTagPill(label, x, y, className) {
  const text = trimReviewChipBoundary(label) || '未命名';
  const width = Math.max(54, Array.from(text).length * 14 + 26);
  return `
    <rect class="review-map-tag-pill ${escapeHtml(className)}" x="${x - width / 2}" y="${y - 13}" width="${width}" height="26" rx="13" />
    <text class="review-map-tag ${escapeHtml(className)}" x="${x}" y="${y + 4}" text-anchor="middle">${escapeHtml(text)}</text>
  `;
}

function firstReviewMapValue(primaryItems, secondaryItems, fallback) {
  return reviewList(primaryItems)[0] ?? reviewList(secondaryItems)[0] ?? fallback;
}

function reviewMapText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim() || '待补充';
  return text.split(/[。！？!?]/).map((item) => item.trim()).find(Boolean) ?? text;
}

function reviewMapCardText(value) {
  return reviewMapText(value);
}

function trimReviewChipBoundary(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s/|｜:：,，、;；.!?？。-]+$/u, '')
    .trim();
}

function condensedReviewChipLabel(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const rules = [
    { pattern: /截图|红框|口径|用户预期|预期不一致/u, label: '分类口径' },
    { pattern: /Playwright/i, label: 'Playwright 验证' },
    { pattern: /Host API/i, label: '不新增 Host API' },
    { pattern: /用量|额度|成本/u, label: '用量额度不变' },
    { pattern: /后台任务|重复触发|轮询/u, label: '不新增后台任务' },
    { pattern: /窄屏|响应式/u, label: '窄屏响应式' },
    { pattern: /滚动|稳定性/u, label: '滚动稳定性' },
    { pattern: /CSS|样式/i, label: 'CSS 样式' },
  ];
  return rules.find((rule) => rule.pattern.test(text))?.label ?? null;
}

function summarizeReviewChip(value, maxLength = 15) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const parsed = parseReviewPanelDetail(text);
  if (parsed.summary && parsed.detail && parsed.summary.length <= maxLength) {
    return parsed.summary;
  }
  const clauses = text.split(/[。；;，,、.!?？]/).map((item) => item.trim()).filter(Boolean);
  const compact =
    clauses.find((item) => item.length >= 4 && item.length <= maxLength) ??
    condensedReviewChipLabel(text) ??
    clauses.find((item) => item.length >= 4) ??
    clauses[0] ??
    text;
  return trimReviewChipBoundary(compact);
}

function reviewHighlightChips(items, emptyText) {
  const chips = [];
  for (const item of reviewList(items)) {
    const chip = summarizeReviewChip(item);
    if (chip && !chips.includes(chip)) {
      chips.push(chip);
    }
    if (chips.length >= 4) break;
  }
  if (chips.length === 0) {
    return `<span class="review-chip empty">${escapeHtml(emptyText)}</span>`;
  }
  return chips.map((chip) => `<span class="review-chip">${escapeHtml(chip)}</span>`).join('');
}

function reviewJourneyLabel(items, fallback) {
  const text = reviewList(items)[0] ?? fallback;
  return summarizeReviewChip(text, 18) || fallback;
}

function reviewJourneyClauses(items) {
  return reviewList(items)
    .flatMap((item) => item.split(/[。；;.!?？]/))
    .flatMap((item) => item.split(/[，,]/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 4);
}

function renderReviewJourneySvg({ primaryFlows, edgeCases, failureModes }) {
  const primary = reviewList(primaryFlows);
  const edges = reviewList(edgeCases);
  const failures = reviewList(failureModes);
  const primaryClauses = reviewJourneyClauses(primary);
  const journey = reviewJourneyLabel(primaryClauses.length ? primaryClauses : primary, '待完善用户入口');
  const step = reviewJourneyLabel(primaryClauses.slice(1).length ? primaryClauses.slice(1) : primary.slice(1), '待完善关键步骤');
  const outcome = reviewJourneyLabel(primaryClauses.slice(2).length ? primaryClauses.slice(2) : primary.slice(2), '待完善完成状态');
  const boundary = reviewJourneyLabel(edges, '待完善边界情况');
  const recovery = reviewJourneyLabel(failures.length ? failures : edges.slice(1), '待完善恢复路径');
  return `
    <div class="review-journey-map" aria-label="主流程小图">
      <svg viewBox="0 0 680 320" role="img" aria-label="用户旅程、关键步骤、边界情况和恢复路径" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="reviewJourneyArrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#0d9488" />
          </marker>
        </defs>
        <rect class="review-journey-bg" x="2" y="2" width="676" height="316" rx="8" />
        <path class="review-journey-arrow" d="M 202 88 H 248" marker-end="url(#reviewJourneyArrow)" />
        <path class="review-journey-arrow" d="M 432 88 H 478" marker-end="url(#reviewJourneyArrow)" />
        <path class="review-journey-arrow branch" d="M 340 134 V 164 H 236 V 190" marker-end="url(#reviewJourneyArrow)" />
        <path class="review-journey-arrow branch" d="M 340 134 V 164 H 454 V 190" marker-end="url(#reviewJourneyArrow)" />
        <g>
          <rect class="review-journey-node stage-journey" x="26" y="40" width="176" height="96" rx="8" />
          <circle class="review-journey-dot stage-journey" cx="56" cy="64" r="12" />
          <text class="review-journey-number" x="56" y="64" text-anchor="middle">1</text>
          <text class="review-journey-tag" x="114" y="66" text-anchor="middle">用户旅程</text>
          ${svgText(journey, 114, 92, 'review-journey-label', 12, 13)}
        </g>
        <g>
          <rect class="review-journey-node stage-step" x="252" y="40" width="176" height="96" rx="8" />
          <circle class="review-journey-dot stage-step" cx="282" cy="64" r="12" />
          <text class="review-journey-number" x="282" y="64" text-anchor="middle">2</text>
          <text class="review-journey-tag" x="340" y="66" text-anchor="middle">关键步骤</text>
          ${svgText(step, 340, 92, 'review-journey-label', 12, 13)}
        </g>
        <g>
          <rect class="review-journey-node stage-outcome" x="478" y="40" width="176" height="96" rx="8" />
          <circle class="review-journey-dot stage-outcome" cx="508" cy="64" r="12" />
          <text class="review-journey-number" x="508" y="64" text-anchor="middle">3</text>
          <text class="review-journey-tag" x="566" y="66" text-anchor="middle">完成状态</text>
          ${svgText(outcome, 566, 92, 'review-journey-label', 12, 13)}
        </g>
        <g>
          <rect class="review-journey-node stage-boundary" x="126" y="194" width="220" height="88" rx="8" />
          <circle class="review-journey-dot stage-boundary" cx="158" cy="218" r="12" />
          <text class="review-journey-number" x="158" y="218" text-anchor="middle">B</text>
          <text class="review-journey-tag" x="236" y="220" text-anchor="middle">边界情况</text>
          ${svgText(boundary, 236, 246, 'review-journey-label', 15, 13)}
        </g>
        <g>
          <rect class="review-journey-node stage-recovery" x="356" y="194" width="220" height="88" rx="8" />
          <circle class="review-journey-dot stage-recovery" cx="388" cy="218" r="12" />
          <text class="review-journey-number" x="388" y="218" text-anchor="middle">R</text>
          <text class="review-journey-tag" x="466" y="220" text-anchor="middle">恢复路径</text>
          ${svgText(recovery, 466, 246, 'review-journey-label', 15, 13)}
        </g>
      </svg>
    </div>
  `;
}

function reviewSubtitleText(value) {
  return String(value ?? '').replace(/[。.]$/u, '');
}

function renderReviewPanel({ kind, title, description, items, emptyText, visual = '' }) {
  const itemCount = Array.isArray(items) ? items.filter(Boolean).length : 0;
  return `
    <section class="review-panel review-panel-${escapeHtml(kind)}" id="review-panel-${escapeHtml(kind)}">
      <header class="review-panel-head">
        ${reviewIcon(kind)}
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(reviewSubtitleText(description))}</p>
        </div>
        <span class="review-panel-count${itemCount === 0 ? ' empty' : ''}" aria-label="条目数">${itemCount === 0 ? '暂无' : `${itemCount} 条`}</span>
      </header>
      <div class="review-chip-row" aria-label="${escapeHtml(title)}重点摘要">
        ${reviewHighlightChips(items, emptyText)}
      </div>
      ${visual}
      <ul class="review-panel-list">${reviewPanelListMarkup(items, emptyText)}</ul>
    </section>
  `;
}

function reviewPanelListMarkup(items, emptyText = '暂无') {
  const normalized = Array.isArray(items) ? items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [];
  if (normalized.length === 0) {
    return `<li class="empty">${escapeHtml(emptyText)}</li>`;
  }
  return normalized.map((item) => {
    const parsed = parseReviewPanelDetail(item);
    return `<li><strong class="review-detail-summary">${escapeHtml(parsed.summary)}</strong><span class="review-detail-body">：${escapeHtml(parsed.detail)}</span></li>`;
  }).join('');
}

function parseReviewPanelDetail(value) {
  const text = normalizedReviewVisibleText(value);
  const markdown = text.match(/^\*\*([^*]+)\*\*\s*[：:]\s*(.+)$/u);
  if (markdown) {
    return {
      summary: markdown[1].trim(),
      detail: markdown[2].trim(),
    };
  }
  const plain = text.match(/^([^：:]{2,18})[：:]\s*(.+)$/u);
  if (plain) {
    return {
      summary: plain[1].trim(),
      detail: plain[2].trim(),
    };
  }
  return {
    summary: reviewDetailSummary(text),
    detail: text,
  };
}

function reviewDetailSummary(value) {
  const text = normalizedReviewVisibleText(value);
  const clause = text.split(/[。；;，,、.!?？]/u).map((item) => item.trim()).find((item) => item.length >= 2 && item.length <= 18);
  return condensedReviewChipLabel(text) ?? clause ?? '重点说明';
}

function reviewCopyBundle({ label, command, payload, message = null }) {
  return [
    `OpenPrD Review: ${label}`,
    message ?? null,
    command ? '命令:' : null,
    command,
    '上下文:',
    payload,
  ].filter(Boolean).join('\n\n');
}

function reviewContinueMessage(snapshot) {
  return '当前评审内容已记录为可逆默认方案。Agent 会继续推进实现；后续反馈可覆盖这份记录，不影响当前工作。';
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function reviewCommand(snapshot, status, notes = null, extra = {}) {
  const parts = ['openprd review . --mark', status];
  if (snapshot.versionId) {
    parts.push('--version', shellQuote(snapshot.versionId));
  }
  if (snapshot.digest) {
    parts.push('--digest', shellQuote(snapshot.digest));
  }
  if (snapshot.workUnitId) {
    parts.push('--work-unit', shellQuote(snapshot.workUnitId));
  }
  if (extra.direction) {
    parts.push('--direction', shellQuote(extra.direction));
  }
  if (notes) {
    parts.push('--notes', shellQuote(notes));
  }
  return parts.join(' ');
}

function reviewDirectionImageHref(imagePath) {
  const text = String(imagePath ?? '').trim();
  if (!text) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(text)) {
    return text;
  }
  return `../../${text.split(path.sep).join('/')}`;
}

function renderReviewDesignDirections(snapshot) {
  const block = reviewDesignDirections(snapshot);
  if (!block) return '';
  const cards = block.directions.map((direction, index) => {
    const id = normalizedReviewVisibleText(direction.id) || `direction-${index + 1}`;
    const title = normalizedReviewVisibleText(direction.title) || `方向 ${index + 1}`;
    const summary = normalizedReviewVisibleText(direction.summary);
    const tradeoff = normalizedReviewVisibleText(direction.tradeoff);
    const href = reviewDirectionImageHref(direction.image);
    const selectCommand = reviewCommand(snapshot, 'confirmed', null, { direction: id });
    const selectCopy = reviewCopyBundle({
      label: `方向反馈：${title}`,
      command: selectCommand,
      payload: JSON.stringify({ versionId: snapshot.versionId, direction: id, title }, null, 2),
      message: `我更偏好「${title}」；请把它记录为当前方向。后续反馈可以覆盖，当前实现继续推进。`,
    });
    const image = href
      ? `<a class="review-direction-image" href="${escapeHtml(href)}" target="_blank" rel="noopener"><img src="${escapeHtml(href)}" alt="${escapeHtml(title)} 交互稿" loading="lazy" /></a>`
      : '<div class="review-direction-image review-direction-image-missing">交互稿图片待生成</div>';
    return `
        <article class="review-direction-card" data-direction="${escapeHtml(id)}">
          ${image}
          <div class="review-direction-body">
            <div class="review-direction-head">
              <span class="review-direction-index">方向 ${index + 1}</span>
              <h3>${escapeHtml(title)}</h3>
            </div>
            ${summary ? `<p class="review-direction-summary">${escapeHtml(summary)}</p>` : ''}
            ${tradeoff ? `<p class="review-direction-tradeoff">取舍：${escapeHtml(tradeoff)}</p>` : ''}
            <button type="button" class="review-direction-select" data-copy-value="${escapeHtml(selectCopy)}" title="复制这个方向的反馈">
              偏好这个方向
            </button>
          </div>
        </article>`;
  });
  return `
      <section class="review-directions" id="review-panel-design-directions" aria-label="交互方向评审">
        <div class="review-section-heading">
          <h2>交互方向参考</h2>
          <p>这里提供 ${block.directions.length} 个可参考方向。Agent 可先采用可逆默认方向继续实现；你的反馈会覆盖当前方向，不会成为开始或继续实现的前置条件。</p>
        </div>
        <div class="review-direction-grid">
          ${cards.join('\n')}
        </div>
      </section>`;
}

function renderReviewDecision(snapshot, reviewModel) {
  const payload = JSON.stringify(buildReviewExportPayload(snapshot), null, 2);
  const confirmCommand = reviewCommand(snapshot, 'confirmed');
  const reviseCommand = reviewCommand(snapshot, 'needs-revision', '说明需要调整的点');
  const confirmCopy = reviewCopyBundle({
    label: '按当前方向推进',
    command: confirmCommand,
    payload,
    message: reviewContinueMessage(snapshot),
  });
  const reviseCopy = reviewCopyBundle({ label: '需要调整', command: reviseCommand, payload });
  return `
    <nav class="review-bottom-bar" aria-label="评审反馈" data-review-model-digest="${escapeHtml(reviewModel.digest)}">
      <div class="review-bottom-bar-inner">
        <button type="button" class="review-bottom-action revise" data-copy-value="${escapeHtml(reviseCopy)}" title="复制需要调整的反馈">
          需要调整
        </button>
        <button type="button" class="review-bottom-action confirm" data-copy-value="${escapeHtml(confirmCopy)}" title="复制当前方向的反馈">
          按当前方向推进
        </button>
      </div>
    </nav>
  `;
}

function renderReviewWorkbenchHeader(reviewModel) {
  return `
    <section class="review-workbench" aria-labelledby="reviewWorkbenchTitle" data-review-model-digest="${escapeHtml(reviewModel.digest)}">
      <div class="review-workbench-copy">
        <p class="review-kicker">双轨证据工作台</p>
        <h2 id="reviewWorkbenchTitle">同一份评审，两种读法</h2>
        <p>先在业务视图看清价值、范围、流程和风险；需要追溯任务、约束或依据时，再切到工程视图。两边共享同一份评审记录。</p>
      </div>
      <div class="review-view-tabs" role="tablist" aria-label="选择评审视图">
        <button
          type="button"
          id="reviewTabBusiness"
          class="review-view-tab active"
          role="tab"
          aria-selected="true"
          aria-controls="reviewBusinessView"
          data-review-tab="business"
        >业务视图<span>先看结论</span></button>
        <button
          type="button"
          id="reviewTabEngineering"
          class="review-view-tab"
          role="tab"
          aria-selected="false"
          aria-controls="reviewEngineeringView"
          data-review-tab="engineering"
          tabindex="-1"
        >工程视图<span>核对追溯</span></button>
      </div>
      <p class="review-workbench-note" aria-live="polite">两种视图共享同一份参考记录，切换视图不会改变内容。</p>
    </section>
  `;
}

function renderBusinessEvidenceBridge(projection) {
  const references = projection.evidenceReferences;
  if (references.length === 0) return '';
  return `
    <section class="review-business-evidence" aria-labelledby="reviewBusinessEvidenceTitle">
      <div>
        <p class="review-kicker">判断依据</p>
        <h2 id="reviewBusinessEvidenceTitle">这些结论有 ${references.length} 条依据可核对</h2>
        <p>这里先保留清楚的业务结论；需要看原始依据时，可以直接定位到工程视图。</p>
      </div>
      <div class="review-business-evidence-actions">
        ${references.map((item) => `
          <button type="button" data-review-locate="review-evidence-${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>
        `).join('')}
      </div>
    </section>
  `;
}

function reviewEngineeringRows(items, emptyText) {
  if (items.length === 0) {
    return `<p class="review-engineering-empty">${escapeHtml(emptyText)}</p>`;
  }
  return `<ul class="review-engineering-list">${items.map((item) => {
    const candidate = item && typeof item === 'object' && !Array.isArray(item) ? item : { detail: item };
    const label = normalizedReviewVisibleText(candidate.label ?? candidate.title ?? candidate.summary);
    const detail = normalizedReviewVisibleText(candidate.detail ?? candidate.value ?? candidate.text);
    const code = Boolean(candidate.code);
    return `
      <li class="review-engineering-item" data-review-filter-item>
        ${label ? `<strong>${escapeHtml(label)}</strong>` : ''}
        ${detail ? code ? `<code>${escapeHtml(detail)}</code>` : `<span>${escapeHtml(detail)}</span>` : ''}
      </li>`;
  }).join('')}</ul>`;
}

function renderReviewEngineeringSection({ id, title, description, items, emptyText }) {
  return `
    <section class="review-engineering-section" id="${escapeHtml(id)}" aria-labelledby="${escapeHtml(id)}-title">
      <header>
        <h2 id="${escapeHtml(id)}-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </header>
      ${reviewEngineeringRows(items, emptyText)}
    </section>
  `;
}

function renderReviewEngineeringProjection(projection) {
  const trace = projection.trace;
  const sections = projection.sections;
  const traceItems = [
    { label: '评审版本', detail: trace.versionId ?? '旧版评审未记录', code: true },
    { label: '工作单元', detail: trace.workUnitId ?? '尚未绑定', code: true },
    { label: '内容指纹', detail: projection.modelDigest, code: true },
    { label: '来源摘要', detail: trace.snapshotDigest ?? '旧版评审未记录', code: true },
    ...(trace.targetRoot ? [{ label: '项目位置', detail: trace.targetRoot, code: true }] : []),
  ];
  const deliveryItems = [
    ...sections.delivery.functional.map((detail, index) => ({ label: `交付项 ${index + 1}`, detail })),
    ...sections.delivery.nonFunctional.map((detail, index) => ({ label: `质量要求 ${index + 1}`, detail })),
    ...sections.tasks.map((task) => ({
      label: `${task.id}${task.status ? ` · ${task.status}` : ''}`,
      detail: task.title,
    })),
  ];
  const constraintItems = [
    ...sections.constraints.technical.map((detail, index) => ({ label: `技术约束 ${index + 1}`, detail })),
    ...sections.constraints.compliance.map((detail, index) => ({ label: `合规约束 ${index + 1}`, detail })),
    ...sections.constraints.dependencies.map((detail, index) => ({ label: `依赖 ${index + 1}`, detail })),
  ];
  const fileItems = sections.files.map((detail, index) => ({ label: `文件 ${index + 1}`, detail, code: true }));
  const acceptanceItems = sections.acceptance.map((detail, index) => ({ label: `验收 ${index + 1}`, detail }));
  const handoffItems = [
    sections.handoff.owner ? { label: '负责人', detail: sections.handoff.owner } : null,
    sections.handoff.nextStep ? { label: '下一步', detail: sections.handoff.nextStep } : null,
    sections.handoff.targetSystem ? { label: '目标范围', detail: sections.handoff.targetSystem } : null,
  ].filter(Boolean);
  const evidenceItems = projection.evidenceReferences.map((item, index) => `
    <article
      class="review-evidence-item review-engineering-item"
      id="review-evidence-${escapeHtml(item.id)}"
      tabindex="-1"
      data-review-filter-item
    >
      <div class="review-evidence-index">${index + 1}</div>
      <div>
        <h3>${escapeHtml(item.label)}</h3>
        <p>${escapeHtml(item.summary)}</p>
        <div class="review-evidence-meta">
          <span>${escapeHtml(item.kind === 'problem' ? '问题依据' : item.kind === 'validation' ? '验证依据' : '关联资料')}</span>
          ${item.source ? `<span>来源：${escapeHtml(item.source)}</span>` : ''}
          ${item.href ? `<code>${escapeHtml(item.href)}</code>` : ''}
        </div>
      </div>
    </article>
  `).join('');
  const filterableCount = traceItems.length + deliveryItems.length + constraintItems.length
    + fileItems.length + acceptanceItems.length + handoffItems.length + projection.evidenceReferences.length;

  return `
    <section
      class="review-projection review-projection-engineering"
      id="reviewEngineeringView"
      role="tabpanel"
      aria-labelledby="reviewTabEngineering"
      data-review-view="engineering"
      data-review-model-digest="${escapeHtml(projection.modelDigest)}"
      hidden
    >
      <header class="review-engineering-head">
        <div>
          <p class="review-kicker">工程追溯</p>
          <h1>从同一结论核对任务、约束与证据</h1>
          <p>这里展示落地所需的版本、任务、文件、测试与依据；底部反馈会写回同一份评审记录，但不会暂停实现。</p>
        </div>
        <label class="review-engineering-filter" for="reviewEngineeringFilter">
          <span>筛选工程内容</span>
          <input id="reviewEngineeringFilter" type="search" placeholder="搜索任务、约束或证据" autocomplete="off" />
          <output id="reviewEngineeringFilterCount" for="reviewEngineeringFilter">共 ${filterableCount} 项</output>
        </label>
      </header>
      <div class="review-engineering-grid">
        ${renderReviewEngineeringSection({
          id: 'review-engineering-trace',
          title: '版本与追溯',
          description: '查看这次评审来自哪份内容，并核对两个视图的共同指纹。',
          items: traceItems,
          emptyText: '暂无版本与追溯信息。',
        })}
        ${renderReviewEngineeringSection({
          id: 'review-engineering-delivery',
          title: '交付与任务',
          description: '查看必须交付的能力、质量要求和已经绑定的任务。',
          items: deliveryItems,
          emptyText: '当前评审稿尚未绑定具体任务。',
        })}
        ${renderReviewEngineeringSection({
          id: 'review-engineering-constraints',
          title: '约束与依赖',
          description: '实现时不能越过的技术、合规与依赖边界。',
          items: constraintItems,
          emptyText: '暂无额外约束或依赖。',
        })}
        ${renderReviewEngineeringSection({
          id: 'review-engineering-files',
          title: '文件与改动范围',
          description: '任务或证据已经明确关联的文件位置。',
          items: fileItems,
          emptyText: '当前评审稿尚未绑定具体文件。',
        })}
        ${renderReviewEngineeringSection({
          id: 'review-engineering-acceptance',
          title: '测试与验收',
          description: '实现完成后据此判断是否真的达到目标。',
          items: acceptanceItems,
          emptyText: '当前评审稿尚未写明验收条件。',
        })}
        ${renderReviewEngineeringSection({
          id: 'review-engineering-handoff',
          title: '交接信息',
          description: '明确由谁继续、下一步做什么、影响哪些范围。',
          items: handoffItems,
          emptyText: '当前评审稿尚未写明交接信息。',
        })}
      </div>
      <section class="review-evidence-section" aria-labelledby="reviewEvidenceTitle">
        <header>
          <p class="review-kicker">共享证据</p>
          <h2 id="reviewEvidenceTitle">证据索引</h2>
          <p>业务视图里的“查看依据”会定位到这里；筛选不会改变证据与评审记录的关联。</p>
        </header>
        <div class="review-evidence-list">
          ${evidenceItems || '<p class="review-engineering-empty">当前评审稿尚未登记原始依据。</p>'}
        </div>
      </section>
      <p class="review-engineering-no-results" id="reviewEngineeringNoResults" hidden>没有找到匹配内容，请换一个更短的关键词。</p>
    </section>
  `;
}

function renderReviewPage({ snapshot, sectionsData, projectRelease }) {
  const reviewModel = buildReviewModel(snapshot);
  const businessProjection = projectReviewModel(reviewModel, 'business');
  const engineeringProjection = projectReviewModel(reviewModel, 'engineering');
  const primaryFlows = reviewList(sectionsData.scenarios?.primaryFlows);
  const edgeCases = reviewList(sectionsData.scenarios?.edgeCases);
  const failureModes = reviewList(sectionsData.scenarios?.failureModes);
  const visibleProjectRelease = resolveReviewProjectRelease(projectRelease ?? snapshot.projectRelease);
  const flowPanelItems = reviewPresentationPanelItems(snapshot, 'flow', [
    ...primaryFlows,
    ...edgeCases,
    ...failureModes,
  ]);
  const functionPanelItems = reviewPresentationPanelItems(snapshot, 'function', [
    ...reviewList(sectionsData.requirements?.functional),
    ...reviewList(sectionsData.requirements?.nonFunctional),
    ...reviewList(sectionsData.constraints?.dependencies),
  ]);
  const guardrailPanelItems = reviewPresentationPanelItems(snapshot, 'guardrail', [
    ...reviewList(sectionsData.businessGuardrails?.costDrivers),
    ...reviewList(sectionsData.businessGuardrails?.usageLimits),
    ...reviewList(sectionsData.businessGuardrails?.abusePrevention),
    ...reviewList(sectionsData.businessGuardrails?.monitoringSignals),
    ...reviewList(sectionsData.businessGuardrails?.alertThresholds),
    ...reviewList(sectionsData.businessGuardrails?.stopLossActions),
  ]);
  const riskPanelItems = reviewPresentationPanelItems(snapshot, 'risk', [
    ...reviewList(sectionsData.risks?.assumptions),
    ...reviewList(sectionsData.risks?.risks),
    ...reviewList(sectionsData.risks?.openQuestions),
  ]);
  const panelSpecs = [
    {
      kind: 'flow',
      title: '主流程与边界情况',
      description: '查看用户旅程、关键步骤和恢复路径；信息不足时由 Agent 采用可逆默认方向并继续推进',
      emptyText: '暂无主流程、边界情况或失败路径。',
      visual: renderReviewJourneySvg({ primaryFlows, edgeCases, failureModes }),
      items: flowPanelItems,
    },
    {
      kind: 'function',
      title: '功能与约束',
      description: '区分必须交付、非功能要求和当前依赖假设',
      emptyText: '暂无功能、非功能要求或依赖约束。',
      items: functionPanelItems,
    },
    {
      kind: 'guardrail',
      title: '业务成本与滥用护栏',
      description: '涉及免费额度、消耗型成本或第三方调用时，记录限制、提醒和止损动作',
      emptyText: '暂无业务成本或滥用护栏。',
      items: guardrailPanelItems,
    },
    {
      kind: 'risk',
      title: '开放问题与风险',
      description: '尚未完善的问题留在这里，由 Agent 后台跟进，不影响当前实现',
      emptyText: '暂无假设、风险或开放问题。',
      items: riskPanelItems,
    },
  ];
  const designDirectionsBlock = reviewDesignDirections(snapshot);
  const panelAgenda = [
    ...(designDirectionsBlock
      ? [{ kind: 'design-directions', title: '交互方向参考（可随时反馈）', count: designDirectionsBlock.directions.length, unit: '个方向' }]
      : []),
    ...panelSpecs.map((spec) => ({
      kind: spec.kind,
      title: spec.title,
      count: Array.isArray(spec.items) ? spec.items.filter(Boolean).length : 0,
    })),
  ];
  const panels = panelSpecs.map((spec) => renderReviewPanel(spec));
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(snapshot.title || 'PRD 评审')}</title>
    <style>
      :root {
        color-scheme: light;
        --review-bg: #f6f8fb;
        --review-panel: #ffffff;
        --review-panel-soft: #f9fafb;
        --review-text: #172033;
        --review-muted: #667085;
        --review-line: #d8dee8;
        --review-blue: #2563eb;
        --review-teal: #0f766e;
        --review-indigo: #4f46e5;
        --review-amber: #b45309;
        --review-red: #dc2626;
        --review-green: #15803d;
        --review-mono: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--review-bg);
        color: var(--review-text);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow-x: hidden;
      }
      .review-page {
        max-width: 1220px;
        margin: 0 auto;
        padding: 28px 22px 120px;
      }
      .review-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 16px;
      }
      .review-stage-rail {
        margin: 0 0 16px;
        border: 1px solid var(--review-line);
        border-radius: 14px;
        background: var(--review-panel);
        padding: 12px 18px;
        overflow-x: auto;
      }
      .review-stage-rail ol {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
        min-width: max-content;
      }
      .review-stage {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 13px;
        color: var(--review-muted);
        white-space: nowrap;
      }
      .review-stage + .review-stage::before {
        content: '→';
        margin-right: 6px;
        color: var(--review-line);
      }
      .review-stage-dot {
        display: inline-grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border-radius: 999px;
        border: 1px solid var(--review-line);
        background: var(--review-panel-soft);
        font-size: 12px;
        font-weight: 800;
      }
      .review-stage.done .review-stage-dot {
        border-color: #86efac;
        background: #dcfce7;
        color: #15803d;
      }
      .review-stage.done .review-stage-name {
        color: var(--review-text);
      }
      .review-stage.current {
        background: #eef2ff;
        border: 1px solid #c7d2fe;
        color: var(--review-indigo);
        font-weight: 800;
      }
      .review-stage.current .review-stage-dot {
        border-color: var(--review-indigo);
        background: var(--review-indigo);
        color: #fff;
      }
      .review-stage-badge {
        font-size: 11px;
        font-weight: 800;
        color: #fff;
        background: var(--review-indigo);
        border-radius: 999px;
        padding: 2px 8px;
      }
      .review-brand {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        border: 1px solid var(--review-line);
        border-radius: 999px;
        background: var(--review-panel);
        color: var(--review-muted);
        padding: 0 12px;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0;
      }
      .review-project-version {
        display: grid;
        gap: 4px;
        min-width: 220px;
        margin-left: auto;
        padding: 12px 16px;
        border: 1px solid #bfdbfe;
        border-radius: 16px;
        background: linear-gradient(135deg, #eff6ff 0%, #ffffff 100%);
        box-shadow: 0 12px 24px rgba(37, 99, 235, 0.08);
      }
      .review-project-version-label {
        color: var(--review-blue);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0;
      }
      .review-project-version-value {
        color: var(--review-text);
        font-family: var(--review-mono);
        font-size: 22px;
        line-height: 1.1;
      }
      .review-project-version-meta {
        color: var(--review-muted);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0;
      }
      .review-kicker {
        margin: 0 0 6px;
        color: var(--review-muted);
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0;
      }
      .review-overview,
      .review-map {
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: var(--review-panel);
        box-shadow: 0 16px 34px rgba(15, 23, 42, 0.06);
      }
      .review-overview {
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr);
        gap: 24px;
        align-items: start;
        padding: 24px;
      }
      .review-goal {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 8px;
        max-width: 760px;
        margin: 14px 0 0;
        color: var(--review-text);
        font-size: 15px;
        line-height: 1.7;
      }
      .review-goal-label {
        flex-shrink: 0;
        padding: 2px 10px;
        border-radius: 999px;
        border: 1px solid rgba(37,99,235,0.3);
        background: rgba(37,99,235,0.06);
        color: var(--review-blue);
        font-size: 12px;
        font-weight: 600;
      }
      .review-agenda {
        padding: 16px 18px;
        border-radius: 14px;
        border: 1px solid var(--review-line);
        background: var(--review-panel-soft);
      }
      .review-agenda-title {
        margin: 0;
        color: var(--review-text);
        font-size: 14px;
        font-weight: 700;
      }
      .review-agenda-list {
        margin: 12px 0 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 6px;
        counter-reset: agenda;
      }
      .review-agenda-list li { counter-increment: agenda; }
      .review-agenda-list a {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid transparent;
        color: var(--review-text);
        text-decoration: none;
        font-size: 14px;
        line-height: 1.5;
      }
      .review-agenda-list a::before {
        content: counter(agenda);
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: rgba(37,99,235,0.1);
        color: var(--review-blue);
        font-size: 12px;
        font-weight: 700;
      }
      .review-agenda-list a:hover {
        border-color: var(--review-line);
        background: #ffffff;
      }
      .review-agenda-name { flex: 1; min-width: 0; }
      .review-agenda-count {
        flex-shrink: 0;
        color: var(--review-blue);
        font-size: 12px;
        font-weight: 600;
      }
      .review-agenda-count.empty { color: var(--review-muted); font-weight: 400; }
      .review-agenda-foot {
        margin: 12px 0 0;
        color: var(--review-muted);
        font-size: 13px;
        line-height: 1.6;
      }
      .review-panel-count {
        flex-shrink: 0;
        margin-left: auto;
        padding: 3px 10px;
        border-radius: 999px;
        border: 1px solid rgba(37,99,235,0.25);
        background: rgba(37,99,235,0.06);
        color: var(--review-blue);
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }
      .review-panel-count.empty {
        border-color: var(--review-line);
        background: var(--review-panel-soft);
        color: var(--review-muted);
        font-weight: 400;
      }
      .review-overview-copy,
      .review-panel {
        min-width: 0;
      }
      .review-overview h1,
      .review-map h2,
      .review-panel h3 {
        margin: 0;
        color: var(--review-text);
        letter-spacing: 0;
        overflow-wrap: anywhere;
      }
      .review-overview h1 {
        font-size: 32px;
        line-height: 1.16;
        word-break: break-word;
      }
      .review-problem {
        max-width: 760px;
        margin: 12px 0 0;
        color: var(--review-muted);
        font-size: 16px;
        line-height: 1.75;
        overflow-wrap: anywhere;
      }
      .review-gap {
        margin-top: 18px;
        padding: 18px 20px;
        border-radius: 16px;
        border: 1px solid var(--review-line);
        background: var(--review-panel);
        box-shadow: 0 10px 24px rgba(23,32,51,0.05);
      }
      .review-gap-clear {
        border-color: rgba(21,128,61,0.3);
        background: #f2fbf5;
      }
      .review-gap-pending {
        border-color: rgba(180,83,9,0.3);
        background: #fffaf2;
      }
      .review-gap-headline {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 10px;
        font-size: 16px;
      }
      .review-gap-headline strong {
        color: var(--review-text);
        font-size: 17px;
      }
      .review-gap-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        align-self: center;
      }
      .review-gap-clear .review-gap-dot { background: var(--review-green); }
      .review-gap-pending .review-gap-dot { background: var(--review-amber); }
      .review-gap-sub {
        color: var(--review-muted);
        font-size: 14px;
        line-height: 1.6;
      }
      .review-gap-list {
        margin: 14px 0 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 8px;
      }
      .review-gap-item {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(180,83,9,0.16);
        background: rgba(255,255,255,0.75);
        font-size: 14px;
        line-height: 1.6;
      }
      .review-gap-item strong { color: var(--review-text); }
      .review-gap-hint { color: var(--review-muted); }
      .review-gap-tag {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--review-line);
        background: #ffffff;
        color: var(--review-muted);
        font-size: 12px;
        font-weight: 600;
      }
      .review-gap-tag-key {
        border-color: rgba(220,38,38,0.35);
        color: var(--review-red);
        background: rgba(220,38,38,0.06);
      }
      .review-map {
        margin-top: 18px;
        padding: 20px;
      }
      .review-section-heading,
      .review-panel-head {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .review-section-heading h2 {
        font-size: 22px;
      }
      .review-icon {
        flex: 0 0 auto;
        display: inline-flex;
        width: 38px;
        height: 38px;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
      }
      .review-icon svg {
        width: 22px;
        height: 22px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .review-icon-map { color: var(--review-indigo); background: #eef2ff; }
      .review-icon-flow { color: var(--review-teal); background: #ccfbf1; }
      .review-icon-function { color: var(--review-blue); background: #dbeafe; }
      .review-icon-guardrail { color: var(--review-amber); background: #fef3c7; }
      .review-icon-risk { color: var(--review-red); background: #fee2e2; }
      .review-map-canvas {
        margin-top: 14px;
        overflow-x: auto;
        max-width: 100%;
      }
      .review-map-canvas svg {
        display: block;
        width: 100%;
        min-width: 680px;
        height: auto;
      }
      .review-map-bg {
        fill: #f8fafc;
        stroke: #e2e8f0;
      }
      .review-map-arrow {
        fill: none;
        stroke: var(--review-indigo);
        stroke-width: 3;
        stroke-linecap: round;
      }
      .review-map-link {
        fill: none;
        stroke: #a5b4fc;
        stroke-width: 2.5;
        stroke-linecap: round;
      }
      .review-map-node {
        fill: #ffffff;
        stroke: #cbd5e1;
        stroke-width: 1.5;
        filter: drop-shadow(0 10px 16px rgba(15, 23, 42, 0.08));
      }
      .review-map-center {
        fill: #eef2ff;
        stroke: #818cf8;
        stroke-width: 1.5;
        filter: drop-shadow(0 14px 18px rgba(79, 70, 229, 0.12));
      }
      .review-map-node.node-1 { stroke: #99f6e4; }
      .review-map-node.node-2 { stroke: #bfdbfe; }
      .review-map-node.node-3 { stroke: #fde68a; }
      .review-map-node.node-4 { stroke: #fecaca; }
      .review-map-step {
        fill: var(--review-indigo);
        font-size: 13px;
        font-weight: 800;
      }
      .review-map-tag {
        fill: var(--review-muted);
        font-size: 11px;
        font-weight: 800;
      }
      .review-map-tag-pill {
        fill: #f8fafc;
        stroke: #cbd5e1;
        stroke-width: 1;
      }
      .review-map-tag-pill.center { fill: #e0e7ff; stroke: #a5b4fc; }
      .review-map-tag-pill.node-1 { fill: #ccfbf1; stroke: #5eead4; }
      .review-map-tag-pill.node-2 { fill: #dbeafe; stroke: #93c5fd; }
      .review-map-tag-pill.node-3 { fill: #fef3c7; stroke: #facc15; }
      .review-map-tag-pill.node-4 { fill: #fee2e2; stroke: #fca5a5; }
      .review-map-tag.center { fill: var(--review-indigo); }
      .review-map-tag.node-1 { fill: #0f766e; }
      .review-map-tag.node-2 { fill: #2563eb; }
      .review-map-tag.node-3 { fill: #b45309; }
      .review-map-tag.node-4 { fill: #dc2626; }
      .review-map-label {
        fill: var(--review-text);
        font-size: 12px;
        font-weight: 680;
      }
      .review-map-note {
        margin: 10px 0 0;
        color: var(--review-muted);
        font-size: 13px;
      }
      .review-panel-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin-top: 18px;
      }
      .review-panel {
        min-height: 260px;
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: var(--review-panel);
        padding: 18px;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
      }
      .review-panel h3 {
        font-size: 20px;
      }
      .review-panel-head p {
        margin: 5px 0 0;
        color: var(--review-muted);
        font-size: 14px;
        line-height: 1.55;
      }
      .review-chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
        padding: 12px;
        border-radius: 8px;
        background: var(--review-panel-soft);
        border: 1px solid var(--review-line);
      }
      .review-chip {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        max-width: 100%;
        min-height: 28px;
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid var(--review-line);
        background: #ffffff;
        color: var(--review-text);
        font-size: 13px;
        font-weight: 750;
        line-height: 1.25;
        white-space: nowrap;
        overflow-wrap: normal;
        word-break: keep-all;
      }
      .review-panel-flow .review-chip { border-color: #99f6e4; background: #f0fdfa; color: #115e59; }
      .review-panel-function .review-chip { border-color: #bfdbfe; background: #eff6ff; color: #1d4ed8; }
      .review-panel-guardrail .review-chip { border-color: #fde68a; background: #fffbeb; color: #92400e; }
      .review-panel-risk .review-chip { border-color: #fecaca; background: #fff1f2; color: #991b1b; }
      .review-chip.empty {
        color: var(--review-muted);
        background: #ffffff;
        border-color: var(--review-line);
      }
      .review-journey-map {
        margin-top: 12px;
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: #f8fafc;
        overflow-x: auto;
        overflow-y: hidden;
      }
      .review-journey-map svg {
        display: block;
        width: 100%;
        min-width: 0;
        min-height: 230px;
      }
      .review-journey-bg {
        fill: #fbfdff;
        stroke: none;
      }
      .review-journey-arrow {
        fill: none;
        stroke: #0d9488;
        stroke-width: 2;
        stroke-linecap: round;
      }
      .review-journey-arrow.branch {
        stroke: #94a3b8;
        stroke-dasharray: 5 6;
      }
      .review-journey-node {
        fill: #ffffff;
        stroke-width: 1.6;
        filter: drop-shadow(0 10px 18px rgba(15, 23, 42, 0.08));
      }
      .review-journey-node.stage-journey { stroke: #5eead4; }
      .review-journey-node.stage-step { stroke: #93c5fd; }
      .review-journey-node.stage-outcome { stroke: #a5b4fc; }
      .review-journey-node.stage-boundary { stroke: #fde68a; }
      .review-journey-node.stage-recovery { stroke: #fecaca; }
      .review-journey-dot {
        fill: #0f172a;
      }
      .review-journey-dot.stage-journey { fill: #0d9488; }
      .review-journey-dot.stage-step { fill: #2563eb; }
      .review-journey-dot.stage-outcome { fill: #4f46e5; }
      .review-journey-dot.stage-boundary { fill: #ca8a04; }
      .review-journey-dot.stage-recovery { fill: #dc2626; }
      .review-journey-number {
        fill: #ffffff;
        font-size: 11px;
        font-weight: 850;
        dominant-baseline: central;
      }
      .review-journey-tag {
        fill: #64748b;
        font-size: 12px;
        font-weight: 850;
      }
      .review-journey-label {
        fill: #0f172a;
        font-size: 12px;
        font-weight: 760;
      }
      .review-panel-list {
        margin: 16px 0 0;
        padding-left: 18px;
        color: var(--review-text);
        font-size: 15px;
        line-height: 1.72;
        overflow-wrap: anywhere;
      }
      .review-panel-list li + li {
        margin-top: 9px;
      }
      .review-detail-summary {
        font-weight: 850;
        color: var(--review-text);
      }
      .review-detail-body {
        color: var(--review-text);
      }
      .review-panel-list .empty {
        color: var(--review-muted);
      }
      .review-bottom-bar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 30;
        padding: 12px 22px calc(12px + env(safe-area-inset-bottom));
        border-top: 1px solid var(--review-line);
        background: rgba(246, 248, 251, 0.94);
        box-shadow: 0 -14px 32px rgba(15, 23, 42, 0.08);
        backdrop-filter: blur(14px);
      }
      .review-bottom-bar-inner {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        max-width: 1220px;
        margin: 0 auto;
      }
      .review-bottom-action {
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 152px;
        min-height: 48px;
        border: 1px solid transparent;
        border-radius: 12px;
        padding: 0 20px;
        font: inherit;
        font-size: 16px;
        font-weight: 850;
        letter-spacing: 0;
        line-height: 1;
        white-space: nowrap;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
        transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }
      .review-bottom-action.revise {
        border-color: #fecaca;
        background: #fff1f2;
        color: #b42318;
      }
      .review-bottom-action.confirm {
        border-color: #bbf7d0;
        background: #ecfdf3;
        color: #067647;
      }
      .review-bottom-action:hover,
      .review-bottom-action:focus-visible {
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.1);
        transform: translateY(-1px);
        outline: none;
      }
      .review-bottom-action.revise:hover,
      .review-bottom-action.revise:focus-visible {
        border-color: #fda4af;
        background: #ffe4e6;
      }
      .review-bottom-action.confirm:hover,
      .review-bottom-action.confirm:focus-visible {
        border-color: #86efac;
        background: #dcfce7;
      }
      .review-bottom-action:active {
        box-shadow: 0 4px 10px rgba(15, 23, 42, 0.08);
        transform: translateY(0);
      }
      .review-workbench {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 22px;
        align-items: end;
        margin-bottom: 18px;
        padding: 20px 22px;
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: var(--review-panel);
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
      }
      .review-workbench-copy h2 {
        margin: 0;
        color: var(--review-text);
        font-size: 24px;
        line-height: 1.25;
        letter-spacing: 0;
      }
      .review-workbench-copy > p:last-child,
      .review-workbench-note {
        margin: 8px 0 0;
        color: var(--review-muted);
        font-size: 14px;
        line-height: 1.65;
      }
      .review-workbench-note {
        grid-column: 1 / -1;
        margin: 0;
        padding-top: 12px;
        border-top: 1px solid var(--review-line);
        font-size: 13px;
      }
      .review-view-tabs {
        display: inline-grid;
        grid-template-columns: repeat(2, minmax(132px, 1fr));
        gap: 4px;
        padding: 4px;
        border: 1px solid var(--review-line);
        border-radius: 12px;
        background: var(--review-panel-soft);
      }
      .review-view-tab {
        cursor: pointer;
        display: grid;
        gap: 2px;
        min-height: 52px;
        border: 1px solid transparent;
        border-radius: 9px;
        padding: 8px 14px;
        background: transparent;
        color: var(--review-muted);
        font: inherit;
        font-size: 14px;
        font-weight: 800;
        line-height: 1.2;
        text-align: left;
      }
      .review-view-tab span {
        font-size: 11px;
        font-weight: 600;
      }
      .review-view-tab:hover,
      .review-view-tab:focus-visible {
        border-color: #c7d2fe;
        color: var(--review-indigo);
        outline: none;
      }
      .review-view-tab.active {
        border-color: #c7d2fe;
        background: #ffffff;
        color: var(--review-indigo);
        box-shadow: 0 4px 12px rgba(79, 70, 229, 0.1);
      }
      .review-projection[hidden],
      [data-review-filter-item][hidden],
      .review-engineering-no-results[hidden] {
        display: none !important;
      }
      .review-business-evidence {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(260px, 0.72fr);
        gap: 22px;
        align-items: center;
        margin-top: 18px;
        padding: 20px;
        border: 1px solid #99f6e4;
        border-radius: 8px;
        background: #f0fdfa;
      }
      .review-business-evidence h2 {
        margin: 0;
        font-size: 20px;
        line-height: 1.3;
      }
      .review-business-evidence p:last-child {
        margin: 6px 0 0;
        color: var(--review-muted);
        font-size: 14px;
        line-height: 1.65;
      }
      .review-business-evidence-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .review-business-evidence-actions button {
        cursor: pointer;
        min-height: 36px;
        border: 1px solid #5eead4;
        border-radius: 9px;
        padding: 0 12px;
        background: #ffffff;
        color: #0f766e;
        font: inherit;
        font-size: 13px;
        font-weight: 800;
      }
      .review-business-evidence-actions button:hover,
      .review-business-evidence-actions button:focus-visible {
        border-color: var(--review-teal);
        box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
        outline: none;
      }
      .review-projection-engineering {
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: var(--review-panel-soft);
        padding: 20px;
      }
      .review-engineering-head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(280px, 0.45fr);
        gap: 24px;
        align-items: end;
        padding: 4px 2px 18px;
        border-bottom: 1px solid var(--review-line);
      }
      .review-engineering-head h1 {
        margin: 0;
        font-size: 26px;
        line-height: 1.25;
        letter-spacing: 0;
      }
      .review-engineering-head > div > p:last-child {
        margin: 8px 0 0;
        color: var(--review-muted);
        font-size: 14px;
        line-height: 1.65;
      }
      .review-engineering-filter {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 7px 10px;
        align-items: center;
      }
      .review-engineering-filter > span {
        color: var(--review-text);
        font-size: 13px;
        font-weight: 800;
      }
      .review-engineering-filter input {
        grid-column: 1 / -1;
        width: 100%;
        min-height: 42px;
        border: 1px solid var(--review-line);
        border-radius: 9px;
        padding: 0 12px;
        background: #ffffff;
        color: var(--review-text);
        font: inherit;
        font-size: 14px;
      }
      .review-engineering-filter input:focus {
        border-color: var(--review-indigo);
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
        outline: none;
      }
      .review-engineering-filter output {
        justify-self: end;
        color: var(--review-muted);
        font-size: 12px;
      }
      .review-engineering-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin-top: 16px;
      }
      .review-engineering-section,
      .review-evidence-section {
        min-width: 0;
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: var(--review-panel);
        overflow: hidden;
      }
      .review-engineering-section > header,
      .review-evidence-section > header {
        min-height: 92px;
        padding: 16px 18px;
        border-bottom: 1px solid var(--review-line);
        background: #ffffff;
      }
      .review-engineering-section h2,
      .review-evidence-section h2 {
        margin: 0;
        font-size: 18px;
        line-height: 1.3;
      }
      .review-engineering-section header p,
      .review-evidence-section header > p:last-child {
        margin: 6px 0 0;
        color: var(--review-muted);
        font-size: 13px;
        line-height: 1.55;
      }
      .review-engineering-list {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .review-engineering-item {
        min-width: 0;
      }
      .review-engineering-list .review-engineering-item {
        display: grid;
        grid-template-columns: minmax(108px, 0.32fr) minmax(0, 1fr);
        gap: 12px;
        align-items: start;
        padding: 12px 18px;
        border-bottom: 1px solid #eef2f6;
        font-size: 13px;
        line-height: 1.6;
      }
      .review-engineering-list .review-engineering-item:last-child {
        border-bottom: 0;
      }
      .review-engineering-list strong {
        color: var(--review-muted);
        font-size: 12px;
        line-height: 1.65;
      }
      .review-engineering-list span,
      .review-engineering-list code {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .review-engineering-list code,
      .review-evidence-meta code {
        color: #3730a3;
        font-family: var(--review-mono);
        font-size: 11px;
      }
      .review-engineering-empty {
        margin: 0;
        padding: 18px;
        color: var(--review-muted);
        font-size: 13px;
        line-height: 1.6;
      }
      .review-evidence-section {
        margin-top: 14px;
      }
      .review-evidence-section > header {
        min-height: 0;
      }
      .review-evidence-list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .review-evidence-item {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
        gap: 12px;
        padding: 16px 18px;
        border-right: 1px solid #eef2f6;
        border-bottom: 1px solid #eef2f6;
        scroll-margin-top: 22px;
        transition: background-color 160ms ease, box-shadow 160ms ease;
      }
      .review-evidence-item:nth-child(2n) { border-right: 0; }
      .review-evidence-index {
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 999px;
        background: #ccfbf1;
        color: var(--review-teal);
        font-size: 12px;
        font-weight: 850;
      }
      .review-evidence-item h3 {
        margin: 0;
        font-size: 14px;
        line-height: 1.4;
      }
      .review-evidence-item p {
        margin: 6px 0 0;
        color: var(--review-text);
        font-size: 13px;
        line-height: 1.65;
      }
      .review-evidence-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 10px;
        margin-top: 10px;
        color: var(--review-muted);
        font-size: 11px;
      }
      .review-evidence-item.is-located {
        background: #ecfdf5;
        box-shadow: inset 4px 0 0 var(--review-teal);
      }
      .review-evidence-item:focus-visible {
        outline: 3px solid rgba(15, 118, 110, 0.24);
        outline-offset: -3px;
      }
      .review-engineering-no-results {
        margin: 14px 0 0;
        padding: 14px 16px;
        border: 1px solid #fde68a;
        border-radius: 8px;
        background: #fffbeb;
        color: #92400e;
        font-size: 14px;
      }
      @media (prefers-reduced-motion: reduce) {
        .review-view-tab,
        .review-evidence-item,
        .review-business-evidence-actions button {
          scroll-behavior: auto;
          transition: none;
        }
      }
      .review-directions {
        margin-top: 28px;
      }
      .review-direction-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 18px;
        margin-top: 14px;
      }
      .review-direction-card {
        display: flex;
        flex-direction: column;
        background: var(--review-panel);
        border: 1px solid var(--review-line);
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
        transition: border-color 160ms ease, box-shadow 160ms ease;
      }
      .review-direction-card.selected {
        border-color: var(--review-indigo);
        box-shadow: 0 0 0 2px var(--review-indigo), 0 12px 24px rgba(79, 70, 229, 0.16);
      }
      .review-direction-card.selected .review-direction-select {
        border-color: var(--review-indigo);
        background: var(--review-indigo);
        color: #fff;
      }
      .review-direction-image {
        display: block;
        background: var(--review-panel-soft);
        border-bottom: 1px solid var(--review-line);
        aspect-ratio: 4 / 3;
        overflow: hidden;
      }
      .review-direction-image img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .review-direction-image-missing {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--review-muted);
        font-size: 14px;
      }
      .review-direction-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 16px;
      }
      .review-direction-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .review-direction-head h3 {
        margin: 0;
        font-size: 17px;
      }
      .review-direction-index {
        flex-shrink: 0;
        border: 1px solid #c7d2fe;
        background: #eef2ff;
        color: var(--review-indigo);
        border-radius: 999px;
        padding: 2px 10px;
        font-size: 12px;
        font-weight: 800;
      }
      .review-direction-summary {
        margin: 0;
        color: var(--review-text);
        font-size: 14px;
        line-height: 1.6;
      }
      .review-direction-tradeoff {
        margin: 0;
        color: var(--review-muted);
        font-size: 13px;
        line-height: 1.6;
      }
      .review-direction-select {
        cursor: pointer;
        align-self: flex-start;
        margin-top: 4px;
        min-height: 38px;
        border: 1px solid #c7d2fe;
        border-radius: 10px;
        padding: 0 16px;
        font: inherit;
        font-size: 14px;
        font-weight: 800;
        background: #eef2ff;
        color: var(--review-indigo);
        transition: background-color 160ms ease, border-color 160ms ease, transform 160ms ease;
      }
      .review-direction-select:hover,
      .review-direction-select:focus-visible {
        border-color: #a5b4fc;
        background: #e0e7ff;
        transform: translateY(-1px);
        outline: none;
      }
      @media (max-width: 860px) {
        .review-workbench,
        .review-engineering-head,
        .review-business-evidence {
          grid-template-columns: 1fr;
        }
        .review-view-tabs {
          width: 100%;
        }
        .review-business-evidence-actions {
          justify-content: flex-start;
        }
        .review-engineering-grid,
        .review-evidence-list {
          grid-template-columns: 1fr;
        }
        .review-evidence-item {
          border-right: 0;
        }
        .review-overview {
          grid-template-columns: 1fr;
        }
        .review-panel-grid {
          grid-template-columns: 1fr;
        }
        .review-direction-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 620px) {
        .review-page { padding: 18px 12px 128px; }
        .review-topbar { align-items: flex-start; flex-direction: column; }
        .review-workbench,
        .review-projection-engineering {
          padding: 16px;
        }
        .review-view-tabs {
          grid-template-columns: 1fr 1fr;
        }
        .review-view-tab {
          min-width: 0;
          padding-inline: 10px;
        }
        .review-engineering-list .review-engineering-item {
          grid-template-columns: 1fr;
          gap: 4px;
        }
        .review-project-version {
          min-width: 0;
          width: 100%;
          margin-left: 0;
        }
        .review-overview { padding: 18px; }
        .review-overview h1 {
          font-size: 26px;
          word-break: break-all;
        }
        .review-problem { word-break: break-all; }
        .review-map-canvas svg { min-width: 0; }
        .review-journey-map svg { min-width: 620px; }
        .review-section-heading h2 { font-size: 20px; }
        .review-bottom-bar { padding-inline: 12px; }
        .review-bottom-bar-inner {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .review-bottom-action {
          justify-content: center;
          padding-inline: 10px;
          font-size: 15px;
        }
      }
    </style>
  </head>
  <body>
    <main class="review-page">
      <header class="review-topbar">
        <div class="review-brand">OpenPrd / 评审面板</div>
        ${renderReviewProjectVersion(visibleProjectRelease)}
      </header>
      ${renderReviewStageRail(reviewModel)}
      ${renderReviewWorkbenchHeader(reviewModel)}
      <section
        class="review-projection review-projection-business"
        id="reviewBusinessView"
        role="tabpanel"
        aria-labelledby="reviewTabBusiness"
        data-review-view="business"
        data-review-model-digest="${escapeHtml(businessProjection.modelDigest)}"
      >
        ${renderReviewOverview(snapshot, sectionsData, panelAgenda)}
        ${renderReviewGapPanel(sectionsData)}
        ${renderReviewDesignDirections(snapshot)}
        ${renderReviewFlowSvg(snapshot, sectionsData)}
        <section class="review-panel-grid" aria-label="固定评审项">
          ${panels.join('\n')}
        </section>
        ${renderBusinessEvidenceBridge(businessProjection)}
      </section>
      ${renderReviewEngineeringProjection(engineeringProjection)}
      ${renderReviewDecision(snapshot, reviewModel)}
      <script>
        async function copyReviewText(text) {
          try {
            await navigator.clipboard.writeText(text);
          } catch (error) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
          }
        }
        function flashCopied(button) {
          const old = button.innerHTML;
          button.textContent = '已复制';
          setTimeout(() => { button.innerHTML = old; }, 1200);
        }
        document.querySelectorAll('[data-copy-value]').forEach((button) => {
          button.addEventListener('click', async () => {
            await copyReviewText(button.dataset.copyValue || '');
            flashCopied(button);
          });
        });

        const reviewTabs = Array.from(document.querySelectorAll('[data-review-tab]'));
        const reviewViews = Array.from(document.querySelectorAll('[data-review-view]'));
        const engineeringFilter = document.getElementById('reviewEngineeringFilter');
        const engineeringFilterCount = document.getElementById('reviewEngineeringFilterCount');
        const engineeringNoResults = document.getElementById('reviewEngineeringNoResults');
        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function setReviewView(view, updateUrl = true) {
          const nextView = view === 'engineering' ? 'engineering' : 'business';
          reviewTabs.forEach((tab) => {
            const active = tab.dataset.reviewTab === nextView;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.tabIndex = active ? 0 : -1;
          });
          reviewViews.forEach((panel) => {
            panel.hidden = panel.dataset.reviewView !== nextView;
          });
          document.documentElement.dataset.reviewView = nextView;
          if (updateUrl) {
            try {
              const url = new URL(window.location.href);
              if (nextView === 'engineering') url.searchParams.set('view', 'engineering');
              else url.searchParams.delete('view');
              window.history.replaceState(null, '', url);
            } catch (error) {
              // Local file previews can deny history updates; the view still switches.
            }
          }
        }

        reviewTabs.forEach((tab, index) => {
          tab.addEventListener('click', () => setReviewView(tab.dataset.reviewTab));
          tab.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            let nextIndex = index;
            if (event.key === 'ArrowLeft') nextIndex = (index - 1 + reviewTabs.length) % reviewTabs.length;
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % reviewTabs.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = reviewTabs.length - 1;
            const nextTab = reviewTabs[nextIndex];
            setReviewView(nextTab.dataset.reviewTab);
            nextTab.focus();
          });
        });

        function applyEngineeringFilter() {
          if (!engineeringFilter) return;
          const query = engineeringFilter.value.trim().toLocaleLowerCase('zh-CN');
          const items = Array.from(document.querySelectorAll('#reviewEngineeringView [data-review-filter-item]'));
          let visibleCount = 0;
          items.forEach((item) => {
            const matches = !query || item.textContent.toLocaleLowerCase('zh-CN').includes(query);
            item.hidden = !matches;
            if (matches) visibleCount += 1;
          });
          if (engineeringFilterCount) {
            engineeringFilterCount.textContent = query ? '找到 ' + visibleCount + ' 项' : '共 ' + items.length + ' 项';
          }
          if (engineeringNoResults) engineeringNoResults.hidden = visibleCount !== 0;
        }

        if (engineeringFilter) {
          engineeringFilter.addEventListener('input', applyEngineeringFilter);
          applyEngineeringFilter();
        }

        document.querySelectorAll('[data-review-locate]').forEach((button) => {
          button.addEventListener('click', () => {
            const target = document.getElementById(button.dataset.reviewLocate || '');
            if (!target) return;
            setReviewView('engineering');
            if (engineeringFilter) {
              engineeringFilter.value = '';
              applyEngineeringFilter();
            }
            window.requestAnimationFrame(() => {
              target.classList.add('is-located');
              target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' });
              target.focus({ preventScroll: true });
              window.setTimeout(() => target.classList.remove('is-located'), 1800);
            });
          });
        });

        try {
          const initialView = new URL(window.location.href).searchParams.get('view');
          setReviewView(initialView === 'engineering' ? 'engineering' : 'business', false);
        } catch (error) {
          setReviewView('business', false);
        }

        document.querySelectorAll('.review-direction-select').forEach((button) => {
          button.addEventListener('click', () => {
            document.querySelectorAll('.review-direction-card').forEach((card) => {
              card.classList.remove('selected');
              const cardButton = card.querySelector('.review-direction-select');
              if (cardButton && cardButton !== button) cardButton.textContent = '偏好这个方向';
            });
            const ownCard = button.closest('.review-direction-card');
            if (ownCard) ownCard.classList.add('selected');
            setTimeout(() => { button.textContent = '已记录，可随时覆盖'; }, 1250);
          });
        });
      </script>
    </main>
  </body>
</html>`;
}

function toYamlLines(value, depth = 0) {
  const indent = '  '.repeat(depth);
  const scalar = (input) => JSON.stringify(String(input ?? ''));
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`];
    return value.flatMap((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const [firstKey] = Object.keys(item);
        const nested = toYamlLines(item[firstKey], depth + 1);
        return [`${indent}- ${firstKey}:`, ...nested];
      }
      return [`${indent}- ${scalar(item)}`];
    });
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => {
      if (Array.isArray(entry) || (entry && typeof entry === 'object')) {
        return [`${indent}${key}:`, ...toYamlLines(entry, depth + 1)];
      }
      return [`${indent}${key}: ${scalar(entry)}`];
    });
  }
  return [`${indent}${scalar(value)}`];
}

function renderArtifactFrontmatter(value) {
  const lines = ['---'];
  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry) || (entry && typeof entry === 'object')) {
      lines.push(`${key}:`);
      lines.push(...toYamlLines(entry, 1));
    } else {
      lines.push(`${key}: ${String(entry ?? '')}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function playgroundFieldDefinitions() {
  return [
    { key: 'problemStatement', label: '问题定义', kind: 'text' },
    { key: 'goals', label: '目标', kind: 'list' },
    { key: 'successMetrics', label: '成功指标', kind: 'list' },
    { key: 'inScope', label: '范围内', kind: 'list' },
    { key: 'outOfScope', label: '范围外', kind: 'list' },
    { key: 'primaryFlows', label: '主流程', kind: 'list' },
    { key: 'openQuestions', label: '开放问题', kind: 'list' },
  ];
}

export function renderPlaygroundMarkdown({ snapshot, state }) {
  const capturePatch = {
    'problem.problemStatement': { value: state.problemStatement, source: 'user-confirmed' },
    'goals.goals': { value: state.goals, source: 'user-confirmed' },
    'goals.successMetrics': { value: state.successMetrics, source: 'user-confirmed' },
    'scope.inScope': { value: state.inScope, source: 'user-confirmed' },
    'scope.outOfScope': { value: state.outOfScope, source: 'user-confirmed' },
    'scenarios.primaryFlows': { value: state.primaryFlows, source: 'user-confirmed' },
    'risks.openQuestions': { value: state.openQuestions, source: 'user-confirmed' },
  };
  const frontmatter = renderArtifactFrontmatter({
    schema: 'openprd.artifact.v1',
    kind: 'playground',
    versionId: snapshot.versionId,
    title: snapshot.title,
    capturePatch,
    editableState: state,
  });
  return `${frontmatter}# 调试数据\n\n## 问题定义\n\n${state.problemStatement || '待补充'}\n\n## 目标\n\n${state.goals.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n\n## 成功指标\n\n${state.successMetrics.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n\n## 范围内\n\n${state.inScope.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n\n## 范围外\n\n${state.outOfScope.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n\n## 主流程\n\n${state.primaryFlows.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n\n## 开放问题\n\n${state.openQuestions.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n`;
}

export function renderPlaygroundPatch({ state }) {
  return {
    'problem.problemStatement': { value: state.problemStatement, source: 'user-confirmed' },
    'goals.goals': { value: state.goals, source: 'user-confirmed' },
    'goals.successMetrics': { value: state.successMetrics, source: 'user-confirmed' },
    'scope.inScope': { value: state.inScope, source: 'user-confirmed' },
    'scope.outOfScope': { value: state.outOfScope, source: 'user-confirmed' },
    'scenarios.primaryFlows': { value: state.primaryFlows, source: 'user-confirmed' },
    'risks.openQuestions': { value: state.openQuestions, source: 'user-confirmed' },
  };
}

export function renderPlaygroundArtifact({ snapshot, state, markdownPath, patchPath }) {
  const fields = playgroundFieldDefinitions();
  const formControls = fields.map((field) => `
    <label class="card">
      <div class="card-header">${escapeHtml(field.label)}</div>
      <div class="card-body">
        ${field.kind === 'text'
          ? `<textarea data-field="${field.key}" rows="4">${escapeHtml(state[field.key] ?? '')}</textarea>`
          : `<textarea data-field="${field.key}" rows="6">${escapeHtml((state[field.key] ?? []).join('\n'))}</textarea>`}
      </div>
    </label>
  `).join('\n');

  const initialMarkdown = renderPlaygroundMarkdown({ snapshot, state });
  const initialPatch = renderPlaygroundPatch({ state });

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(snapshot.title)} Playground</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f8fb;
        --panel: #ffffff;
        --line: #d8dee8;
        --text: #172033;
        --muted: #667085;
        --accent: #2563eb;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .page { max-width: 1320px; margin: 0 auto; padding: 24px; }
      h1 { margin: 0 0 8px; font-size: 42px; }
      .subtitle { margin: 0 0 20px; color: var(--muted); line-height: 1.7; }
      .chip-row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
      .chip { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; background: #fff; color: var(--muted); font-size: 12px; }
      .layout { display: grid; grid-template-columns: minmax(320px, 0.95fr) minmax(360px, 1.05fr); gap: 16px; }
      .form-grid { display: grid; gap: 14px; }
      .card { border: 1px solid var(--line); border-radius: 18px; background: var(--panel); overflow: hidden; }
      .card-header { padding: 12px 16px 0; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .card-body { padding: 12px 16px 16px; }
      textarea { width: 100%; border: 1px solid var(--line); border-radius: 12px; padding: 12px; font: inherit; line-height: 1.6; resize: vertical; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
      button { border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; background: #fff; cursor: pointer; }
      .primary { background: var(--accent); color: #fff; border-color: var(--accent); }
      pre { margin: 0; border-radius: 14px; border: 1px solid var(--line); background: #f9fafb; color: var(--text); padding: 14px; overflow: auto; white-space: pre-wrap; line-height: 1.6; font-size: 13px; }
      .hint { color: var(--muted); font-size: 13px; line-height: 1.6; }
      .top-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: -4px;
      }
      .meta-chip {
        display: inline-flex;
        width: fit-content;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: #ffffff;
        color: var(--muted);
        font-size: 12px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 12px;
      }
      .copy-button {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(15,23,42,0.18);
        border-radius: 999px;
        background: #fff;
        color: var(--text);
        padding: 9px 14px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .copy-button:hover {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }
      @media (max-width: 980px) { .layout { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main class="page">
      <h1>${escapeHtml(snapshot.title)} 调试面板</h1>
      <p class="subtitle">左侧调整关键 PRD 参数，右侧会实时生成 Markdown 数据源和 capture patch。你可以复制 Markdown、复制 patch，或下载文件后再用 <code>openprd capture --artifact-markdown</code> 导回工作区。</p>
      <div class="chip-row">
        <span class="chip">版本: ${escapeHtml(snapshot.versionId)}</span>
        <span class="chip">Markdown 数据源: ${escapeHtml(markdownPath)}</span>
        <span class="chip">捕获补丁: ${escapeHtml(patchPath)}</span>
      </div>
      <section class="layout">
        <div class="form-grid">${formControls}
          <div class="card">
            <div class="card-header">操作</div>
            <div class="card-body">
              <div class="actions">
                <button id="copyMarkdown" class="primary">复制更新后的 Markdown</button>
                <button id="copyPatch">复制捕获补丁 JSON</button>
                <button id="downloadMarkdown">下载 data.md</button>
                <button id="downloadPatch">下载 capture-patch.json</button>
              </div>
              <p class="hint">推荐流程：在这里微调参数 -> 复制或下载 Markdown / patch -> 运行 <code>openprd capture . --artifact-markdown &lt;data.md&gt;</code> 或使用 JSON patch 导回。</p>
            </div>
          </div>
        </div>
        <div class="form-grid">
          <div class="card">
            <div class="card-header">Markdown 数据源</div>
            <div class="card-body"><pre id="markdownPreview">${escapeHtml(initialMarkdown)}</pre></div>
          </div>
          <div class="card">
            <div class="card-header">捕获补丁 JSON</div>
            <div class="card-body"><pre id="patchPreview">${escapeHtml(JSON.stringify(initialPatch, null, 2))}</pre></div>
          </div>
        </div>
      </section>
    </main>
    <script>
      const fields = ${JSON.stringify(fields)};
      const state = ${JSON.stringify(state)};
      const markdownPreview = document.getElementById('markdownPreview');
      const patchPreview = document.getElementById('patchPreview');

      function splitList(value) {
        return String(value || '').split(/\\n+/).map((item) => item.trim()).filter(Boolean);
      }

      function yamlValue(value, depth = 0) {
        const indent = '  '.repeat(depth);
        if (Array.isArray(value)) {
          if (value.length === 0) return [indent + '[]'];
          return value.map((item) => indent + '- ' + JSON.stringify(String(item ?? '')));
        }
        if (value && typeof value === 'object') {
          return Object.entries(value).flatMap(([key, entry]) => {
            if (Array.isArray(entry) || (entry && typeof entry === 'object')) {
              return [indent + key + ':', ...yamlValue(entry, depth + 1)];
            }
            return [indent + key + ': ' + JSON.stringify(String(entry ?? ''))];
          });
        }
        return [indent + JSON.stringify(String(value ?? ''))];
      }

      function buildPatch() {
        return {
          "problem.problemStatement": { value: state.problemStatement, source: "user-confirmed" },
          "goals.goals": { value: state.goals, source: "user-confirmed" },
          "goals.successMetrics": { value: state.successMetrics, source: "user-confirmed" },
          "scope.inScope": { value: state.inScope, source: "user-confirmed" },
          "scope.outOfScope": { value: state.outOfScope, source: "user-confirmed" },
          "scenarios.primaryFlows": { value: state.primaryFlows, source: "user-confirmed" },
          "risks.openQuestions": { value: state.openQuestions, source: "user-confirmed" }
        };
      }

      function buildMarkdown() {
        const patch = buildPatch();
        const frontmatter = ['---',
          'schema: openprd.artifact.v1',
          'kind: playground',
          'versionId: ${escapeHtml(snapshot.versionId)}',
          'title: ${escapeHtml(snapshot.title)}',
          'capturePatch:',
          ...yamlValue(patch, 1),
          'editableState:',
          ...yamlValue(state, 1),
          '---',
          '',
          '# 调试数据',
          '',
          '## 问题定义',
          '',
          state.problemStatement || '待补充',
          '',
          '## 目标',
          '',
          ...(state.goals.length ? state.goals.map((item) => '- ' + item) : ['- 待补充']),
          '',
          '## 成功指标',
          '',
          ...(state.successMetrics.length ? state.successMetrics.map((item) => '- ' + item) : ['- 待补充']),
          '',
          '## 范围内',
          '',
          ...(state.inScope.length ? state.inScope.map((item) => '- ' + item) : ['- 待补充']),
          '',
          '## 范围外',
          '',
          ...(state.outOfScope.length ? state.outOfScope.map((item) => '- ' + item) : ['- 待补充']),
          '',
          '## 主流程',
          '',
          ...(state.primaryFlows.length ? state.primaryFlows.map((item) => '- ' + item) : ['- 待补充']),
          '',
          '## 开放问题',
          '',
          ...(state.openQuestions.length ? state.openQuestions.map((item) => '- ' + item) : ['- 待补充']),
          ''
        ];
        return frontmatter.join('\\n');
      }

      function refreshOutputs() {
        markdownPreview.textContent = buildMarkdown();
        patchPreview.textContent = JSON.stringify(buildPatch(), null, 2);
      }

      document.querySelectorAll('textarea[data-field]').forEach((textarea) => {
        textarea.addEventListener('input', () => {
          const field = textarea.dataset.field;
          const definition = fields.find((item) => item.key === field);
          state[field] = definition.kind === 'text' ? textarea.value.trim() : splitList(textarea.value);
          refreshOutputs();
        });
      });

      async function copyText(text) {
        await navigator.clipboard.writeText(text);
      }

      document.getElementById('copyMarkdown').addEventListener('click', () => copyText(markdownPreview.textContent));
      document.getElementById('copyPatch').addEventListener('click', () => copyText(patchPreview.textContent));

      function download(name, text) {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);
      }

      document.getElementById('downloadMarkdown').addEventListener('click', () => download('playground.data.md', markdownPreview.textContent));
      document.getElementById('downloadPatch').addEventListener('click', () => download('playground.capture-patch.json', patchPreview.textContent));

      refreshOutputs();
    </script>
  </body>
</html>`;
}

export function renderReviewArtifact({ snapshot, projectRelease = null }) {
  const sectionsData = snapshot.sections ?? {};
  return renderReviewPage({ snapshot, sectionsData, projectRelease });
}

export function renderRegressionArtifact({ task, report }) {
  const passed = report.summary.failed === 0;
  const failedCases = (report.cases ?? []).filter((item) => !item.passed);
  const summaryCards = [
    metricCard('任务', task.id, task.title),
    metricCard('验证方式', report.kind || 'command', report.verifyCommand || '未指定'),
    metricCard('通过用例', `${report.summary.passed}/${report.summary.total}`, '本次回归通过的测试用例数量'),
    metricCard('失败用例', `${report.summary.failed}`, '需要继续修复或补证据的测试用例数量'),
  ];
  const verdictCard = card('这次验证的结论', passed
    ? `
      <div class="qa-item success">
        <div class="qa-label">全部 ${report.summary.total} 个用例都通过了</div>
        <div class="qa-meta">这部分功能按预期工作，可以放心进入下一步。想继续推进就用底部按钮告诉我。</div>
      </div>
    `
    : `
      <div class="qa-item warning">
        <div class="qa-label">还有 ${report.summary.failed} 个用例没有通过</div>
        <div class="qa-meta">没过的是：${failedCases.map((item) => escapeHtml(item.title || item.id)).join('、') || '见下方清单'}。建议先让我继续修复，再重新跑一次验证。</div>
      </div>
    `);

  const sections = [
    verdictCard,
    card('回归用例清单', report.cases.map((item) => `
      <div class="qa-item ${item.passed ? 'success' : 'warning'}">
        <div class="qa-label">${escapeHtml(item.id)} · ${escapeHtml(item.title)}</div>
        <div class="qa-status-row">
          <div class="status-badge mini-status ${item.passed ? 'status-pass' : 'status-fail'}">${item.passed ? '通过' : '未通过'}</div>
        </div>
        <div class="qa-meta">预期: ${escapeHtml(item.expected)}</div>
        <div class="qa-meta">结果: ${escapeHtml(item.actual)}</div>
        <div class="qa-meta">证据: ${escapeHtml(leafName(item.evidence))}</div>
      </div>
    `).join('\n')),
    ...(report.screenshots?.length ? [
      card('截图证据', report.screenshots.map((item) => `
        <div class="evidence-item">
          <div class="card-body"><img src="${escapeHtml(item.url)}" alt="截图证据" style="max-width:100%; border-radius:12px; border:1px solid rgba(15,23,42,0.12);" /></div>
        </div>
      `).join('\n')),
    ] : []),
    formatExportItem({
      title: '结构化回归结论',
      description: '供后续 commit、handoff、回归复跑或汇总报告使用。',
      payload: JSON.stringify(report, null, 2),
    }),
  ];

  return pageShell({
    eyebrow: 'OpenPrd / 回归报告',
    title: `${task.id} 回归验证`,
    subtitle: '执行结果必须沉淀成结构化回归资产，而不是只把 verify 命令跑一遍。',
    statusBadge: passed
      ? { label: '通过', className: 'status-pass' }
      : { label: '未通过', className: 'status-fail' },
    topMeta: [
      `任务来源: ${task.changeId}`,
    ],
    summaryCards,
    sections,
    footer: '',
    bottomActions: passed
      ? [
        { label: '确认通过，继续下一步', tone: 'primary', copyText: `回归报告 ${task.id} 我看过了，全部用例通过，确认继续推进下一步。` },
      ]
      : [
        { label: '先修复未通过的用例', tone: 'danger', copyText: `回归报告 ${task.id} 里还有 ${report.summary.failed} 个用例没通过（${failedCases.map((item) => item.id).join('、')}），请继续修复后重新跑一次验证。` },
        { label: '我接受现状，继续下一步', tone: 'neutral', copyText: `回归报告 ${task.id} 的未通过用例我已知晓，先按现状继续推进，后续再处理。` },
      ],
  });
}

export async function writeHtmlArtifact(filePath, html) {
  await writeText(filePath, html);
  return filePath;
}

export async function openArtifactInBrowser(filePath) {
  const platform = process.platform;
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = platform === 'win32'
    ? ['/c', 'start', '', filePath]
    : [filePath];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export function canonicalReviewPath(ws, versionId) {
  return cjoin(ws.workspaceRoot, 'reviews', `${slugify(versionId, 'review')}.html`);
}

function toRelativeHref(fromFilePath, targetFilePath) {
  const relative = path.relative(path.dirname(fromFilePath), targetFilePath) || path.basename(targetFilePath);
  return relative.split(path.sep).join('/');
}

export function renderReviewEntryHtml({ entryPath, reviewPath, title = 'OpenPrd Review' }) {
  const href = escapeHtml(toRelativeHref(entryPath, reviewPath));
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="refresh" content="0; url=${href}" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f8fafc;
        --panel: #ffffff;
        --text: #111827;
        --muted: #6b7280;
        --line: rgba(17,24,39,0.12);
        --accent: #2563eb;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
        color: var(--text);
        font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .panel {
        width: min(560px, calc(100vw - 32px));
        padding: 28px 24px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--panel);
        box-shadow: 0 18px 40px rgba(15,23,42,0.08);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 24px;
        line-height: 1.25;
      }
      p {
        margin: 0 0 12px;
        color: var(--muted);
        line-height: 1.6;
      }
      a {
        color: var(--accent);
        font-weight: 700;
        text-decoration: none;
      }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <main class="panel">
      <h1>${escapeHtml(title)}</h1>
      <p>这个入口只保留当前评审稿的固定路径，页面会自动跳转到最新的版本化评审文件。</p>
      <p><a href="${href}">如果没有自动跳转，点这里打开评审面板</a></p>
    </main>
  </body>
</html>`;
}


export function defaultReviewArtifactPath(ws) {
  return cjoin(ws.workspaceRoot, 'engagements', 'active', 'review.html');
}

export function defaultRegressionArtifactPath(projectRoot, taskId) {
  return cjoin(projectRoot, '.openprd', 'harness', 'test-reports', `${taskId.replace(/[^a-zA-Z0-9._-]/g, '_')}.html`);
}

export function artifactBundleDir(ws, artifactId) {
  return cjoin(ws.paths.artifactsActiveDir, slugify(artifactId));
}

export function artifactBundlePaths(ws, artifactId) {
  const dir = artifactBundleDir(ws, artifactId);
  return {
    dir,
    html: cjoin(dir, 'artifact.html'),
    markdown: cjoin(dir, 'data.md'),
    patch: cjoin(dir, 'capture-patch.json'),
  };
}

export function renderMarkdownDataDocument({ title, sections }) {
  const lines = [`# ${title}`, ''];
  for (const section of sections) {
    lines.push(`## ${section.title}`);
    lines.push('');
    lines.push(...section.lines);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
