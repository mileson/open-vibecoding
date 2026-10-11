/* Current brainstorming and diagram output plus read-only historical version output. */
import { formatProductTypeDisplay } from '../product-type-copy.js';

function printBrainstormResult(result, json) {
  if (json) return console.log(JSON.stringify(result, null, 2));
  console.log('脑暴工作台已生成');
  console.log(`主题: ${result.record.topic}`);
  console.log(`推荐方向: ${result.record.summary?.recommendedDirection ?? '待补充'}`);
  console.log(`脑暴页面: ${result.htmlPath}`);
  console.log(`Markdown 数据源: ${result.markdownPath}`);
  console.log(`已自动打开: ${result.opened ? '是' : '否'}`);
}

function printHistoryResult(result, json) {
  if (json) return console.log(JSON.stringify(result, null, 2));
  console.log(`历史版本: ${result.ws.workspaceRoot}`);
  for (const entry of result.versions) {
    console.log(`- ${entry.versionId} | ${entry.title} | ${formatProductTypeDisplay(entry.productType, { fallback: '待确认' })} | ${entry.createdAt}`);
  }
}

function printDiffResult(result, json) {
  if (json) return console.log(JSON.stringify(result.diff, null, 2));
  console.log(`历史差异 ${result.diff.fromVersionId} -> ${result.diff.toVersionId}`);
  console.log(`变更章节: ${result.diff.changedSections.length > 0 ? result.diff.changedSections.join(', ') : '无'}`);
  for (const change of result.diff.changes) {
    console.log(`- ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);
  }
}

function printDiagramResult(result, json) {
  if (json) return console.log(JSON.stringify(result, null, 2));
  console.log(`已生成${result.type === 'product-flow' ? '产品流程' : '架构'}图`);
  console.log(`HTML: ${result.htmlPath}`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`Mermaid: ${result.mermaidPath}`);
  if (result.inputPath) console.log(`输入 contract: ${result.inputPath}`);
  if (result.marked) console.log(`评审状态: ${result.marked}`);
  console.log(`已打开: ${result.opened ? '是' : '否'}`);
}

export { printBrainstormResult, printHistoryResult, printDiffResult, printDiagramResult };
