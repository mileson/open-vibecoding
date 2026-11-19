import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderPrd } from '../src/prd-html.js';

const firstPhoto = JSON.parse(readFileSync(new URL('./fixtures/prd-camera-first-photo.json', import.meta.url), 'utf8'));

test('renders the classroom PRD as standalone HTML', () => {
  const output = renderPrd(firstPhoto);
  assert.match(output, /<title>轻拍相机 · 首次拍照<\/title>/);
  for (const id of ['goal', 'business', 'scenarios', 'scope', 'flow', 'requirements', 'exceptions', 'tracking', 'non-functional', 'acceptance', 'observation', 'open-items']) {
    assert.ok(output.includes(`<section id="${id}"`), id);
    if (id !== 'observation') assert.ok(output.includes(`href="#${id}"`), id);
  }
  assert.match(output, /拒绝授权后返回首页/);
  assert.match(output, /<blockquote class="goal-quote">/);
  assert.match(output, /<dt>版本<\/dt><dd>1\.3<\/dd>/);
  assert.match(output, /<dt>日期<\/dt><dd>2026-11-18<\/dd>/);
  assert.match(output, /<dt>修订人<\/dt><dd>产品需求维护<\/dd>/);
  assert.match(output, /<dt>修订说明<\/dt>/);
  assert.match(output, /按匿名安装 ID 去重，取首次打开后 24 小时/);
  assert.equal(output.match(/<td>待定<\/td>/g)?.length, 6);
  assert.match(output, /<li>首拍预览成功，首次显示本次拍摄的照片<\/li>/);
  assert.match(output, /首拍预览成功（照片拍摄成功且预览首次显示）的新用户数/);
  assert.match(output, /相机权限结果/);
  assert.match(output, /class="flow-paths"[^]*<h3>已授权<\/h3>[^]*<h3>首次授权 · 允许<\/h3>[^]*<h3>首次拒绝或权限已关闭<\/h3>/);
  assert.match(output, /class="flow-choices"[^]*<h4>返回<\/h4>[^]*回到首页[^]*<h4>前往设置<\/h4>[^]*从首页再次进入取景/);
  for (const { id, name } of firstPhoto.requirements) {
    assert.ok(output.includes(`<tr id="requirement-${id}">`), id);
    assert.ok(output.includes(`<a href="#requirement-${id}">${name}</a>`), id);
  }
  assert.match(output, /<th scope="col">可见反馈<\/th>/);
  assert.match(output, /<th scope="col">必要属性<\/th>/);
  assert.match(output, /<th scope="col">去重规则<\/th>/);
  assert.match(output, /<td>capture_completed<\/td><td>首拍预览成功时上报，须同时满足照片拍摄成功且预览首次显示本次照片/);
  assert.match(output, /href="#acceptance">验收附录/);
  assert.match(output, /快门到首拍预览成功耗时（P95）/);
  assert.match(output, /<th scope="col">确认角色<\/th>/);
  assert.match(output, /支持设备上的首拍预览耗时目标定为多少？/);
  assert.doesNotMatch(output, /分支与恢复/);
  assert.match(output, /画面与刚拍下的照片一致/);
  assert.match(output, /ToC · 用户任务与使用体验/);
  assert.match(output, /href="#scenarios">用户与场景/);
  const audience = output.split('<section id="scenarios"')[1].split('<section id="scope"')[0];
  assert.match(audience, /<h3>ToC · 用户任务与使用体验<\/h3>[^]*id="persona-CAM-USER-01"[^]*首次使用、还不熟悉入口的用户[^]*id="scenario-CAM-S01"[^]*id="scenario-CAM-S02"/);
  const flow = output.split('<section id="flow"')[1].split('<section id="requirements"')[0];
  assert.match(flow, /首次授权 · 允许<\/h3>[^]*href="#scenario-CAM-S01"[^]*首次拒绝或权限已关闭<\/h3>[^]*href="#scenario-CAM-S02"/);
  const acceptance = output.split('<section id="acceptance"')[1];
  for (const { id } of firstPhoto.scenarios) {
    assert.ok(acceptance.includes(`href="#scenario-${id}"`), id);
  }
  assert.doesNotMatch(output, /id="focus"/);
  assert.doesNotMatch(output, /ToB|Agent|\{\{PRD_|<script\b|\bsrc\s*=|href="(?!#)/);
});

test('renders only selected focus groups and omits empty optional sections', () => {
  const output = renderPrd({
    ...firstPhoto,
    personas: undefined, scenarios: ['审批人收到待办'],
    scope: { in: ['订单审批'] },
    flow: { steps: ['提交订单'] },
    focus: { ToB: ['审批者可退回订单'], Agent: ['提交订单前由人工确认'] },
    observation: [],
    requirements: [], exceptions: [], tracking: [], nonFunctional: [], performance: [], openItems: [],
    acceptance: [{ scenario: '订单审批', given: '有待审批订单', when: '批准订单', then: '订单状态更新' }],
    business: undefined, revision: undefined,
  });
  assert.match(output, /ToB · 角色、权限与协作/);
  assert.match(output, /Agent · 输入、执行边界与交接/);
  assert.doesNotMatch(output, /ToC|id="(?:business|observation|requirements|exceptions|tracking|non-functional|open-items)"|class="revision"|本次不包含|其他处理路径/);
  assert.doesNotMatch(renderPrd({ ...firstPhoto, focus: undefined }), /id="focus"/);
});

test('treats data as text and leaves token-like content intact', () => {
  const output = renderPrd({ ...firstPhoto, title: '<img src=x> & {{PRD_CONTENT}}' });
  assert.match(output, /&lt;img src=x&gt; &amp; \{\{PRD_CONTENT\}\}/);
  assert.doesNotMatch(output, /<img\b/);
});

test('reports the field when acceptance criteria or focus data is invalid', () => {
  assert.throws(() => renderPrd({ ...firstPhoto, acceptance: [] }), /acceptance/);
  assert.throws(() => renderPrd({ ...firstPhoto, acceptance: [{ ...firstPhoto.acceptance[0], then: ' ' }] }), /acceptance\[0\]\.then/);
  assert.throws(() => renderPrd({ ...firstPhoto, focus: { other: ['未知类型'] } }), /focus\.other/);
});

test('keeps existing flow, functional, tracking and acceptance input compatible', () => {
  const output = renderPrd({
    ...firstPhoto,
    personas: undefined, scenarios: ['首次打开应用'],
    revision: { version: '1.0', date: '2026-11-18', summary: '创建文档' },
    business: undefined,
    flow: { steps: ['打开 App', '点击拍照入口'], branches: ['拒绝时返回首页'] },
    requirements: [{ name: '拍照入口', priority: 'P0', behavior: '打开相机' }],
    exceptions: undefined,
    tracking: [{ event: 'app_opened', trigger: '打开 App', purpose: '首拍起点' }],
    performance: undefined,
    openItems: ['确认拍照入口位置'],
    acceptance: [{ scenario: '拍照', given: '在首页', when: '点击拍照入口', then: '打开相机' }],
  });
  assert.match(output, /其他处理路径/);
  assert.match(output, /<td>拍照入口<\/td><td>P0<\/td><td>打开相机<\/td>/);
  assert.match(output, /<td>app_opened<\/td><td>打开 App<\/td><td>首拍起点<\/td>/);
  assert.match(output, /<li>确认拍照入口位置<\/li>/);
  assert.match(output, /<li>首次打开应用<\/li>/);
  assert.doesNotMatch(output, /flow-split">|requirement-links">|id="(?:business|exceptions)"|修订人|目标用户与使用场景/);
});

test('renders the three exception paths with linked acceptance cases', () => {
  const output = renderPrd(firstPhoto);
  for (const { trigger, message, recovery } of firstPhoto.exceptions) {
    assert.ok(output.includes(`<td class="table-links"><a href="#requirement-CAM-03">拍照预览</a></td><td>${trigger}</td><td>${message}</td><td>${recovery}</td>`));
  }
  for (const scenario of ['拍摄失败后重新拍摄', '预览加载失败后重试或返回', '连续快门只触发一次拍摄']) {
    assert.ok(output.includes(`<h3>${scenario}</h3><p class="requirement-links"><span>关联需求 <a href="#requirement-CAM-03">`));
  }
  assert.throws(() => renderPrd({
    ...firstPhoto, exceptions: [{ ...firstPhoto.exceptions[0], requirementIds: ['MISSING'] }],
  }), /exceptions\[0\]\.requirementIds.*MISSING/);
});

test('shows filled measurements and hides resolved review items even in mixed input', () => {
  const [pending] = firstPhoto.openItems;
  const resolved = { ...pending, question: '已决定的事项', status: 'resolved' };
  const output = renderPrd({
    ...firstPhoto,
    business: { ...firstPhoto.business, metrics: [{ ...firstPhoto.business.metrics[0], baseline: '40%', target: '45%' }] },
    performance: [{ ...firstPhoto.performance[0], baseline: '900 ms', target: '800 ms' }],
    openItems: [resolved, pending, '保留旧文本待决项'],
  });
  assert.match(output, /<td>40%<\/td><td>45%<\/td>/);
  assert.match(output, /<td>900 ms<\/td><td>800 ms<\/td>/);
  assert.ok(output.includes(`<td>${pending.question}</td><td>${pending.proposal}</td><td>${pending.impact}</td><td>${pending.confirmationRole}</td>`));
  assert.match(output, /保留旧文本待决项/);
  assert.doesNotMatch(output, /已决定的事项/);
  assert.doesNotMatch(renderPrd({ ...firstPhoto, openItems: [resolved] }), /(?:href="#|id=")open-items/);
  assert.throws(() => renderPrd({ ...firstPhoto, openItems: [resolved, '旧待决项', { ...pending, impact: '' }] }),
    /openItems\[2\]\.impact/);
});

test('rejects duplicate requirement IDs and invalid acceptance references', () => {
  assert.throws(() => renderPrd({
    ...firstPhoto, requirements: [firstPhoto.requirements[0], firstPhoto.requirements[0]],
  }), /requirements\[1\]\.id.*CAM-01/);
  assert.throws(() => renderPrd({
    ...firstPhoto, acceptance: [{ ...firstPhoto.acceptance[0], requirementIds: ['MISSING'] }],
  }), /acceptance\[0\]\.requirementIds.*MISSING/);
});

test('groups ToB and Agent scenarios under business and human roles', () => {
  const data = {
    product: '订单审批', title: '审批与提交', goal: '让订单按权限完成审批',
    focus: { ToB: ['主管和财务交接审批结果'], Agent: ['提交前等待人工确认'] },
    personas: [
      { id: 'MANAGER', type: 'ToB', name: '部门主管', responsibilities: '审核所属部门订单', permissions: '只读所属部门订单', handoff: '通过后转交财务' },
      { id: 'REVIEWER', type: 'Agent', name: '财务审批者', responsibilities: '核对金额并授权提交' },
    ],
    scenarios: [
      { id: 'APPROVE', personaId: 'MANAGER', title: '部门内审批', context: '收到部门订单', task: '审批订单', outcome: '财务收到待办' },
      { id: 'SUBMIT', personaId: 'REVIEWER', title: '核对后提交', context: '待办已到财务', task: '核对后提交', outcome: '授权后才提交', agentBoundary: '只整理审批材料', humanHandoff: '金额不一致时交给财务审批者' },
    ],
    scope: { in: ['订单审批'] },
    flow: { steps: ['主管审批', '财务核对'], scenarioIds: ['APPROVE', 'SUBMIT'] },
    acceptance: [{ scenario: '人工确认', given: '准备提交', when: '批准提交', then: '订单提交', scenarioIds: ['SUBMIT'] }],
  };
  const output = renderPrd(data);
  assert.match(output, /ToB · 角色、权限与协作[^]*id="persona-MANAGER"[^]*<dt>权限<\/dt><dd>只读所属部门订单<\/dd>[^]*<dt>协作交接<\/dt>[^]*id="scenario-APPROVE"/);
  assert.match(output, /Agent · 输入、执行边界与交接[^]*id="persona-REVIEWER"[^]*财务审批者[^]*id="scenario-SUBMIT"[^]*<dt>代理执行边界<\/dt><dd>只整理审批材料<\/dd>[^]*<dt>人工接手条件<\/dt>/);
  assert.doesNotMatch(output, /ToC|id="focus"/);
  assert.throws(() => renderPrd({
    ...data, scenarios: [data.scenarios[0], { ...data.scenarios[1], humanHandoff: '' }],
  }), /scenarios\[1\]\.humanHandoff/);
});

test('validates scenario references and the linked persona', () => {
  const [scenario] = firstPhoto.scenarios;
  assert.throws(() => renderPrd({
    ...firstPhoto, scenarios: [{ ...scenario, personaId: 'MISSING' }],
  }), /scenarios\[0\]\.personaId.*MISSING/);
  assert.throws(() => renderPrd({
    ...firstPhoto, flow: { ...firstPhoto.flow, scenarioIds: ['MISSING'] },
  }), /flow\.scenarioIds.*MISSING/);
});
