/*
 * 核心功能
 * 提供多个 CLI 输出模块共享的轻量打印 helper。
 *
 * 输入
 * 接收知识回顾等横向复用的结构化子对象。
 *
 * 输出
 * 输出统一格式的辅助文本片段，供 run、quality、growth 等模块复用。
 *
 * 定位
 * 位于 CLI 表现层的共享工具模块，只承载跨模块复用的打印逻辑。
 *
 * 依赖
 * 仅依赖终端输出，不依赖其他业务模块。
 *
 * 维护规则
 * 共享 helper 只放稳定、无副作用的格式化逻辑，避免再次把大型输出文件堆回一起。
 */
function printKnowledgeReview(knowledgeReview) {
  if (!knowledgeReview) {
    return;
  }
  if (knowledgeReview.skipped) {
    console.log(`项目经验回顾: 已跳过 (${knowledgeReview.reason})`);
    return;
  }
  if (knowledgeReview.ok === false) {
    console.log(`项目经验回顾: 失败 (${knowledgeReview.errors?.[0] ?? 'unknown'})`);
    return;
  }
  const userFacingMessage = String(knowledgeReview.userFacingExperience?.message ?? '').trim();
  if (userFacingMessage) {
    console.log('项目经验回顾:');
    console.log(userFacingMessage);
    return;
  }
  console.log(`项目经验草案: ${knowledgeReview.candidateId}`);
  if (knowledgeReview.summary) {
    console.log(`摘要: ${knowledgeReview.summary}`);
  }
  if (Array.isArray(knowledgeReview.categories) && knowledgeReview.categories.length > 0) {
    console.log(`类别: ${knowledgeReview.categories.join(', ')}`);
  }
  if (knowledgeReview.files?.draftSkill) {
    console.log(`Draft Skill: ${knowledgeReview.files.draftSkill}`);
  }
  if (knowledgeReview.files?.candidateDir) {
    console.log(`诊断候选: ${knowledgeReview.files.candidateDir}`);
  }
  if (knowledgeReview.suggestedLearnCommand) {
    console.log(`Promote: ${knowledgeReview.suggestedLearnCommand}`);
  }
}

function knowledgeAdoptionLabel(adoption = {}) {
  return `命中 ${adoption.hitCount ?? 0} / 引用 ${adoption.referencedCount ?? 0} / 注入 ${adoption.injectedCount ?? 0}`;
}

function formatUseWhenLabel(value) {
  return String(value ?? '').trim().replace(/^use when\b[:：]?\s*/i, '').trim();
}

function printKnowledgeSkillMatches(knowledgeSkills) {
  const matched = Array.isArray(knowledgeSkills?.matched) ? knowledgeSkills.matched : [];
  if (matched.length === 0) {
    return;
  }
  const mandatoryCheck = knowledgeSkills?.mandatoryCheck ?? null;
  if (mandatoryCheck?.required) {
    console.log(`项目级经验候选: 找到 ${matched.length} 条`);
    console.log(`${mandatoryCheck.title}: ${mandatoryCheck.summary}`);
    for (const instruction of (mandatoryCheck.instructions ?? []).slice(0, 3)) {
      console.log(`- ${instruction}`);
    }
    if (Array.isArray(mandatoryCheck.focusSignals) && mandatoryCheck.focusSignals.length > 0) {
      console.log(`当前判断线索: ${mandatoryCheck.focusSignals.join('；')}`);
    }
  } else {
    console.log(`项目级 Skill: 命中 ${matched.length} 个`);
  }
  for (const skill of matched.slice(0, 3)) {
    console.log(`- ${skill.skillName}: ${skill.matchSummary ?? '命中当前上下文'}`);
    const useWhen = formatUseWhenLabel(skill.useWhen ?? skill.description);
    if (useWhen) {
      console.log(`  适用时机: ${useWhen}`);
    } else if (skill.description) {
      console.log(`  说明: ${skill.description}`);
    }
    if (Array.isArray(skill.reviewFirst) && skill.reviewFirst.length > 0) {
      console.log(`  先看: ${skill.reviewFirst.slice(0, 3).join('；')}`);
    }
    if (Array.isArray(skill.antiPatterns) && skill.antiPatterns.length > 0) {
      console.log(`  不要直接套用: ${skill.antiPatterns.slice(0, 2).join('；')}`);
    }
    if (Array.isArray(skill.touchedFiles) && skill.touchedFiles.length > 0) {
      console.log(`  相关文件: ${skill.touchedFiles.slice(0, 4).join('；')}`);
    }
    console.log(`  复用指标: ${knowledgeAdoptionLabel(skill.adoption ?? {})}`);
  }
}

function optionalCapabilityLocationLabel(location) {
  const clientLabels = {
    codex: 'Codex',
    cursor: 'Cursor',
    claude: 'Claude Code',
  };
  const scopeLabel = location.scope === 'user' ? '用户级' : '项目级';
  return `${clientLabels[location.client] ?? location.client} ${scopeLabel} (${location.path})`;
}

function printOptionalCapabilitySuggestions(optionalCapabilities) {
  if (!Array.isArray(optionalCapabilities) || optionalCapabilities.length === 0) {
    return;
  }
  const configured = optionalCapabilities.filter((capability) => capability.configured);
  const recommended = optionalCapabilities.filter((capability) => !capability.configured);
  if (configured.length === 0 && recommended.length === 0) {
    return;
  }

  if (configured.length > 0) {
    const configuredSummary = configured
      .map((capability) => {
        const locations = capability.configuredLocations.map(optionalCapabilityLocationLabel).join('；');
        return locations ? `${capability.name}（${locations}）` : capability.name;
      })
      .join('，');
    console.log(`已检测可选增强能力: ${configuredSummary}`);
  }

  if (recommended.length === 0) {
    return;
  }

  console.log('可选增强建议:');
  for (const capability of recommended) {
    console.log(`- ${capability.name}: ${capability.summary}`);
    if (capability.recommendedFor) {
      console.log(`  适合场景: ${capability.recommendedFor}`);
    }
    if (Array.isArray(capability.checkedLocations) && capability.checkedLocations.length > 0) {
      console.log(`  建议检查位置: ${capability.checkedLocations.map(optionalCapabilityLocationLabel).join('；')}`);
    }
    console.log(`  文档: ${capability.docsUrl}`);
    console.log(`  GitHub: ${capability.repoUrl}`);
    console.log(`  MCP: ${capability.serverUrl}`);
  }
}

export {
  knowledgeAdoptionLabel,
  printKnowledgeReview,
  printKnowledgeSkillMatches,
  printOptionalCapabilitySuggestions,
};
