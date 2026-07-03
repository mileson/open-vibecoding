/*
 * Core purpose
 * Render the browser app used by `openprd canvas`.
 *
 * Inputs
 * Receives a resolved canvas session and emits a single HTML document.
 *
 * Outputs
 * A local Excalidraw-powered canvas shell that saves scenes to the OpenPrd
 * canvas session service and applies agent-queued image/card operations.
 *
 * Positioning
 * This file is presentation-only. Server routes, file storage, and session
 * binding live in canvas-workspace.js.
 *
 * Maintenance rules
 * Keep this bundle dependency-light. If the CDN embed is replaced with a
 * packaged build later, keep the API contract with canvas-workspace.js stable.
 */
import {
  CANVAS_DEFAULT_LOCALE,
  CANVAS_LOCALE_STORAGE_KEY,
  CANVAS_LOCALES,
} from './canvas-i18n.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function serialize(value) {
  return JSON.stringify(value ?? null).replaceAll('</script', '<\\/script');
}

function renderCanvasAppHtml(session) {
  const bindingTitle = session.binding?.title
    ?? session.binding?.threadTitle
    ?? session.binding?.sessionTitle
    ?? session.binding?.name
    ?? session.binding?.displayId
    ?? session.sessionKey;
  const title = `OpenPrd Canvas · ${bindingTitle}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%232563eb'/%3E%3Cpath d='M9 10h14M9 16h14M9 22h9' stroke='white' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E" />
  <script>
    window.EXCALIDRAW_ASSET_PATH = "https://esm.sh/@excalidraw/excalidraw@0.18.0/dist/prod/";
  </script>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@18.3.1",
      "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
      "react-dom": "https://esm.sh/react-dom@18.3.1",
      "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
      "@excalidraw/excalidraw": "https://esm.sh/@excalidraw/excalidraw@0.18.0/dist/dev/index.js?external=react,react-dom"
    }
  }
  </script>
  <link rel="stylesheet" href="https://esm.sh/@excalidraw/excalidraw@0.18.0/dist/dev/index.css" />
  <style>
    :root {
      color-scheme: light;
      --paper: #ffffff;
      --ink: #111827;
      --muted: #64748b;
      --line: #e5e7eb;
      --rail: #ffffff;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --accent-soft: #eff6ff;
      --warn: #b45309;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body,
    #root {
      width: 100%;
      height: 100%;
      margin: 0;
    }

    body {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--paper);
      color: var(--ink);
      letter-spacing: 0;
      overflow: hidden;
    }

    button,
    input,
    select,
    textarea {
      font: inherit;
    }

    .shell {
      display: grid;
      grid-template-rows: 48px minmax(0, 1fr);
      width: 100%;
      height: 100%;
      background: var(--paper);
    }

    .topbar {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      padding: 0 16px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.96);
    }

    .brand {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 220px;
      white-space: nowrap;
    }

    .brand strong {
      font-size: 14px;
      line-height: 1;
    }

    .brand span {
      color: var(--muted);
      font-size: 12px;
    }

    .chipbar {
      display: flex;
      flex-wrap: nowrap;
      gap: 8px;
      min-width: 0;
      overflow: hidden;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      height: 26px;
      max-width: min(30vw, 360px);
      padding: 0 9px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--muted);
      background: #ffffff;
      font-size: 12px;
      white-space: nowrap;
    }

    .chip span {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      white-space: nowrap;
    }

    .icon-button,
    .text-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 32px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink);
      background: #ffffff;
      cursor: pointer;
    }

    .icon-button {
      width: 34px;
    }

    .text-button {
      gap: 7px;
      padding: 0 10px;
    }

    .icon-button:hover,
    .text-button:hover {
      border-color: #bfdbfe;
      background: var(--accent-soft);
    }

    .primary-button {
      border-color: var(--accent);
      color: #ffffff;
      background: var(--accent);
    }

    .primary-button:hover {
      border-color: var(--accent-hover);
      background: var(--accent-hover);
    }

    .subtle-button {
      border-color: #e2e8f0;
      color: #334155;
      background: #f1f5f9;
    }

    .subtle-button:hover {
      border-color: #cbd5e1;
      color: #1f2937;
      background: #e5e7eb;
    }

    .text-button:disabled {
      cursor: default;
    }

    .primary-button:disabled {
      opacity: 1;
      border-color: var(--accent);
      color: #ffffff;
      background: var(--accent);
      box-shadow: none;
    }

    .text-button:disabled:not(.primary-button) {
      opacity: 0.6;
      border-color: var(--line);
      color: #9ca3af;
      background: #f8fafc;
    }

    .language-select {
      height: 32px;
      min-width: 84px;
      padding: 0 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink);
      background: #ffffff;
      cursor: pointer;
    }

    .language-select:focus,
    .language-select:focus-visible {
      outline: none;
      border-color: #cbd5e1;
      box-shadow: none;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 232px;
      min-height: 0;
    }

    .rail {
      min-width: 0;
      border-left: 1px solid var(--line);
      background: var(--rail);
      padding: 18px 16px;
      overflow: auto;
    }

    .rail-section {
      margin-bottom: 18px;
    }

    .rail-title {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .rail-value {
      margin: 0;
      color: var(--ink);
      font-size: 13px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .thread-summary {
      display: grid;
      gap: 6px;
      padding: 0;
    }

    .thread-title {
      margin: 0;
      color: var(--ink);
      font-size: 14px;
      font-weight: 700;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .thread-id {
      margin: 0;
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .thread-id-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 28px;
      align-items: start;
      gap: 6px;
    }

    .thread-copy-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 1px solid #dbeafe;
      border-radius: 6px;
      color: var(--accent);
      background: var(--accent-soft);
      cursor: pointer;
    }

    .thread-copy-button svg {
      width: 15px;
      height: 15px;
    }

    .thread-copy-button:hover {
      border-color: #bfdbfe;
      background: #dbeafe;
    }

    .thread-copy-button:focus,
    .thread-copy-button:focus-visible {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 2px #dbeafe;
    }

    .rail-actions {
      display: grid;
      gap: 8px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }

    .rail-heading {
      margin: 0 0 2px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .rail-action-group {
      display: grid;
      gap: 7px;
      margin-bottom: 10px;
    }

    .guide-strip {
      display: grid;
      gap: 4px;
      padding: 9px 11px;
      border: 1px solid #c7d2fe;
      border-radius: 8px;
      background: #eef2ff;
    }

    .guide-strip strong {
      color: #3730a3;
      font-size: 12px;
      line-height: 1.4;
    }

    .guide-strip span {
      color: #52525b;
      font-size: 11px;
      line-height: 1.45;
    }

    .rail-action-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }

    .rail-action-button {
      display: grid;
      grid-template-rows: auto auto;
      place-items: center;
      gap: 5px;
      width: 100%;
      min-height: 58px;
      padding: 7px 4px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink);
      background: #ffffff;
      font-size: 12px;
      line-height: 1.15;
      cursor: pointer;
      text-align: center;
    }

    .rail-action-button svg {
      width: 18px;
      height: 18px;
    }

    .rail-action-button span {
      display: block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .rail-action-button:hover {
      border-color: #bfdbfe;
      background: var(--accent-soft);
    }

    .rail-action-button.primary {
      border-color: var(--accent);
      color: #ffffff;
      background: var(--accent);
    }

    .rail-action-button.primary:hover {
      border-color: var(--accent-hover);
      background: var(--accent-hover);
    }

    .rail-action-button.danger {
      border-color: #fecaca;
      color: #b91c1c;
    }

    .rail-action-button.danger:hover {
      border-color: #fca5a5;
      background: #fef2f2;
    }

    .rail-action-button:disabled {
      cursor: default;
    }

    .rail-action-button:disabled:not(.primary) {
      opacity: 0.6;
      color: #9ca3af;
      background: #f8fafc;
    }

    .rail-action-button.primary:disabled {
      opacity: 1;
      border-color: var(--accent);
      color: #ffffff;
      background: var(--accent);
    }

    .action-status {
      display: grid;
      gap: 8px;
      margin: 2px 0 8px;
      padding: 8px 9px;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      color: #333333;
      background: #ecfdf5;
      font-size: 12px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .action-status.busy {
      border-color: #bfdbfe;
      color: #1e3a8a;
      background: #eff6ff;
    }

    .action-status.error {
      border-color: #fecaca;
      color: #991b1b;
      background: #fef2f2;
    }

    .status-folder-button {
      justify-self: start;
      min-height: 28px;
      padding: 5px 9px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      color: #ffffff;
      background: var(--accent);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .status-folder-button:hover {
      border-color: var(--accent-hover);
      background: var(--accent-hover);
    }

    .status-folder-button:disabled {
      cursor: default;
      opacity: 0.75;
    }

    .library-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .library-tile {
      display: grid;
      gap: 6px;
      min-width: 0;
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink);
      background: #ffffff;
      cursor: pointer;
      text-align: left;
    }

    .library-tile:hover {
      border-color: #bfdbfe;
      background: var(--accent-soft);
    }

    .library-card-preview {
      position: relative;
      width: 100%;
      aspect-ratio: 4 / 3;
      border: 1px solid #94a3b8;
      border-radius: 5px;
      background: #ffffff;
    }

    .library-card-preview::after {
      content: "";
      position: absolute;
      inset: 38% 18%;
      border-top: 2px solid #cbd5e1;
      border-bottom: 2px solid #e2e8f0;
    }

    .library-item-preview {
      display: grid;
      place-items: center;
      width: 100%;
      aspect-ratio: 4 / 3;
      overflow: hidden;
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      background: #ffffff;
    }

    .library-item-preview img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .library-item-preview span {
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
    }

    .library-tile span {
      color: var(--ink);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .template-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .template-tile {
      display: grid;
      gap: 6px;
      min-width: 0;
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink);
      background: #ffffff;
      cursor: pointer;
      text-align: left;
    }

    .template-tile:hover {
      border-color: #bfdbfe;
      background: var(--accent-soft);
    }

    .template-preview {
      position: relative;
      display: grid;
      place-items: center;
      width: 100%;
      min-height: 42px;
      max-height: 86px;
      overflow: hidden;
      border: 1px dashed #93c5fd;
      border-radius: 5px;
      background: #eff6ff;
    }

    .template-preview::before {
      content: "AI";
      display: inline-grid;
      place-items: center;
      width: 30px;
      height: 20px;
      border-radius: 5px;
      color: #ffffff;
      background: var(--accent);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0;
    }

    .template-tile strong,
    .template-tile span {
      color: var(--ink);
      font-size: 12px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .template-tile strong {
      font-weight: 700;
    }

    .template-tile span {
      color: var(--muted);
      font-weight: 600;
    }

    .template-compose-preview {
      display: grid;
      place-items: center;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #f8fafc;
    }

    .template-compose-frame {
      position: relative;
      display: grid;
      place-items: center;
      width: min(100%, 320px);
      max-height: 240px;
      border: 1px dashed #93c5fd;
      border-radius: 6px;
      background: #eff6ff;
      color: #1e3a8a;
      font-size: 13px;
      font-weight: 700;
    }

    .template-compose-frame::before {
      content: "AI";
      position: absolute;
      top: 10px;
      left: 10px;
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 22px;
      border-radius: 5px;
      color: #ffffff;
      background: var(--accent);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0;
    }

    .rail-note {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }

    .path {
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #ffffff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .canvas-wrap {
      position: relative;
      min-width: 0;
      min-height: 0;
      background: #f8fafc;
    }

    .canvas-wrap .excalidraw {
      --color-primary: #2563eb;
      --color-primary-darker: #1d4ed8;
      --color-primary-light: #eff6ff;
      --border-radius-md: 6px;
      --border-radius-lg: 8px;
      height: 100%;
    }

    .canvas-wrap .excalidraw [data-testid="main-menu-trigger"],
    .canvas-wrap .excalidraw .main-menu-trigger,
    .canvas-wrap .excalidraw [data-testid="library-button"],
    .canvas-wrap .excalidraw .library-button,
    .canvas-wrap .excalidraw .default-sidebar-trigger,
    .canvas-wrap .excalidraw .sidebar-trigger__label-element,
    .canvas-wrap .excalidraw button[aria-label="Library"],
    .canvas-wrap .excalidraw button[aria-label="素材库"],
    .canvas-wrap .excalidraw button[title="Library"],
    .canvas-wrap .excalidraw button[title="素材库"] {
      display: none !important;
    }

    .fallback {
      display: grid;
      place-items: center;
      height: 100%;
      padding: 32px;
      color: var(--muted);
      text-align: center;
    }

    .fallback strong {
      display: block;
      margin-bottom: 8px;
      color: var(--ink);
    }

    .fallback pre {
      max-width: min(760px, calc(100vw - 48px));
      max-height: 220px;
      margin: 14px 0 0;
      padding: 10px 12px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #ffffff;
      color: var(--warn);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.5;
      text-align: left;
      white-space: pre-wrap;
    }

    .selection-sendbar {
      position: absolute;
      z-index: 20;
      left: 50%;
      bottom: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: calc(100% - 40px);
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
      transform: translateX(-50%);
    }

    .selection-sendbar strong {
      font-size: 12px;
      white-space: nowrap;
    }

    .selection-sendbar .text-button {
      min-width: 118px;
      flex: 0 0 auto;
      white-space: nowrap;
    }

    .selection-sendbar .primary-button {
      min-width: 136px;
    }

    .selection-sendbar .text-button span {
      white-space: nowrap;
    }

    .composer-backdrop {
      position: absolute;
      inset: 0;
      z-index: 30;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(15, 23, 42, 0.28);
    }

    .composer-modal {
      width: min(560px, calc(100vw - 48px));
      max-height: calc(100vh - 96px);
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 20px 48px rgba(15, 23, 42, 0.22);
    }

    .composer-header,
    .composer-body,
    .composer-actions {
      padding: 16px;
    }

    .composer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
    }

    .composer-header h2 {
      margin: 0;
      color: var(--ink);
      font-size: 16px;
      line-height: 1.3;
    }

    .composer-body {
      display: grid;
      gap: 12px;
    }

    .composer-label {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.35;
    }

    .composer-preview {
      width: 100%;
      min-height: 180px;
      max-height: 340px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #f8fafc;
      object-fit: contain;
    }

    .composer-input {
      width: 100%;
      min-height: 110px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink);
      background: #ffffff;
      font: inherit;
      line-height: 1.5;
      resize: vertical;
    }

    .composer-input:focus {
      outline: 2px solid #bfdbfe;
      border-color: var(--accent);
    }

    .composer-status {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }

    .composer-error {
      margin: 0;
      color: #b91c1c;
      font-size: 12px;
      line-height: 1.45;
    }

    .composer-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      border-top: 1px solid var(--line);
    }

    @media (max-width: 860px) {
      .layout {
        grid-template-columns: 1fr;
      }

      .rail {
        display: none;
      }

      .brand {
        min-width: 150px;
      }

      .chipbar {
        display: none;
      }

      .text-button span {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="fallback">
      <div>
        <strong>正在打开 OpenPrd 画布</strong>
        <span>画布会自动绑定当前对话记录。</span>
      </div>
    </div>
  </div>
  <script id="openprd-session" type="application/json">${serialize(session)}</script>
  <script id="openprd-canvas-locales" type="application/json">${serialize({
    defaultLocale: CANVAS_DEFAULT_LOCALE,
    storageKey: CANVAS_LOCALE_STORAGE_KEY,
    messages: CANVAS_LOCALES,
  })}</script>
  <script>
    function escapeBootText(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    window.__openprdCanvasBootError = function(error) {
      const root = document.getElementById("root");
      if (!root || root.querySelector(".shell, .excalidraw")) {
        return;
      }
      const message = error && (error.stack || error.message || String(error)) || "unknown boot error";
      root.innerHTML =
        '<div class="fallback"><div><strong>画布启动失败</strong><span>请刷新页面；如果仍失败，把下面这段错误发给 Agent。</span><pre>' +
        escapeBootText(message) +
        "</pre></div></div>";
    };

    window.addEventListener("error", (event) => {
      if (event.target && event.target !== window) {
        const tagName = event.target.tagName;
        if (tagName !== "SCRIPT" && tagName !== "LINK") {
          return;
        }
      }
      window.__openprdCanvasBootError(event.error || event.message);
    }, true);

    window.addEventListener("unhandledrejection", (event) => {
      window.__openprdCanvasBootError(event.reason);
    });
  </script>
  <script type="module">
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { Excalidraw, convertToExcalidrawElements, exportToCanvas, serializeAsJSON } from "@excalidraw/excalidraw";

    const session = JSON.parse(document.getElementById("openprd-session").textContent);
    const localeConfig = JSON.parse(document.getElementById("openprd-canvas-locales").textContent);
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

    function createElementId(prefix = "openprd-lib") {
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
          console.warn("OpenPrd canvas save failed", error);
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

    function createSceneFilename(prefix = "openprd-canvas") {
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

    function buildCodexPrompt(t, exportPath, elementCount, instruction) {
      const binding = conversationId();
      const trimmedInstruction = String(instruction || "").trim();
      return [
        trimmedInstruction || t.codexPromptDefaultInstruction,
        "",
        t.codexPromptIntro,
        "",
        "![OpenPrd Canvas selection](" + exportPath + ")",
        "",
        exportPath,
        "",
        formatMessage(t.codexPromptMeta, { count: elementCount, binding }),
      ].join("\\n");
    }

    function buildThreadPrompt(t) {
      return formatMessage(t.threadPromptTemplate, {
        title: conversationTitle(t),
        id: conversationId(),
      });
    }

    async function recordCodexHandoff(exported, promptText, locale, instruction) {
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
          selection: operation.selection || (exported.selected.length > 0 ? "selected" : "scene"),
          selectedElementIds: exported.selected.map((element) => element.id),
          elementCount: exported.elements.length,
          locale,
          instruction,
          relayWaitMs: codexRelayStartWaitMs,
          note: "canvas-send-to-codex",
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
        t.aiImagePromptReturn,
        "",
        JSON.stringify({
          placeholderId,
          aspectRatio: template.aspectRatio,
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
      const requestId = createElementId("openprd-ai-image");
      const groupId = createElementId("openprd-ai-group");
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
          const fileId = "openprd-direction-" + direction.id + "-" + Date.now();
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
      const fileId = op.fileId || ("openprd-image-" + Date.now());
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
        console.warn("OpenPrd canvas op polling failed", error);
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
        console.warn("OpenPrd canvas agent bridge polling failed", error);
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
      window.dispatchEvent(new CustomEvent("openprd-canvas-exported", { detail: { ...result, intent } }));
      return {
        result,
        elements,
        selected,
      };
    }

    async function exportSelection() {
      return exportCanvasElements({ intent: "manual-export" }).catch((error) => {
        console.warn("OpenPrd canvas export failed", error);
        return null;
      });
    }

    function CanvasApp() {
      const [initialData, setInitialData] = React.useState(null);
      const [loadError, setLoadError] = React.useState(null);
      const [locale, setLocale] = React.useState(initialLocale);
      const [selectedCount, setSelectedCount] = React.useState(0);
      const [selectedImageCount, setSelectedImageCount] = React.useState(0);
      const [isSending, setIsSending] = React.useState(false);
      const [isExporting, setIsExporting] = React.useState(false);
      const [isDownloadingSelection, setIsDownloadingSelection] = React.useState(false);
      const [isOpeningFolder, setIsOpeningFolder] = React.useState(false);
      const [actionStatus, setActionStatus] = React.useState(null);
      const [composer, setComposer] = React.useState(null);
      const [imageComposer, setImageComposer] = React.useState(null);
      const [isRequestingImage, setIsRequestingImage] = React.useState(false);
      const [libraryItems, setLibraryItems] = React.useState([]);
      const [libraryPreviews, setLibraryPreviews] = React.useState({});
      const [guide, setGuide] = React.useState(null);
      const [isImportingDirections, setIsImportingDirections] = React.useState(false);
      const latestHandoffSignalSeqRef = React.useRef(0);
      const t = messagesFor(locale);
      const aiTemplates = React.useMemo(() => imageTemplateOptions(t), [locale]);

      React.useEffect(() => {
        syncSelectionState = (appState, elements) => {
          setSelectedCount(selectedCountFromAppState(appState));
          setSelectedImageCount(selectedImageCountFromAppState(appState, elements));
        };
        return () => {
          syncSelectionState = () => {};
        };
      }, []);

      React.useEffect(() => {
        const shouldApplyHandoffSignal = (op) => {
          const seq = Number(op.seq || 0);
          if (seq > 0 && seq < latestHandoffSignalSeqRef.current) {
            return false;
          }
          if (seq > 0) {
            latestHandoffSignalSeqRef.current = seq;
          }
          return true;
        };
        syncCodexRelayStatus = (op) => {
          if (!shouldApplyHandoffSignal(op)) {
            return;
          }
          if (op.dryRun) {
            setActionStatus(null);
            return;
          }
          if (op.status === "completed" || op.status === "started") {
            setActionStatus({ type: "success", message: t.sentBodyWithRelay });
          } else if (["queued", "starting", "resuming", "connecting"].includes(op.status)) {
            setActionStatus({ type: "busy", message: t.sentBodyPending });
          } else if (op.status === "failed" || op.status === "timeout" || op.status === "closed") {
            setActionStatus({ type: "error", message: op.error || t.agentBridgeFailed });
          }
        };
        syncAgentBridgeStatus = (op) => {
          if (!shouldApplyHandoffSignal(op)) {
            return;
          }
          if (op.status === "sent") {
            setActionStatus({ type: "success", message: t.agentBridgeSent });
          } else if (op.status === "failed") {
            setActionStatus({ type: "error", message: op.reason || t.agentBridgeFailed });
          } else if (op.status === "pending" || op.status === "claimed") {
            setActionStatus({ type: "busy", message: agentBridgePendingMessage(t, op.status) });
          }
        };
        return () => {
          syncCodexRelayStatus = () => {};
          syncAgentBridgeStatus = () => {};
        };
      }, [t]);

      React.useEffect(() => {
        document.documentElement.lang = locale;
        try {
          window.localStorage.setItem(localeConfig.storageKey, locale);
        } catch {}
      }, [locale]);

      React.useEffect(() => {
        let mounted = true;
        Promise.all([
          fetchJson("/api/scene"),
          fetchJson("/api/library").catch(() => ({ libraryItems: [] })),
        ])
          .then(([scene, library]) => {
            if (mounted) {
              const libraryItems = libraryItemsFromPayload(library);
              const normalizedScene = normalizeInitialScene(scene);
              setInitialData({
                ...normalizedScene,
                libraryItems,
              });
              setLibraryItems(libraryItems);
              latestElements = normalizedScene.elements;
              latestAppState = normalizedScene.appState;
              latestFiles = normalizedScene.files;
              setSelectedCount(selectedCountFromAppState(normalizedScene.appState));
              setSelectedImageCount(selectedImageCountFromAppState(normalizedScene.appState, normalizedScene.elements));
              if (scene?.appState?.viewBackgroundColor !== normalizedScene.appState.viewBackgroundColor) {
                fetchJson("/api/scene", {
                  method: "POST",
                  body: JSON.stringify({
                    type: "openprd.canvas.scene.v1",
                    elements: normalizedScene.elements,
                    appState: stripAppState(normalizedScene.appState),
                    files: normalizedScene.files,
                    savedAt: new Date().toISOString(),
                  }),
                }).catch((error) => {
                  console.warn("OpenPrd canvas background migration failed", error);
                });
              }
            }
          })
          .catch((error) => {
            if (mounted) {
              setLoadError(error);
            }
          });
        return () => {
          mounted = false;
          window.clearInterval(pollTimer);
        };
      }, []);

      React.useEffect(() => {
        pollTimer = window.setInterval(pollOperations, 1400);
        pollOperations();
        return () => window.clearInterval(pollTimer);
      }, []);

      React.useEffect(() => {
        let mounted = true;
        const loadGuide = () => {
          fetchJson("/api/guide")
            .then((result) => {
              if (mounted && result && result.ok && result.currentStage) {
                setGuide(result);
              }
            })
            .catch(() => {});
        };
        loadGuide();
        const timer = window.setInterval(loadGuide, 30000);
        return () => {
          mounted = false;
          window.clearInterval(timer);
        };
      }, []);

      async function handleImportReviewDirections() {
        if (isImportingDirections) {
          return;
        }
        setIsImportingDirections(true);
        try {
          const result = await importReviewDirectionsToCanvas(t);
          setActionStatus({ type: "success", message: formatMessage(t.reviewDirectionsImported, { count: result.count }) });
        } catch (error) {
          setActionStatus({
            type: "error",
            message: error?.code === "empty" ? t.reviewDirectionsEmpty : t.reviewDirectionsFailed,
          });
        } finally {
          setIsImportingDirections(false);
        }
      }

      React.useEffect(() => {
        hideNativeExcalidrawChrome();
        const observer = new MutationObserver(hideNativeExcalidrawChrome);
        const root = document.querySelector(".canvas-wrap");
        if (root) {
          observer.observe(root, { childList: true, subtree: true });
        }
        return () => observer.disconnect();
      }, [initialData, locale]);

      React.useEffect(() => {
        let cancelled = false;
        async function buildPreviews() {
          if (!initialData || !exportToCanvas || libraryItems.length === 0) {
            setLibraryPreviews({});
            return;
          }
          const previews = {};
          for (const item of libraryItems.slice(0, 40)) {
            if (cancelled || !Array.isArray(item.elements) || item.elements.length === 0) {
              continue;
            }
            try {
              const canvas = await exportToCanvas({
                elements: item.elements,
                appState: {
                  exportBackground: true,
                  viewBackgroundColor: "#ffffff",
                },
                files: currentFilesForFile(),
                exportPadding: 12,
                maxWidthOrHeight: 320,
              });
              previews[item.id] = canvas.toDataURL("image/png");
            } catch (error) {
              console.warn("OpenPrd canvas library preview failed", error);
            }
          }
          if (!cancelled) {
            setLibraryPreviews(previews);
          }
        }
        buildPreviews();
        return () => {
          cancelled = true;
        };
      }, [initialData, libraryItems]);

      function changeLocale(event) {
        setLocale(normalizeLocale(event.target.value));
      }

      async function copyThreadPrompt() {
        const copied = await copyTextToClipboard(buildThreadPrompt(t));
        setActionStatus({
          type: copied ? "success" : "error",
          message: copied ? t.threadPromptCopied : t.threadPromptCopyFailed,
        });
      }

      function resetCanvas() {
        if (!window.confirm(t.resetConfirm)) {
          return;
        }
        latestElements = [];
        latestFiles = {};
        latestAppState = normalizeCanvasAppState({
          ...latestAppState,
          selectedElementIds: {},
        });
        excalidrawAPI?.updateScene?.({ elements: [], appState: latestAppState });
        setSelectedCount(0);
        setSelectedImageCount(0);
        setActionStatus({ type: "success", message: t.resetCanvas });
        queueSave();
      }

      async function persistLibraryItems(items, intent = "sync-excalidraw-library") {
        return fetchJson("/api/library", {
          method: "POST",
          body: JSON.stringify({
            type: "excalidrawlib",
            version: 2,
            source: "https://openprd.local/canvas",
            libraryItems: items,
            intent,
            locale,
          }),
        });
      }

      function handleLibraryChange(items) {
        const nextItems = Array.isArray(items) ? items : [];
        setLibraryItems(nextItems);
        persistLibraryItems(nextItems).catch((error) => {
          console.warn("OpenPrd canvas library save failed", error);
        });
      }

      async function openContainingFolder(target) {
        const downloadFileName = target?.downloadFileName || "";
        const targetPath = target?.openPath || "";
        if ((!downloadFileName && !targetPath) || isOpeningFolder) {
          return;
        }
        setIsOpeningFolder(true);
        try {
          await fetchJson(downloadFileName ? "/api/open-download" : "/api/open-folder", {
            method: "POST",
            body: JSON.stringify(downloadFileName ? { filename: downloadFileName } : { path: targetPath }),
          });
        } catch (error) {
          console.warn("OpenPrd canvas open folder failed", error);
          setActionStatus((current) => ({
            type: "error",
            message: t.openFolderFailed,
            openPath: current?.openPath || targetPath,
            downloadFileName: current?.downloadFileName || downloadFileName,
          }));
        } finally {
          setIsOpeningFolder(false);
        }
      }

      async function handleSaveCanvas() {
        setActionStatus({ type: "busy", message: t.savingCanvas });
        try {
          const result = await saveCanvasToDisk();
          setActionStatus({
            type: "success",
            message: formatMessage(t.savedCanvas, { filename: result.filename }),
            downloadFileName: result.filename,
          });
        } catch (error) {
          console.warn("OpenPrd canvas save-as failed", error);
          setActionStatus({ type: "error", message: t.saveFailed });
        }
      }

      async function handleExportImage() {
        if (isExporting) {
          return;
        }
        setIsExporting(true);
        setActionStatus({ type: "busy", message: t.exportingImage });
        try {
          const exportData = await exportCanvasImage(locale);
          const path = exportData.exportPath || exportData.fileName || exportData.exportUrl || "";
          setActionStatus({
            type: "success",
            message: formatMessage(t.exportedImage, { path }),
            openPath: exportData.exportPath || "",
          });
        } catch (error) {
          console.warn("OpenPrd canvas image export failed", error);
          setActionStatus({ type: "error", message: error?.code === "empty-scene" ? t.emptySceneExportBody : t.exportFailed });
        } finally {
          setIsExporting(false);
        }
      }

      async function downloadSelectedImage() {
        if (isDownloadingSelection || selectedImageCount <= 0) {
          return;
        }
        setIsDownloadingSelection(true);
        setActionStatus({ type: "busy", message: t.downloadingSelectedImage });
        try {
          const filename = createExportFilename("openprd-selected-image");
          const exported = await exportCanvasElements({
            requireSelection: true,
            intent: "download-selected-image",
            locale,
            filename,
          });
          const exportData = exported.result.export || {};
          const result = await fetchJson("/api/download-image", {
            method: "POST",
            body: JSON.stringify({
              path: exportData.exportPath,
              filename: exportData.fileName || filename,
            }),
          });
          const fileName = result.file?.fileName || exportData.fileName || filename;
          setActionStatus({
            type: "success",
            message: formatMessage(t.downloadedSelectedImage, { filename: fileName }),
            downloadFileName: fileName,
          });
        } catch (error) {
          console.warn("OpenPrd canvas selected image download failed", error);
          setActionStatus({ type: "error", message: t.downloadSelectedImageFailed });
        } finally {
          setIsDownloadingSelection(false);
        }
      }

      function libraryItemName(item, index) {
        return item?.name || formatMessage(t.libraryItemName, {
          index: index + 1,
          count: Array.isArray(item?.elements) ? item.elements.length : 0,
        });
      }

      function insertLibraryItem(item) {
        if (!item || !Array.isArray(item.elements) || item.elements.length === 0) {
          return;
        }
        const bounds = boundsForElements(item.elements);
        const point = getViewportDropPoint(bounds.width, bounds.height);
        const offsetX = point.x - bounds.x;
        const offsetY = point.y - bounds.y;
        const cloned = item.elements.map((element) => cloneLibraryElement(element, offsetX, offsetY));
        updateScene([...latestElements, ...cloned]);
        setActionStatus({ type: "success", message: t.insertedLibraryItem });
      }

      function updateComposerInstruction(event) {
        const value = event.target.value;
        setComposer((current) => current ? { ...current, instruction: value, status: current.status === "sent" ? "ready" : current.status, promptText: "" } : current);
      }

      async function prepareSelectionForCodex() {
        if (isSending) {
          return;
        }
        setIsSending(true);
        setComposer(null);
        try {
          const selected = currentSelectedElements();
          if (selected.length === 0) {
            setComposer({
              status: "error",
              title: t.emptySelectionTitle,
              body: t.emptySelectionBody,
            });
            return;
          }
          const filename = createExportFilename("codex-selection");
          const exported = await exportCanvasElements({
            requireSelection: true,
            intent: "codex-handoff",
            locale,
            filename,
          });
          const exportPath = exported.result.export.exportPath;
          setComposer({
            status: "ready",
            title: t.composerTitle,
            body: "",
            exported,
            exportPath,
            exportUrl: exported.result.export.exportUrl,
            elementCount: exported.elements.length,
            instruction: "",
            promptText: "",
          });
        } catch (error) {
          setComposer({
            status: "error",
            title: t.sendErrorTitle,
            body: error.message || String(error),
          });
        } finally {
          setIsSending(false);
        }
      }

      async function sendComposerToCodex() {
        if (!composer?.exported || isSending) {
          return;
        }
        setIsSending(true);
        setComposer((current) => current ? { ...current, status: "sending", error: "" } : current);
        try {
          const instruction = String(composer.instruction || "").trim();
          const promptText = buildCodexPrompt(t, composer.exportPath, composer.elementCount, instruction);
          let relayTimedOut = false;
          const relay = await withTimeout(recordCodexHandoff(composer.exported, promptText, locale, instruction), codexRelayUiTimeoutMs).catch((error) => {
            relayTimedOut = error?.message === "timeout";
            console.warn("OpenPrd canvas handoff record failed", error);
            return null;
          });
          const copied = await withTimeout(copyTextToClipboard(promptText), 1800).catch(() => false);
          const relayed = relayWasAccepted(relay);
          const agentBridgePending = agentBridgeIsPending(relay);
          const relayPending = relayIsPending(relay, relayTimedOut);
          setComposer((current) => current ? {
            ...current,
            status: "sent",
            copied,
            body: agentBridgePending ? t.sentBodyAgentBridge : (relayed ? t.sentBodyWithRelay : (relayPending ? t.sentBodyPending : (copied ? t.sentBody : t.sendManualCopyBody))),
            promptText,
          } : current);
        } catch (error) {
          setComposer((current) => current ? {
            ...current,
            status: "ready",
            error: error.message || String(error),
          } : current);
        } finally {
          setIsSending(false);
        }
      }

      async function copyCurrentPrompt() {
        if (composer?.promptText) {
          await copyTextToClipboard(composer.promptText);
        }
      }

      function openImageTemplate(template) {
        setImageComposer({
          status: "ready",
          template,
          instruction: "",
          promptText: "",
          error: "",
        });
      }

      function updateImageComposerInstruction(event) {
        const value = event.target.value;
        setImageComposer((current) => current ? {
          ...current,
          instruction: value,
          status: current.status === "sent" ? "ready" : current.status,
          error: "",
        } : current);
      }

      async function submitImageTemplateRequest() {
        if (!imageComposer?.template || isRequestingImage) {
          return;
        }
        const instruction = String(imageComposer.instruction || "").trim();
        if (!instruction) {
          setImageComposer((current) => current ? { ...current, error: t.imagePromptRequired } : current);
          return;
        }
        setIsRequestingImage(true);
        setImageComposer((current) => current ? { ...current, status: "sending", error: "" } : current);
        try {
          const created = createAiImageCard(imageComposer.template, instruction, t);
          const promptText = buildImageRequestPrompt(t, imageComposer.template, instruction, created.placeholderId);
          attachAiImagePrompt(created.placeholderId, promptText);
          let relayTimedOut = false;
          const relay = await withTimeout(recordCodexImageRequestHandoff(promptText, locale, instruction, imageComposer.template, created), codexRelayUiTimeoutMs).catch((error) => {
            relayTimedOut = error?.message === "timeout";
            console.warn("OpenPrd canvas image handoff record failed", error);
            return null;
          });
          const copied = await withTimeout(copyTextToClipboard(promptText), 1800).catch(() => false);
          const relayed = relayWasAccepted(relay);
          const agentBridgePending = agentBridgeIsPending(relay);
          const relayPending = relayIsPending(relay, relayTimedOut);
          setActionStatus({
            type: relayed ? "success" : (agentBridgePending || relayPending ? "busy" : "success"),
            message: agentBridgePending ? t.imageRequestAgentBridge : (relayed ? t.imageRequestSent : (relayPending ? t.imageRequestPending : (copied ? t.imageRequestPrepared : t.imageRequestManualCopy))),
          });
          setImageComposer(null);
        } catch (error) {
          console.warn("OpenPrd canvas image request failed", error);
          setImageComposer((current) => current ? {
            ...current,
            status: "ready",
            error: error.message || String(error),
          } : current);
        } finally {
          setIsRequestingImage(false);
        }
      }

      if (loadError) {
        return h("div", { className: "fallback" },
          h("div", null,
            h("strong", null, t.loadErrorTitle),
            h("span", null, loadError.message || String(loadError)),
          ),
        );
      }

      if (!initialData) {
        return h("div", { className: "fallback" },
          h("div", null,
            h("strong", null, t.loadingTitle),
            h("span", null, t.loadingBody),
          ),
        );
      }

      return h("div", { className: "shell" },
        h("header", { className: "topbar" },
          h("div", { className: "brand" },
            h("strong", null, "OpenPrd Canvas"),
            h("span", null, t.appSubtitle),
          ),
          h("div", { className: "actions" },
            h("select", {
              className: "language-select",
              "aria-label": t.languageLabel,
              "data-testid": "openprd-canvas-locale",
              value: locale,
              onChange: changeLocale,
            },
              h("option", { value: "zh-CN" }, "中文"),
              h("option", { value: "en" }, "English"),
            ),
          ),
        ),
        h("main", { className: "layout" },
          h("section", { className: "canvas-wrap" },
            h(Excalidraw, {
              excalidrawAPI: (api) => {
                excalidrawAPI = api;
                window.__openprdExcalidrawAPI = api;
              },
              initialData,
              name: "OpenPrd Canvas",
              langCode: locale,
              UIOptions: {
                canvasActions: {
                  loadScene: false,
                  saveToActiveFile: false,
                  export: {
                    saveFileToDisk: true,
                  },
                },
              },
              onChange: (elements, appState, files) => {
                latestElements = elements || [];
                latestAppState = normalizeCanvasAppState(appState || {});
                latestFiles = files || {};
                setSelectedCount(selectedCountFromAppState(latestAppState));
                setSelectedImageCount(selectedImageCountFromAppState(latestAppState, latestElements));
                queueSave();
              },
              onLibraryChange: handleLibraryChange,
            }),
            selectedCount > 0 && h("div", { className: "selection-sendbar", "data-testid": "openprd-canvas-selection-sendbar" },
              h("strong", null, formatMessage(t.selectedCount, { count: selectedCount })),
              selectedImageCount > 0 && h("button", {
                className: "text-button subtle-button",
                disabled: isDownloadingSelection || isSending,
                onClick: downloadSelectedImage,
                "data-testid": "openprd-canvas-download-image",
              }, toolIcon("export"), h("span", null, isDownloadingSelection ? t.downloadingSelectedImage : t.downloadSelectedImage)),
              h("button", {
                className: "text-button primary-button",
                disabled: isSending,
                onClick: prepareSelectionForCodex,
                "data-testid": "openprd-canvas-send-codex",
              }, toolIcon("send"), h("span", null, isSending ? t.sendingToCodex : t.sendToCodex)),
            ),
            composer && h("div", { className: "composer-backdrop", "data-testid": "openprd-canvas-composer" },
              h("section", { className: "composer-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "openprd-canvas-composer-title" },
                h("div", { className: "composer-header" },
                  h("h2", { id: "openprd-canvas-composer-title" }, composer.title || t.composerTitle),
                  h("button", { className: "text-button", onClick: () => setComposer(null) }, h("span", null, t.dismiss)),
                ),
                h("div", { className: "composer-body" },
                  composer.exportUrl && h(React.Fragment, null,
                    h("p", { className: "composer-label" }, t.previewLabel),
                    h("img", { className: "composer-preview", src: composer.exportUrl, alt: t.composerPreviewAlt }),
                  ),
                  composer.exported && h(React.Fragment, null,
                    h("p", { className: "composer-label" }, t.instructionLabel),
                    h("textarea", {
                      className: "composer-input",
                      value: composer.instruction || "",
                      placeholder: t.instructionPlaceholder,
                      disabled: isSending || composer.status === "sent",
                      onChange: updateComposerInstruction,
                      "data-testid": "openprd-canvas-composer-prompt",
                    }),
                  ),
                  composer.body && h("p", { className: "composer-status" }, composer.body),
                  composer.error && h("p", { className: "composer-error" }, composer.error),
                ),
                h("div", { className: "composer-actions" },
                  composer.promptText && h("button", { className: "text-button", onClick: copyCurrentPrompt }, toolIcon("copy"), h("span", null, t.copyPrompt)),
                  composer.exported && h("button", {
                    className: "text-button primary-button",
                    disabled: isSending || composer.status === "sent",
                    onClick: sendComposerToCodex,
                    "data-testid": "openprd-canvas-composer-submit",
                  }, toolIcon("send"), h("span", null, isSending || composer.status === "sending" ? t.sendingToCodex : t.sendToCodex)),
                ),
              ),
            ),
            imageComposer && h("div", { className: "composer-backdrop", "data-testid": "openprd-canvas-image-composer" },
              h("section", { className: "composer-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "openprd-canvas-image-composer-title" },
                h("div", { className: "composer-header" },
                  h("h2", { id: "openprd-canvas-image-composer-title" }, t.aiImageComposerTitle),
                  h("button", { className: "text-button", onClick: () => setImageComposer(null), disabled: isRequestingImage }, h("span", null, t.dismiss)),
                ),
                h("div", { className: "composer-body" },
                  h("p", { className: "composer-label" }, t.aiImageTemplateLabel),
                  h("div", { className: "template-compose-preview" },
                    h("div", {
                      className: "template-compose-frame",
                      style: { aspectRatio: imageComposer.template.width + " / " + imageComposer.template.height },
                    }, h("span", null, imageComposer.template.label)),
                  ),
                  h("p", { className: "composer-label" }, t.aiImageInstructionLabel),
                  h("textarea", {
                    className: "composer-input",
                    value: imageComposer.instruction || "",
                    placeholder: t.aiImageInstructionPlaceholder,
                    disabled: isRequestingImage,
                    onChange: updateImageComposerInstruction,
                    "data-testid": "openprd-canvas-image-prompt",
                  }),
                  imageComposer.error && h("p", { className: "composer-error" }, imageComposer.error),
                ),
                h("div", { className: "composer-actions" },
                  h("button", { className: "text-button", onClick: () => setImageComposer(null), disabled: isRequestingImage }, h("span", null, t.dismiss)),
                  h("button", {
                    className: "text-button primary-button",
                    disabled: isRequestingImage,
                    onClick: submitImageTemplateRequest,
                    "data-testid": "openprd-canvas-create-ai-image",
                  }, toolIcon("send"), h("span", null, isRequestingImage ? t.sendingToCodex : t.createAiImageCard)),
                ),
              ),
            ),
          ),
          h("aside", { className: "rail" },
            h("section", { className: "thread-summary", "data-testid": "openprd-canvas-thread-summary" },
              h("p", { className: "thread-title" }, conversationTitle(t)),
              h("div", { className: "thread-id-row" },
                h("p", { className: "thread-id" }, conversationId()),
                h("button", {
                  className: "thread-copy-button",
                  type: "button",
                  title: t.copyThreadPrompt,
                  "aria-label": t.copyThreadPrompt,
                  onClick: copyThreadPrompt,
                  "data-testid": "openprd-canvas-copy-thread",
                }, toolIcon("copy")),
              ),
            ),
            h("section", { className: "rail-actions", "data-testid": "openprd-canvas-rail-actions" },
              h("div", { className: "rail-action-group", "data-testid": "openprd-canvas-review-board" },
                h("p", { className: "rail-heading" }, t.reviewBoardTitle),
                guide && h("div", { className: "guide-strip", "data-testid": "openprd-canvas-guide" },
                  h("strong", null, formatMessage(t.reviewGuideStage, {
                    index: guide.currentStage.index,
                    total: guide.totalStages,
                    title: guide.currentStage.title,
                  })),
                  guide.nextAction && h("span", null, formatMessage(t.reviewGuideNext, { action: guide.nextAction })),
                ),
                h("button", {
                  className: "rail-action-button",
                  title: t.importReviewDirections,
                  disabled: isImportingDirections,
                  onClick: handleImportReviewDirections,
                  "data-testid": "openprd-canvas-import-directions",
                }, toolIcon("export"), h("span", null, isImportingDirections ? t.importingReviewDirections : t.importReviewDirections)),
              ),
              h("div", { className: "rail-action-group" },
                h("p", { className: "rail-heading" }, t.canvasActionsTitle),
                h("div", { className: "rail-action-grid" },
                  h("button", {
                    className: "rail-action-button",
                    title: t.saveCanvas,
                    onClick: handleSaveCanvas,
                    "data-testid": "openprd-canvas-save",
                  }, toolIcon("save"), h("span", null, t.saveCanvas)),
                  h("button", {
                    className: "rail-action-button",
                    title: t.exportImage,
                    disabled: isExporting,
                    onClick: handleExportImage,
                    "data-testid": "openprd-canvas-export-image",
                  }, toolIcon("export"), h("span", null, isExporting ? t.exportingImage : t.exportImage)),
                  h("button", {
                    className: "rail-action-button danger",
                    title: t.resetCanvas,
                    onClick: resetCanvas,
                    "data-testid": "openprd-canvas-reset",
                  }, toolIcon("reset"), h("span", null, t.resetCanvas)),
                ),
                actionStatus && h("div", {
                  className: "action-status" + (actionStatus.type === "error" ? " error" : "") + (actionStatus.type === "busy" ? " busy" : ""),
                  "data-testid": "openprd-canvas-action-status",
                },
                  h("span", null, actionStatus.message),
                  (actionStatus.openPath || actionStatus.downloadFileName) && h("button", {
                    className: "status-folder-button",
                    disabled: isOpeningFolder,
                    onClick: () => openContainingFolder(actionStatus),
                    "data-testid": "openprd-canvas-open-folder",
                  }, isOpeningFolder ? t.openingFolder : t.openContainingFolder),
                ),
              ),
              h("div", { className: "rail-action-group" },
                h("p", { className: "rail-heading" }, t.aiImageTemplatesTitle),
                h("div", { className: "template-grid", "data-testid": "openprd-canvas-ai-templates" },
                  aiTemplates.map((template) => h("button", {
                    key: template.id,
                    className: "template-tile",
                    title: template.title + " " + template.label,
                    onClick: () => openImageTemplate(template),
                    "data-testid": "openprd-canvas-ai-template-" + template.id,
                  },
                    h("span", {
                      className: "template-preview",
                      style: { aspectRatio: template.width + " / " + template.height },
                      "aria-hidden": "true",
                    }),
                    h("strong", null, template.label),
                    h("span", null, template.title),
                  )),
                ),
              ),
              h("div", { className: "rail-action-group" },
                h("p", { className: "rail-heading" }, t.personalLibraryTitle),
                h("div", { className: "library-grid", "data-testid": "openprd-canvas-personal-library" },
                  libraryItems.map((item, index) => h("button", {
                    key: item.id || index,
                    className: "library-tile",
                    title: libraryItemName(item, index),
                    onClick: () => insertLibraryItem(item),
                    "data-testid": "openprd-canvas-library-item",
                  },
                    h("span", { className: "library-item-preview", "aria-hidden": "true" },
                      libraryPreviews[item.id]
                        ? h("img", { src: libraryPreviews[item.id], alt: "" })
                        : h("span", null, formatMessage(t.libraryItemCount, { count: Array.isArray(item.elements) ? item.elements.length : 0 })),
                    ),
                    h("span", null, libraryItemName(item, index)),
                  )),
                  h("button", {
                    className: "library-tile",
                    title: t.blankCard,
                    onClick: () => addBlankCard(t.placeholderText),
                    "data-testid": "openprd-canvas-blank-card",
                  },
                    h("span", { className: "library-card-preview", "aria-hidden": "true" }),
                    h("span", null, t.blankCard),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    createRoot(document.getElementById("root")).render(h(CanvasApp));
  </script>
</body>
</html>`;
}

export { renderCanvasAppHtml };
