import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCommandArgs } from '../src/cli/args.js';
import { renderCanvasAppHtml } from '../src/canvas-app.html.js';
import { defaultCanvasLocaleForLanguages, normalizeCanvasLocale } from '../src/canvas-i18n.js';
import { canvasWorkspace, resolveCanvasOpenTarget, resolveCanvasSessionBinding, resolveDownloadsFolderTarget, resolveOpenFolderTarget } from '../src/canvas-workspace.js';

async function makeTempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openprd-canvas-'));
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test('canvas command parses explicit thread, daemon, and session flags', () => {
  const { flags, positionals } = parseCommandArgs(['.', '--thread', 'codex-thread-1', '--thread-title', '梳理 Codex 专属能力', '--session', 'fallback-session', '--session-title', 'Fallback Canvas', '--port', '4767', '--host', '127.0.0.1', '--daemon', '--open-target', 'codex-browser']);
  assert.deepEqual(positionals, ['.']);
  assert.equal(flags.thread, 'codex-thread-1');
  assert.equal(flags.threadTitle, '梳理 Codex 专属能力');
  assert.equal(flags.conversationTitle, '梳理 Codex 专属能力');
  assert.equal(flags.session, 'fallback-session');
  assert.equal(flags.sessionTitle, 'Fallback Canvas');
  assert.equal(flags.port, '4767');
  assert.equal(flags.host, '127.0.0.1');
  assert.equal(flags.daemon, true);
  assert.equal(flags.openTarget, 'codex-browser');
});

test('canvas command parses Codex Agent bridge flags', () => {
  const { flags, positionals } = parseCommandArgs(['canvas', '.', '--thread', 'codex-thread-1', '--bridge-outbox', '--claim', 'next', '--bridge-sent', '--id', 'bridge-1', '--reason', 'sent from test', '--json']);
  assert.deepEqual(positionals, ['canvas', '.']);
  assert.equal(flags.thread, 'codex-thread-1');
  assert.equal(flags.bridgeOutbox, true);
  assert.equal(flags.claim, 'next');
  assert.equal(flags.bridgeSent, true);
  assert.equal(flags.id, 'bridge-1');
  assert.equal(flags.reason, 'sent from test');
  assert.equal(flags.json, true);
});

