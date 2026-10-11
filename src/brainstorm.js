/*
 * 核心功能
 * 生成脑暴模式的 workspace 数据、资源池摘要和稳定 artifact。
 *
 * 输入
 * 接收项目根目录、可选 topic 和打开页面参数，并读取 benchmark、knowledge 与当前工作区状态。
 *
 * 输出
 * 写入 brainstorm.html、brainstorm.json、data.md、capture-patch.json，并返回结构化结果。
 *
 * 定位
 * 位于脑暴模式应用层，负责把 Open VibeCoding 现有资源组织成可评审的脑暴工作台。
 *
 * 依赖
 * 依赖 benchmark、knowledge、workspace-core 和 brainstorm-artifacts；由 open-vibecoding CLI 作为命令入口调用。
 *
 * 维护规则
 * 修改脑暴状态结构或 artifact 路径时，必须同步维护 CLI、presentation 工具、测试和 docs/basic。
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { listBenchmarkWorkspace } from './benchmark.js';
import { renderBrainstormArtifact, renderBrainstormMarkdown, renderBrainstormPatch } from './brainstorm-artifacts.js';
import { openArtifactInBrowser, artifactBundlePaths, writeHtmlArtifact } from './html-artifacts.js';
import { exists, readJson, writeJson, writeText } from './fs-utils.js';
import { timestamp } from './time.js';
import { appendWorkflowEvent, loadWorkspace } from './workspace-core.js';

const WORKSPACE_SCAN_IGNORE = new Set(['.git', '.open-vibecoding', 'node_modules', '.DS_Store']);

function normalizedText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function listOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizedText(item))
    .filter(Boolean);
}

function firstText(value, fallback = '') {
  return listOfStrings(value)[0] || fallback;
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

function slugify(value, fallback = 'brainstorm') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function toRelativeProjectPath(projectRoot, filePath) {
  const relative = path.relative(projectRoot, filePath).split(path.sep).join('/');
  return relative && !relative.startsWith('..') ? relative : filePath;
}

async function listDocsBasic(projectRoot) {
  const docsRoot = path.join(projectRoot, 'docs', 'basic');
  if (!(await exists(docsRoot))) return [];
  const files = await fs.readdir(docsRoot, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile())
    .map((entry) => path.join('docs', 'basic', entry.name).split(path.sep).join('/'))
    .sort();
}

async function listTopLevelReusableAreas(projectRoot) {
  const entries = await fs.readdir(projectRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => !WORKSPACE_SCAN_IGNORE.has(entry.name))
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .slice(0, 24)
    .map((entry) => {
      if (entry.isDirectory()) {
        return `目录 ${entry.name} 可能包含可复用能力`;
      }
      return `文件 ${entry.name} 可能包含可复用配置`;
    });
}

async function listActiveArtifacts(ws) {
  const targets = [
    ws.paths.activePrd,
    ws.paths.activeReviewHtml,
    ws.paths.activeBrainstormHtml,
    ws.paths.activeArchitectureDiagramHtml,
    ws.paths.activeProductFlowDiagramHtml,
  ];
  const items = [];
  for (const target of targets) {
    if (!(await exists(target))) continue;
    items.push(toRelativeProjectPath(ws.projectRoot, target));
  }
  return items;
}

function summarizeBenchmarks(result) {
  const approved = Array.isArray(result?.approved) ? result.approved : [];
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  const recommendations = Array.isArray(result?.recommendations) ? result.recommendations : [];
  return {
    approved: approved.map((item) => ({
      id: item.id,
      title: item.title,
      repo: item.repo ?? null,
      url: item.url ?? null,
      scenarios: listOfStrings(item.scenarios),
      triggerWhen: listOfStrings(item.triggerWhen),
      note: normalizedText(item.note),
      researchMethod: item.researchMethod ?? null,
    })),
    recommendations: recommendations.map((item) => ({
      id: item.id,
      title: item.title,
      adoptedCount: Number(item.adoptedCount ?? item.recentAdoptedCount ?? 0),
      threshold: Number(item.threshold ?? item.promotion?.threshold ?? 0),
      approveCommand: item.approveCommand ?? item.promotion?.approveCommand ?? null,
    })),
    counts: {
      approved: approved.length,
      candidates: candidates.length,
    },
  };
}

function summarizeKnowledge(index) {
  const skills = Array.isArray(index?.skills) ? index.skills : [];
  const candidates = Array.isArray(index?.candidates) ? index.candidates : [];
  return {
    skills: skills.slice(0, 8).map((item) => ({
      skillName: item.skillName,
      description: normalizedText(item.description ?? item.summary ?? ''),
      categories: listOfStrings(item.categories),
      adoption: item.adoption ?? {},
      touchedFiles: listOfStrings(item.touchedFiles).slice(0, 6),
    })),
    candidates: candidates.slice(0, 6).map((item) => ({
      candidateId: item.candidateId,
      title: item.title ?? item.candidateId,
      status: item.status ?? 'pending-review',
    })),
    counts: {
      incidents: Array.isArray(index?.incidents) ? index.incidents.length : 0,
      patterns: Array.isArray(index?.patterns) ? index.patterns.length : 0,
      skills: skills.length,
      candidates: candidates.length,
      drafts: Array.isArray(index?.drafts) ? index.drafts.length : 0,
    },
  };
}

function buildSourceCoverageLabel({ benchmark, knowledge, workspaceScan }) {
  return [
    `benchmark ${benchmark.counts.approved}/${benchmark.counts.candidates}`,
    `knowledge ${knowledge.counts.skills}/${knowledge.counts.candidates}`,
    `docs ${workspaceScan.docs.length}`,
  ].join(' · ');
}

function buildConfidenceLabel(currentState, benchmark, knowledge) {
  const signals = [
    normalizedText(currentState.problemStatement),
    listOfStrings(currentState.primaryUsers).length > 0 ? 'users' : null,
    listOfStrings(currentState.community).length > 0 ? 'community' : null,
    listOfStrings(currentState.communityFit).length > 0 ? 'community-fit' : null,
    normalizedText(currentState.currentAlternative || currentState.asIs) ? 'current-alternative' : null,
    listOfStrings(currentState.painEvidence).length > 0 ? 'pain-evidence' : null,
    listOfStrings(currentState.manualPath).length > 0 ? 'manual-path' : null,
    listOfStrings(currentState.manualPlaybook).length > 0 ? 'manual-playbook' : null,
    listOfStrings(currentState.commitmentSignals).length > 0 ? 'commitment' : null,
    normalizedText(currentState.firstValidationStep || currentState.nextStep) ? 'validation-step' : null,
    listOfStrings(currentState.paymentProof).length > 0 ? 'payment-proof' : null,
    normalizedText(currentState.mvpSlice) ? 'mvp-slice' : null,
    normalizedText(currentState.weekendTest) ? 'weekend-test' : null,
    listOfStrings(currentState.smallestExecution).length > 0 ? 'smallest-execution' : null,
    listOfStrings(currentState.productizeGate).length > 0 ? 'productize-gate' : null,
    listOfStrings(currentState.firstCustomerPath).length > 0 ? 'first-customer-path' : null,
    normalizedText(currentState.pricingHypothesis) ? 'pricing' : null,
    normalizedText(currentState.customerOneProfitability) ? 'customer-one-profitability' : null,
    listOfStrings(currentState.growthDiscipline).length > 0 ? 'growth-discipline' : null,
    normalizedText(currentState.reversibility) ? 'reversibility' : null,
    normalizedText(currentState.customerTruth) ? 'customer-truth' : null,
    normalizedText(currentState.valuesFit) ? 'values-fit' : null,
    listOfStrings(currentState.goals).length > 0 ? 'goals' : null,
    listOfStrings(currentState.assumptions).length > 0 ? 'assumptions' : null,
    benchmark.counts.approved > 0 ? 'benchmark' : null,
    knowledge.counts.skills > 0 ? 'knowledge' : null,
  ].filter(Boolean).length;
  if (signals >= 8) return '已经有较完整基础，可以开始整理 PRD';
  if (signals >= 5) return '方向基本有了，但还差 1 轮确认';
  return '现在信息还不够，先继续把问题聊透';
}

function buildFollowUpPrompts(currentState, workspaceScan) {
  const prompts = [];
  if (listOfStrings(currentState.primaryUsers).length === 0) {
    prompts.push('先补一轮目标用户和真实场景。');
  }
  if (listOfStrings(currentState.community).length === 0) {
    prompts.push('先说清第一批最容易触达、最可能给真实反馈的人群或社区。');
  }
  if (!normalizedText(currentState.currentAlternative || currentState.asIs)) {
    prompts.push('先说清楚现在是靠什么办法在解决这件事。');
  }
  if (listOfStrings(currentState.manualPath).length === 0) {
    prompts.push('先补一条不做完整产品时也能手工交付价值的路径。');
  }
  if (listOfStrings(currentState.manualPlaybook).length === 0) {
    prompts.push('先把手工作战卡写出来，至少补齐触发条件、步骤、工具、耗时和交接点。');
  }
  if (listOfStrings(currentState.communityFit).length === 0) {
    prompts.push('先说清你为什么算这个社区里的自己人、他们在哪里聚集、为什么这个切口足够小，以及你现在是否已经在真实参与或贡献。');
  }
  if (listOfStrings(currentState.painEvidence).length === 0) {
    prompts.push('先证明这个问题真的痛，用户现在已经在为更差的办法花时间或花钱。');
  }
  if (listOfStrings(currentState.commitmentSignals).length === 0) {
    prompts.push('先定义什么真实承诺能证明这不是口头兴趣。');
  }
  if (!normalizedText(currentState.firstValidationStep || currentState.nextStep)) {
    prompts.push('先定一个最低成本验证动作，不要一上来写全套方案。');
  }
  if (listOfStrings(currentState.defaultAlivePlan).length === 0) {
    prompts.push('先说清验证阶段怎样控制成本、时间和交付方式，确保这件事先活下来。');
  }
  if (listOfStrings(currentState.paymentProof).length === 0) {
    prompts.push('先补有没有 10 个样本、3/10 付费意愿或更强交易信号。');
  }
  if (!normalizedText(currentState.mvpSlice)) {
    prompts.push('先收敛第一版到底只做哪一件事。');
  }
  if (!normalizedText(currentState.weekendTest)) {
    prompts.push('先判断这件事能不能压成周末级 MVP 或更轻试跑。');
  }
  if (listOfStrings(currentState.smallestExecution).length === 0) {
    prompts.push('先说清能不能用 spreadsheet、表单或 no-code 工具把第一版跑起来；如果必须开始做产品，也只自动化最重复的一步，先压成 forms / lists / CRUD 骨架，不要先为假想中的未来客户造复杂能力。');
  }
  if (listOfStrings(currentState.productizeGate).length === 0) {
    prompts.push('先写清达到什么条件才允许继续产品化或加功能，先服务今天已经存在的重复需求，不要提前为未来规模开壳。');
  }
  if (listOfStrings(currentState.firstCustomerPath).length === 0) {
    prompts.push('先说清第一批客户最现实的触达顺序。');
  }
  if (!normalizedText(currentState.pricingHypothesis)) {
    prompts.push('先给出一个从第一个客户开始就成立的收费假设。');
  }
  if (!normalizedText(currentState.customerOneProfitability)) {
    prompts.push('先判断客户 1 怎么覆盖时间和交付成本。');
  }
  if (listOfStrings(currentState.growthDiscipline).length === 0) {
    prompts.push('先约束增长纪律：先熟人还是先社区、什么时候不该 launch、什么时候别急着花钱。');
  }
  if (!normalizedText(currentState.reversibility)) {
    prompts.push('先说清如果验证结果一般，这条路有多容易回退，会不会逼你做重招聘、长期绑定或重平台化这类不可逆决策。');
  }
  if (!normalizedText(currentState.customerTruth)) {
    prompts.push('先判断这更像客户真问题，还是团队自己的技术冲动。');
  }
  if (!normalizedText(currentState.valuesFit)) {
    prompts.push('先确认这条路是否符合团队现在想坚持的价值观和长期经营方式；如果连续这样做 3 到 5 年，你还愿意住在这套业务里吗？');
  }
  if (listOfStrings(currentState.goals).length === 0) {
    prompts.push('先把想达到的目标和判断标准说清楚。');
  }
  if (listOfStrings(currentState.assumptions).length === 0) {
    prompts.push('把这件事要成立必须为真的前提先列出来。');
  }
  if (listOfStrings(currentState.openQuestions).length === 0) {
    prompts.push('把最影响判断的几个问题先列出来。');
  }
  if (workspaceScan.docs.length === 0) {
    prompts.push('如果有现成方案或旧文档，可以一起作为参考。');
  }
  prompts.push('如果以前做过类似产品，优先看看有没有现成做法能直接借。');
  return prompts;
}

function humanizeBenchmarkHint(item) {
  const note = normalizedText(item.note);
  if (note) return note;
  const scenarios = listOfStrings(item.scenarios);
  if (scenarios.length > 0) {
    return `外部类似案例更常出现在 ${scenarios.slice(0, 2).join('、')} 这些场景。`;
  }
  const triggerWhen = listOfStrings(item.triggerWhen);
  if (triggerWhen.length > 0) {
    return `这类参考通常适合用在 ${triggerWhen.slice(0, 2).join('、')} 这些情况。`;
  }
  return '外部类似案例普遍强调先缩小第一版范围，再进入开发。';
}

function buildBrainstormReport({ currentState, benchmark, knowledge, workspaceScan, topic }) {
  const primaryUsers = listOfStrings(currentState.primaryUsers);
  const stakeholders = listOfStrings(currentState.stakeholders);
  const goals = listOfStrings(currentState.goals);
  const successMetrics = listOfStrings(currentState.successMetrics);
  const inScope = listOfStrings(currentState.inScope);
  const outOfScope = listOfStrings(currentState.outOfScope);
  const primaryFlows = listOfStrings(currentState.primaryFlows);
  const openQuestions = listOfStrings(currentState.openQuestions);
  const assumptions = listOfStrings(currentState.assumptions);
  const stopLossActions = listOfStrings(currentState.stopLossActions);
  const community = listOfStrings(currentState.community);
  const seedUsers = listOfStrings(currentState.seedUsers);
  const currentAlternative = normalizedText(currentState.currentAlternative || currentState.asIs);
  const communityFit = listOfStrings(currentState.communityFit);
  const painEvidence = listOfStrings(currentState.painEvidence);
  const manualPath = listOfStrings(currentState.manualPath);
  const manualPlaybook = listOfStrings(currentState.manualPlaybook);
  const commitmentSignals = listOfStrings(currentState.commitmentSignals);
  const firstValidationStep = normalizedText(currentState.firstValidationStep || currentState.nextStep);
  const defaultAlivePlan = listOfStrings(currentState.defaultAlivePlan);
  const paymentProof = listOfStrings(currentState.paymentProof);
  const mvpSlice = normalizedText(currentState.mvpSlice);
  const weekendTest = normalizedText(currentState.weekendTest);
  const smallestExecution = listOfStrings(currentState.smallestExecution);
  const productizeGate = listOfStrings(currentState.productizeGate);
  const firstCustomerPath = listOfStrings(currentState.firstCustomerPath);
  const pricingHypothesis = normalizedText(currentState.pricingHypothesis);
  const customerOneProfitability = normalizedText(currentState.customerOneProfitability);
  const growthDiscipline = listOfStrings(currentState.growthDiscipline);
  const reversibility = normalizedText(currentState.reversibility);
  const customerTruth = normalizedText(currentState.customerTruth);
  const valuesFit = normalizedText(currentState.valuesFit);
  const toBe = normalizedText(currentState.toBe);
  const whyNow = normalizedText(currentState.whyNow);
  const nextStep = normalizedText(currentState.nextStep);
  const benchmarkSignals = benchmark.approved.slice(0, 4).map((item) => humanizeBenchmarkHint(item));
  const knowledgeSignals = knowledge.skills.slice(0, 4).map((item) => {
    const hint = normalizedText(item.description);
    return hint
      ? `当前项目里已经有一些可借鉴的经验：${hint}`
      : '当前项目里已经有类似经验，优先确认能不能直接借用。';
  });
  const currentSituation = [
    ...(primaryUsers.length > 0
      ? [`这次先重点看 ${primaryUsers.slice(0, 2).join('、')} 的真实问题，不要一开始同时服务太多角色。`]
      : ['当前还没锁定最核心的人群，建议先补最近一次真实场景。']),
    ...(primaryFlows.length > 0
      ? [`最近最值得先看的场景是：${primaryFlows[0]}。`]
      : ['当前主流程还比较空，建议先补“最近一次真实发生的案例”。']),
    ...(community.length > 0
      ? [`第一批最容易先验证的人群或社区是：${community.slice(0, 2).join('、')}。`]
      : ['当前还没锁定第一批最容易触达的人群或社区，建议先补最现实的反馈入口。']),
    ...(communityFit.length > 0
      ? [`你现在更适合先从这里切入：${communityFit.slice(0, 2).join('、')}。`]
      : ['当前还没证明你为什么算这个社区里的自己人，建议先补“为什么现在就能触达”。']),
    ...(currentAlternative
      ? [`现在主要还是靠“${currentAlternative}”这类办法在撑着，先判断值不值得替换。`]
      : ['当前还没明确现在是怎么解决的，建议先补现有替代方案。']),
    ...(painEvidence.length > 0
      ? [`这个问题之所以值得做，主要证据是：${painEvidence.slice(0, 2).join('；')}。`]
      : ['当前还没证明这个问题到底有多痛，建议先补真实痛点和现有成本。']),
    ...(whyNow
      ? [`现在提这件事，主要因为：${whyNow}`]
      : ['为什么现在要做还不够具体，建议先说清触发这件事的变化。']),
    ...(mvpSlice
      ? [`如果现在就动手，第一版最好只做“${mvpSlice}”这一件事。`]
      : ['当前还没把第一版压成“一件事 MVP”，建议继续收范围。']),
  ];
  const directionOptions = [
    `推荐方向：${goalsDirection(currentState, topic)}。`,
    ...(toBe
      ? [`更理想的结果是先做到：${toBe}。`]
      : goals.length > 0
        ? [`第一版先围绕“${goals[0]}”收范围，不急着把所有问题一次做完。`]
        : [`第一版先把“${topic}”收敛成可落地的小切口。`]),
    ...(manualPath.length > 0
      ? [`不等完整产品也可以先这样交付价值：${manualPath.slice(0, 2).join('、')}。`]
      : ['如果还没准备好完整产品，建议先补一条手工服务或半自动交付路径。']),
    ...(weekendTest
      ? [`如果要压轻一点，可以先跑这样一个周末级验证：${weekendTest}。`]
      : ['建议再压一层，先想清楚有没有周末级 MVP 或更轻的试跑方式。']),
    ...(smallestExecution.length > 0
      ? [`更小的第一版可以先这样跑：${smallestExecution.slice(0, 2).join('、')}。`]
      : ['建议优先想清楚能不能先用 spreadsheet、表单或 no-code 跑起来；如果必须开始做产品，也只自动化最重复的一步，先压成 forms / lists / CRUD 骨架，不要先为假想中的未来客户造复杂能力。']),
    ...(inScope.length > 0
      ? [`这轮先聚焦：${inScope.slice(0, 2).join('、')}。`]
      : ['范围边界还不够清楚，建议先补“这轮先做什么、先不做什么”。']),
    ...(benchmarkSignals.length > 0
      ? [`外部类似做法大多也是先缩小第一版，再继续扩展。`]
      : []),
    ...(workspaceScan.reuseOpportunities.length > 0
      ? ['备选思路：先盘点现有基础，能直接借的就不从零再做一遍。']
      : []),
  ];
  const validationPlan = [
    ...(communityFit.length > 0
      ? communityFit.slice(0, 2).map((item) => `社区契合：${item}`)
      : ['建议先证明你为什么算这个社区里的自己人、他们在哪里聚集、为什么这个切口够小，以及你现在是否已经在真实参与或贡献。']),
    ...(manualPlaybook.length > 0
      ? manualPlaybook.slice(0, 2).map((item) => `手工作战卡：${item}`)
      : ['建议先把手工作战卡写出来，至少补齐触发条件、步骤、工具、耗时和交接点。']),
    ...(commitmentSignals.length > 0
      ? commitmentSignals.slice(0, 2).map((item) => `先看真实承诺：${item}`)
      : ['建议先定义什么真实承诺能证明这不是口头兴趣。']),
    ...(assumptions.length > 0
      ? assumptions.slice(0, 2).map((item) => `关键前提：${item}`)
      : ['当前还没把“这件事要成立，哪些前提必须为真”说清楚。']),
    ...(successMetrics.length > 0
      ? successMetrics.slice(0, 2).map((item) => `验证通过可以先看：${item}`)
      : ['建议先补 1 到 2 条可验证标准，方便判断第一版值不值得继续。']),
    ...(firstValidationStep
      ? [`低成本先这样验证：${firstValidationStep}`]
      : openQuestions.length > 0
        ? [`低成本先验证最不确定的问题：${openQuestions[0]}`]
        : ['建议先定一个最低成本的验证动作，再决定是否进入完整 PRD。']),
    ...(paymentProof.length > 0
      ? paymentProof.slice(0, 2).map((item) => `付费验证：${item}`)
      : ['建议先补有没有 10 个样本、3/10 付费意愿或更强交易信号。']),
    ...(weekendTest
      ? [`再压一层可以先做：${weekendTest}`]
      : ['如果还太重，建议继续把验证动作压到周末级别。']),
    ...(productizeGate.length > 0
      ? productizeGate.slice(0, 2).map((item) => `产品化门槛：${item}`)
      : ['建议先写清达到什么条件才允许继续产品化，而不是一有想法就继续扩。']),
    ...(stopLossActions.length > 0
      ? stopLossActions.slice(0, 2).map((item) => `如果验证不顺，先这样止损：${item}`)
      : ['如果验证结果不达预期，最好提前定义什么情况下先停。']),
  ];
  const validationLoop = [
    ...(community.length > 0
      ? [`先去这里找真实反馈：${community.slice(0, 2).join('、')}。`]
      : ['先补第一批最容易触达的社区、渠道或人群。']),
    ...(communityFit.length > 0
      ? [`你更像这个圈子的自己人，因为：${communityFit.slice(0, 2).join('、')}。`]
      : ['先补你为什么算这个社区里的自己人、他们为什么愿意先相信你。']),
    ...(seedUsers.length > 0
      ? [`第一批优先先找：${seedUsers.slice(0, 2).join('、')}。`]
      : ['先补第一批最值得先聊、先服务的人。']),
    ...(currentAlternative
      ? [`当前主要替代方案是：${currentAlternative}。`]
      : ['先补用户现在主要靠什么办法在解决。']),
    ...(painEvidence.length > 0
      ? [`痛点证据更像这样：${painEvidence.slice(0, 2).join('；')}。`]
      : ['先补这个问题到底有多痛，用户现在已经在付出什么时间或金钱。']),
    ...(manualPath.length > 0
      ? [`先不做完整产品时，也可以这样手工交付：${manualPath.slice(0, 2).join('、')}。`]
      : ['先补一条不做完整产品也能交付价值的手工路径。']),
    ...(manualPlaybook.length > 0
      ? manualPlaybook.slice(0, 2).map((item) => `手工作战卡先这样写：${item}`)
      : ['先补一版手工作战卡，把触发条件、步骤、工具、耗时和交接点写清楚。']),
    ...(firstCustomerPath.length > 0
      ? [`第一批客户更现实的顺序是：${firstCustomerPath.slice(0, 3).join(' -> ')}。`]
      : ['先补第一批客户最现实的触达顺序，比如熟人、社区和陌生线索怎么排。']),
  ];
  const businessViability = [
    ...(commitmentSignals.length > 0
      ? commitmentSignals.slice(0, 2).map((item) => `先用这种承诺证明值得继续：${item}`)
      : ['先定义什么真实承诺最能证明值得继续。']),
    ...(paymentProof.length > 0
      ? paymentProof.slice(0, 2).map((item) => `付费证明：${item}`)
      : ['先补 10 个样本里有没有 3/10 愿意付费、预付或给出更强承诺。']),
    ...(pricingHypothesis
      ? [`从第一个客户开始，先按这个方式收费：${pricingHypothesis}`]
      : ['先给一个从第一个客户开始就成立的收费假设，不要无限期免费。']),
    ...(customerOneProfitability
      ? [`客户 1 的盈利或打平路径：${customerOneProfitability}`]
      : ['先判断第一个客户怎么覆盖时间和交付成本。']),
    ...(defaultAlivePlan.length > 0
      ? defaultAlivePlan.slice(0, 2).map((item) => `先活下来要守住：${item}`)
      : ['先补验证阶段怎样控制成本、时间和交付方式，确保这件事先活下来。']),
    ...(firstValidationStep
      ? [`下一步最便宜的验证动作是：${firstValidationStep}`]
      : ['先定一个最低成本验证动作，再决定要不要继续做大。']),
    ...(growthDiscipline.length > 0
      ? growthDiscipline.slice(0, 2).map((item) => `增长纪律：${item}`)
      : ['先约束增长纪律：先卖再 launch，先花时间别先花钱。']),
  ];
  const minimalistReview = [
    ...(smallestExecution.length > 0
      ? smallestExecution.slice(0, 2).map((item) => `更小的执行方式：${item}`)
      : ['先判断能不能继续保持小：先用 spreadsheet、表单或 no-code 跑；如果必须开始做产品，也只自动化最重复的一步，先压成 forms / lists / CRUD 骨架，不要先为假想中的未来客户造复杂能力。']),
    ...(productizeGate.length > 0
      ? productizeGate.slice(0, 2).map((item) => `产品化条件：${item}`)
      : ['先写清达到什么条件才允许产品化，别让功能冲动替代真实门槛。']),
    ...(reversibility
      ? [`如果结果一般，这条路的可逆性是：${reversibility}`]
      : ['先判断如果验证结果一般，这条路是不是容易回退，避免先做重招聘、长期绑定或重平台化。']),
    ...(customerTruth
      ? [`客户真问题校验：${customerTruth}`]
      : ['先判断这更像在解决客户真问题，还是团队自己的技术冲动。']),
    ...(valuesFit
      ? [`价值观一致性：${valuesFit}`]
      : ['先确认这条路是否符合团队现在想坚持的价值观和长期经营方式；如果连续这样做 3 到 5 年，你还愿意住在这套业务里吗？']),
  ];
  const reuseFoundation = [
    ...(inScope.length > 0
      ? inScope.slice(0, 2).map((item) => `这轮范围里可以先围绕“${item}”判断现有能力能不能直接借。`)
      : []),
    ...(workspaceScan.docs.length > 0
      ? ['当前项目里已经有现成文档或历史方案，可以先借现有边界和思路。']
      : []),
    ...(workspaceScan.activeArtifacts.length > 0
      ? ['当前项目里已经有相关评审或方案产物，可以先沿用现成结构。']
      : []),
    ...(workspaceScan.reuseOpportunities.length > 0
      ? [`当前工作区里已经识别到 ${Math.min(workspaceScan.reuseOpportunities.length, 8)} 类可能复用的能力，建议先看能不能少做一遍。`]
      : []),
    ...(stakeholders.length > 0
      ? [`这件事还需要 ${stakeholders.slice(0, 3).join('、')} 一起参与或拍板。`]
      : ['相关参与方和拍板人还没补齐，后面容易在范围或节奏上来回返工。']),
  ];
  const externalReferences = [...benchmarkSignals, ...knowledgeSignals].slice(0, 8);
  const unresolved = [
    ...(outOfScope.length > 0 ? outOfScope.map((item) => `这轮先不展开：${item}`) : []),
    ...(openQuestions.length > 0 ? openQuestions.map((item) => `还要确认：${item}`) : ['还需要补 1 轮高价值确认，避免直接进入实现。']),
  ];
  const nextSteps = [
    `如果方向基本认可，下一步就把这次结论整理成 PRD。`,
    `如果还没把握，先补“当前替代方案、关键前提、低成本验证”这三类信息。`,
  ];

  return {
    executiveSummary: normalizedText(currentState.problemStatement)
      ? `围绕“${topic}”，这次更像是先把问题、目标和第一版思路想清楚，再决定怎么整理成 PRD。`
      : `围绕“${topic}”，现在还在想清楚方向，建议先把目标、用户和第一版思路收拢，再进入 PRD。`,
    currentSituation: currentSituation.slice(0, 8),
    directionOptions: directionOptions.slice(0, 8),
    validationPlan: validationPlan.slice(0, 8),
    reuseFoundation: reuseFoundation.slice(0, 8),
    externalReferences,
    userSignals: currentSituation.slice(0, 8),
    marketSignals: directionOptions.slice(0, 8),
    validationLoop: validationLoop.slice(0, 8),
    businessViability: businessViability.slice(0, 8),
    minimalistReview: minimalistReview.slice(0, 8),
    risks: validationPlan.slice(0, 8),
    reuseOpportunities: reuseFoundation.slice(0, 8),
    openQuestions: openQuestions.slice(0, 8),
    unresolved: unresolved.slice(0, 8),
    nextSteps,
  };
}

export async function loadBrainstormState(projectRoot) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.paths.activeBrainstormState))) {
    throw new Error(`未找到脑暴状态文件: ${ws.paths.activeBrainstormState}。先运行 open-vibecoding brainstorm .`);
  }
  const record = await readJson(ws.paths.activeBrainstormState);
  return { ws, record };
}

export async function renderBrainstormWorkspaceArtifacts(projectRoot, record, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  const artifactId = normalizedText(record?.artifactId) || 'brainstorm-active';
  const bundle = artifactBundlePaths(ws, artifactId);
  const patch = renderBrainstormPatch({ record });
  const markdown = renderBrainstormMarkdown({ record });

  const nextRecord = {
    ...record,
    artifacts: {
      bundleDir: bundle.dir,
      htmlPath: ws.paths.activeBrainstormHtml,
      bundleHtmlPath: bundle.html,
      markdownPath: bundle.markdown,
      patchPath: bundle.patch,
      statePath: ws.paths.activeBrainstormState,
    },
  };

  await writeText(bundle.markdown, markdown);
  await writeJson(bundle.patch, patch);
  await writeJson(ws.paths.activeBrainstormState, nextRecord);

  const html = renderBrainstormArtifact({
    record: nextRecord,
    markdownPath: bundle.markdown,
    patchPath: bundle.patch,
    statePath: ws.paths.activeBrainstormState,
  });
  await writeHtmlArtifact(bundle.html, html);
  await writeHtmlArtifact(ws.paths.activeBrainstormHtml, html);

  if (options.open) {
    await openArtifactInBrowser(ws.paths.activeBrainstormHtml);
  }

  return {
    ws,
    record: nextRecord,
    htmlPath: ws.paths.activeBrainstormHtml,
    bundleHtmlPath: bundle.html,
    markdownPath: bundle.markdown,
    patchPath: bundle.patch,
    statePath: ws.paths.activeBrainstormState,
    opened: Boolean(options.open),
  };
}

export async function brainstormWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const currentState = {
    ...(ws.data.currentState ?? {}),
    captureMeta: {
      ...((ws.data.currentState ?? {}).captureMeta ?? {}),
    },
  };
  const topic = normalizedText(options.topic)
    || normalizedText(currentState.title)
    || normalizedText(currentState.problemStatement)
    || '当前需求方向脑暴';
  const benchmarkResult = await listBenchmarkWorkspace(projectRoot).catch(() => ({
    approved: [],
    candidates: [],
    recommendations: [],
    counts: { approved: 0, candidates: 0 },
  }));
  const knowledgeIndex = await readJson(ws.paths.knowledgeIndex).catch(() => ({}));
  const previousRecord = await readJson(ws.paths.activeBrainstormState).catch(() => null);
  const workspaceScan = {
    docs: await listDocsBasic(projectRoot),
    reuseOpportunities: await listTopLevelReusableAreas(projectRoot),
    activeArtifacts: await listActiveArtifacts(ws),
  };
  workspaceScan.followUpPrompts = buildFollowUpPrompts(currentState, workspaceScan);

  const benchmark = summarizeBenchmarks(benchmarkResult);
  const knowledge = summarizeKnowledge(knowledgeIndex);
  const report = buildBrainstormReport({
    currentState,
    benchmark,
    knowledge,
    workspaceScan,
    topic,
  });
  const artifactId = `brainstorm-${slugify(topic, 'active')}`;
  const generatedAt = timestamp();
  const recordBase = {
    schema: 'openprd.brainstorm.v3',
    artifactId,
    topic,
    title: `${topic} / 方向梳理`,
    generatedAt,
    currentStatus: currentState.status ?? 'initialized',
    productType: currentState.productType ?? null,
    productTypeLabel: currentState.productType ?? '待确认',
    summary: {
      recommendedDirection: goalsDirection(currentState, topic),
      currentAlternative: summarizeCurrentAlternative(currentState),
      confidenceLabel: buildConfidenceLabel(currentState, benchmark, knowledge),
      sourceCoverageLabel: buildSourceCoverageLabel({ benchmark, knowledge, workspaceScan }),
    },
    captureState: {
      problemStatement: currentState.problemStatement ?? '',
      whyNow: currentState.whyNow ?? '',
      primaryUsers: listOfStrings(currentState.primaryUsers),
      stakeholders: listOfStrings(currentState.stakeholders),
      community: listOfStrings(currentState.community),
      seedUsers: listOfStrings(currentState.seedUsers),
      communityFit: listOfStrings(currentState.communityFit),
      painEvidence: listOfStrings(currentState.painEvidence),
      goals: listOfStrings(currentState.goals),
      successMetrics: listOfStrings(currentState.successMetrics),
      inScope: listOfStrings(currentState.inScope),
      outOfScope: listOfStrings(currentState.outOfScope),
      primaryFlows: listOfStrings(currentState.primaryFlows),
      openQuestions: listOfStrings(currentState.openQuestions),
      assumptions: listOfStrings(currentState.assumptions),
      stopLossActions: listOfStrings(currentState.stopLossActions),
      currentAlternative: currentState.currentAlternative ?? '',
      manualPath: listOfStrings(currentState.manualPath),
      manualPlaybook: listOfStrings(currentState.manualPlaybook),
      commitmentSignals: listOfStrings(currentState.commitmentSignals),
      firstValidationStep: currentState.firstValidationStep ?? '',
      defaultAlivePlan: listOfStrings(currentState.defaultAlivePlan),
      paymentProof: listOfStrings(currentState.paymentProof),
      mvpSlice: currentState.mvpSlice ?? '',
      weekendTest: currentState.weekendTest ?? '',
      smallestExecution: listOfStrings(currentState.smallestExecution),
      productizeGate: listOfStrings(currentState.productizeGate),
      firstCustomerPath: listOfStrings(currentState.firstCustomerPath),
      pricingHypothesis: currentState.pricingHypothesis ?? '',
      customerOneProfitability: currentState.customerOneProfitability ?? '',
      growthDiscipline: listOfStrings(currentState.growthDiscipline),
      reversibility: currentState.reversibility ?? '',
      customerTruth: currentState.customerTruth ?? '',
      valuesFit: currentState.valuesFit ?? '',
      asIs: currentState.asIs ?? '',
      toBe: currentState.toBe ?? '',
      nextStep: currentState.nextStep ?? '',
    },
    report,
    benchmark,
    knowledge,
    workspaceScan,
    brainstormPresentation: previousRecord?.brainstormPresentation ?? null,
    brainstormPresentationMeta: previousRecord?.brainstormPresentationMeta ?? null,
  };
  const digest = hashStableJson(recordBase);
  const record = {
    ...recordBase,
    digest,
  };

  const rendered = await renderBrainstormWorkspaceArtifacts(projectRoot, record, { open: options.open || !options.json });
  await appendWorkflowEvent(ws, 'brainstorm_generated', {
    artifactId,
    digest,
    htmlPath: rendered.htmlPath,
    markdownPath: rendered.markdownPath,
    patchPath: rendered.patchPath,
  });

  return {
    ...rendered,
  };
}

function goalsDirection(currentState, topic) {
  const firstGoal = listOfStrings(currentState.goals)[0];
  if (firstGoal) {
    return `先围绕“${firstGoal}”收敛第一版做法`;
  }
  return `先把“${topic}”收敛成可落地的第一版`;
}

function summarizeCurrentAlternative(currentState) {
  const currentAlternative = normalizedText(currentState.currentAlternative || currentState.asIs);
  if (currentAlternative) {
    return `现在主要还是靠“${currentAlternative}”在解决`;
  }
  return '还没明确现在主要靠什么方式在解决';
}
