import { readFileSync } from 'node:fs';

const labels = {
  passed: '通过', passed_on_retry: '重跑通过', assertion_failed: '断言失败',
  environment_error: '环境或执行错误', not_run: '未运行',
};
const engineNames = { playwright: 'Playwright', maestro: 'Maestro' };
const engineIcons = Object.fromEntries(Object.keys(engineNames).map(engine => [
  engine, readFileSync(new URL(`./test-report-templates/engine-icons/${engine}.svg`, import.meta.url), 'base64'),
]));
const engineLabel = engine => `<span class="engine"><img src="data:image/svg+xml;base64,${engineIcons[engine]}" alt="" width="18" height="18">${engineNames[engine]}</span>`;
const reportTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai',
});
const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const printable = value => value == null ? '未记录' : escape(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const badge = status => `<span class="status ${escape(status)}">${escape(labels[status])}</span>`;
const link = file => `<a href="./${file.split('/').map(encodeURIComponent).join('/')}">${escape(file.split('/').slice(2).join('/') || file)}</a>`;
const envLabels = {
  target: '目标', deviceType: '设备类型', deviceModel: '设备', os: '系统', osVersion: '系统版本',
  browser: '浏览器', browserVersion: '浏览器版本', runnerVersion: '执行器版本', hostOS: '宿主',
  hostRelease: '宿主版本', architecture: '架构', location: '执行位置', version: '应用版本',
};

const preparationLabels = { prepare_failed: '测试数据准备失败', verify_failed: '测试数据校验失败' };
const comparisonLabel = { passed: '一致', mismatch: '不一致', missing: '未观测到' };
const compact = value => value == null ? '无' : escape(typeof value === 'string' ? value : JSON.stringify(value));

function renderPreparation(preparation) {
  if (!preparation || preparation.status === 'passed') return '';
  const checks = preparation.checks.map(check => `<li><strong>${escape(check.title)}</strong>
    <span>${check.status === 'passed' ? compact(check.actual) :
      `期望 ${compact(check.expected)} · 实际 ${check.status === 'missing' ? '未观测到' : compact(check.actual)}`}</span>
    <small>${comparisonLabel[check.status]}</small></li>`).join('');
  return `<div class="preparation"><h3>${preparationLabels[preparation.status]}</h3>
    <p>${escape(preparation.label)}</p>
    ${preparation.error ? `<p class="detail">${escape(preparation.error)}</p>` : ''}
    ${checks ? `<ul>${checks}</ul>` : ''}
    ${preparation.evidence.length ? `<details><summary>数据准备证据</summary><ul>${preparation.evidence.map(file => `<li>${link(file)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}

function renderCase(entry) {
  const history = entry.attempts.length > 1
    ? entry.attempts.map((attempt, index) => `<li>第 ${index + 1} 次 · ${badge(attempt.status)}
      <pre>${printable(attempt.actual)}</pre>${attempt.reason ? `<pre>${escape(attempt.reason)}</pre>` : ''}</li>`).join('')
    : '';
  return `<tr><th scope="row">${escape(entry.title)}</th><td>${badge(entry.status)}</td>
    <td><pre>${printable(entry.expected)}</pre></td><td><pre>${printable(entry.actual)}</pre>
    ${entry.reason && !history ? `<pre class="detail">${escape(entry.reason)}</pre>` : ''}
    ${history ? `<details><summary>执行记录（${entry.attempts.length}）</summary><ol>${history}</ol></details>` : ''}</td></tr>`;
}

function renderRun(run) {
  const environment = Object.entries(run.environment).map(([key, value]) =>
    `<div><dt>${escape(envLabels[key] ?? key)}</dt><dd>${printable(value)}</dd></div>`).join('');
  const blocked = run.dataPreparation && run.dataPreparation.status !== 'passed';
  return `<section class="run" id="${escape(run.id)}"><header><div class="run-heading"><h2>${escape(run.label)}</h2>${engineLabel(run.engine)}</div>${badge(run.status)}</header>
  <dl>${environment}</dl>${run.error ? `<pre class="detail">${escape(run.error)}</pre>` : ''}
  ${renderPreparation(run.dataPreparation)}
  ${blocked ? `<p>未执行的用例 · ${run.cases.map(entry => escape(entry.title)).join('、')}</p>` :
    `<div class="table"><table><thead><tr><th scope="col">验收项</th><th scope="col">结果</th><th scope="col">期望</th><th scope="col">实际</th></tr></thead>
    <tbody>${run.cases.map(renderCase).join('')}</tbody></table></div>`}</section>`;
}

function renderNavigation(runs) {
  const engines = new Set(runs.map(run => run.engine));
  const groups = Array.from(engines, engine => {
    const links = runs.filter(run => run.engine === engine).map(run =>
      `<li><a href="#${escape(run.id)}">${escape(run.label)}</a></li>`).join('');
    return `<div class="nav-group">${engineLabel(engine)}<ul>${links}</ul></div>`;
  });
  return `<nav aria-label="测试执行">${groups.join('')}</nav>`;
}

function renderSummary(runs) {
  const counts = { passed: 0, passed_on_retry: 0, assertion_failed: 0, environment_error: 0, not_run: 0 };
  let total = 0;
  for (const run of runs) for (const entry of run.cases) {
    counts[entry.status] += 1;
    total += 1;
  }
  const metrics = [
    ['total', '验收项总数', total],
    ['passed', '通过', counts.passed + counts.passed_on_retry],
    ['failed', '未通过', counts.assertion_failed],
  ];
  if (counts.environment_error) metrics.push(['error', '环境或执行错误', counts.environment_error]);
  if (counts.not_run) metrics.push(['pending', '未运行', counts.not_run]);
  return `<ul class="report-summary" aria-label="验收结果合计">${metrics.map(([kind, label, count]) =>
    `<li data-metric="${kind}"><strong>${count}</strong><span>${label}</span></li>`).join('')}</ul>`;
}

export function renderE2EReport(report) {
  const runs = report.runs.some(run => run.dataPreparation)
    ? report.runs.filter(run => run.status !== 'not_run' || run.executedAt || run.dataPreparation)
    : report.runs;
  const time = new Date(report.generatedAt);
  const reportTime = Number.isFinite(time.getTime())
    ? reportTimeFormat.format(time)
    : report.generatedAt;
  return `<!-- OPEN-VIBECODING:E2E-REPORT -->
<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(report.project)} · 端到端测试报告</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f8;color:#17212d;font:15px/1.55 system-ui,sans-serif}
main{max-width:1160px;margin:auto;padding:16px 20px 36px}
.report-header{background:#fff;border:1px solid #e5e8ed;border-radius:16px;padding:15px 19px;box-shadow:0 2px 8px #252c3b08}
.report-header .eyebrow{margin:0;color:#155eaa;font-size:13px;font-weight:700}
.report-header h1{margin:3px 0 6px;font-size:clamp(22px,3.6vw,34px);line-height:1.2;letter-spacing:-.025em;overflow-wrap:anywhere}
.report-header .report-meta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 16px;font-size:13px}
.report-meta p{margin:0}.report-meta strong{margin-inline-end:6px;color:#17212d}
.report-meta a{font-weight:650;text-decoration:none}.report-meta a:hover{text-decoration:underline}
.report-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,110px),1fr));gap:8px;margin:12px 0 0;padding:0;list-style:none}
.report-summary li{display:grid;justify-items:center;align-content:center;padding:6px 8px;border:1px solid #dce3ec;border-radius:8px;background:#f6f8fa;color:#4b5970;font-size:13px;text-align:center}
.report-summary strong{color:#17212d;font-size:21px;line-height:1.25;font-variant-numeric:tabular-nums}
.report-summary [data-metric="total"] strong{color:#155eaa}
.report-summary [data-metric="passed"] strong{color:#0c6137}
.report-summary [data-metric="failed"] strong{color:#dc2626}
.report-summary [data-metric="error"] strong{color:#902b37}
h2{font-size:20px;margin:0}small{color:#4b5970;font-weight:500;margin-inline-start:.4rem}
p,dt{color:#4b5970}a{color:#1551a1}
.layout{display:grid;gap:14px;margin-top:18px}.layout.grouped{grid-template-columns:minmax(180px,220px) minmax(0,1fr);align-items:start}
.runs{display:grid;gap:14px;min-width:0}
nav,.run{background:#fff;border:1px solid #dce3ec;border-radius:12px}
nav{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;padding:10px}
.nav-group+.nav-group{margin-top:8px;padding-top:8px;border-top:1px solid #e0e6ed}
.nav-group>.engine{margin:3px 6px}.nav-group ul{margin:0;padding:0;list-style:none}
nav a{display:block;padding:6px;border-radius:6px;color:#17212d;text-decoration:none;font-size:14px;overflow-wrap:anywhere}
nav a:hover,nav a:focus-visible{background:#f1f2f4}
.engine{display:inline-flex;align-items:center;gap:6px;color:#4b5970;font-size:14px;font-weight:650;white-space:nowrap}
.engine img{display:block;flex:none;object-fit:contain}
.run{padding:18px;scroll-margin-top:12px}
.run-heading,.run>header,dl{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.run>header{justify-content:space-between}
dl{justify-content:flex-start;gap:8px 20px;font-size:13px}dd{margin:0}.table{overflow:auto}
table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:10px;border-bottom:1px solid #e0e6ed;vertical-align:top}
thead th{background:#f3f5f8}tbody th{min-width:135px}pre{font:13px/1.45 ui-monospace,monospace;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.detail{color:#842a23;margin-top:8px}details{margin-top:10px}summary{cursor:pointer;color:#1551a1}
.status{display:inline-block;padding:2px 8px;border-radius:5px;white-space:nowrap;background:#e5e9ef;color:#354354;font-size:13px}
.passed{background:#d9f3e5;color:#0c6137}.passed_on_retry{background:#fff1c7;color:#694e05}
.assertion_failed,.environment_error{background:#fce4e2;color:#842a23}
.preparation{background:#f4f7fb;border:1px solid #dce3ec;border-radius:8px;padding:12px 14px;margin:0 0 12px}
.preparation h3,.preparation p{margin:0}.preparation h3{font-size:15px}
.preparation ul{padding-inline-start:18px;margin:6px 0}.preparation li{overflow-wrap:anywhere}
.preparation li span{margin-inline:9px}.preparation .detail{color:#842a23}
@media(max-width:650px){.layout.grouped{grid-template-columns:minmax(0,1fr)}nav{position:static;max-height:none}.run{padding:12px}}
</style>
<body><main><header class="report-header">
<p class="eyebrow">端到端测试报告</p>
<h1>${escape(report.project)}</h1>
<div class="report-meta"><p><strong>报告生成时间</strong><time datetime="${escape(report.generatedAt)}">${escape(reportTime)}</time></p>
<a href="./results.json">下载 JSON</a></div>
${renderSummary(runs)}
</header>
<div class="layout${runs.length > 1 ? ' grouped' : ''}">
${runs.length > 1 ? renderNavigation(runs) : ''}
<div class="runs">${runs.map(renderRun).join('')}</div>
</div>
</main></body></html>\n`;
}