test('canvas app maps all browser module dependencies needed by Excalidraw', () => {
  const html = renderCanvasAppHtml({
    sessionKey: 'unit-session',
    binding: {
      kind: 'session',
      displayId: 'unit-session',
      source: 'unit-test',
    },
    paths: {
      sessionDir: '/tmp/openprd-canvas/unit-session',
    },
  });

  assert.match(html, /"react\/jsx-runtime": "https:\/\/esm\.sh\/react@18\.3\.1\/jsx-runtime"/);
  assert.match(html, /"react-dom": "https:\/\/esm\.sh\/react-dom@18\.3\.1"/);
  assert.match(html, /__openprdCanvasBootError/);
  assert.match(html, /openprd-canvas-locale/);
  assert.match(html, /openprd-canvas-rail-actions/);
  assert.match(html, /openprd-canvas-save/);
  assert.match(html, /openprd-canvas-export-image/);
  assert.match(html, /导出文件/);
  assert.match(html, /Export file/);
  assert.match(html, /导出图片/);
  assert.match(html, /Export image/);
  assert.match(html, /m21 16-5-5-4 4-2-2-5 5/);
  assert.doesNotMatch(html, /m7 10 5 5 5-5/);
  assert.match(html, /openprd-canvas-reset/);
  assert.match(html, /openprd-canvas-action-status/);
  assert.match(html, /openprd-canvas-open-folder/);
  assert.match(html, /rail-action-grid/);
  assert.match(html, /openprd-canvas-personal-library/);
  assert.match(html, /openprd-canvas-library-item/);
  assert.match(html, /openprd-canvas-blank-card/);
  assert.match(html, /openprd-canvas-ai-templates/);
  assert.match(html, /openprd-canvas-ai-template-/);
  assert.match(html, /openprd-canvas-image-composer/);
  assert.match(html, /openprd-canvas-image-prompt/);
  assert.match(html, /openprd-canvas-create-ai-image/);
  assert.match(html, /openprd-canvas-send-codex/);
  assert.match(html, /openprd-canvas-download-image/);
  assert.match(html, /download-selected-image/);
  assert.match(html, /openprd-canvas-thread-summary/);
  assert.match(html, /openprd-canvas-copy-thread/);
  assert.match(html, /thread-id-row/);
  assert.match(html, /thread-copy-button/);
  assert.match(html, /复制线程指令/);
  assert.match(html, /Copy thread prompt/);
  assert.match(html, /已复制线程指令/);
  assert.match(html, /Thread prompt copied/);
  assert.match(html, /请在 Codex 中定位并操作这个 OpenPrd 画布绑定的对话线程/);
  assert.match(html, /openprd-canvas-composer/);
  assert.match(html, /codex-handoff/);
  assert.match(html, /\/api\/handoffs/);
  assert.match(html, /canvas-ai-image-template/);
  assert.match(html, /agentBridge: true/);
  assert.match(html, /relay: true/);
  assert.match(html, /sentBodyAgentBridge/);
  assert.match(html, /imageRequestAgentBridge/);
  assert.match(html, /agent-foreground-relay/);
  assert.match(html, /op\.type === "handoff-relay"/);
  assert.match(html, /syncCodexRelayStatus/);
  assert.match(html, /op\.dryRun/);
  assert.doesNotMatch(html, /setInterval\(readAgentBridgeOutbox/);
  assert.match(html, /relayWaitMs: codexRelayStartWaitMs/);
  assert.match(html, /function relayWasAccepted/);
  assert.match(html, /codexRelayCompletedStatuses/);
  assert.match(html, /"started"\]\.includes\(status\)/);
  assert.doesNotMatch(html, /前台委托消息发送/);
  assert.doesNotMatch(html, /foreground Codex delegation/);
  assert.match(html, /openprd-ai-group/);
  assert.match(html, /groupIds: \[groupId\]/);
  assert.match(html, /Object\.fromEntries\(elements\.map\(\(element\) => \[element\.id, true\]\)\)/);
  assert.match(html, /function groupIdsForElement/);
  assert.match(html, /hiddenGroupIds/);
  assert.match(html, /sharesTargetParent/);
  assert.match(html, /\/api\/library/);
  assert.match(html, /\/api\/open-folder/);
  assert.match(html, /\/api\/open-download/);
  assert.match(html, /\/api\/clipboard/);
  assert.match(html, /\/api\/download-file/);
  assert.match(html, /\/api\/download-image/);
  assert.match(html, /\/api\/agent-bridge/);
  assert.match(html, /agentBridgePendingMessage/);
  assert.match(html, /onLibraryChange/);
  assert.match(html, /libraryItems/);
  assert.match(html, /codex-app-server-codex-delegation-turn-start/);
  assert.doesNotMatch(html, /codex-thread-tool-or-clipboard/);
  assert.match(html, /ai-image-placeholder/);
  assert.doesNotMatch(html, /\/api\/image-requests/);
  assert.doesNotMatch(html, /data-testid": "openprd-canvas-handoff"/);
  assert.ok(html.includes('replace(/\\{(\\w+)\\}/g,'));
  assert.doesNotMatch(html, /export: true/);
  assert.match(html, /export: \{\s+saveFileToDisk: true,\s+\}/);
  assert.match(html, /serializeAsJSON/);
  assert.doesNotMatch(html, /openSidebar: "library"/);
  assert.match(html, /\[data-testid="main-menu-trigger"\]/);
  assert.match(html, /\[data-testid="library-button"\]/);
  assert.match(html, /\.default-sidebar-trigger/);
  assert.match(html, /\.sidebar-trigger__label-element/);
  assert.match(html, /grid-template-columns: minmax\(0, 1fr\) 232px/);
  assert.match(html, /border-left: 1px solid var\(--line\)/);
  assert.doesNotMatch(html, /openprd-canvas-open-library/);
  assert.doesNotMatch(html, /rgba\(255,\s*253,\s*249/);
  assert.match(html, /\.selection-sendbar \.text-button/);
  assert.match(html, /min-width: 118px/);
  assert.match(html, /\.selection-sendbar \.primary-button/);
  assert.doesNotMatch(html, /h\("span", null, t\.sendBarHint\)/);
  assert.match(html, /language-select:focus/);
  assert.doesNotMatch(html, /openprd-canvas-shimmer/);
  assert.match(html, /background: #ecfdf5/);
  assert.match(html, /color: #333333/);
  assert.match(html, /let syncSelectionState = \(\) => \{\};/);
  const updateSceneStart = html.indexOf('function updateScene(');
  const updateSceneEnd = html.indexOf('function createAiImageCard', updateSceneStart);
  assert.notEqual(updateSceneStart, -1);
  assert.notEqual(updateSceneEnd, -1);
  const updateSceneSource = html.slice(updateSceneStart, updateSceneEnd);
  assert.match(updateSceneSource, /syncSelectionState\(latestAppState, latestElements\)/);
  assert.doesNotMatch(updateSceneSource, /setSelectedCount/);
  assert.doesNotMatch(updateSceneSource, /setSelectedImageCount/);
});

test('canvas open target resolves Codex Browser only from explicit target or runtime evidence', () => {
  const explicit = resolveCanvasOpenTarget({ binding: {} }, { openTarget: 'codex-browser' }, {});
  assert.equal(explicit.target, 'codex-browser');
  assert.equal(explicit.reason, 'explicit-open-target');

  const fallback = resolveCanvasOpenTarget({ binding: {} }, {}, {});
  assert.equal(fallback.target, 'system');
  assert.equal(fallback.reason, 'no-codex-browser-evidence');

  const detected = resolveCanvasOpenTarget({
    binding: {
      activeClient: 'codex',
      surface: 'codex-desktop',
      observedCapabilities: ['tool-surface:browser'],
    },
  }, {}, {});
  assert.equal(detected.target, 'codex-browser');
  assert.equal(detected.reason, 'runtime-evidence');
});

test('canvas locale defaults to Chinese unless browser language is English', () => {
  assert.equal(normalizeCanvasLocale('zh-Hans-CN'), 'zh-CN');
  assert.equal(normalizeCanvasLocale('en-US'), 'en');
  assert.equal(normalizeCanvasLocale('fr-FR'), 'zh-CN');
  assert.equal(defaultCanvasLocaleForLanguages(['fr-FR', 'en-US']), 'zh-CN');
  assert.equal(defaultCanvasLocaleForLanguages(['en-US', 'zh-CN']), 'en');
});

test('canvas session binding prefers explicit thread and creates isolated paths', async () => {
  const project = await makeTempProject();
  const binding = await resolveCanvasSessionBinding(project, { thread: 'thread/with unsafe chars', threadTitle: '梳理 Codex 专属能力' }, {});
  assert.equal(binding.kind, 'thread');
  assert.equal(binding.id, 'thread/with unsafe chars');
  assert.equal(binding.displayId, 'thread/with unsafe chars');
  assert.equal(binding.title, '梳理 Codex 专属能力');
  assert.equal(binding.threadTitle, '梳理 Codex 专属能力');
  assert.equal(binding.source, 'flag:thread');
  assert.match(binding.sessionKey, /^thread-thread-with-unsafe-chars-/);

  const result = await canvasWorkspace(project, { thread: 'thread/with unsafe chars', dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.session.binding.kind, 'thread');
  assert.equal(result.session.binding.source, 'flag:thread');
  assert.match(result.paths.sessionDir, /canvas-sessions[/\\]thread-thread-with-unsafe-chars-/);
  assert.equal(await fs.stat(result.paths.sceneFile).then((stat) => stat.isFile()), true);
  assert.equal(await fs.stat(result.paths.opsFile).then((stat) => stat.isFile()), true);
  assert.equal(await fs.stat(result.paths.libraryFile).then((stat) => stat.isFile()), true);
  const scene = JSON.parse(await fs.readFile(result.paths.sceneFile, 'utf8'));
  assert.equal(scene.appState.viewBackgroundColor, '#ffffff');
  const library = JSON.parse(await fs.readFile(result.paths.libraryFile, 'utf8'));
  assert.equal(library.type, 'excalidrawlib');
  assert.equal(library.version, 2);
  assert.deepEqual(library.libraryItems, []);
});

test('canvas session binding preserves existing display title when querying by thread only', async () => {
  const project = await makeTempProject();
  const created = await canvasWorkspace(project, {
    thread: 'codex-thread-title-preserve',
    threadTitle: '梳理 Codex 专属能力',
    dryRun: true,
  });
  assert.equal(created.session.binding.title, '梳理 Codex 专属能力');
  assert.equal(created.session.binding.threadTitle, '梳理 Codex 专属能力');

  const queried = await canvasWorkspace(project, {
    thread: 'codex-thread-title-preserve',
    bridgeOutbox: true,
  });
  assert.equal(queried.ok, true);
  assert.equal(queried.session.binding.id, 'codex-thread-title-preserve');
  assert.equal(queried.session.binding.title, '梳理 Codex 专属能力');
  assert.equal(queried.session.binding.threadTitle, '梳理 Codex 专属能力');
});

test('canvas session binding reads runtime thread title when available', async () => {
  const project = await makeTempProject();
  const harnessDir = path.join(project, '.openprd', 'harness');
  await fs.mkdir(harnessDir, { recursive: true });
  await fs.writeFile(path.join(harnessDir, 'runtime-environment.json'), JSON.stringify({
    active: {
      activeClient: 'codex',
      surface: 'codex-desktop',
      threadId: '019ee3af-3b76-7842-98b9-addf6902d110',
      threadTitle: '梳理 Codex 专属能力',
    },
    observedCapabilities: ['tool-surface:browser'],
  }, null, 2));

  const binding = await resolveCanvasSessionBinding(project, {}, {});
  assert.equal(binding.kind, 'thread');
  assert.equal(binding.id, '019ee3af-3b76-7842-98b9-addf6902d110');
  assert.equal(binding.displayId, '019ee3af-3b76-7842-98b9-addf6902d110');
  assert.equal(binding.title, '梳理 Codex 专属能力');
  assert.equal(binding.threadTitle, '梳理 Codex 专属能力');
  assert.equal(binding.source, 'runtime-environment:thread');
  assert.equal(binding.activeClient, 'codex');
  assert.equal(binding.surface, 'codex-desktop');
  assert.match(binding.sessionKey, /^thread-019ee3af-3b76-7842-98b9-addf6902d110-/);
});

test('canvas local service normalizes legacy warm scene backgrounds to white', async () => {
  const project = await makeTempProject();
  const prepared = await canvasWorkspace(project, { session: 'legacy-background-test', dryRun: true });
  await fs.writeFile(prepared.paths.sceneFile, JSON.stringify({
    type: 'openprd.canvas.scene.v1',
    elements: [],
    appState: { viewBackgroundColor: '#fbfaf7' },
    files: {},
  }, null, 2));

  const result = await canvasWorkspace(project, { session: 'legacy-background-test', port: 0 });
  try {
    const sceneResponse = await fetch(`${result.url}api/scene`);
    assert.equal(sceneResponse.ok, true);
    const scene = await sceneResponse.json();
    assert.equal(scene.appState.viewBackgroundColor, '#ffffff');
  } finally {
    await closeServer(result.server);
  }
});

test('canvas local service stores images as conversation-scoped operations', async () => {
  const project = await makeTempProject();
  const result = await canvasWorkspace(project, { thread: 'thread-service-test', port: 0 });
  try {
    const sessionResponse = await fetch(`${result.url}api/session`);
    assert.equal(sessionResponse.ok, true);
    const session = await sessionResponse.json();
    assert.equal(session.binding.id, 'thread-service-test');

    const imageResponse = await fetch(`${result.url}api/images`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        aspectRatio: 1,
        note: 'unit-test',
      }),
    });
    assert.equal(imageResponse.ok, true);
    const imageResult = await imageResponse.json();
    assert.equal(imageResult.ok, true);
    assert.equal(imageResult.operation.type, 'image');
    assert.match(imageResult.asset.assetPath, /canvas-sessions[/\\]thread-thread-service-test-/);

    const opsResponse = await fetch(`${result.url}api/ops?after=-1`);
    const ops = await opsResponse.json();
    assert.equal(ops.ops.length, 1);
    assert.equal(ops.ops[0].type, 'image');
    assert.equal(ops.ops[0].note, 'unit-test');
  } finally {
    await closeServer(result.server);
  }
});

test('canvas local service exposes structured selection and anchored image insertion', async () => {
  const project = await makeTempProject();
  const result = await canvasWorkspace(project, { session: 'structured-tools-test', port: 0 });
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  try {
    const sceneResponse = await fetch(`${result.url}api/scene`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'openprd.canvas.scene.v1',
        elements: [
          {
            id: 'img-1',
            type: 'image',
            x: 100,
            y: 200,
            width: 320,
            height: 240,
            fileId: 'file-img-1',
            isDeleted: false,
          },
          {
            id: 'note-1',
            type: 'freedraw',
            x: 150,
            y: 260,
            width: 80,
            height: 40,
            isDeleted: false,
          },
          {
            id: 'other-1',
            type: 'rectangle',
            x: 900,
            y: 900,
            width: 50,
            height: 50,
            isDeleted: false,
          },
        ],
        appState: {
          selectedElementIds: { 'img-1': true, 'note-1': true },
        },
        files: {},
      }),
    });
    assert.equal(sceneResponse.ok, true);

    const selectionResponse = await fetch(`${result.url}api/selection`);
    assert.equal(selectionResponse.ok, true);
    const selection = await selectionResponse.json();
    assert.equal(selection.ok, true);
    assert.equal(selection.count, 2);
    assert.deepEqual(selection.elements.map((element) => element.id).sort(), ['img-1', 'note-1']);
    const imageSummary = selection.elements.find((element) => element.id === 'img-1');
    assert.equal(imageSummary.type, 'image');
    assert.equal(imageSummary.fileId, 'file-img-1');
    assert.deepEqual(selection.bounds, { x: 100, y: 200, width: 320, height: 240 });

    const insertResponse = await fetch(`${result.url}api/insert-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dataUrl: tinyPng,
        anchorElementId: 'img-1',
        placement: 'right',
        note: 'annotation-edit-revision',
        sizeContract: { width: 320, height: 240, aspectRatio: 320 / 240 },
      }),
    });
    assert.equal(insertResponse.ok, true);
    const inserted = await insertResponse.json();
    assert.equal(inserted.ok, true);
    assert.equal(inserted.operation.type, 'image');
    assert.equal(inserted.operation.anchorElementId, 'img-1');
    assert.equal(inserted.operation.placement, 'right');
    assert.equal(inserted.operation.note, 'annotation-edit-revision');
    assert.deepEqual(inserted.operation.box, { x: 468, y: 200, width: 320, height: 240 });
    assert.equal(inserted.operation.sizeContract.width, 320);
    assert.equal(inserted.operation.sizeContract.height, 240);
    assert.equal(inserted.anchor.id, 'img-1');
    assert.match(inserted.asset.assetPath, /canvas-sessions/);

    const missingAnchorResponse = await fetch(`${result.url}api/insert-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dataUrl: tinyPng,
        anchorElementId: 'does-not-exist',
      }),
    });
    assert.equal(missingAnchorResponse.status, 404);
  } finally {
    await closeServer(result.server);
  }
});

