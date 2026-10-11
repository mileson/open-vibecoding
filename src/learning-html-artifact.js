import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cjoin } from './fs-utils.js';
import { escapeHtml, listMarkup, slugify } from './html-artifact-utils.js';

function learningSourceAnchor(sourceId) {
  return `source-${slugify(sourceId, 'source')}`;
}

function learningAssetUrl(rawPath) {
  const value = String(rawPath ?? '').trim();
  if (!value) return null;
  if (/^(?:https?:|data:|file:)/i.test(value)) return value;
  if (path.isAbsolute(value)) return pathToFileURL(value).href;
  return encodeURI(value.split(path.sep).join('/'));
}

function formatLearningParagraphs(paragraphs) {
  const list = Array.isArray(paragraphs) ? paragraphs.filter(Boolean) : [];
  return list.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n');
}

function formatLearningRetrievalBlocks(blocks, chapterId) {
  const list = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  if (list.length === 0) return '';
  return `
    <section class="learning-block retrieval" id="${escapeHtml(chapterId)}-retrieval">
      <h4>检索练习</h4>
      ${list.map((block, index) => `
        <details class="retrieval-item" id="${escapeHtml(chapterId)}-retrieval-${index + 1}">
          <summary><span>R${index + 1}</span>${escapeHtml(block.prompt)}</summary>
          ${block.hint ? `<div class="retrieval-hint">提示: ${escapeHtml(block.hint)}</div>` : ''}
          <div class="retrieval-answer">参考答案: ${escapeHtml(block.answer)}</div>
        </details>
      `).join('\n')}
    </section>
  `;
}

function formatLearningWorkedExamples(examples, chapterId) {
  const list = Array.isArray(examples) ? examples.filter(Boolean) : [];
  if (list.length === 0) return '';
  return `
    <section class="learning-block worked" id="${escapeHtml(chapterId)}-worked">
      <h4>工作示例</h4>
      ${list.map((example, index) => `
        <div class="worked-item" id="${escapeHtml(chapterId)}-worked-${index + 1}">
          <div class="worked-title">${escapeHtml(example.title)}</div>
          <p>${escapeHtml(example.scenario)}</p>
          <ol>${listMarkup(example.steps, '暂无步骤')}</ol>
          ${example.principle ? `<div class="worked-principle">原则: ${escapeHtml(example.principle)}</div>` : ''}
        </div>
      `).join('\n')}
    </section>
  `;
}

function formatLearningVisualExplainer(explainer, chapterId) {
  if (!explainer || typeof explainer !== 'object') return '';
  const takeaways = Array.isArray(explainer.takeaways) ? explainer.takeaways.filter(Boolean) : [];
  const imageUrl = learningAssetUrl(explainer.image?.path);
  const hasImage = Boolean(imageUrl);
  return `
    <section class="learning-block visual" id="${escapeHtml(chapterId)}-visual">
      <div class="visual-header">
        <div class="visual-kicker">一眼看懂</div>
        <h4>${escapeHtml(explainer.title ?? '图文解释')}</h4>
      </div>
      <div class="visual-grid${hasImage ? ' has-image' : ''}">
        ${hasImage ? `
          <figure class="visual-figure">
            <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(explainer.image?.alt ?? explainer.title ?? 'visual explainer')}" loading="lazy" />
            ${explainer.image?.caption ? `<figcaption>${escapeHtml(explainer.image.caption)}</figcaption>` : ''}
          </figure>
        ` : ''}
        <div class="visual-copy">
          <div class="visual-note">
            <div class="visual-label">比喻</div>
            <p>${escapeHtml(explainer.analogy ?? '')}</p>
          </div>
          <div class="visual-note">
            <div class="visual-label">场景</div>
            <p>${escapeHtml(explainer.scene ?? '')}</p>
          </div>
          <div class="visual-note">
            <div class="visual-label">为什么这张图有用</div>
            <p>${escapeHtml(explainer.whyItMatters ?? '')}</p>
          </div>
          ${takeaways.length > 0 ? `
            <div class="visual-note">
              <div class="visual-label">看图重点</div>
              <ul class="visual-takeaways">${listMarkup(takeaways, '暂无重点')}</ul>
            </div>
          ` : ''}
        </div>
      </div>
    </section>
  `;
}

