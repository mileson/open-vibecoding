/*
 * Core purpose
 * Client-side helper functions for the `open-vibecoding canvas` browser app.
 *
 * Positioning
 * Raw inline <script type="module"> payload (part 1 of 2), extracted from
 * canvas-app.html.js. It runs in the browser, not in Node. Keep it free of
 * backticks and \${} so the host template stays safe.
 */
export const CANVAS_APP_CLIENT_HELPERS = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { Excalidraw, convertToExcalidrawElements, exportToCanvas, serializeAsJSON } from "@excalidraw/excalidraw";

    const session = JSON.parse(document.getElementById("open-vibecoding-session").textContent);
    const localeConfig = JSON.parse(document.getElementById("open-vibecoding-canvas-locales").textContent);
    const h = React.createElement;
    const apiBase = "";
    const sceneSaveDelay = 700;
    const codexRelayStartWaitMs = 45000;
    const codexRelayUiTimeoutMs = 60000;
    const codexRelayCompletedStatuses = new Set(["completed"]);
    let excalidrawAPI = null;
    let latestElements = [];
    let latestAppState = {};
    let latestFiles = {};
    let saveTimer = null;
    let lastSeq = -1;
    let pollTimer = null;
    let syncSelectionState = () => {};
    let syncAgentBridgeStatus = () => {};
    let syncCodexRelayStatus = () => {};

    function normalizeLocale(locale) {
      const value = String(locale || "").trim().toLowerCase();
      if (value === "en" || value.startsWith("en-")) {
        return "en";
      }
      if (value === "zh" || value.startsWith("zh-")) {
        return "zh-CN";
      }
      return localeConfig.defaultLocale || "zh-CN";
    }

    function initialLocale() {
      try {
        const saved = window.localStorage.getItem(localeConfig.storageKey);
        if (saved) {
          return normalizeLocale(saved);
        }
      } catch {}
      const languages = Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];
      for (const language of languages) {
        if (String(language || "").trim()) {
          return normalizeLocale(language);
        }
      }
      return localeConfig.defaultLocale || "zh-CN";
    }

    function formatMessage(template, values = {}) {
      return String(template || "").replace(/\\{(\\w+)\\}/g, (_, key) => {
        return values[key] == null ? "" : String(values[key]);
      });
    }

    function messagesFor(locale) {
      return localeConfig.messages[locale] || localeConfig.messages[localeConfig.defaultLocale] || {};
    }

    const canvasSurfaceColor = "#ffffff";
    const legacyCanvasBackgrounds = new Set(["#fbfaf7", "#fffdf9", "#f8f6f1"]);

    function normalizeCanvasAppState(appState = {}) {
      const nextAppState = { ...(appState || {}) };
      const current = String(nextAppState.viewBackgroundColor || "").trim().toLowerCase();
      if (!current || legacyCanvasBackgrounds.has(current)) {
        nextAppState.viewBackgroundColor = canvasSurfaceColor;
      }
      return nextAppState;
    }

    function normalizeInitialScene(scene) {
      const base = scene && Array.isArray(scene.elements)
        ? scene
        : { elements: [], appState: {}, files: {} };
      return {
        ...base,
        elements: Array.isArray(base.elements) ? base.elements : [],
        appState: normalizeCanvasAppState(base.appState),
        files: base.files && typeof base.files === "object" ? base.files : {},
      };
    }

    function selectedCountFromAppState(appState) {
      const selectedIds = appState?.selectedElementIds || {};
      return Object.keys(selectedIds).filter((id) => selectedIds[id]).length;
    }

    function selectedImageCountFromAppState(appState, elements = latestElements) {
      const selectedIds = appState?.selectedElementIds || {};
      return (elements || []).filter((element) => {
        return element && !element.isDeleted && element.type === "image" && selectedIds[element.id];
      }).length;
    }

    function conversationTitle(t) {
      return session.binding?.title || session.binding?.threadTitle || session.binding?.name || t.currentConversationTitle;
    }

    function conversationId() {
      return session.binding?.displayId || session.binding?.id || session.sessionKey;
    }

    function toolIcon(kind) {
      if (kind === "card") {
        return h("svg", { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
          h("rect", { x: 4, y: 5, width: 16, height: 14, rx: 2 }),
          h("path", { d: "M8 9h8" }),
          h("path", { d: "M8 13h5" }),
        );
      }
      if (kind === "export") {
        return h("svg", { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
          h("rect", { x: 3, y: 5, width: 18, height: 14, rx: 2 }),
          h("circle", { cx: 8, cy: 10, r: 1.6 }),
          h("path", { d: "m21 16-5-5-4 4-2-2-5 5" }),
        );
      }
      if (kind === "save") {
        return h("svg", { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
          h("path", { d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" }),
          h("path", { d: "M17 21v-8H7v8" }),
          h("path", { d: "M7 3v5h8" }),
        );
      }
      if (kind === "reset") {
        return h("svg", { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
          h("path", { d: "M3 6h18" }),
          h("path", { d: "M8 6V4h8v2" }),
          h("path", { d: "M19 6l-1 14H6L5 6" }),
          h("path", { d: "M10 11v5" }),
          h("path", { d: "M14 11v5" }),
        );
      }
      if (kind === "library") {
        return h("svg", { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
          h("path", { d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20" }),
          h("path", { d: "M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z" }),
        );
      }
      if (kind === "send") {
        return h("svg", { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
          h("path", { d: "M22 2 11 13" }),
          h("path", { d: "m22 2-7 20-4-9-9-4 20-7z" }),
        );
      }
      if (kind === "copy") {
        return h("svg", { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
          h("rect", { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
          h("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }),
        );
      }
      return h("svg", { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        h("circle", { cx: 12, cy: 12, r: 9 }),
        h("path", { d: "M12 8v4" }),
        h("path", { d: "M12 16h.01" }),
      );
    }

    async function fetchJson(url, options = {}) {
      const response = await fetch(apiBase + url, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
        },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || response.statusText);
      }
      return response.json();
    }

    async function withTimeout(promise, timeoutMs) {
      let timer = null;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== null) {
          window.clearTimeout(timer);
        }
      }
    }

    function relayWasAccepted(result) {
      return Boolean(result?.relay?.accepted || result?.relay?.delivered || codexRelayCompletedStatuses.has(result?.relay?.status));
    }

    function relayIsPending(result, timedOut) {
      const status = result?.relay?.status;
      return Boolean(timedOut || result?.relay?.pending || result?.relay?.waitTimedOut || ["queued", "starting", "resuming", "connecting", "started"].includes(status));
    }

    function agentBridgeIsPending(result) {
      const status = result?.agentBridge?.status;
      return Boolean(result?.agentBridge?.supportsForegroundMessage && ["pending", "claimed"].includes(status));
    }

    function agentBridgePendingMessage(t, status) {
      return status === "claimed" ? t.agentBridgeClaimed : t.agentBridgePending;
    }

    function stripAppState(appState) {
      const {
        collaborators,
        contextMenu,
        editingElement,
        editingFrame,
        editingGroupId,
        errorMessage,
        openDialog,
        openMenu,
        pendingImageElementId,
        resizingElement,
        selectionElement,
        suggestedBindings,
        toast,
        ...rest
      } = appState || {};
      return rest;
    }

    function libraryItemsFromPayload(payload) {
      if (Array.isArray(payload?.libraryItems)) {
        return payload.libraryItems;
      }
      if (Array.isArray(payload?.items)) {
        return payload.items;
      }
      return [];
    }

    function createElementId(prefix = "open-vibecoding-lib") {
      if (window.crypto?.randomUUID) {
        return prefix + "-" + window.crypto.randomUUID();
      }
      return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    }

    function imageTemplateOptions(t) {
      return [
        { id: "1-1", label: "1:1", title: t.aiTemplateSquare, width: 320, height: 320, aspectRatio: 1 },
        { id: "3-4", label: "3:4", title: t.aiTemplatePortrait, width: 300, height: 400, aspectRatio: 0.75 },
        { id: "4-3", label: "4:3", title: t.aiTemplateLandscape, width: 400, height: 300, aspectRatio: 1.3333333333 },
        { id: "16-9", label: "16:9", title: t.aiTemplateWide, width: 480, height: 270, aspectRatio: 1.7777777778 },
        { id: "9-16", label: "9:16", title: t.aiTemplateVertical, width: 270, height: 480, aspectRatio: 0.5625 },
        { id: "wechat-2-35", label: "2.35:1", title: t.aiTemplateWechat, width: 520, height: 221, aspectRatio: 2.35 },
      ];
    }

    function cloneLibraryElement(element, offsetX, offsetY) {
      return {
        ...element,
        id: createElementId(),
        x: Number(element.x || 0) + offsetX,
        y: Number(element.y || 0) + offsetY,
        seed: Math.floor(Math.random() * 2147483647),
        version: 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
        updated: Date.now(),
        isDeleted: false,
      };
    }

    function boundsForElements(elements) {
      const values = elements
        .filter((element) => element && !element.isDeleted)
        .map((element) => ({
          minX: Number(element.x || 0),
          minY: Number(element.y || 0),
          maxX: Number(element.x || 0) + Number(element.width || 0),
          maxY: Number(element.y || 0) + Number(element.height || 0),
        }));
      if (values.length === 0) {
        return { x: 0, y: 0, width: 360, height: 240 };
      }
      const minX = Math.min(...values.map((value) => value.minX));
      const minY = Math.min(...values.map((value) => value.minY));
      const maxX = Math.max(...values.map((value) => value.maxX));
      const maxY = Math.max(...values.map((value) => value.maxY));
      return {
        x: minX,
        y: minY,
        width: Math.max(80, maxX - minX),
        height: Math.max(80, maxY - minY),
      };
    }

    function queueSave() {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(async () => {
        await fetchJson("/api/scene", {
          method: "POST",
          body: JSON.stringify({
            type: "openprd.canvas.scene.v1",
            elements: latestElements,
            appState: stripAppState(latestAppState),
            files: latestFiles,
            savedAt: new Date().toISOString(),
          }),
        }).catch((error) => {
          console.warn("Open VibeCoding canvas save failed", error);
        });
      }, sceneSaveDelay);
    }

    function getViewportDropPoint(width, height) {
      const appState = latestAppState || {};
      const scrollX = Number(appState.scrollX || 0);
      const scrollY = Number(appState.scrollY || 0);
      const zoomValue = Number(appState.zoom?.value || 1);
      const canvasWidth = window.innerWidth - 232;
      const canvasHeight = window.innerHeight - 48;
      return {
        x: Math.round((canvasWidth / 2 - scrollX) / zoomValue - width / 2),
        y: Math.round((canvasHeight / 2 - scrollY) / zoomValue - height / 2),
      };
    }

    function selectedElement() {
      const selectedIds = latestAppState?.selectedElementIds || {};
      return latestElements.find((element) => selectedIds[element.id] && !element.isDeleted) || null;
    }

    function currentVisibleElements() {
      return latestElements.filter((element) => !element.isDeleted);
    }

    function currentSelectedElements() {
      const selectedIds = latestAppState?.selectedElementIds || {};
      return currentVisibleElements().filter((element) => selectedIds[element.id]);
    }

    function createExportFilename(prefix = "canvas-selection") {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      return prefix + "-" + stamp + ".png";
    }

    function createSceneFilename(prefix = "open-vibecoding-canvas") {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      return prefix + "-" + stamp + ".excalidraw";
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function downloadUrl(url, filename) {
      if (!url) {
        throw new Error("missing-export-url");
      }
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename || createExportFilename("canvas-export");
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    }

    function currentSceneElementsForFile() {
      return excalidrawAPI?.getSceneElements?.() || latestElements;
    }

    function currentFilesForFile() {
      return excalidrawAPI?.getFiles?.() || latestFiles;
    }

    function currentAppStateForFile() {
      return normalizeCanvasAppState(excalidrawAPI?.getAppState?.() || latestAppState);
    }

    async function saveCanvasToDisk() {
      const elements = currentSceneElementsForFile();
      const appState = stripAppState(currentAppStateForFile());
      const files = currentFilesForFile();
      const content = serializeAsJSON
        ? serializeAsJSON(elements, appState, files, "local")
        : JSON.stringify({ type: "excalidraw", version: 2, source: "https://openprd.local/canvas", elements, appState, files }, null, 2);
      const filename = createSceneFilename();
      await fetchJson("/api/download-file", {
        method: "POST",
        body: JSON.stringify({
          filename,
          content,
          mimeType: "application/json; charset=utf-8",
        }),
      });
      queueSave();
      return { filename };
    }

    async function exportCanvasImage(locale) {
      const filename = createExportFilename("canvas-export");
      const exported = await exportCanvasElements({ intent: "manual-export", locale, filename });
      const exportData = exported.result.export || {};
      downloadUrl(exportData.exportUrl, exportData.fileName || filename);
      return exportData;
    }

    function hideNativeExcalidrawChrome() {
      const root = document.querySelector(".canvas-wrap .excalidraw");
      if (!root) {
        return;
      }
      const fixedSelectors = [
        '[data-testid="main-menu-trigger"]',
        ".main-menu-trigger",
        '[data-testid="library-button"]',
        ".library-button",
        ".default-sidebar-trigger",
        ".sidebar-trigger__label-element",
        'button[aria-label="Library"]',
        'button[aria-label="素材库"]',
        'button[title="Library"]',
        'button[title="素材库"]',
      ];
      root.querySelectorAll(fixedSelectors.join(",")).forEach((node) => {
        node.setAttribute("hidden", "");
        node.style.display = "none";
      });
      root.querySelectorAll("button").forEach((button) => {
        const label = [
          button.textContent,
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
        ].join(" ").trim().toLowerCase();
        if (label === "library" || label === "素材库") {
          button.setAttribute("hidden", "");
          button.style.display = "none";
        }
      });
    }

    async function copyTextToClipboard(text) {
      let copied = false;
      try {
        await withTimeout(navigator.clipboard.writeText(text), 900);
        copied = true;
      } catch {}
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        copied = copied || ok;
      } catch {
        copied = copied || false;
      }
      try {
        await withTimeout(fetchJson("/api/clipboard", {
          method: "POST",
          body: JSON.stringify({ text }),
        }), 1200);
        return true;
      } catch {}
      return copied;
    }

    function buildCodexPrompt(t, exportPath, elementCount, instruction, annotationContext) {
      const binding = conversationId();
      const trimmedInstruction = String(instruction || "").trim();
      const lines = [
        trimmedInstruction || t.codexPromptDefaultInstruction,
        "",
        t.codexPromptIntro,
        "",
        "![Open VibeCoding Canvas selection](" + exportPath + ")",
        "",
        exportPath,
        "",
        formatMessage(t.codexPromptMeta, { count: elementCount, binding }),
      ];
      if (annotationContext) {
        lines.push(
          "",
          t.annotationEditPromptIntro,
          "",
          formatMessage(t.annotationEditPromptMeta, {
            sourceIds: annotationContext.sourceImageElementIds.join(", "),
            annotationIds: annotationContext.annotationElementIds.join(", "),
          }),
          "",
          t.annotationEditPromptReturn,
          "",
          JSON.stringify({
            api: "POST /api/insert-image",
            anchorElementId: annotationContext.anchorElementId,
            placement: "right",
            mode: "append",
            note: "annotation-edit-revision",
          }, null, 2),
        );
      }
      return lines.join("\\n");
    }

    function annotationEditContextFor(selected) {
      const elements = Array.isArray(selected) ? selected.filter((element) => element && !element.isDeleted) : [];
      const sourceImages = elements.filter((element) => element.type === "image");
      const annotations = elements.filter((element) => {
        if (element.type === "image") {
          return false;
        }
        const role = String(element.customData?.openprdRole || "");
        return !role.startsWith("ai-image") && !role.startsWith("image-placeholder");
      });
      if (sourceImages.length === 0 || annotations.length === 0) {
        return null;
      }
      return {
        sourceImageElementIds: sourceImages.map((element) => element.id),
        annotationElementIds: annotations.map((element) => element.id),
        anchorElementId: sourceImages[0].id,
      };
    }

    function buildThreadPrompt(t) {
      return formatMessage(t.threadPromptTemplate, {
        title: conversationTitle(t),
        id: conversationId(),
      });
    }

    async function recordCodexHandoff(exported, promptText, locale, instruction, annotationContext) {
      const operation = exported.result.operation || {};
      const exportData = exported.result.export || {};
      return fetchJson("/api/handoffs", {
        method: "POST",
        body: JSON.stringify({
          target: "codex",
          transport: "codex-app-server-codex-delegation-turn-start",
          agentBridge: true,
          relay: true,
          exportOperationId: operation.id || null,
          exportPath: exportData.exportPath || "",
          exportUrl: exportData.exportUrl || "",
          promptText,
          selection: annotationContext ? "annotation-edit" : (operation.selection || (exported.selected.length > 0 ? "selected" : "scene")),
          selectedElementIds: exported.selected.map((element) => element.id),
          sourceImageElementIds: annotationContext ? annotationContext.sourceImageElementIds : [],
          annotationElementIds: annotationContext ? annotationContext.annotationElementIds : [],
          elementCount: exported.elements.length,
          locale,
          instruction,
          relayWaitMs: codexRelayStartWaitMs,
          note: annotationContext ? "canvas-annotation-edit" : "canvas-send-to-codex",
        }),
      });
    }

    async function recordCodexImageRequestHandoff(promptText, locale, instruction, template, created) {
      return fetchJson("/api/handoffs", {
        method: "POST",
        body: JSON.stringify({
          target: "codex",
          transport: "codex-app-server-codex-delegation-turn-start",
          agentBridge: true,
          relay: true,
          promptText,
          instruction,
          selection: "ai-image-template",
          placeholderId: created.placeholderId,
          aspectRatio: template.aspectRatio,
          sizeContract: {
            width: template.width,
            height: template.height,
            aspectRatio: template.aspectRatio,
          },
          mode: "replace",
          elementCount: created.elementIds.length,
          selectedElementIds: created.elementIds,
          locale,
          relayWaitMs: codexRelayStartWaitMs,
          note: "canvas-ai-image-template",
        }),
      });
    }

    function buildImageRequestPrompt(t, template, instruction, placeholderId) {
      const binding = conversationId();
      const trimmedInstruction = String(instruction || "").trim();
      return [
        trimmedInstruction,
        "",
        t.aiImagePromptIntro,
        "",
        formatMessage(t.aiImagePromptMeta, {
          ratio: template.label,
          placeholderId,
          binding,
        }),
        "",
        formatMessage(t.aiImagePromptSize, {
          width: template.width,
          height: template.height,
          ratio: template.label,
        }),
        "",
        t.aiImagePromptReturn,
        "",
        JSON.stringify({
          placeholderId,
          aspectRatio: template.aspectRatio,
          sizeContract: {
            width: template.width,
            height: template.height,
            aspectRatio: template.aspectRatio,
          },
          mode: "replace",
          note: "ai-image-template",
        }, null, 2),
      ].join("\\n");
    }

    function latestPlaceholder() {
      return [...latestElements].reverse().find((element) => {
        const role = element.customData?.openprdRole;
        return !element.isDeleted && (role === "image-placeholder" || role === "ai-image-placeholder");
      }) || null;
    }

    function fitIntoBox(box, aspectRatio) {
      const ratio = Number(aspectRatio || 1.5);
      let width = Math.max(80, Number(box.width || 360));
      let height = Math.max(80, Math.round(width / ratio));
      if (height > Number(box.height || height)) {
        height = Math.max(80, Number(box.height || 240));
        width = Math.round(height * ratio);
      }
      return {
        x: Math.round(Number(box.x || 0) + (Number(box.width || width) - width) / 2),
        y: Math.round(Number(box.y || 0) + (Number(box.height || height) - height) / 2),
        width,
        height,
      };
    }

    function updateScene(elements, appStatePatch = null) {
      if (!excalidrawAPI) {
        return;
      }
      const nextAppState = appStatePatch
        ? normalizeCanvasAppState({ ...latestAppState, ...appStatePatch })
        : latestAppState;
      excalidrawAPI.updateScene(appStatePatch ? { elements, appState: nextAppState } : { elements });
      latestElements = elements;
      if (appStatePatch) {
        latestAppState = nextAppState;
      }
      syncSelectionState(latestAppState, latestElements);
      queueSave();
    }

    function createAiImageCard(template, instruction, t) {
      const point = getViewportDropPoint(template.width, template.height);
      const requestId = createElementId("open-vibecoding-ai-image");
      const groupId = createElementId("open-vibecoding-ai-group");
      const centerY = point.y + Math.round(template.height / 2);
      const pendingParent = {
        openprdParentId: "__pending__",
        openprdRequestId: requestId,
        openprdGroupId: groupId,
      };
      let elements = convertToExcalidrawElements([
        {
          type: "rectangle",
          x: point.x,
          y: point.y,
          width: template.width,
          height: template.height,
          backgroundColor: "#eff6ff",
          strokeColor: "#2563eb",
          strokeStyle: "dashed",
          fillStyle: "hachure",
          roughness: 1,
          customData: {
            openprdRole: "ai-image-placeholder",
            openprdStatus: "generating",
            openprdRequestId: requestId,
            openprdPrompt: instruction,
            openprdAspectRatio: template.aspectRatio,
            openprdTemplateId: template.id,
            openprdTemplateLabel: template.label,
          },
        },
        {
          type: "rectangle",
          x: point.x + 18,
          y: point.y + 18,
          width: 58,
          height: 28,
          backgroundColor: "#2563eb",
          strokeColor: "#2563eb",
          roughness: 0,
          customData: { ...pendingParent, openprdRole: "ai-image-badge" },
        },
        {
          type: "text",
          x: point.x + 36,
          y: point.y + 24,
          text: "AI",
          fontSize: 14,
          strokeColor: "#ffffff",
          customData: { ...pendingParent, openprdRole: "ai-image-badge-label" },
        },
        {
          type: "rectangle",
          x: point.x + Math.round(template.width * 0.18),
          y: point.y + Math.round(template.height * 0.28),
          width: Math.round(template.width * 0.64),
          height: 12,
          backgroundColor: "#bfdbfe",
          strokeColor: "#bfdbfe",
          opacity: 38,
          roughness: 0,
          customData: { ...pendingParent, openprdRole: "ai-image-ripple" },
        },
        {
          type: "rectangle",
          x: point.x + Math.round(template.width * 0.24),
          y: point.y + Math.round(template.height * 0.36),
          width: Math.round(template.width * 0.52),
          height: 10,
          backgroundColor: "#bfdbfe",
          strokeColor: "#bfdbfe",
          opacity: 26,
          roughness: 0,
          customData: { ...pendingParent, openprdRole: "ai-image-ripple" },
        },
        {
          type: "text",
          x: point.x + 24,
          y: centerY - 32,
          text: t.aiGenerating,
          fontSize: 22,
          strokeColor: "#1e3a8a",
          customData: { ...pendingParent, openprdRole: "ai-image-status-label" },
        },
        {
          type: "text",
          x: point.x + 24,
          y: centerY + 4,
          text: formatMessage(t.aiTemplateOnCanvas, { ratio: template.label }),
          fontSize: 15,
          strokeColor: "#64748b",
          customData: { ...pendingParent, openprdRole: "ai-image-ratio-label" },
        },
      ]);
      const placeholder = elements.find((element) => element.customData?.openprdRole === "ai-image-placeholder");
      const placeholderId = placeholder?.id || requestId;
      elements = elements.map((element) => {
        const groupedElement = {
          ...element,
          groupIds: [groupId],
        };
        if (element.customData?.openprdParentId !== "__pending__") {
          return {
            ...groupedElement,
            customData: {
              ...groupedElement.customData,
              openprdGroupId: groupId,
            },
          };
        }
        return {
          ...groupedElement,
          customData: {
            ...groupedElement.customData,
            openprdParentId: placeholderId,
          },
        };
      });
      const selectedElementIds = Object.fromEntries(elements.map((element) => [element.id, true]));
      updateScene([...latestElements, ...elements], {
        selectedElementIds,
      });
      return {
        placeholderId,
        groupId,
        elementIds: elements.map((element) => element.id),
      };
    }

    function attachAiImagePrompt(placeholderId, promptText) {
      updateScene(latestElements.map((element) => {
        if (element.id !== placeholderId) {
          return element;
        }
        return {
          ...element,
          customData: {
            ...element.customData,
            openprdPromptText: promptText,
          },
        };
      }));
    }

    function groupIdsForElement(element) {
      const ids = new Set(Array.isArray(element?.groupIds) ? element.groupIds.filter(Boolean) : []);
      if (element?.customData?.openprdGroupId) {
        ids.add(element.customData.openprdGroupId);
      }
      return ids;
    }

    async function addBlankCard(labelText = messagesFor(initialLocale()).placeholderText) {
      const point = getViewportDropPoint(360, 240);
      const elements = convertToExcalidrawElements([
        {
          type: "rectangle",
          x: point.x,
          y: point.y,
          width: 360,
          height: 240,
          backgroundColor: "#ffffff",
          strokeColor: "#2563eb",
          roughness: 1,
          customData: { openprdRole: "image-placeholder" },
        },
        {
          type: "text",
          x: point.x + 22,
          y: point.y + 104,
          text: labelText,
          fontSize: 18,
          strokeColor: "#65717f",
          customData: { openprdRole: "image-placeholder-label" },
        },
      ]);
      updateScene([...latestElements, ...elements]);
      await fetchJson("/api/cards", {
        method: "POST",
        body: JSON.stringify({ source: "browser", note: "blank-card" }),
      }).catch(() => {});
    }

    function measureDataUrl(dataUrl) {
      return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth || 1024, height: image.naturalHeight || 768 });
        image.onerror = () => resolve({ width: 1024, height: 768 });
        image.src = dataUrl;
      });
    }

    async function importReviewDirectionsToCanvas(t) {
      const payload = await fetchJson("/api/review-directions");
      const directions = Array.isArray(payload.directions) ? payload.directions : [];
      if (!payload.ok || directions.length === 0) {
        const error = new Error(payload.reason || "no-directions");
        error.code = payload.reason === "no-directions" || payload.reason === "no-version" ? "empty" : "failed";
        throw error;
      }
      const cardWidth = 460;
      const gap = 60;
      const headerHeight = 96;
      const measured = [];
      for (const direction of directions) {
        const size = direction.image?.dataUrl ? await measureDataUrl(direction.image.dataUrl) : { width: 4, height: 3 };
        measured.push({ direction, imageHeight: Math.round(cardWidth * (size.height / size.width)) });
      }
      const maxImageHeight = Math.max(...measured.map((item) => item.imageHeight));
      const cardHeight = headerHeight + maxImageHeight + 24;
      const boardWidth = directions.length * cardWidth + (directions.length - 1) * gap;
      const origin = getViewportDropPoint(boardWidth, cardHeight);
      const files = [];
      const skeletons = [];
      measured.forEach((item, index) => {
        const direction = item.direction;
        const x = origin.x + index * (cardWidth + gap);
        const y = origin.y;
        const isSelected = payload.selectedDirectionId && direction.id === payload.selectedDirectionId;
        skeletons.push({
          type: "rectangle",
          x: x - 16,
          y: y - 16,
          width: cardWidth + 32,
          height: cardHeight + 32,
          backgroundColor: isSelected ? "#eef2ff" : "#ffffff",
          strokeColor: isSelected ? "#4f46e5" : "#cbd5e1",
          roughness: 0,
          customData: { openprdRole: "review-direction-frame", openprdDirectionId: direction.id },
        });
        skeletons.push({
          type: "text",
          x: x,
          y: y,
          text: (index + 1) + ". " + (direction.title || direction.id) + (isSelected ? "  [" + t.reviewDirectionSelectedTag + "]" : ""),
          fontSize: 20,
          strokeColor: "#0f172a",
          customData: { openprdRole: "review-direction-title", openprdDirectionId: direction.id },
        });
        if (direction.summary) {
          skeletons.push({
            type: "text",
            x: x,
            y: y + 34,
            text: direction.summary + (direction.tradeoff ? "\\n" + direction.tradeoff : ""),
            fontSize: 14,
            strokeColor: "#475569",
            customData: { openprdRole: "review-direction-summary", openprdDirectionId: direction.id },
          });
        }
        if (direction.image?.dataUrl) {
          const fileId = "open-vibecoding-direction-" + direction.id + "-" + Date.now();
          files.push({
            id: fileId,
            dataURL: direction.image.dataUrl,
            mimeType: direction.image.mimeType || "image/png",
            created: Date.now(),
          });
          skeletons.push({
            type: "image",
            x: x,
            y: y + headerHeight,
            width: cardWidth,
            height: item.imageHeight,
            fileId,
            customData: { openprdRole: "review-direction-image", openprdDirectionId: direction.id },
          });
        }
      });
      if (excalidrawAPI && files.length > 0) {
        excalidrawAPI.addFiles(files);
      }
      const elements = convertToExcalidrawElements(skeletons);
      updateScene([...latestElements, ...elements]);
      if (excalidrawAPI) {
        excalidrawAPI.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.85 });
      }
      return { count: directions.length };
    }

    async function applyImageOperation(op) {
      if (!excalidrawAPI) {
        return;
      }
      const response = await fetch(op.assetUrl);
      if (!response.ok) {
        throw new Error("image fetch failed");
      }
      const blob = await response.blob();
      const dataURL = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const fileId = op.fileId || ("open-vibecoding-image-" + Date.now());
      excalidrawAPI.addFiles([{ id: fileId, dataURL, mimeType: blob.type || "image/png", created: Date.now() }]);
      const explicitTarget = op.placeholderId
        ? latestElements.find((element) => element.id === op.placeholderId && !element.isDeleted)
        : null;
      const target = explicitTarget || selectedElement() || latestPlaceholder();
      const imageBox = target
        ? fitIntoBox(target, op.aspectRatio)
        : { ...getViewportDropPoint(480, 320), width: 480, height: 320 };
      const [imageElement] = convertToExcalidrawElements([
        {
          type: "image",
          x: imageBox.x,
          y: imageBox.y,
          width: imageBox.width,
          height: imageBox.height,
          fileId,
          customData: {
            openprdRole: "agent-image",
            sourceOperationId: op.id,
            sourcePath: op.sourcePath || null,
            sourcePlaceholderId: target?.id || null,
          },
        },
      ]);
      const hiddenTargetIds = new Set();
      if (target && op.mode !== "append") {
        const hiddenGroupIds = groupIdsForElement(target);
        const targetParentId = target.customData?.openprdParentId || null;
        hiddenTargetIds.add(target.id);
        if (targetParentId) {
          hiddenTargetIds.add(targetParentId);
        }
        latestElements.forEach((element) => {
          const elementGroupIds = groupIdsForElement(element);
          const isSameGroup = [...hiddenGroupIds].some((groupId) => elementGroupIds.has(groupId));
          const hasTargetAsParent = element.customData?.openprdParentId === target.id;
          const sharesTargetParent = Boolean(targetParentId && element.customData?.openprdParentId === targetParentId);
          if (
            isSameGroup
            || hasTargetAsParent
            || sharesTargetParent
          ) {
            hiddenTargetIds.add(element.id);
          }
        });
      }
      const nextElements = latestElements
        .map((element) => hiddenTargetIds.has(element.id) ? { ...element, isDeleted: true } : element)
        .concat(imageElement);
      updateScene(nextElements);
    }

    async function applyCardOperation(op) {
      if (op.source === "browser") {
        return;
      }
      await addBlankCard();
    }

    async function pollOperations() {
      try {
        const result = await fetchJson("/api/ops?after=" + encodeURIComponent(String(lastSeq)));
        for (const op of result.ops || []) {
          lastSeq = Math.max(lastSeq, Number(op.seq || 0));
          if (op.type === "image") {
            await applyImageOperation(op);
          }
          if (op.type === "card") {
            await applyCardOperation(op);
          }
          if (op.type === "handoff-relay") {
            syncCodexRelayStatus(op);
          }
          if (op.type === "agent-foreground-relay" || op.type === "agent-foreground-relay-status") {
            syncAgentBridgeStatus(op);
          }
        }
      } catch (error) {
        console.warn("Open VibeCoding canvas op polling failed", error);
      }
    }

    async function readAgentBridgeOutbox() {
      try {
        const result = await fetchJson("/api/agent-bridge");
        const pending = Array.isArray(result.pending) ? result.pending : [];
        if (pending.length === 0) {
          return;
        }
        const claimed = pending.find((item) => item.status === "claimed");
        const item = claimed || pending[0];
        syncAgentBridgeStatus({ status: item.status || "pending" });
      } catch (error) {
        console.warn("Open VibeCoding canvas agent bridge polling failed", error);
      }
    }

    async function exportCanvasElements(options = {}) {
      if (!excalidrawAPI || !exportToCanvas) {
        throw new Error("Canvas API is not ready.");
      }
      const visibleElements = currentVisibleElements();
      const selected = currentSelectedElements();
      if (options.requireSelection && selected.length === 0) {
        const error = new Error("empty-selection");
        error.code = "empty-selection";
        throw error;
      }
      const elements = selected.length > 0 ? selected : visibleElements;
      if (elements.length === 0) {
        const error = new Error("empty-scene");
        error.code = "empty-scene";
        throw error;
      }
      const canvas = await exportToCanvas({
        elements,
        appState: {
          ...stripAppState(latestAppState),
          exportBackground: true,
          viewBackgroundColor: latestAppState?.viewBackgroundColor || "#ffffff",
        },
        files: excalidrawAPI.getFiles(),
        exportPadding: 24,
        maxWidthOrHeight: 2400,
      });
      const dataUrl = canvas.toDataURL("image/png");
      const intent = options.intent || "manual-export";
      const result = await fetchJson("/api/exports", {
        method: "POST",
        body: JSON.stringify({
          dataUrl,
          selection: selected.length > 0 ? "selected" : "scene",
          selectedElementIds: selected.map((element) => element.id),
          elementCount: elements.length,
          intent,
          locale: options.locale || null,
          filename: options.filename || null,
        }),
      });
      window.dispatchEvent(new CustomEvent("open-vibecoding-canvas-exported", { detail: { ...result, intent } }));
      return {
        result,
        elements,
        selected,
      };
    }

    async function exportSelection() {
      return exportCanvasElements({ intent: "manual-export" }).catch((error) => {
        console.warn("Open VibeCoding canvas export failed", error);
        return null;
      });
    }

`;