test('canvas local service keeps annotation-edit metadata and size contract on handoffs', async () => {
  const project = await makeTempProject();
  const result = await canvasWorkspace(project, { thread: 'annotation-edit-test', port: 0 });
  try {
    const handoffResponse = await fetch(`${result.url}api/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'codex',
        relayDryRun: true,
        promptText: '请按标注修改这张图，并把新图放到原图旁边。',
        instruction: '按红圈标注修改',
        selection: 'annotation-edit',
        selectedElementIds: ['img-1', 'note-1'],
        sourceImageElementIds: ['img-1'],
        annotationElementIds: ['note-1'],
        sizeContract: { width: 480, height: 270, aspectRatio: 16 / 9 },
        elementCount: 2,
        locale: 'zh-CN',
        note: 'canvas-annotation-edit',
      }),
    });
    assert.equal(handoffResponse.ok, true);
    const handoffResult = await handoffResponse.json();
    assert.equal(handoffResult.ok, true);
    assert.equal(handoffResult.operation.selection, 'annotation-edit');
    assert.deepEqual(handoffResult.operation.sourceImageElementIds, ['img-1']);
    assert.deepEqual(handoffResult.operation.annotationElementIds, ['note-1']);
    assert.equal(handoffResult.operation.sizeContract.width, 480);
    assert.equal(handoffResult.operation.sizeContract.height, 270);
    assert.equal(handoffResult.operation.note, 'canvas-annotation-edit');
  } finally {
    await closeServer(result.server);
  }
});

test('canvas local service stores Excalidraw library items and resolves download targets safely', async () => {
  const project = await makeTempProject();
  const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-canvas-downloads-'));
  const previousDownloadDir = process.env.OPENPRD_DOWNLOADS_DIR;
  process.env.OPENPRD_DOWNLOADS_DIR = downloadDir;
  const result = await canvasWorkspace(project, { session: 'library-save-test', port: 0 });
  let downloadPath = null;
  try {
    const libraryItem = {
      id: 'lib-shape-1',
      status: 'unpublished',
      created: 123,
      name: 'Shape card',
      elements: [{
        id: 'shape-1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 120,
        height: 80,
        isDeleted: false,
      }],
      previewDataUrl: 'data:image/png;base64,ignored',
    };
    const libraryResponse = await fetch(`${result.url}api/library`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'excalidrawlib',
        version: 2,
        libraryItems: [libraryItem],
        locale: 'zh-CN',
      }),
    });
    assert.equal(libraryResponse.ok, true);
    const libraryResult = await libraryResponse.json();
    assert.equal(libraryResult.type, 'excalidrawlib');
    assert.equal(libraryResult.version, 2);
    assert.equal(libraryResult.libraryItems.length, 1);
    assert.equal(libraryResult.libraryItems[0].id, 'lib-shape-1');
    assert.equal(libraryResult.libraryItems[0].status, 'unpublished');
    assert.equal(libraryResult.libraryItems[0].previewDataUrl, undefined);

    const storedLibrary = JSON.parse(await fs.readFile(result.paths.libraryFile, 'utf8'));
    assert.equal(storedLibrary.type, 'excalidrawlib');
    assert.deepEqual(storedLibrary.libraryItems, libraryResult.libraryItems);

    const downloadName = `manual-save-${process.pid}-${Date.now()}.excalidraw`;
    const downloadResponse = await fetch(`${result.url}api/download-file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: downloadName,
        content: '{"type":"excalidraw","version":2}',
      }),
    });
    assert.equal(downloadResponse.ok, true);
    const downloadResult = await downloadResponse.json();
    assert.equal(downloadResult.file.fileName, downloadName);
    assert.equal(downloadResult.file.folderPath, downloadDir);
    downloadPath = downloadResult.file.filePath;
    assert.equal(await fs.readFile(downloadResult.file.filePath, 'utf8'), '{"type":"excalidraw","version":2}');

    const exportedPath = path.join(result.paths.exportsDir, 'manual-export.png');
    await fs.writeFile(exportedPath, 'png');
    const target = await resolveOpenFolderTarget(result.session, exportedPath);
    assert.equal(target.isFile, true);
    assert.equal(target.folderPath, result.paths.exportsDir);
    await assert.rejects(
      () => resolveOpenFolderTarget(result.session, path.join(os.tmpdir(), 'outside-openprd-canvas.excalidraw')),
      /outside this canvas session|does not exist/,
    );
    const downloadsTarget = await resolveDownloadsFolderTarget(downloadName);
    assert.equal(downloadsTarget.folderPath, downloadDir);
    assert.equal(downloadsTarget.fileName, downloadName);
    assert.equal(downloadsTarget.isFile, true);
    await assert.rejects(
      () => resolveDownloadsFolderTarget('../manual-save.excalidraw'),
      /Invalid download filename/,
    );
  } finally {
    if (previousDownloadDir == null) {
      delete process.env.OPENPRD_DOWNLOADS_DIR;
    } else {
      process.env.OPENPRD_DOWNLOADS_DIR = previousDownloadDir;
    }
    if (downloadPath) {
      await fs.rm(downloadPath, { force: true });
    }
    await fs.rm(downloadDir, { force: true, recursive: true });
    await closeServer(result.server);
  }
});