function formatLearningEvidenceDetails(chapter, sourcesById) {
  const ids = Array.isArray(chapter.evidenceIds) ? chapter.evidenceIds.filter(Boolean) : [];
  if (ids.length === 0) return '';
  return `
    <details class="chapter-evidence" id="${escapeHtml(chapter.id)}-evidence">
      <summary>
        <span class="evidence-summary-title">本章出处</span>
        <span class="evidence-summary-count">${ids.length} 个来源</span>
      </summary>
      <div class="evidence-mini-list">
        ${ids.map((id) => {
          const source = sourcesById.get(id);
          return `
            <div class="evidence-mini-card">
              <strong>${escapeHtml(source?.title ?? id)}</strong>
              <span>${escapeHtml(source?.relativePath ?? source?.path ?? id)}</span>
              ${source?.summary ? `<p>${escapeHtml(source.summary)}</p>` : ''}
            </div>
          `;
        }).join('\n')}
      </div>
    </details>
  `;
}

function formatLearningChapter(chapter, index, sourcesById) {
  return `
    <section class="chapter${index === 0 ? ' active' : ''}" id="${escapeHtml(chapter.id)}" data-chapter-index="${index}"${index === 0 ? '' : ' hidden'}>
      <div class="chapter-kicker" id="${escapeHtml(chapter.id)}-reading">第 ${index + 1} 章 · ${escapeHtml(chapter.label)}</div>
      <h2>${escapeHtml(chapter.semanticTitle)}</h2>
      <p class="chapter-summary">${escapeHtml(chapter.summary)}</p>
      ${formatLearningVisualExplainer(chapter.visualExplainer, chapter.id)}
      ${formatLearningParagraphs(chapter.paragraphs)}
      ${formatLearningRetrievalBlocks(chapter.retrievalBlocks, chapter.id)}
      ${formatLearningWorkedExamples(chapter.workedExamples, chapter.id)}
      ${formatLearningEvidenceDetails(chapter, sourcesById)}
    </section>
  `;
}

function formatLearningOutlineNode(node, indexPath = '1', activeChapterId = null) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const label = `
    <span class="outline-jump depth-${escapeHtml(node.depth ?? 1)}${node.id === activeChapterId ? ' active' : ''}" data-target-id="${escapeHtml(node.id)}">
      <span class="outline-number">${escapeHtml(indexPath)}</span>
      <span class="outline-copy">
        <strong>${escapeHtml(node.title)}</strong>
        ${node.subtitle ? `<small>${escapeHtml(node.subtitle)}</small>` : ''}
      </span>
    </span>
  `;
  if (!hasChildren) return `<li>${label}</li>`;
  return `
    <li>
      <details class="outline-branch" open>
        <summary>${label}</summary>
        <ol>
          ${node.children.map((child, childIndex) => formatLearningOutlineNode(child, `${indexPath}.${childIndex + 1}`, activeChapterId)).join('\n')}
        </ol>
      </details>
    </li>
  `;
}

