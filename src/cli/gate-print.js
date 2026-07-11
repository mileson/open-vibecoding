function printGateResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.ok) {
    console.log(`OpenPrd 操作门禁：未完成（${result.error?.code ?? 'unknown'}）`);
    console.log(result.error?.message ?? '门禁操作失败。');
    return;
  }
  const status = result.result?.status;
  console.log(`OpenPrd 操作门禁：${status === 'pass' ? '通过' : status === 'blocked' ? '已阻断' : '已记录'}`);
  if (result.result?.decisionId) console.log(`决策编号：${result.result.decisionId}`);
  for (const reason of result.result?.reasons ?? []) console.log(`- ${reason.code}`);
}

export { printGateResult };
