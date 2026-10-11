/*
 * Core purpose
 * Hold the CSS for the `open-vibecoding canvas` browser shell.
 *
 * Positioning
 * Extracted from canvas-app.html.js so the HTML renderer stays small.
 * This is a raw <style> payload; keep it dependency-free.
 */
export const CANVAS_APP_STYLES = `
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
`;