function formatLearningEmptyState(content, packageMeta, evidenceManifest) {
  const promptPath = content.agentPromptPath ?? packageMeta?.paths?.agentPrompt ?? null;
  const contextPath = content.agentContextPath ?? packageMeta?.paths?.agentContext ?? null;
  const contentPath = content.packagePaths?.contentJson ?? packageMeta?.paths?.contentJson ?? null;
  const assetsDir = content.packagePaths?.assetsDir ?? packageMeta?.paths?.assetsDir ?? null;
  const renderCommand = contentPath ? `open-vibecoding learn . --content-json ${contentPath} --open` : null;
  const sourceCount = evidenceManifest?.sourceCount ?? (evidenceManifest?.sources?.length ?? 0);
  const claimCount = evidenceManifest?.claimCount ?? (evidenceManifest?.claims?.length ?? 0);
  const gapCount = Array.isArray(evidenceManifest?.gaps) ? evidenceManifest.gaps.length : 0;
  return `
    <section class="empty-reader" id="agent-authoring">
      <p class="chapter-kicker">证据包待写作</p>
      <h2>还没有生成可阅读正文</h2>
      <p>这一步只完成了学习包归档和证据收集。真正给人阅读的标题、大纲、章节、检索练习和工作示例，还需要由 Agent 根据证据写入内容 JSON 后再渲染。</p>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${sourceCount}</div><div class="stat-label">份证据来源</div></div>
        <div class="stat"><div class="stat-value">${claimCount}</div><div class="stat-label">条结构化判断</div></div>
        <div class="stat"><div class="stat-value">${gapCount}</div><div class="stat-label">个待补缺口</div></div>
      </div>
      <ol class="empty-steps">
        <li>让 Agent 读取写作提示、上下文和证据清单。</li>
        <li>由 Agent 把标题、目录、章节正文、检索练习、工作示例和需要的 visualExplainer 写进 <code>learning-content.json</code>。</li>
        <li>写完后重新执行渲染命令，再打开阅读器查看成品。</li>
      </ol>
      <div class="empty-paths">
        ${promptPath ? `<div><strong>写作提示</strong><span>${escapeHtml(promptPath)}</span></div>` : ''}
        ${contextPath ? `<div><strong>上下文</strong><span>${escapeHtml(contextPath)}</span></div>` : ''}
        ${contentPath ? `<div><strong>内容 JSON</strong><span>${escapeHtml(contentPath)}</span></div>` : ''}
        ${assetsDir ? `<div><strong>图片素材目录</strong><span>${escapeHtml(assetsDir)}</span></div>` : ''}
        ${renderCommand ? `<div><strong>重渲染命令</strong><span>${escapeHtml(renderCommand)}</span></div>` : ''}
      </div>
    </section>
  `;
}

