#!/usr/bin/env node

export const DEV_CHECK_WRAPUP_COPY_LIMIT = 20;
// 主动结构优化建议与普通建议使用不同表头；两者都不扩大当前任务范围。
const WRAPUP_FIELD_ALIASES = [
  ['源文件规模', '规模信号'],
  ['优化原因', '预警原因'],
  ['本次处理结果'],
  ['后续建议'],
];
const VALIDATE_USAGE = 'Usage: echo \'{"rows":[{"影响对象":"src/example.js","源文件规模":"701 行（> 700 行/文件）","优化原因":"文件偏大，维护成本升","本次处理结果":"本轮小改，未扩职责","后续建议":"继续改前先拆小"}]}\' | node scripts/dev-check-wrapup-copy.mjs --validate（仅推荐模式对应字段为“规模信号 / 预警原因”）';

function countChars(value) {
  return Array.from(String(value ?? ''));
}

function validateCompactRows(rows = [], limit = DEV_CHECK_WRAPUP_COPY_LIMIT) {
  for (const [index, row] of rows.entries()) {
    const rowLabel = row?.影响对象 ? String(row.影响对象) : (row?.影响位置 ? String(row.影响位置) : `第 ${index + 1} 行`);
    for (const aliases of WRAPUP_FIELD_ALIASES) {
      const field = aliases.find((name) => typeof row?.[name] === 'string');
      if (!field) {
        throw new Error(`收口表格校验失败：${rowLabel} 缺少字段“${aliases.join('／')}”。${VALIDATE_USAGE}`);
      }
      const value = row[field];
      const actual = countChars(value).length;
      if (actual > limit) {
        throw new Error(`收口表格校验失败：${rowLabel} 的“${field}”有 ${actual} 个字，超过 ${limit} 字上限。当前内容：“${value}”。请缩短后重试。`);
      }
    }
  }
}

function formatLineCount(value) {
  return value === null || value === undefined ? '未知行数' : `${value} 行`;
}

function thresholdText(file) {
  const thresholds = file.thresholds ?? {};
  const okMax = thresholds.okMax ?? 700;
  const attentionMax = thresholds.attentionMax ?? 1500;
  const lineText = formatLineCount(file.lineCount);
  if (file.status === 'warning') {
    return `${lineText}（> ${attentionMax} 行/文件）`;
  }
  if (file.status === 'attention') {
    return `${lineText}（> ${okMax} 行/文件）`;
  }
  if (file.status === 'error') {
    return `${lineText}（检查失败）`;
  }
  if (file.status === 'ok') {
    return `${lineText}（范围内）`;
  }
  return lineText;
}

function reasonText(file) {
  if (file.status === 'warning') return '文件太大，后续改动风险高';
  if (file.status === 'attention') return '文件偏大，维护成本升';
  if (file.status === 'error') return '检查失败，需先修复';
  if (file.status === 'ok') return '暂无额外预警';
  return '待补充';
}

function currentResultText(file, autoRefactor) {
  if (file.status === 'warning') {
    return autoRefactor ? '同范围时可顺手拆分' : '当前任务不受影响';
  }
  if (file.status === 'attention') {
    return autoRefactor ? '同范围时小步优化' : '本轮小改，未扩职责';
  }
  if (file.status === 'error') return '本轮失败，未收口';
  if (file.status === 'ok') return '本轮已回顾';
  return '待确认';
}

function followUpText(file, autoRefactor) {
  if (file.status === 'warning') {
    return autoRefactor ? '不扩范围，拆后再验证' : '后续按职责拆分';
  }
  if (file.status === 'attention') {
    return autoRefactor ? '保持职责边界清晰' : '继续演进时再拆小';
  }
  if (file.status === 'error') return '先修复后重跑';
  if (file.status === 'ok') return '无需额外动作';
  return '待确认';
}

export function buildCompactDevCheckWrapUpRows(files = [], options = {}) {
  const autoRefactor = Boolean(options.autoRefactor);
  return files.map((file) => (autoRefactor
    ? {
      源文件规模: thresholdText(file),
      优化原因: reasonText(file),
      本次处理结果: currentResultText(file, autoRefactor),
      后续建议: followUpText(file, autoRefactor),
    }
    : {
      规模信号: thresholdText(file),
      预警原因: reasonText(file),
      本次处理结果: currentResultText(file, autoRefactor),
      后续建议: followUpText(file, autoRefactor),
    }));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const validateOnly = process.argv.includes('--validate');
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const rows = validateOnly
    ? (Array.isArray(payload.rows) ? payload.rows : [])
    : buildCompactDevCheckWrapUpRows(Array.isArray(payload.files) ? payload.files : [], {
      autoRefactor: Boolean(payload.autoRefactor),
    });
  validateCompactRows(rows);
  process.stdout.write(JSON.stringify({
    ok: true,
    limit: DEV_CHECK_WRAPUP_COPY_LIMIT,
    rows,
  }));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
