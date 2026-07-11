/*
 * 核心功能
 * 承载质量与视觉相关 CLI 命令分发：standards、quality、knowledge、visual-prepare、
 * visual-compare、design-starter、grow、docs-compact、guide、dev-check。
 *
 * 输入
 * 接收 main 传入的 command、projectPath、flags、positionals。
 *
 * 输出
 * 命中命令时执行对应 workspace 函数并打印结果，返回退出码；未命中返回 null。
 *
 * 定位
 * 位于 CLI 应用层，从 openprd.js 拆出的命令分组，不承载领域业务规则。
 *
 * 依赖
 * 依赖 standards、quality、knowledge、visual-compare、growth 等 workspace 模块与 cli/print。
 *
 * 维护规则
 * 新增质量/视觉类命令时优先放这里，并同步 usage、打印契约与测试。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkStandardsWorkspace, classifyExternalReferenceWorkspace, initStandardsWorkspace } from '../standards.js';
import { qualityWorkspace } from '../quality.js';
import {
  archiveKnowledgeCandidate,
  listKnowledgeCandidates,
  rejectKnowledgeCandidate,
  restoreKnowledgeCandidate,
} from '../knowledge.js';
import { checkDevelopmentStandardsWorkspace } from '../dev-standards.js';
import {
  applyGrowthCandidateWorkspace,
  checkGrowthWorkspace,
  initGrowthWorkspace,
  rejectGrowthCandidateWorkspace,
  reviewGrowthWorkspace,
} from '../growth.js';
import { designStarterWorkspace } from '../design-starter.js';
import { visualCompareWorkspace } from '../visual-compare.js';
import { visualPrepareWorkspace } from '../visual-prepare.js';
import {
  printDesignStarterResult,
  printDevelopmentStandardsResult,
  printGrowthResult,
  printKnowledgeResult,
  printQualityResult,
  printStandardsResult,
  printVisualCompareResult,
  printVisualPrepareResult,
} from './print.js';

async function isDirectoryPath(candidate) {
  const stat = await fs.stat(path.resolve(candidate)).catch(() => null);
  return Boolean(stat?.isDirectory());
}

export async function runQualityCommand(command, { projectPath, flags, positionals }) {
  if (command === 'standards') {
    const result = flags.init
      ? await initStandardsWorkspace(projectPath, { force: flags.force })
      : flags.classifyExternal !== null
        ? await classifyExternalReferenceWorkspace(projectPath, { externalReference: flags.classifyExternal })
        : await checkStandardsWorkspace(projectPath);
    printStandardsResult(result, flags.json);
    return result.ok ? 0 : 1;
  }

  if (command === 'quality') {
    const result = await qualityWorkspace(projectPath, {
      init: flags.init,
      verify: flags.verify,
      report: flags.report,
      html: flags.html,
      learn: Boolean(flags.learn),
      review: flags.review,
      from: flags.from,
      force: flags.force,
    });
    printQualityResult(result, flags.json);
    return result.ok ? 0 : 1;
  }

  if (command === 'knowledge') {
    const subcommand = positionals[0] ?? 'candidates';
    const firstArgIsProjectPath = !flags.path && positionals.length > 1 && await isDirectoryPath(positionals[1]);
    const knowledgeProjectPath = path.resolve(flags.path ?? (firstArgIsProjectPath ? positionals[1] : process.cwd()));
    let result;
    if (subcommand === 'candidates' || subcommand === 'list') {
      result = await listKnowledgeCandidates(knowledgeProjectPath, {
        status: flags.status ?? 'pending-review',
      });
    } else if (subcommand === 'reject') {
      result = await rejectKnowledgeCandidate(knowledgeProjectPath, {
        id: flags.id ?? positionals[1] ?? null,
        reason: flags.reason ?? flags.notes,
      });
    } else if (subcommand === 'archive') {
      result = await archiveKnowledgeCandidate(knowledgeProjectPath, {
        id: flags.id ?? positionals[1] ?? null,
        reason: flags.reason ?? flags.notes,
      });
    } else if (subcommand === 'restore') {
      result = await restoreKnowledgeCandidate(knowledgeProjectPath, {
        id: flags.id ?? positionals[1] ?? null,
      });
    } else {
      console.log('Usage: openprd knowledge <candidates|reject|archive|restore> [path-or-id] [--status <pending-review|all|rejected|archived|promoted|merged>] [--id <candidate-id>] [--reason <text>] [--json]');
      return 1;
    }
    printKnowledgeResult(result, flags.json);
    return result.ok ? 0 : 1;
  }

  if (command === 'visual-prepare') {
    const result = await visualPrepareWorkspace(projectPath, {
      reference: flags.reference,
      grid: flags.grid,
      boxes: flags.boxes,
      include: flags.include,
      id: flags.id,
      title: flags.title,
      out: flags.out,
    });
    printVisualPrepareResult(result, flags.json);
    return result.ok ? 0 : 1;
  }

  if (command === 'visual-compare') {
    const result = await visualCompareWorkspace(projectPath, {
      reference: flags.reference,
      actual: flags.actual,
      before: flags.before,
      after: flags.after,
      board: flags.board,
      out: flags.out,
      format: flags.format,
      quality: flags.quality,
      maxPanelWidth: flags.maxPanelWidth,
      referenceLabel: flags.referenceLabel,
      actualLabel: flags.actualLabel,
      locale: flags.locale,
    });
    printVisualCompareResult(result, flags.json);
    return result.ok ? 0 : 1;
  }

  if (command === 'design-starter') {
    const result = await designStarterWorkspace(projectPath, {
      starter: flags.starter,
      out: flags.out,
      title: flags.title,
      brief: flags.brief,
      sections: flags.sections,
      noExternalFacts: flags.noExternalFacts,
      noBrandAssets: flags.noBrandAssets,
      noRealImages: flags.noRealImages,
      force: flags.force,
    });
    printDesignStarterResult(result, flags.json);
    return result.ok ? 0 : 1;
  }

  if (command === 'grow') {
    const firstArgIsProjectPath = !flags.path && positionals.length > 0 && await isDirectoryPath(positionals[0]);
    const growthProjectPath = path.resolve(flags.path ?? (firstArgIsProjectPath ? positionals[0] : process.cwd()));
    let result;
    if (flags.init) {
      result = await initGrowthWorkspace(growthProjectPath);
    } else if (flags.apply) {
      result = await applyGrowthCandidateWorkspace(growthProjectPath, { id: flags.id });
    } else if (flags.reject) {
      result = await rejectGrowthCandidateWorkspace(growthProjectPath, { id: flags.id, notes: flags.notes });
    } else if (flags.check) {
      result = await checkGrowthWorkspace(growthProjectPath);
    } else {
      result = await reviewGrowthWorkspace(growthProjectPath);
    }
    printGrowthResult(result, flags.json);
    return result.ok ? 0 : 1;
  }

  if (command === 'docs-compact') {
    const { docsCompactWorkspace, printDocsCompactResult } = await import('../docs-compact.js');
    const result = await docsCompactWorkspace(projectPath);
    printDocsCompactResult(result, flags.json);
    return result.ok ? 0 : 1;
  }

  if (command === 'guide') {
    const { guideWorkspace, printGuideResult } = await import('../guide.js');
    const result = await guideWorkspace(projectPath);
    printGuideResult(result, flags.json);
    return result.ok ? 0 : 1;
  }

  if (command === 'dev-check') {
    const firstArgIsProjectPath = !flags.path && positionals.length > 0 && await isDirectoryPath(positionals[0]);
    const devProjectPath = path.resolve(flags.path ?? (firstArgIsProjectPath ? positionals[0] : process.cwd()));
    const files = flags.path
      ? positionals
      : (firstArgIsProjectPath ? positionals.slice(1) : positionals);
    if (flags.autoRefactor !== null) {
      const normalized = String(flags.autoRefactor).trim().toLowerCase();
      if (!['on', 'off'].includes(normalized)) {
        console.error('--auto-refactor 只接受 on 或 off。');
        return 1;
      }
      const { setDevCheckAutoRefactor } = await import('../dev-standards.js');
      const toggleResult = await setDevCheckAutoRefactor(devProjectPath, normalized === 'on');
      if (files.length === 0) {
        printDevelopmentStandardsResult(toggleResult, flags.json);
        return toggleResult.ok ? 0 : 1;
      }
    }
    const result = await checkDevelopmentStandardsWorkspace(devProjectPath, { files });
    printDevelopmentStandardsResult(result, flags.json);
    return result.ok ? 0 : 1;
  }

  if (command === 'i18n-init') {
    const initProjectPath = path.resolve(flags.path ?? positionals[0] ?? process.cwd());
    const { initI18nConfig } = await import('../dev-standards.js');
    const result = await initI18nConfig(initProjectPath, {
      defaultLanguage: flags.locale ?? undefined,
    });
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`OpenPrd i18n: ${result.created ? '已创建' : '配置已存在'} ${result.configPath}`);
      console.log(`基准语言: ${result.config.defaultLanguage}`);
      console.log(`支持语种: ${result.config.supportedLanguages.join(', ')}`);
      console.log(`dev-check 检查: ${result.config.enforceOnDevCheck ? '开启' : '关闭'}`);
      console.log(`最佳实践文档: docs/basic/i18n-guidelines.md`);
    }
    return 0;
  }

  return null;
}