export function renderLearningArtifact({ packageMeta, content, evidenceManifest }) {
  const chapters = Array.isArray(content.chapters) ? content.chapters : [];
  const sources = Array.isArray(evidenceManifest.sources) ? evidenceManifest.sources : [];
  const title = content.title || packageMeta?.title || 'Open VibeCoding 复盘学习包';
  const outline = Array.isArray(content.outline) && content.outline.length > 0
    ? content.outline
    : chapters.map((chapter, index) => ({
      id: chapter.id,
      depth: 1,
      title: `第 ${index + 1} 章 · ${chapter.label}`,
      subtitle: chapter.semanticTitle,
      children: [],
    }));
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const initialChapterId = chapters[0]?.id ?? outline[0]?.id ?? null;
  const initialProgressPercent = chapters.length > 0 ? String((1 / chapters.length) * 100) : '0';

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6fbff;
        --bg-deep: #eef6ff;
        --paper: #ffffff;
        --panel: rgba(255, 255, 255, 0.96);
        --ink: #171411;
        --text: #1f2b3d;
        --muted: #66758b;
        --line: rgba(121, 151, 194, 0.28);
        --line-strong: rgba(91, 126, 177, 0.32);
        --accent: #ef7b43;
        --accent-deep: #d95f26;
        --accent-soft: #fff2e8;
        --amber: #8a5a2b;
        --amber-soft: #f6e7d4;
        --jade: #ef7b43;
        --wash: #f5f9ff;
        --danger-soft: rgba(220,38,38,0.08);
        --reader-scale: 1;
        --mono: "JetBrains Mono","SFMono-Regular",Menlo,monospace;
        --serif: "Songti SC","Noto Serif CJK SC","Iowan Old Style","Palatino Linotype",serif;
        --ui: "Avenir Next","Gill Sans","Trebuchet MS",sans-serif;
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        background:
          linear-gradient(90deg, rgba(95, 129, 181, 0.07) 0 1px, transparent 1px 100%),
          linear-gradient(rgba(95, 129, 181, 0.07) 0 1px, transparent 1px 100%),
          radial-gradient(circle at top, rgba(255,255,255,0.82), transparent 30%),
          linear-gradient(180deg, #fbfdff 0%, var(--bg) 50%, var(--bg-deep) 100%);
        background-size: 56px 56px, 56px 56px, auto, auto;
        color: var(--text);
        font-family: var(--ui);
        overflow: hidden;
      }
      .shell {
        display: grid;
        grid-template-columns: minmax(280px, 330px) minmax(0, 980px);
        gap: 18px;
        max-width: 1340px;
        height: 100vh;
        margin: 0 auto;
        padding: 18px;
      }
      .side-panel,
      .reader {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--panel);
        box-shadow: 0 20px 50px rgba(92, 122, 168, 0.14);
      }
      .side-panel {
        position: sticky;
        top: 18px;
        align-self: start;
        max-height: calc(100vh - 36px);
        overflow: auto;
        padding: 18px;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.985), rgba(252,254,255,0.985)),
          var(--panel);
      }
      .reader {
        min-width: 0;
        background: var(--paper);
        overflow: hidden;
        position: relative;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: calc(100vh - 36px);
      }
      .reader-header {
        border-bottom: 1px solid var(--line);
        background:
          linear-gradient(135deg, rgba(255,255,255,0.995), rgba(249,252,255,0.98)),
          var(--paper);
        padding: 16px 30px 10px;
      }
      .reader-scroll {
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        scroll-padding-top: 24px;
      }
      .eyebrow {
        margin: 0 0 8px;
        color: var(--accent);
        font-size: 13px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0;
      }
      h1 {
        margin: 0;
        font-family: var(--serif);
        font-size: clamp(27px, 3.2vw, 36px);
        line-height: 1.14;
        font-weight: 700;
        letter-spacing: 0.01em;
        color: var(--ink);
      }
      .subtitle {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.55;
        font-size: 15px;
      }
      .meta-row,
      .controls,
      .chapter-evidence {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .meta-row { margin-top: 8px; }
      .meta-details {
        margin-top: 10px;
        color: var(--muted);
        font-size: 12px;
      }
      .meta-details summary,
      .retrieval-item summary,
      .chapter-evidence summary {
        list-style: none;
      }
      .meta-details summary::-webkit-details-marker,
      .retrieval-item summary::-webkit-details-marker,
      .chapter-evidence summary::-webkit-details-marker {
        display: none;
      }
      .meta-details summary {
        width: fit-content;
        cursor: pointer;
        color: var(--accent-deep);
        font-weight: 650;
        line-height: 1.4;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .meta-details summary::before,
      .retrieval-item summary::before,
      .chapter-evidence summary::before {
        content: "▸";
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        color: var(--accent-deep);
        font-size: 11px;
        transform-origin: 50% 50%;
        transition: transform 120ms ease;
      }
      .meta-details[open] summary::before,
      .retrieval-item[open] summary::before,
      .chapter-evidence[open] summary::before {
        transform: rotate(90deg);
      }
      .meta-pill,
      .evidence-chip {
        display: inline-flex;
        width: fit-content;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 4px 8px;
        background: rgba(255,255,255,0.86);
        color: var(--muted);
        font-size: 10.5px;
        text-decoration: none;
      }
      .evidence-chip {
        color: var(--accent);
        background: var(--accent-soft);
        border-color: rgba(239,123,67,0.22);
      }
      .evidence-chip.muted {
        color: var(--muted);
        background: #f8fafc;
      }
      .controls {
        justify-content: space-between;
        margin-top: 9px;
        border-top: 1px solid var(--line);
        padding-top: 9px;
        background: transparent;
        gap: 14px;
      }
      .button-row { display: flex; gap: 8px; flex-wrap: wrap; }
      button {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 7px 10px;
        background: rgba(255, 255, 255, 0.96);
        color: var(--text);
        font: inherit;
        font-size: 14px;
        cursor: pointer;
      }
      button:hover { border-color: var(--accent); }
      button:disabled { color: var(--muted); cursor: not-allowed; opacity: 0.58; }
      .progress-wrap {
        min-width: 180px;
        flex: 1;
      }
      .progress-meta {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 6px;
      }
      .progress-track {
        height: 7px;
        border-radius: 999px;
        background: #e5dfd4;
        overflow: hidden;
      }
      .progress-bar {
        height: 100%;
        width: 0%;
        border-radius: inherit;
        background: var(--accent);
        transition: width 180ms ease;
      }
      .toc-title {
        margin: 0 0 12px;
        font-size: 14px;
        font-weight: 800;
        color: var(--accent-deep);
      }
      .toc-subtitle {
        margin: -4px 0 16px;
        color: var(--muted);
        line-height: 1.6;
        font-size: 13px;
      }
      .outline-list,
      .outline-list ol {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .outline-list ol {
        margin-left: 12px;
        padding-left: 12px;
        border-left: 1px solid var(--line);
      }
      .outline-branch summary {
        list-style: none;
      }
      .outline-branch summary::-webkit-details-marker { display: none; }
      .outline-jump {
        display: grid;
        grid-template-columns: 42px 1fr;
        gap: 10px;
        width: 100%;
        text-align: left;
        border-color: transparent;
        background: transparent;
        color: var(--text);
        line-height: 1.45;
        padding: 9px 8px;
        border-radius: 12px;
        border: 1px solid transparent;
        cursor: pointer;
      }
      .outline-jump:hover {
        border-color: rgba(239,123,67,0.18);
        background: rgba(255, 246, 239, 0.78);
        color: var(--accent-deep);
      }
      .outline-jump.active {
        border-color: rgba(239,123,67,0.24);
        background: linear-gradient(180deg, rgba(255,246,239,0.96), rgba(255,250,245,0.98));
        color: var(--accent-deep);
      }
      .outline-jump.active .outline-number,
      .outline-jump.active .outline-copy strong {
        color: var(--accent-deep);
      }
      .outline-jump.active .outline-copy small {
        color: #b27044;
      }
      .outline-number {
        color: var(--amber);
        font-family: var(--serif);
        font-weight: 800;
      }
      .outline-copy strong,
      .outline-copy small {
        display: block;
      }
      .outline-copy strong {
        font-weight: 700;
      }
      .outline-copy small {
        margin-top: 3px;
        color: var(--muted);
        font-size: 12px;
      }
      .stat-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
        margin-top: 16px;
      }
      .stat {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 10px;
        background: var(--wash);
      }
      .stat-value {
        font-family: var(--serif);
        font-size: 26px;
        font-weight: 700;
      }
      .stat-label {
        color: var(--muted);
        font-size: 12px;
        margin-top: 2px;
      }
      .chapter {
        padding: 38px 52px 54px;
        min-height: 100%;
      }
      .chapter[hidden] { display: none; }
      .chapter-kicker {
        color: var(--accent-deep);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
        margin-bottom: 8px;
      }
      .chapter h2 {
        margin: 0 0 12px;
        font-family: var(--serif);
        font-size: 38px;
        line-height: 1.24;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
      .chapter-summary {
        margin: 0 0 20px;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.8;
        max-width: 36em;
      }
      .chapter > p {
        max-width: 42em;
      }
      .chapter p,
      .learning-block p {
        font-size: calc(17px * var(--reader-scale));
        line-height: 1.85;
      }
      .learning-block {
        margin: 34px 0 0;
        border: 0;
        border-top: 1px solid var(--line);
        border-radius: 0;
        padding: 22px 0 0;
        background: transparent;
      }
      .learning-block h4 {
        margin: 0 0 14px;
        font-family: var(--serif);
        font-size: 24px;
        line-height: 1.3;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
      .learning-block.retrieval,
      .learning-block.worked,
      .learning-block.visual {
        border-top-color: rgba(239,123,67,0.2);
      }
      .learning-block.visual {
        padding-top: 26px;
      }
      .visual-header {
        display: grid;
        gap: 6px;
        margin-bottom: 18px;
      }
      .visual-kicker {
        color: var(--accent-deep);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.12em;
      }
      .visual-header h4 {
        margin: 0;
        font-size: 30px;
        line-height: 1.28;
        font-weight: 600;
      }
      .visual-grid {
        display: grid;
        gap: 26px;
      }
      .visual-grid.has-image {
        grid-template-columns: minmax(0, 1.28fr) minmax(240px, 320px);
        align-items: start;
      }
      .visual-copy {
        display: grid;
        gap: 0;
        border-left: 1px solid var(--line);
        padding-left: 22px;
      }
      .visual-note {
        border: 0;
        border-radius: 0;
        background: transparent;
        padding: 0 0 16px;
      }
      .visual-note + .visual-note {
        border-top: 1px solid rgba(121, 151, 194, 0.22);
        padding-top: 16px;
      }
      .visual-label {
        color: var(--accent-deep);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        margin-bottom: 8px;
      }
      .visual-note p {
        margin: 0;
      }
      .visual-takeaways {
        margin: 0;
        padding-left: 20px;
      }
      .visual-figure {
        margin: 0;
        border: 1px solid rgba(121, 151, 194, 0.2);
        border-radius: 16px;
        overflow: hidden;
        background: rgba(255,255,255,0.98);
        box-shadow: 0 18px 42px rgba(91, 126, 177, 0.08);
      }
      .visual-figure img {
        display: block;
        width: 100%;
        height: auto;
        background:
          linear-gradient(90deg, rgba(95, 129, 181, 0.07) 0 1px, transparent 1px 100%),
          linear-gradient(rgba(95, 129, 181, 0.07) 0 1px, transparent 1px 100%),
          #f8fbff;
        background-size: 24px 24px, 24px 24px, auto;
      }
      .visual-figure figcaption {
        padding: 12px 14px 14px;
        border-top: 1px solid rgba(121, 151, 194, 0.16);
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }
      .retrieval-item {
        border-top: 1px solid var(--line);
        padding: 16px 0;
      }
      .retrieval-item:first-of-type { border-top: 0; }
      .retrieval-item summary {
        cursor: pointer;
        font-weight: 650;
        line-height: 1.6;
        display: flex;
        gap: 10px;
        align-items: flex-start;
      }
      .retrieval-item summary span {
        display: inline-flex;
        color: var(--accent);
        font-family: var(--mono);
        font-size: 11px;
        min-width: 24px;
        padding-top: 2px;
      }
      .retrieval-hint,
      .retrieval-answer {
        color: var(--muted);
        line-height: 1.7;
        margin-top: 8px;
        margin-left: 34px;
      }
      .worked-item {
        padding: 18px 0;
        border-top: 1px solid var(--line);
      }
      .worked-item:first-of-type {
        padding-top: 6px;
        border-top: 0;
      }
      .worked-title {
        font-family: var(--serif);
        font-size: 24px;
        font-weight: 600;
        line-height: 1.35;
      }
      .worked-principle {
        color: var(--muted);
        line-height: 1.7;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(239,123,67,0.16);
      }
      ol,
      ul {
        margin: 10px 0 0;
        padding-left: 20px;
        line-height: 1.75;
      }
      .chapter-evidence {
        display: block;
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid var(--line);
      }
      .chapter-evidence summary {
        cursor: pointer;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        color: var(--muted);
      }
      .evidence-summary-title {
        color: var(--accent-deep);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      .evidence-summary-count {
        color: var(--muted);
        font-size: 12px;
      }
      .evidence-mini-list {
        display: grid;
        gap: 0;
        margin-top: 12px;
      }
      .evidence-mini-card {
        border: 0;
        border-top: 1px solid rgba(121, 151, 194, 0.16);
        border-radius: 0;
        background: transparent;
        padding: 12px 0;
      }
      .evidence-mini-card:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .evidence-mini-card strong,
      .evidence-mini-card span {
        display: block;
      }
      .evidence-mini-card strong {
        font-weight: 650;
        font-size: 14px;
        line-height: 1.5;
      }
      .evidence-mini-card span {
        color: var(--muted);
        font-family: var(--mono);
        font-size: 11px;
        letter-spacing: 0.02em;
        margin-top: 4px;
      }
      .evidence-mini-card p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.6;
      }
      .empty-reader {
        margin: 38px 52px 54px;
        padding: 28px;
        border: 1px dashed var(--line-strong);
        border-radius: 16px;
        background: var(--wash);
      }
      .empty-reader h2 {
        margin: 0 0 12px;
        font-family: var(--serif);
        font-size: 34px;
        line-height: 1.2;
      }
      .empty-reader p {
        margin: 0;
        color: var(--muted);
        font-size: 17px;
        line-height: 1.8;
      }
      .empty-steps {
        margin: 18px 0 0;
        padding-left: 22px;
        color: var(--muted);
        line-height: 1.8;
      }
      .empty-steps li + li {
        margin-top: 6px;
      }
      .empty-paths {
        display: grid;
        gap: 10px;
        margin-top: 18px;
      }
      .empty-paths div {
        display: grid;
        gap: 4px;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 10px 12px;
        background: #fffefa;
      }
      .empty-paths strong {
        color: var(--accent-deep);
        font-size: 13px;
      }
      .empty-paths span {
        color: var(--muted);
        font-family: var(--mono);
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      @media (max-width: 1120px) {
        body { overflow: auto; }
        .shell { grid-template-columns: 1fr; height: auto; min-height: 100vh; padding: 12px; }
        .side-panel {
          position: static;
          max-height: none;
        }
        .reader { height: auto; }
        .reader-scroll { height: auto; overflow: visible; }
        .chapter { min-height: auto; padding: 24px 20px 30px; }
        .visual-grid.has-image { grid-template-columns: 1fr; }
        .visual-copy {
          border-left: 0;
          border-top: 1px solid var(--line);
          padding-left: 0;
          padding-top: 18px;
        }
      }
      @media (max-width: 700px) {
        .reader-header { padding: 18px 20px 12px; }
        h1 { font-size: 30px; }
        .chapter h2 { font-size: 28px; }
        .learning-block h4,
        .visual-header h4,
        .worked-title {
          font-size: 24px;
        }
        .stat-grid { grid-template-columns: 1fr; }
        .controls { display: grid; gap: 12px; }
        .chapter { padding: 30px 22px 38px; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <aside class="side-panel">
        <p class="toc-title">书籍大纲</p>
        <p class="toc-subtitle">最多三层展开。先读章名，再进入心法、练习与示例。</p>
        <ol class="outline-list">
          ${outline.length > 0 ? outline.map((node, index) => formatLearningOutlineNode(node, `${index + 1}`, initialChapterId)).join('\n') : '<li><span class="outline-jump"><span class="outline-number">0</span><span class="outline-copy"><strong>证据包待写作</strong><small>正文完成后显示目录</small></span></span></li>'}
        </ol>
      </aside>

      <article class="reader">
        <header class="reader-header">
          <p class="eyebrow">Open VibeCoding 复盘学习 · ${escapeHtml(content.genre?.label ?? '默认题材')}</p>
          <h1>${escapeHtml(title)}</h1>
          <p class="subtitle">${escapeHtml(content.subtitle ?? '')}</p>
          <details class="meta-details">
            <summary>生成信息</summary>
            <div class="meta-row">
              <span class="meta-pill">topic: ${escapeHtml(content.topic ?? '未指定')}</span>
              <span class="meta-pill">genre: ${escapeHtml(content.genre?.id ?? 'unknown')}</span>
              <span class="meta-pill">风格: ${escapeHtml(content.stylePromptPack?.styleId ?? packageMeta?.styleId ?? 'default')}</span>
              <span class="meta-pill">trigger: ${escapeHtml(packageMeta?.trigger ?? content.trigger ?? 'manual')}</span>
            </div>
          </details>
          <div class="controls">
            <div class="button-row">
              <button type="button" id="prevChapter" disabled>上一章</button>
              <button type="button" id="nextChapter"${chapters.length <= 1 ? ' disabled' : ''}>下一章</button>
              <button type="button" id="smallerText">A-</button>
              <button type="button" id="largerText">A+</button>
            </div>
            <div class="progress-wrap">
              <div class="progress-meta">
                <span id="progressTitle">阅读进度</span>
                <span id="progressText">${chapters.length > 0 ? `1/${chapters.length}` : '0/0'}</span>
              </div>
              <div class="progress-track"><div class="progress-bar" id="progressBar" style="width: ${initialProgressPercent}%"></div></div>
            </div>
          </div>
        </header>
        <div class="reader-scroll" tabindex="0" aria-label="Open VibeCoding 复盘学习阅读器 · 当前章节正文">
          ${chapters.length > 0 ? chapters.map((chapter, index) => formatLearningChapter(chapter, index, sourcesById)).join('\n') : formatLearningEmptyState(content, packageMeta, evidenceManifest)}
        </div>
      </article>
    </main>
    <script>
      const scrollRoot = document.querySelector('.reader-scroll');
      const chapters = Array.from(document.querySelectorAll('.chapter'));
      const outlineItems = Array.from(document.querySelectorAll('[data-target-id]'));
      const prevButton = document.getElementById('prevChapter');
      const nextButton = document.getElementById('nextChapter');
      const progressBar = document.getElementById('progressBar');
      const progressText = document.getElementById('progressText');
      let activeIndex = 0;
      let fontScale = Number(localStorage.getItem('open-vibecoding-learning-font-scale') || '1');

      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      function applyFontScale() {
        fontScale = clamp(fontScale, 0.9, 1.25);
        document.documentElement.style.setProperty('--reader-scale', String(fontScale));
        localStorage.setItem('open-vibecoding-learning-font-scale', String(fontScale));
      }

      function setActive(index, shouldScroll = false) {
        if (chapters.length === 0) return;
        activeIndex = clamp(index, 0, chapters.length - 1);
        chapters.forEach((chapter, chapterIndex) => {
          const isActive = chapterIndex === activeIndex;
          chapter.hidden = !isActive;
          chapter.classList.toggle('active', isActive);
        });
        const activeChapterId = chapters[activeIndex].id;
        outlineItems.forEach((item) => item.classList.toggle('active', item.dataset.targetId === activeChapterId));
        prevButton.disabled = activeIndex === 0;
        nextButton.disabled = activeIndex === chapters.length - 1;
        progressText.textContent = String(activeIndex + 1) + '/' + String(chapters.length);
        progressBar.style.width = String(((activeIndex + 1) / chapters.length) * 100) + '%';
        if (shouldScroll) {
          scrollRoot?.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }

      function scrollToReaderTarget(target) {
        if (!target || !scrollRoot) return;
        const rootTop = scrollRoot.getBoundingClientRect().top;
        const targetTop = target.getBoundingClientRect().top;
        scrollRoot.scrollTo({
          top: scrollRoot.scrollTop + targetTop - rootTop - 18,
          behavior: 'smooth',
        });
      }

      outlineItems.forEach((item) => {
        item.addEventListener('click', () => {
          const target = document.getElementById(item.dataset.targetId);
          if (!target) return;
          const chapterIndex = chapters.findIndex((chapter) => chapter.id === target.id || chapter.contains(target));
          if (chapterIndex >= 0) setActive(chapterIndex, false);
          scrollToReaderTarget(target);
        });
      });
      prevButton.addEventListener('click', () => setActive(activeIndex - 1, true));
      nextButton.addEventListener('click', () => setActive(activeIndex + 1, true));
      document.getElementById('smallerText').addEventListener('click', () => {
        fontScale -= 0.05;
        applyFontScale();
      });
      document.getElementById('largerText').addEventListener('click', () => {
        fontScale += 0.05;
        applyFontScale();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'PageDown') setActive(activeIndex + 1, true);
        if (event.key === 'ArrowLeft' || event.key === 'PageUp') setActive(activeIndex - 1, true);
      });

      applyFontScale();
      setActive(0, false);
    </script>
  </body>
</html>`;
}

export function learningPackagePaths(ws, packageId) {
  const dir = cjoin(ws.paths.learningArchiveDir, slugify(packageId, 'learning-package'));
  return {
    dir,
    readerHtml: cjoin(dir, 'reader.html'),
    assetsDir: cjoin(dir, 'assets'),
    packageJson: cjoin(dir, 'learning-package.json'),
    contentJson: cjoin(dir, 'learning-content.json'),
    contentMarkdown: cjoin(dir, 'learning-content.md'),
    evidenceManifest: cjoin(dir, 'evidence-manifest.json'),
    agentContext: cjoin(dir, 'agent-context.json'),
    agentPrompt: cjoin(dir, 'agent-prompt.md'),
  };
}
