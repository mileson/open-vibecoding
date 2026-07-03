import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DOC_MEGA_LINE_CHARS,
  DOC_STALE_VERSION_THRESHOLD,
  STANDARD_DOCS,
  STANDARD_DOCS_ROOT,
  analyzeDocQuality,
  analyzeDocStaleness,
} from './standards.js';

const PREVIEW_CHARS = 80;
const MAX_LINE_SUGGESTIONS_PER_DOC = 8;

function lineSuggestion(lineNumber, line) {
  const preview = Array.from(line.trim()).slice(0, PREVIEW_CHARS).join('');
  const separators = (line.match(/[；;。]/gu) ?? []).length;
  const hint = separators >= 2
    ? `含 ${separators + 1} 个句段，建议拆成分点列表（每点一行）`
    : '建议拆成小节或分点，删除重复叙述';
  return {
    line: lineNumber,
    chars: Array.from(line).length,
    preview: `${preview}…`,
    hint,
  };
}

export async function docsCompactWorkspace(projectRoot, options = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  const docs = [];
  let totalMegaLines = 0;

  for (const doc of STANDARD_DOCS) {
    const docPath = path.join(resolvedRoot, STANDARD_DOCS_ROOT, doc.fileName);
    const text = await fs.readFile(docPath, 'utf8').catch(() => null);
    if (text === null) {
      continue;
    }
    const relativePath = path.relative(resolvedRoot, docPath);
    const quality = analyzeDocQuality(relativePath, text);
    const lines = text.split('\n');
    const suggestions = [];
    lines.forEach((line, index) => {
      if (Array.from(line).length > DOC_MEGA_LINE_CHARS && suggestions.length < MAX_LINE_SUGGESTIONS_PER_DOC) {
        suggestions.push(lineSuggestion(index + 1, line));
      }
    });
    totalMegaLines += quality.megaLines;

    const entry = {
      ...quality,
      suggestions,
      status: quality.megaLines > 0 ? 'needs-compaction' : 'ok',
    };

    if (doc.fileName === 'prd.md') {
      const stat = await fs.stat(docPath).catch(() => null);
      if (stat) {
        const staleness = await analyzeDocStaleness(resolvedRoot, stat.mtimeMs);
        entry.versionsBehind = staleness.versionsBehind;
        entry.totalVersions = staleness.totalVersions;
        if (staleness.versionsBehind > DOC_STALE_VERSION_THRESHOLD) {
          entry.status = entry.status === 'needs-compaction' ? 'needs-compaction-and-backfill' : 'needs-backfill';
        }
      }
    }

    docs.push(entry);
  }

  const needsAttention = docs.filter((doc) => doc.status !== 'ok');
  const recommendations = [];
  if (needsAttention.length > 0) {
    recommendations.push('压缩原则：同一事实只保留一处最新版本；把巨行拆成分点；过时段落直接删除而不是追加“更新：”。');
    recommendations.push('压缩后运行 openprd standards . --verify 确认警告消除，再运行 openprd dev-check . 收口。');
  }
  for (const doc of needsAttention) {
    if (doc.status.includes('backfill')) {
      recommendations.push(`${doc.path}: 已落后 ${doc.versionsBehind} 个 requirement 版本，需要按最新已确认需求回填基线，再删除已失效内容。`);
    }
    if (doc.megaLines > 0) {
      recommendations.push(`${doc.path}: ${doc.megaLines} 行巨行（阈值 ${DOC_MEGA_LINE_CHARS} 字符），按 suggestions 列出的行号拆分。`);
    }
  }

  return {
    ok: true,
    action: 'docs-compact',
    projectRoot: resolvedRoot,
    docsRoot: STANDARD_DOCS_ROOT,
    analyzedDocs: docs.length,
    docsNeedingAttention: needsAttention.length,
    totalMegaLines,
    docs,
    recommendations,
  };
}

export function printDocsCompactResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`docs/basic 压缩体检: ${result.docsNeedingAttention === 0 ? '健康' : `${result.docsNeedingAttention} 个文档需要处理`}`);
  console.log(`- 已分析文档: ${result.analyzedDocs}`);
  console.log(`- 巨行总数（> ${DOC_MEGA_LINE_CHARS} 字符）: ${result.totalMegaLines}`);
  for (const doc of result.docs) {
    if (doc.status === 'ok') {
      console.log(`- ${doc.path}: 健康（${doc.lines} 行，平均 ${doc.avgLineChars} 字符/行）`);
      continue;
    }
    console.log(`- ${doc.path}: ${doc.status}（${doc.lines} 行，巨行 ${doc.megaLines}，最长 ${doc.maxLineChars} 字符${doc.versionsBehind != null ? `，落后 ${doc.versionsBehind} 版本` : ''}）`);
    for (const suggestion of doc.suggestions) {
      console.log(`  · L${suggestion.line}（${suggestion.chars} 字符）: ${suggestion.preview}`);
      console.log(`    ${suggestion.hint}`);
    }
  }
  if (result.recommendations.length > 0) {
    console.log('建议:');
    for (const item of result.recommendations) {
      console.log(`- ${item}`);
    }
  }
}
