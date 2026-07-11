function printTaskRuntimeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.ok) {
    console.log(`OpenPrd 并行任务运行时：未完成（${result.error?.code ?? 'unknown'}）`);
    console.log(result.error?.message ?? '运行时操作失败。');
    return;
  }
  console.log(`OpenPrd 并行任务运行时：${result.action.replace(/^runtime-/, '')}`);
  if (result.laneId) console.log(`处理通道：${result.laneId}`);
  if (result.taskId) console.log(`任务：${result.taskId}`);
  const task = result.result?.task;
  if (task) {
    console.log(`状态：${task.status}`);
    console.log(`修订：${task.revision}`);
    if (task.claim?.leaseExpiresAt) console.log(`占用有效期至：${task.claim.leaseExpiresAt}`);
  } else if (Array.isArray(result.result)) {
    console.log(`处理通道数：${result.result.length}`);
  }
}

export { printTaskRuntimeResult };
