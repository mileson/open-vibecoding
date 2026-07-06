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
import { CANVAS_APP_STYLES } from './canvas-app-styles.js';
import { CANVAS_APP_CLIENT_HELPERS } from './canvas-app-client-helpers.js';
import { CANVAS_APP_CLIENT_APP } from './canvas-app-client-app.js';

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
${CANVAS_APP_STYLES}
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
${CANVAS_APP_CLIENT_HELPERS}
${CANVAS_APP_CLIENT_APP}
  </script>
</body>
</html>`;
}

export { renderCanvasAppHtml };