test('canvas local service stores export handoff metadata', async () => {
  const project = await makeTempProject();
  const result = await canvasWorkspace(project, { session: 'export-handoff-test', port: 0 });
  try {
    const exportResponse = await fetch(`${result.url}api/exports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        filename: 'codex-selection-test.png',
        selection: 'selected',
        intent: 'codex-handoff',
        elementCount: 2,
        selectedElementIds: ['shape-1', 'shape-2'],
        locale: 'zh-CN',
      }),
    });
    assert.equal(exportResponse.ok, true);
    const exportResult = await exportResponse.json();
    assert.equal(exportResult.ok, true);
    assert.equal(exportResult.operation.type, 'export');
    assert.equal(exportResult.operation.intent, 'codex-handoff');
    assert.equal(exportResult.operation.elementCount, 2);
    assert.deepEqual(exportResult.operation.selectedElementIds, ['shape-1', 'shape-2']);
    assert.equal(exportResult.operation.locale, 'zh-CN');
    assert.match(exportResult.export.exportPath, /codex-selection-test\.png$/);
  } finally {
    await closeServer(result.server);
  }
});

test('canvas local service downloads exported images to the Downloads folder', async () => {
  const project = await makeTempProject();
  const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-canvas-image-downloads-'));
  const previousDownloadDir = process.env.OPENPRD_DOWNLOADS_DIR;
  process.env.OPENPRD_DOWNLOADS_DIR = downloadDir;
  const result = await canvasWorkspace(project, { thread: 'codex-image-download-test', port: 0 });
  try {
    const exportResponse = await fetch(`${result.url}api/exports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        filename: 'selected-image-test.png',
        selection: 'selected',
        intent: 'download-selected-image',
        elementCount: 1,
        selectedElementIds: ['image-1'],
        locale: 'zh-CN',
      }),
    });
    assert.equal(exportResponse.ok, true);
    const exportResult = await exportResponse.json();

    const downloadResponse = await fetch(`${result.url}api/download-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: exportResult.export.exportPath,
        filename: 'selected-image-test.png',
      }),
    });
    assert.equal(downloadResponse.ok, true);
    const downloadResult = await downloadResponse.json();
    assert.equal(downloadResult.file.fileName, 'selected-image-test.png');
    assert.equal(downloadResult.file.folderPath, downloadDir);
    assert.equal(await fs.stat(downloadResult.file.filePath).then((stat) => stat.isFile()), true);

    const outsideResponse = await fetch(`${result.url}api/download-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: path.join(os.tmpdir(), 'outside-selected-image.png'),
        filename: 'outside-selected-image.png',
      }),
    });
    assert.equal(outsideResponse.status, 403);
  } finally {
    if (previousDownloadDir == null) {
      delete process.env.OPENPRD_DOWNLOADS_DIR;
    } else {
      process.env.OPENPRD_DOWNLOADS_DIR = previousDownloadDir;
    }
    await fs.rm(downloadDir, { force: true, recursive: true });
    await closeServer(result.server);
  }
});

