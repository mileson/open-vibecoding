/*
 * 核心功能
 * 渲染 standards、dev-check、quality、knowledge 和 visual compare 等质量相关命令输出。
 *
 * 输入
 * 接收标准校验、研发期行数检查、质量报告、知识候选和视觉对比等结构化结果对象。
 *
 * 输出
 * 向终端输出质量门禁、证据状态、知识候选和视觉对比摘要，或在 `--json` 模式下直出 JSON。
 *
 * 定位
 * 位于 CLI 表现层的质量输出模块，负责 standards/quality 这一类高频质量反馈。
 *
 * 依赖
 * 依赖 shared-print 中的知识回顾 helper，不承担实际检测逻辑。
 *
 * 维护规则
 * 质量类输出要优先保留 production-ready、门禁范围和证据状态，避免把关键风险埋进长文本里。
 */
import { printKnowledgeReview } from './shared-print.js';

function describeFeatureCoverageLedger(report) {
  const activeTasks = report?.evalHarness?.featureCoverage?.activeTasks ?? null;
  if (!activeTasks || Number(activeTasks.pending ?? 0) <= 0) {
    return null;
  }
  const total = Number(activeTasks.total ?? 0);
  const done = Number(activeTasks.done ?? 0);
  const pending = Number(activeTasks.pending ?? 0);
  const blocked = Number(activeTasks.blocked ?? 0);
  const progress = total > 0 ? `${done}/${total}` : `${done}`;
  const changeLabel = activeTasks.activeChange ? `当前变更 ${activeTasks.activeChange}` : '当前任务账本';
  return `${changeLabel} 仍有 ${pending} 个未完成任务（已完成 ${progress}${blocked > 0 ? `，其中 ${blocked} 个因依赖阻塞` : ''}）。这表示账本未收口，不等于当前实现失败。`;
}

function printStandardsResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'init') {
    console.log(`已初始化 OpenPrd standards: ${result.docsRoot}`);
    for (const item of result.changed) {
      console.log(`- ${item.status}: ${item.path}`);
    }
    return;
  }
  if (result.action === 'classify-external-reference') {
    console.log(`已归类外部参考源码: ${result.path}`);
    console.log(`配置: ${result.configPath}`);
    console.log(`状态: ${result.alreadyPresent ? '已存在' : '已写入'}`);
    return;
  }

  console.log(`OpenPrd standards: ${result.ok ? '通过' : '失败'}`);
  console.log(`Docs root: ${result.docsRoot}`);
  for (const check of result.checks) {
    console.log(`- ${check}`);
  }
  if (result.errors.length > 0) {
    console.log('错误:');
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
  if (result.warnings.length > 0) {
    console.log('警告:');
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
  const candidates = result.manualReport?.externalReferenceCandidates ?? [];
  if (candidates.length > 0) {
    console.log('外部参考源码候选:');
    console.log('请先询问用户这些目录是否只作为外部参考；用户确认后再运行归类命令。');
    for (const candidate of candidates) {
      console.log(`- ${candidate.path}: ${candidate.missingFiles} 个文件、${candidate.missingFolders} 个文件夹缺说明书；原因: ${candidate.reason}；建议确认后运行 ${candidate.suggestedCommand}`);
    }
  }
}

function printDevelopmentStandardsResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'dev-check-auto-refactor') {
    console.log(`OpenPrd dev-check 自动优化: 已${result.autoRefactor?.enabled ? '开启' : '关闭'}`);
    console.log(`当前模式: ${result.autoRefactor?.enabled ? '自动执行优化（OpenPRD 自动优化报告）' : '仅推荐（后续建议）'}`);
    console.log(`配置文件: ${result.configPath}`);
    return;
  }

  const autoMode = result.autoRefactor?.enabled !== false;
  console.log(`OpenPrd ${autoMode ? '自动优化报告' : '后续建议'}: ${result.ok ? '完成' : '失败'}`);
  console.log(`自动优化: ${autoMode ? '开启（超行文件本轮直接拆分，收口附开关确认）' : '关闭（仅输出拆分推荐）'}`);
  const attentionFiles = result.files.filter((file) => ['attention', 'warning', 'error'].includes(file.status));
  if (attentionFiles.length > 0) {
    console.log(`${autoMode ? '问题级别' : '关注程度'}: 🟡 低风险｜建议留意，🟠 中风险｜建议优先关注，🔴 高风险｜需要先处理。`);
  } else {
    console.log(`本轮已回顾 ${result.files.length} 个改动文件，暂未发现需要额外说明的影响对象。`);
  }
  for (const file of attentionFiles) {
    const lineText = file.lineCount === null || file.lineCount === undefined ? '未知行数' : `${file.lineCount} 行`;
    console.log(`- ${file.statusLabel ?? file.status}: ${file.path} (${lineText})`);
    console.log(`  ${file.nextAction}`);
  }
  if (result.wrapUp?.required && result.wrapUp.markdownTable) {
    console.log(result.wrapUp.markdownBlock ?? result.wrapUp.markdownTable);
  }
  if (result.wrapUp?.required && result.wrapUp.switchHint) {
    console.log(`- 开关提示: ${result.wrapUp.switchHint}`);
  }
  if (result.visualEvidence?.required) {
    console.log(`- 视觉证据提醒: ${result.visualEvidence.reason}`);
    console.log(`  涉及界面文件: ${result.visualEvidence.uiFiles.join(', ')}`);
    for (const command of result.visualEvidence.suggestedCommands ?? []) {
      console.log(`  可选命令: ${command}`);
    }
    console.log(`  ${result.visualEvidence.chatEmbedHint}`);
  } else if (result.visualEvidence?.uiFiles?.length > 0) {
    console.log(`- 视觉证据: 最近 24 小时已有证据板（${result.visualEvidence.freshEvidence.join(', ')}）；确认覆盖本轮改动并把证据图嵌入对话流。`);
  }
  if (result.i18nReminder?.required) {
    console.log(`- 多语言提醒: ${result.i18nReminder.reason}`);
    console.log(`  涉及文件: ${result.i18nReminder.textFiles.join(', ')}`);
    if (result.i18nReminder.guideline) {
      console.log(`  最佳实践: ${result.i18nReminder.guideline}`);
    }
    if (!result.i18nReminder.configExists) {
      console.log('  建议: 创建 .openprd/i18n-config.json 启用项目级多语言检查。');
    }
  }
  printKnowledgeReview(result.knowledgeReview);
  for (const error of result.errors ?? []) {
    console.log(`- ${error}`);
  }
}

function printQualityResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'quality-init') {
    console.log(`OpenPrd quality: 已初始化 (${result.changed})`);
    console.log(`配置: ${result.files.config}`);
    console.log(`报告目录: ${result.files.reportsDir}`);
    console.log(`知识库索引: ${result.files.knowledgeIndex}`);
    return;
  }

  if (result.action === 'quality-learn') {
    console.log(`OpenPrd quality learn: ${result.ok ? '已沉淀' : '失败'}`);
    if (result.ok) {
      console.log(`来源类型: ${result.sourceKind}`);
      console.log(`来源: ${result.sourcePath}`);
      if (Array.isArray(result.sourcePaths) && result.sourcePaths.length > 1) {
        console.log(`证据数: ${result.sourcePaths.length}`);
      }
      console.log(`事故: ${result.files.incident}`);
      console.log(`模式: ${result.files.pattern}`);
      console.log(`经验 Skill: ${result.files.skill}`);
      return;
    }
    for (const error of result.errors ?? []) {
      console.log(`- ${error}`);
    }
    return;
  }

  if (result.action === 'quality-knowledge-review') {
    console.log('OpenPrd quality review: 已完成');
    printKnowledgeReview(result);
    return;
  }

  const headline = result.report
    ? (result.report.readiness.ok && !result.report.readiness.productionReady
      ? '需关注'
      : (result.ok ? '完成' : '失败'))
    : (result.ok ? '完成' : '失败');
  console.log(`OpenPrd quality: ${headline}`);
  if (result.report) {
    console.log(`质量状态: ${result.report.summary.status}`);
    console.log(`生产就绪: ${result.report.readiness.productionReady ? '是' : '否'}`);
    console.log(`执行模式: ${result.report.readiness.enforcement}`);
    if (result.report.qualityPolicy) {
      console.log(`场景标签: ${result.report.qualityPolicy.scenarioTags.join(', ')}`);
      console.log(`必需门禁: ${result.report.qualityPolicy.requiredGates.join(', ') || '无'}`);
    }
    if (result.report.readiness.attentionGates.length > 0) {
      console.log(`需关注门禁: ${result.report.readiness.attentionGates.join(', ')}`);
    }
    const featureCoverageLedger = describeFeatureCoverageLedger(result.report);
    if (featureCoverageLedger) {
      console.log(`账本提示: ${featureCoverageLedger}`);
    }
    console.log('门禁:');
    for (const gate of result.report.gates) {
      const scope = gate.required ? '必需' : '可选';
      const evidence = gate.evidence?.present ? `证据 ${gate.evidence.sources.length}` : '缺证据';
      console.log(`- ${gate.status}: ${gate.label} (${scope}, ${evidence})`);
    }
  }
  if (result.reportPath) {
    console.log(`JSON: ${result.reportPath}`);
  }
  if (result.htmlPath) {
    console.log(`HTML: ${result.htmlPath}`);
  }
  printKnowledgeReview(result.knowledgeReview);
  for (const error of result.errors ?? []) {
    console.log(`- ${error}`);
  }
}

function printKnowledgeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.ok) {
    console.log(`OpenPrd knowledge: 失败 (${result.action ?? 'unknown'})`);
    for (const error of result.errors ?? []) {
      console.log(`- ${error}`);
    }
    return;
  }

  if (result.action === 'knowledge-candidates') {
    const counts = result.counts ?? {};
    console.log(`OpenPrd knowledge candidates: ${result.candidates.length} 个 (${result.status})`);
    console.log(`统计: pending ${counts.pending ?? 0}, promoted ${counts.promoted ?? 0}, rejected ${counts.rejected ?? 0}, archived ${counts.archived ?? 0}, reviewed ${counts.reviewed ?? 0}, total ${counts.total ?? 0}`);
    const ordered = [...result.candidates].sort((left, right) => (right.occurrences ?? 1) - (left.occurrences ?? 1));
    for (const candidate of ordered) {
      const occurrences = candidate.occurrences ?? 1;
      const repeatNote = occurrences > 1 ? `（同类经验已重复出现 ${occurrences} 次，值得优先保留）` : '';
      console.log(`- ${candidate.title ?? candidate.candidateId}${repeatNote}`);
      console.log(`  编号: ${candidate.candidateId} · 状态: ${candidate.status}`);
      console.log(`  候选: ${candidate.path ?? candidate.files?.candidate}`);
      if (candidate.draftSkillPath ?? candidate.files?.draftSkill) {
        console.log(`  草案 Skill: ${candidate.draftSkillPath ?? candidate.files?.draftSkill}`);
      }
      if (candidate.pending) {
        console.log(`  保留: openprd quality . --learn --review --from ${candidate.files?.candidateDir ?? candidate.candidateId}`);
        console.log(`  拒绝: openprd knowledge reject --id ${candidate.candidateId} --reason <原因>`);
        console.log(`  归档: openprd knowledge archive --id ${candidate.candidateId} --reason <原因>`);
      }
    }
    if (result.candidates.length === 0) {
      console.log('没有匹配的 knowledge candidate。');
    } else if (ordered.some((candidate) => candidate.pending)) {
      console.log('给用户的确认话术: 只要回复「保留第 N 条」或「忽略第 N 条」，Agent 就会执行对应命令，不需要手动操作。');
    }
    return;
  }

  console.log(`OpenPrd knowledge ${result.action?.replace(/^knowledge-/, '') ?? 'update'}: ${result.candidateId}`);
  if (result.candidate) {
    console.log(`状态: ${result.candidate.status}`);
    if (result.candidate.reviewDecision) {
      console.log(`决定: ${result.candidate.reviewDecision}`);
    }
    if (result.candidate.reviewReason) {
      console.log(`原因: ${result.candidate.reviewReason}`);
    }
  }
  if (result.files?.candidate) {
    console.log(`候选: ${result.files.candidate}`);
  }
  if (result.files?.knowledgeIndex) {
    console.log(`索引: ${result.files.knowledgeIndex}`);
  }
}

function printVisualCompareResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const modeLabel = result.mode === 'before-after'
    ? '修改前后自检'
    : result.mode === 'focus-board'
      ? '局部焦点证据板'
      : result.mode === 'parallel-board'
        ? '并行实验证据板'
        : '效果图对比';
  console.log('OpenPrd visual compare: 已生成');
  console.log(`输出图片: ${result.outputPath}`);
  console.log(`模式: ${modeLabel}`);
  console.log(`格式: ${result.format}${result.quality ? `, quality=${result.quality}` : ''}`);
  console.log(`画布: ${result.canvas.width}x${result.canvas.height}`);
  if (result.labels?.reference && result.reference?.rendered) {
    console.log(`左侧: ${result.labels.reference} (${result.reference.rendered.width}x${result.reference.rendered.height})`);
  }
  if (result.labels?.actual && result.actual?.rendered) {
    console.log(`右侧: ${result.labels.actual} (${result.actual.rendered.width}x${result.actual.rendered.height})`);
  }
  if (Array.isArray(result.focusRegions) && result.focusRegions.length > 0) {
    console.log(`焦点区域: ${result.focusRegions.length}`);
  }
  if (Array.isArray(result.items) && result.items.length > 0) {
    console.log(`实验卡片: ${result.items.length}`);
  }
  if (result.chatEmbed?.markdown) {
    console.log(`对话流嵌入: ${result.chatEmbed.markdown}`);
    console.log(`  ${result.chatEmbed.hint}`);
  }
  for (const action of result.nextActions ?? []) {
    console.log(`- 下一步: ${action}`);
  }
}

function printVisualPrepareResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const modeLabel = result.mode === 'grid' ? '规则网格切片' : '手工裁剪计划';
  console.log('OpenPrd visual prepare: 已生成');
  console.log(`reference-set: ${result.referenceSetPath}`);
  console.log(`输出目录: ${result.outputDir}`);
  console.log(`模式: ${modeLabel}`);
  console.log(`参考对象: ${result.itemCount}`);
  if (result.source?.metadata) {
    console.log(`参考整板: ${result.source.metadata.width}x${result.source.metadata.height}`);
  }
  console.log(`Contact sheet: ${result.contactSheetPath}`);
  console.log(`Focus 模板: ${result.focusBoardTemplatePath}`);
  console.log(`Parallel 模板: ${result.parallelBoardTemplatePath}`);
  console.log(`对比计划: ${result.comparePlanPath}`);
  for (const action of result.nextActions ?? []) {
    console.log(`- 下一步: ${action}`);
  }
}

function printDesignStarterResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.ok) {
    console.log('OpenPrd design starter: 失败');
    for (const error of result.errors ?? []) {
      console.log(`- ${error}`);
    }
    return;
  }

  console.log('OpenPrd design starter: 已生成');
  console.log(`模板: ${result.starterId} (${result.relativeTemplatePath})`);
  console.log(`输出: ${result.relativeOutputPath}`);
  if (result.defaults?.lens || result.defaults?.theme || result.defaults?.layout) {
    console.log(`默认组合: lens=${result.defaults.lens ?? '待补'} theme=${result.defaults.theme ?? '待补'} layout=${result.defaults.layout ?? '待补'}`);
  }
  if (result.overwritten) {
    console.log('覆盖: 是');
  }
  if (result.hydrated) {
    console.log('active design contracts: 已同步写实');
    if (Array.isArray(result.docsHydrated) && result.docsHydrated.length > 0) {
      console.log(`docs/basic: 已同步写实 (${result.docsHydrated.length} 份)`);
    }
    if (result.sourceManualFilled) {
      console.log(`文件说明书: 已补到 ${result.relativeOutputPath}`);
    }
    if (result.folderManualCreated && result.folderManualPath) {
      console.log(`文件夹 README: 已补到 ${result.folderManualPath}`);
    }
    console.log(`页面主题: ${result.title ?? result.brief ?? '已补'}`);
    if (Array.isArray(result.sections) && result.sections.length > 0) {
      console.log(`模块: ${result.sections.join(' / ')}`);
    }
    console.log('下一步: 直接在生成的入口文件上继续细化结构和样式，不要回到 pending 合同；禁止删除这个入口文件后另起新稿。如果题目更像导览、旅行、展览或馆藏内容页，保持真实图片路线，不要再把它改回 `--no-real-images`。');
    return;
  }
  console.log('下一步: 立即替换入口文件里的标题、CTA 和所有占位文案，并同步把 active design contracts 写实；只有确认当前页不依赖外部事实、品牌素材或真实图片时，才直接写清无依赖。若题目更像导览、旅行、展览或馆藏内容页，先不要急着加 `--no-real-images`。后续必须继续在生成的入口文件上改，禁止删除后重起。');
}

export {
  printStandardsResult,
  printDevelopmentStandardsResult,
  printQualityResult,
  printKnowledgeResult,
  printVisualPrepareResult,
  printVisualCompareResult,
  printDesignStarterResult,
};
