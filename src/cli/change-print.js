/* Read-only historical change, spec, and task output. */

function printOpenSpecChangeValidationResult(result, json) {
  if (json) return console.log(JSON.stringify(result, null, 2));
  console.log(`历史 change 验证: ${result.valid ? '通过' : '失败'}`);
  console.log(`Change: ${result.changeId}`);
  for (const check of result.checks) console.log(`- ${check}`);
  for (const error of result.errors) console.log(`错误: ${error}`);
  for (const warning of result.warnings) console.log(`警告: ${warning}`);
}

function printOpenSpecTaskResult(result, json) {
  if (json) return console.log(JSON.stringify(result, null, 2));
  console.log(`历史任务: ${result.changeId}`);
  console.log(`既有记录: ${result.summary.completed}/${result.summary.total} 已完成，${result.summary.pending} 待处理`);
  for (const task of result.tasks) {
    console.log(`- [${task.checked ? 'x' : ' '}] ${task.id} ${task.title}`);
  }
}

function printOpenPrdChangesResult(result, json) {
  if (json) return console.log(JSON.stringify(result, null, 2));
  console.log(`历史 changes: ${result.changes.length}`);
  for (const change of result.changes) {
    console.log(`- ${change.id} | ${change.status} | ${change.source}`);
  }
}

function printAcceptedSpecsResult(result, json) {
  if (json) return console.log(JSON.stringify(result, null, 2));
  console.log(`历史 accepted specs: ${result.specs.length}`);
  for (const spec of result.specs) {
    console.log(`- ${spec.capability}: ${spec.specPath}`);
  }
}

export {
  printOpenSpecChangeValidationResult,
  printOpenSpecTaskResult,
  printOpenPrdChangesResult,
  printAcceptedSpecsResult,
};