test('canvas local service records Codex handoff relay prompts', async () => {
  const project = await makeTempProject();
  const result = await canvasWorkspace(project, { thread: 'codex-thread-relay-test', port: 0 });
  try {
    const exportResponse = await fetch(`${result.url}api/exports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        filename: 'codex-thread-relay.png',
        selection: 'selected',
        intent: 'codex-handoff',
        elementCount: 1,
        selectedElementIds: ['shape-1'],
        locale: 'zh-CN',
      }),
    });
    const exportResult = await exportResponse.json();

    const promptText = [
      '请按截图里的红框优化布局。',
      '',
      '请基于这张 OpenPrd 画布选区继续协同分析或修改：',
      '',
      `![OpenPrd Canvas selection](${exportResult.export.exportPath})`,
      '',
      exportResult.export.exportPath,
    ].join('\n');

    const handoffResponse = await fetch(`${result.url}api/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'codex',
        transport: 'codex-app-server-codex-delegation-turn-start',
        relayDryRun: true,
        exportOperationId: exportResult.operation.id,
        exportPath: exportResult.export.exportPath,
        exportUrl: exportResult.export.exportUrl,
        promptText,
        instruction: '请按截图里的红框优化布局。',
        selection: 'selected',
        elementCount: 1,
        selectedElementIds: ['shape-1'],
        locale: 'zh-CN',
      }),
    });
    assert.equal(handoffResponse.ok, true);
    const handoffResult = await handoffResponse.json();
    assert.equal(handoffResult.ok, true);
    assert.equal(handoffResult.operation.type, 'handoff');
    assert.equal(handoffResult.operation.target, 'codex');
    assert.equal(handoffResult.operation.transport, 'codex-app-server-codex-delegation-turn-start');
    assert.equal(handoffResult.operation.exportOperationId, exportResult.operation.id);
    assert.equal(handoffResult.operation.promptText, promptText);
    assert.equal(handoffResult.operation.instruction, '请按截图里的红框优化布局。');
    assert.equal(handoffResult.operation.binding.kind, 'thread');
    assert.equal(handoffResult.operation.binding.id, 'codex-thread-relay-test');
    assert.equal(handoffResult.relay.status, 'queued');
    assert.equal(handoffResult.relay.dryRun, true);
    assert.equal(handoffResult.relay.pending, true);
    assert.equal(handoffResult.relay.accepted, false);
    assert.equal(handoffResult.relay.delivered, false);
    assert.equal(handoffResult.relay.supportsDirectMessage, true);
    assert.equal(handoffResult.relay.supportsDirectAttachment, true);
    assert.deepEqual(handoffResult.relay.inputTypes, ['text', 'localImage']);
    assert.equal(await fs.stat(handoffResult.relay.payloadPath).then((stat) => stat.isFile()), true);
    assert.equal(await fs.stat(handoffResult.relay.statusPath).then((stat) => stat.isFile()), true);
    const relayPayload = JSON.parse(await fs.readFile(handoffResult.relay.payloadPath, 'utf8'));
    assert.equal(relayPayload.threadId, 'codex-thread-relay-test');
    assert.equal(relayPayload.input[0].type, 'text');
    assert.match(relayPayload.input[0].text, /<codex_delegation>/);
    assert.match(relayPayload.input[0].text, /<source_thread_id>codex-thread-relay-test<\/source_thread_id>/);
    assert.match(relayPayload.input[0].text, /<input>[\s\S]*请按截图里的红框优化布局。/);
    assert.match(relayPayload.input[0].text, /<\/codex_delegation>/);
    assert.deepEqual(relayPayload.input[1], {
      type: 'localImage',
      path: exportResult.export.exportPath,
    });

    const opsResponse = await fetch(`${result.url}api/ops?after=-1`);
    const ops = await opsResponse.json();
    assert.deepEqual(ops.ops.map((op) => op.type), ['export', 'handoff', 'handoff-relay']);
    assert.equal(ops.ops[2].handoffOperationId, handoffResult.operation.id);
    assert.equal(ops.ops[2].transport, 'codex-app-server-codex-delegation-turn-start');
    assert.equal(ops.ops[2].status, 'queued');
  } finally {
    await closeServer(result.server);
  }
});

