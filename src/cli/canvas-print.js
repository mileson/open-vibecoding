/*
 * Core purpose
 * Print user-facing output for `openprd canvas`.
 *
 * Inputs
 * Receives the canvas workspace result.
 *
 * Outputs
 * Emits either JSON or concise terminal text with the local URL, binding, and
 * archive paths.
 *
 * Positioning
 * CLI presentation layer only; all service and session logic stays in
 * canvas-workspace.js.
 *
 * Maintenance rules
 * Keep output copy user-facing. Do not expose internal API details unless the
 * command is explicitly in JSON mode.
 */
import { toPrintableCanvasResult } from '../canvas-workspace.js';

function printCanvasResult(result, asJson = false) {
  const printable = toPrintableCanvasResult(result);
  if (asJson) {
    console.log(JSON.stringify(printable, null, 2));
    return;
  }

  if (!printable?.ok) {
    console.log('OpenPrd 画布启动失败。');
    return;
  }

  if (printable.action === 'canvas-stop') {
    console.log(printable.stopped ? 'OpenPrd 画布后台服务已停止。' : 'OpenPrd 画布后台服务未在运行。');
    const stopBinding = printable.session?.binding ?? {};
    console.log(`绑定: ${stopBinding.kind ?? 'session'} ${stopBinding.displayId ?? stopBinding.id ?? printable.session?.sessionKey}`);
    console.log(`目录: ${printable.paths?.sessionDir}`);
    return;
  }

  if (printable.action === 'canvas-agent-bridge') {
    const binding = printable.session?.binding ?? {};
    if (printable.bridgeAction === 'outbox') {
      console.log(`待 Codex Agent 前台接力: ${printable.pending?.length ?? 0} 条。`);
      if ((printable.pending?.length ?? 0) > 0) {
        console.log('下一步: Agent 使用 --claim next 领取后，调用 Codex 线程工具发送，再用 --bridge-sent 回写。');
      }
    } else if (printable.bridgeAction === 'claim') {
      console.log(printable.item ? '已认领一条 Codex 前台接力任务。' : '没有可认领的 Codex 前台接力任务。');
      if (printable.item) {
        console.log(`目标线程: ${printable.item.threadId}`);
        console.log('下一步: 调用 codex_app.send_message_to_thread 发送返回的 prompt。');
      }
    } else if (printable.bridgeAction === 'sent') {
      console.log('已标记 Codex 前台接力完成。');
    } else if (printable.bridgeAction === 'failed') {
      console.log('已标记 Codex 前台接力失败。');
    }
    console.log(`绑定: ${binding.kind ?? 'session'} ${binding.displayId ?? binding.id ?? printable.session?.sessionKey}`);
    console.log(`目录: ${printable.paths?.sessionDir}`);
    return;
  }

  if (printable.dryRun) {
    console.log('OpenPrd 画布会话检查完成。');
  } else if (printable.daemon && printable.alreadyRunning) {
    console.log('OpenPrd 画布后台服务已在运行。');
  } else if (printable.daemon) {
    console.log('OpenPrd 画布后台服务已启动。');
  } else {
    console.log('OpenPrd 画布已启动。');
  }
  if (printable.url) {
    console.log(`地址: ${printable.url}`);
  }
  if (printable.pid) {
    console.log(`进程: ${printable.pid}`);
  }
  if (printable.logPath) {
    console.log(`日志: ${printable.logPath}`);
  }
  if (printable.openResult) {
    const labels = {
      'codex-browser': 'Codex 右侧 Browser',
      system: '系统默认浏览器',
    };
    const label = labels[printable.openResult.target] ?? printable.openResult.target;
    console.log(`打开方式: ${label}`);
    if (printable.openResult.status === 'requires-agent-browser') {
      console.log('提醒: 当前命令不会打开系统浏览器；请由 Codex Agent 使用右侧 Browser 打开上面的地址。');
    }
  }
  const binding = printable.session?.binding ?? {};
  console.log(`绑定: ${binding.kind ?? 'session'} ${binding.displayId ?? binding.id ?? printable.session?.sessionKey}`);
  console.log(`来源: ${binding.source ?? 'unknown'} (${binding.confidence ?? 'unknown'})`);
  if (binding.note) {
    console.log(`提醒: ${binding.note}`);
  }
  console.log(`目录: ${printable.paths?.sessionDir}`);
  if (!printable.dryRun && !printable.daemon) {
    console.log('保持该命令运行即可继续协同；结束时按 Ctrl+C。');
  }
}

export { printCanvasResult };
