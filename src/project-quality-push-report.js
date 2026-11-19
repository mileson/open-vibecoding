import path from 'node:path';
import { atomicWriteJson, atomicWriteText } from './kernel/atomic-store.js';

const labels = {
  ready: '检查通过，可以推送', blocked: '推送已拦截', skipped: '没有需要检查的提交',
  unconfigured: '尚未接入推送前检查',
  passed: '通过', failed: '失败', missing: '缺少必过检查',
  matched: '远端指向已检查的提交', unchanged: '远端引用未变动',
  different: '远端引用与预期不同', deleted: '远端引用已删除', unobserved: '尚未读回远端',
};
const escape = value => String(value ?? '—').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const date = value => new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Shanghai', hourCycle: 'h23',
}).format(new Date(value));
const nextStep = {
  failed: '查看原始证据，修复后重新提交并推送。',
  blocked: '处理阻塞原因后重新推送。',
  missing: '恢复项目要求的必过检查后重新推送。',
  unconfigured: '在项目质量配置登记 prepush 必过项，并通过项目已有 hook 启用。',
};

function artifact(root, report, target) {
  if (!target) return null;
  const [base, file] = [report, target].map(file => path.resolve(root, file));
  if (!file.startsWith(root + path.sep)) return null;
  return path.relative(path.dirname(base), file).split(path.sep).map(encodeURIComponent).join('/');
}

function checkRow(root, report, check) {
  const target = artifact(root, report, check.evidence?.html ?? check.evidence?.log);
  const log = artifact(root, report, check.evidence?.html && check.evidence.log);
  const native = check.evidence?.runs?.find(run => run.status === 'assertion_failed');
  const reason = native ? '<p>有验收断言失败。</p>' : '';
  const runnerReason = check.reason ? '<p>' + escape(check.reason) + '</p>' : '';
  const detail = target ? '<a href="' + escape(target) + '">执行证据</a>' : '';
  const rawLog = log ? ' · <a href="' + escape(log) + '">原始日志</a>' : '';
  return '<li><strong>' + escape(check.checkId) + '</strong> <span class="state" data-status="' + escape(check.status) + '">' +
    escape(check.status === 'blocked' ? '阻塞' : labels[check.status] ?? check.status) + '</span>' + reason +
    (nextStep[check.status] ? '<p>' + nextStep[check.status] + '</p>' : '') +
    '<details><summary>详情</summary><p>耗时 ' + escape(check.durationMs ?? 0) +
    ' ms</p>' + runnerReason + detail + rawLog + '</details></li>';
}

function refCard(root, data, ref, offset) {
  const remote = data.remoteObservation?.refs[offset];
  const remoteLabel = labels[remote?.status ?? 'unobserved'];
  const reason = ref.reason ? '<p>' + escape(ref.reason) + '</p>' : '';
  const preparation = artifact(root, data.html, ref.prepareLog);
  return '<section><h2>提交检查</h2><p>' + escape(remoteLabel) + '</p>' +
    reason + '<ul>' + ref.checks.map(check => checkRow(root, data.html, check)).join('') + '</ul>' +
    '<details><summary>提交与远端详情</summary><dl><dt>本地引用</dt><dd>' + escape(ref.localRef) +
    '</dd><dt>提交 SHA</dt><dd>' + escape(ref.commit) + '</dd><dt>目标引用</dt><dd>' + escape(ref.remoteRef) +
    '</dd><dt>检查前远端 SHA</dt><dd>' + escape(ref.previousOid) + '</dd><dt>读回的远端 SHA</dt><dd>' +
    escape(remote?.observedOid) + '</dd></dl>' + (preparation ?
      '<a href="' + escape(preparation) + '">环境准备日志</a>' : '') + '</details></section>';
}

export async function writePushReport(root, data) {
  const metrics = [
    ['检查总数', data.counts.total], ['通过', data.counts.passed],
    ['失败或阻塞', data.counts.failed + data.counts.blocked + data.counts.missing],
  ];
  const remoteTime = data.remoteObservation
    ? '<p>远端读回 ' + escape(date(data.remoteObservation.observedAt)) + '（北京时间）</p>'
    : '<p>待推送后读回远端引用。</p>';
  const page = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>推送前检查</title>
<style>
:root{color-scheme:light;font:16px/1.6 system-ui,sans-serif;color:#182520;background:#eef4f0}
body{max-width:920px;margin:0 auto;padding:28px 16px}
header,section{background:white;border:1px solid #d6e3dc;border-radius:16px;padding:24px;margin:12px 0}
header{border-top:5px solid #376352}header[data-status="blocked"],header[data-status="unconfigured"]{border-top-color:#a13d32}
h1,h2,p,ul{margin:0 0 10px}h1{font-size:clamp(1.6rem,4vw,2.4rem)}h2{font-size:1.12rem}
.metrics{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.metric{background:#eef4f0;border-radius:10px;padding:8px 14px}.metric b{margin-right:8px}
ul{list-style:none;padding:0}li{border-top:1px solid #e1eae4;padding:10px 0}details{margin:6px 0;overflow-wrap:anywhere}
summary{cursor:pointer}.state{margin-left:8px;color:#345d4d}.state[data-status=failed],.state[data-status=blocked],.state[data-status=missing]{color:#9b3026}dd{margin:0 0 4px}a{color:#19563f}
</style>
<header data-status="${escape(data.status)}">
<h1>${escape(labels[data.status])}</h1>
<p>完成于 ${escape(date(data.finishedAt))}（北京时间）</p>
<div class="metrics">${metrics.map(([title, amount]) => '<div class="metric"><b>' + amount + '</b>' + title + '</div>').join('')}</div>
${data.reason ? '<p>' + escape(data.reason) + '</p>' : ''}
${remoteTime}
<details><summary>本次检查耗时</summary>${escape(data.durationMs ?? Date.parse(data.finishedAt) - Date.parse(data.startedAt))} ms</details>
</header>
<main>${data.refs.map((ref, offset) => refCard(root, data, ref, offset)).join('')}</main></html>`;
  await atomicWriteJson(path.join(root, data.report), data);
  await atomicWriteText(path.join(root, data.html), page);
}