test('canvas local service prefers Codex app-server relay over foreground bridge when available', async () => {
  const project = await makeTempProject();
  const result = await canvasWorkspace(project, { thread: 'codex-direct-relay-test', threadTitle: 'Direct Relay Test', port: 0 });
  try {
    const handoffResponse = await fetch(`${result.url}api/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'codex',
        transport: 'codex-app-server-codex-delegation-turn-start',
        agentBridge: true,
        relayDryRun: true,
        promptText: '请自动发送到当前 Codex 对话。',
        instruction: '自动发送',
        selection: 'selected',
        elementCount: 1,
        selectedElementIds: ['shape-direct-1'],
        locale: 'zh-CN',
      }),
    });
    assert.equal(handoffResponse.ok, true);
    const handoffResult = await handoffResponse.json();
    assert.equal(handoffResult.relay.status, 'queued');
    assert.equal(handoffResult.relay.dryRun, true);
    assert.equal(handoffResult.relay.supportsDirectMessage, true);
    assert.equal(handoffResult.agentBridge.status, 'skipped');
    assert.equal(handoffResult.agentBridge.reason, 'direct-relay-active');
    assert.equal(handoffResult.agentBridge.directRelayStatus, 'queued');

    const bridgeResponse = await fetch(`${result.url}api/agent-bridge`);
    assert.equal(bridgeResponse.ok, true);
    const bridgeStatus = await bridgeResponse.json();
    assert.deepEqual(bridgeStatus.pending, []);

    const opsResponse = await fetch(`${result.url}api/ops?after=-1`);
    const ops = await opsResponse.json();
    assert.deepEqual(ops.ops.map((op) => op.type), ['handoff', 'handoff-relay']);
  } finally {
    await closeServer(result.server);
  }
});

test('canvas local service records and claims Codex Agent foreground bridge items', async () => {
  const project = await makeTempProject();
  const result = await canvasWorkspace(project, { thread: 'codex-agent-bridge-test', threadTitle: 'Bridge Test', port: 0 });
  try {
    const promptText = '请基于这张 OpenPrd 画布选区继续处理。';
    const handoffResponse = await fetch(`${result.url}api/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'codex',
        agentBridge: true,
        relay: false,
        promptText,
        instruction: '继续处理',
        selection: 'selected',
        elementCount: 1,
        selectedElementIds: ['shape-bridge-1'],
        locale: 'zh-CN',
      }),
    });
    assert.equal(handoffResponse.ok, true);
    const handoffResult = await handoffResponse.json();
    assert.equal(handoffResult.agentBridge.status, 'pending');
    assert.equal(handoffResult.agentBridge.transport, 'codex-agent-send-message-to-thread');
    assert.equal(handoffResult.agentBridge.threadId, 'codex-agent-bridge-test');
    assert.equal(handoffResult.agentBridge.threadTitle, 'Bridge Test');
    assert.match(handoffResult.agentBridge.prompt, /<codex_delegation>/);
    assert.match(handoffResult.agentBridge.prompt, /<source_thread_id>codex-agent-bridge-test<\/source_thread_id>/);
    assert.match(handoffResult.agentBridge.prompt, /请基于这张 OpenPrd 画布选区继续处理。/);
    assert.equal(handoffResult.relay.status, 'skipped');
    assert.equal(handoffResult.relay.reason, 'disabled-by-request');

    const outbox = await canvasWorkspace(project, {
      thread: 'codex-agent-bridge-test',
      bridgeOutbox: true,
    });
    assert.equal(outbox.action, 'canvas-agent-bridge');
    assert.equal(outbox.pending.length, 1);
    assert.equal(outbox.pending[0].id, handoffResult.agentBridge.id);
    assert.equal(outbox.pending[0].status, 'pending');

    const bridgeResponse = await fetch(`${result.url}api/agent-bridge`);
    assert.equal(bridgeResponse.ok, true);
    const bridgeStatus = await bridgeResponse.json();
    assert.equal(bridgeStatus.transport, 'codex-agent-send-message-to-thread');
    assert.equal(bridgeStatus.requiresAgentTool, 'codex_app.send_message_to_thread');
    assert.equal(bridgeStatus.pending.length, 1);
    assert.equal(bridgeStatus.pending[0].id, handoffResult.agentBridge.id);

    const claimed = await canvasWorkspace(project, {
      thread: 'codex-agent-bridge-test',
      bridgeOutbox: true,
      claim: 'next',
    });
    assert.equal(claimed.item.id, handoffResult.agentBridge.id);
    assert.equal(claimed.item.status, 'claimed');

    const sent = await canvasWorkspace(project, {
      thread: 'codex-agent-bridge-test',
      bridgeSent: true,
      id: handoffResult.agentBridge.id,
    });
    assert.equal(sent.item.id, handoffResult.agentBridge.id);
    assert.equal(sent.item.status, 'sent');

    const finalOutbox = await canvasWorkspace(project, {
      thread: 'codex-agent-bridge-test',
      bridgeOutbox: true,
    });
    assert.equal(finalOutbox.pending.length, 0);

    const opsResponse = await fetch(`${result.url}api/ops?after=-1`);
    const ops = await opsResponse.json();
    assert.deepEqual(ops.ops.map((op) => op.type), [
      'handoff',
      'agent-foreground-relay',
      'agent-foreground-relay-status',
      'agent-foreground-relay-status',
    ]);
  } finally {
    await closeServer(result.server);
  }
});

