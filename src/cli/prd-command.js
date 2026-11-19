import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { prdTemplateFile, renderPrd } from '../prd-html.js';
import { mergePrdDesigns, standaloneDesigns } from '../prd-design.js';

const exampleFile = new URL('../../test/fixtures/prd-camera-first-photo.json', import.meta.url);
const templates = new Map([['.json', exampleFile], ['.html', prdTemplateFile]]);
const usage = [
  'open-vibecoding prd template --out <requirements.json|template.html>',
  'open-vibecoding prd render --data <requirements.json> --out <prd.html> [--template <template.html>]',
  'open-vibecoding prd design validate --design <designs.json> [--data <requirements.json>]',
  'open-vibecoding prd design merge --design <designs.json> --data <requirements.json> --out <new.json>',
];

async function readJson(dataPath) {
  const source = await readFile(dataPath, 'utf8');
  try {
    return JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`JSON 解析失败（${path.resolve(dataPath)}）：${error.message}`);
  }
}

async function renderFromFile(dataPath, templatePath) {
  const data = await readJson(dataPath);
  const input = path.resolve(dataPath);
  const template = templatePath === undefined ? undefined : await readFile(templatePath, 'utf8');
  try {
    return renderPrd(data, template, { assetBaseDir: path.dirname(input) });
  } catch (error) {
    const sources = templatePath === undefined ? input : `${input}（模板 ${path.resolve(templatePath)}）`;
    throw new Error(`${sources}：${error.message}`);
  }
}

async function writeNewFile(out, content) {
  await mkdir(path.dirname(out), { recursive: true });
  try {
    await writeFile(out, content, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`输出已存在，请使用新路径：${out}`);
    throw error;
  }
}

async function runDesignCommand([operation, ...args]) {
  if (operation !== 'validate' && operation !== 'merge') throw new Error('请选择 design validate 或 design merge');
  const options = { design: { type: 'string' }, data: { type: 'string' } };
  if (operation === 'merge') options.out = { type: 'string' };
  const { values } = parseArgs({ args, options });
  for (const key of operation === 'merge' ? ['design', 'data', 'out'] : ['design']) {
    if (!values[key]?.trim()) throw new Error(`请提供 --${key}`);
  }
  const designPath = path.resolve(values.design);
  const designDir = path.dirname(designPath);
  const dataPath = values.data === undefined ? null : path.resolve(values.data);
  const out = values.out === undefined ? null : path.resolve(values.out);
  if (out && path.extname(out).toLowerCase() !== '.json') throw new Error('--out 需使用 .json 扩展名');
  const manifest = await readJson(designPath);
  const data = dataPath ? await readJson(dataPath) : null;
  let result;
  try {
    if (dataPath) {
      const prdDir = path.dirname(dataPath);
      result = mergePrdDesigns(data, manifest, { prdDir, designDir, outDir: out ? path.dirname(out) : prdDir });
    } else {
      result = { designs: standaloneDesigns(manifest, designDir) };
    }
  } catch (error) {
    const sources = dataPath ? `${designPath}（PRD ${dataPath}）` : designPath;
    throw new Error(`${sources}：${error.message}`);
  }
  if (out) await writeNewFile(out, `${JSON.stringify(result.prd, null, 2)}\n`);
  const designs = result.designs.map(({ id, title, status, requirementIds, scenarioIds, image }) =>
    ({ id, title, status, requirementIds, scenarioIds, hasImage: Boolean(image) }));
  return { ok: true, action: 'design', operation, referencesChecked: Boolean(dataPath), designs, ...(out && { out }) };
}

export async function runPrdCommand(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(usage.join('\n'));
    console.log('导出首拍 JSON 样例或 HTML 模板，再用 JSON 生成可离线打开的 PRD。输出文件必须是新文件。');
    return 0;
  }

  const [action, ...args] = argv;
  try {
    if (action === 'design') {
      console.log(JSON.stringify(await runDesignCommand(args), null, 2));
      return 0;
    }
    if (action !== 'template' && action !== 'render') throw new Error('请选择 template、render 或 design');
    const options = { out: { type: 'string' } };
    if (action === 'render') {
      options.data = { type: 'string' };
      options.template = { type: 'string' };
    }
    const { values } = parseArgs({ args, options });
    for (const key of action === 'render' ? ['out', 'data'] : ['out']) {
      if (!values[key]?.trim()) throw new Error(`请提供 --${key}`);
    }

    const out = path.resolve(values.out);
    const extension = path.extname(out).toLowerCase();
    const templateFile = templates.get(extension);
    if (action === 'template' && !templateFile) throw new Error('--out 需使用 .json 或 .html 扩展名');
    if (action === 'render' && extension !== '.html') throw new Error('--out 需使用 .html 扩展名');

    const content = action === 'template'
      ? await readFile(templateFile, 'utf8')
      : await renderFromFile(values.data, values.template);
    await writeNewFile(out, content);

    console.log(JSON.stringify({ ok: true, action, format: extension.slice(1), out }, null, 2));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, action, error: { type: 'prd', message: error.message, usage } }));
    return 1;
  }
}