test('canvas local service records AI image template handoff metadata', async () => {
  const project = await makeTempProject();
  const result = await canvasWorkspace(project, { thread: 'codex-ai-image-handoff-test', port: 0 });
  try {
    const handoffResponse = await fetch(`${result.url}api/handoffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'codex',
        transport: 'codex-app-server-codex-delegation-turn-start',
        relay: false,
        promptText: '请用 Image 2 生成一张 1:1 图片。',
        instruction: '一只卡皮兽在海滩玩耍',
        selection: 'ai-image-template',
        placeholderId: 'placeholder-1',
        aspectRatio: 1,
        mode: 'replace',
        elementCount: 3,
        selectedElementIds: ['placeholder-1', 'label-1'],
        locale: 'zh-CN',
        note: 'canvas-ai-image-template',
      }),
    });
    assert.equal(handoffResponse.ok, true);
    const handoffResult = await handoffResponse.json();
    assert.equal(handoffResult.operation.type, 'handoff');
    assert.equal(handoffResult.operation.selection, 'ai-image-template');
    assert.equal(handoffResult.operation.placeholderId, 'placeholder-1');
    assert.equal(handoffResult.operation.aspectRatio, 1);
    assert.equal(handoffResult.operation.mode, 'replace');
    assert.equal(handoffResult.operation.note, 'canvas-ai-image-template');
    assert.equal(handoffResult.operation.binding.kind, 'thread');
    assert.equal(handoffResult.operation.binding.id, 'codex-ai-image-handoff-test');
  } finally {
    await closeServer(result.server);
  }
});

test('canvas local service exposes a clipboard fallback for browser copy actions', async () => {
  const project = await makeTempProject();
  const result = await canvasWorkspace(project, { session: 'clipboard-fallback-test', port: 0 });
  try {
    const clipboardResponse = await fetch(`${result.url}api/clipboard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'OpenPrd clipboard fallback',
        platform: 'darwin',
        dryRun: true,
      }),
    });
    assert.equal(clipboardResponse.ok, true);
    const clipboardResult = await clipboardResponse.json();
    assert.equal(clipboardResult.ok, true);
    assert.equal(clipboardResult.clipboard.dryRun, true);
    assert.equal(clipboardResult.clipboard.platform, 'darwin');
    assert.equal(clipboardResult.clipboard.command, 'pbcopy');
  } finally {
    await closeServer(result.server);
  }
});

test('canvas stop reports cleanly when no daemon is running for the binding', async () => {
  const project = await makeTempProject();
  const result = await canvasWorkspace(project, { session: 'no-running-daemon', stop: true });
  assert.equal(result.ok, true);
  assert.equal(result.action, 'canvas-stop');
  assert.equal(result.stopped, false);
  assert.equal(result.reason, 'not-running');
  assert.equal(result.session.binding.kind, 'session');
  assert.equal(result.session.binding.id, 'no-running-daemon');
});
