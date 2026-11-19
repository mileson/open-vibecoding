import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { atomicWriteJson, readJsonIfExists, withFileLock } from './kernel/atomic-store.js';
import { installedSkillPath, PROJECT_SKILLS_DIR } from './skill-presentation.js';

export const LEGACY_SKILL_ROOTS = [
  ['open-vibecoding/internal', '.open-vibecoding/harness/internal-skills'],
  ['codex', '.codex/skills'],
  ['cursor', '.cursor/skills'],
  ['claude', '.claude/skills'],
  ['gemini', '.gemini/skills'],
  ['open-vibecoding/experience', '.open-vibecoding/knowledge/skills'],
  ['open-vibecoding/project', '.open-vibecoding/skills'],
];

export function projectSkillPath(name) {
  return path.posix.join(PROJECT_SKILLS_DIR, name, 'SKILL.md');
}

export function validSkillName(name) {
  return typeof name === 'string' && name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

export function skillMetadata(text) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text ?? '');
  if (!header) return {};
  try { return parse(header[1]) ?? {}; } catch { return {}; }
}

async function lstat(file) {
  return fs.lstat(file).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

async function entries(dir) {
  return fs.readdir(dir, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
}

export async function assertProjectSkillParents(root, relative) {
  let current = root;
  for (const part of path.posix.dirname(relative).split('/')) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat && !stat.isDirectory()) throw new Error('Skill path is blocked by a non-directory: ' + path.relative(root, current));
  }
}

async function digest(item) {
  const stat = await fs.lstat(item);
  if (stat.isSymbolicLink()) return ['link', await fs.readlink(item)];
  if (stat.isFile()) return ['file', stat.mode & 0o111, createHash('sha256').update(await fs.readFile(item)).digest('hex')];
  if (!stat.isDirectory()) throw new Error('Unsupported skill asset type: ' + path.basename(item));
  const hashes = [];
  for (const entry of (await entries(item)).sort((a,b)=>a.name.localeCompare(b.name))) {
    hashes.push([entry.name, await digest(path.join(item, entry.name))]);
  }
  return ['dir', ...hashes];
}

async function relocate(root, source, destination, origin, changes) {
  await assertProjectSkillParents(root, source);
  await assertProjectSkillParents(root, destination);
  const src = path.join(root, source);
  const dst = path.join(root, destination);
  const stat = await lstat(src);
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    changes.push({ path: source, status: 'skill-migration-blocked', reason: 'legacy-skill-symlink' });
    return;
  }
  if (!(await lstat(dst))) {
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
    changes.push({ path: destination, from: source, status: 'migrated-project-skill' });
    return;
  }
  const sourceDigest = JSON.stringify(await digest(src));
  if (sourceDigest === JSON.stringify(await digest(dst))) {
    await fs.rm(src, { recursive: stat.isDirectory() });
    changes.push({ path: destination, from: source, status: 'deduplicated-project-skill' });
    return;
  }
  await archiveLegacy(root, source, destination, origin, 'project-skill-conflict', changes);
}

async function archiveLegacy(root, source, destination, origin, status, changes) {
  await assertProjectSkillParents(root, source);
  const src = path.join(root, source);
  const stat = await lstat(src);
  const sourceDigest = JSON.stringify(await digest(src));
  const name = path.posix.basename(destination);
  const token = createHash('sha256').update(sourceDigest).digest('hex').slice(0, 12);
  const archived = path.posix.join('.agents', 'skill-conflicts', origin, name + '-' + token);
  await assertProjectSkillParents(root, archived);
  const backup = path.join(root, archived);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  if (await lstat(backup)) {
    if (sourceDigest !== JSON.stringify(await digest(backup))) throw new Error('Skill conflict archive already exists: ' + archived);
    await fs.rm(src, { recursive: stat.isDirectory() });
  } else {
    await fs.rename(src, backup);
  }
  changes.push({ path: destination, from: source, preservedAt: archived, status });
}

function migratedPath(root, value, name) {
  if (typeof value !== 'string' || !validSkillName(name)) return value;
  const relative = (path.isAbsolute(value) ? path.relative(root, value) : value).split(path.sep).join('/');
  if (relative === '.open-vibecoding/knowledge/skills/' + name + '/SKILL.md' ||
      relative === projectSkillPath(name) ||
      (path.isAbsolute(value) && value.replaceAll('\\', '/').endsWith('/.open-vibecoding/knowledge/skills/' + name + '/SKILL.md'))) {
    return projectSkillPath(name);
  }
  return value;
}

async function updateKnowledgePointers(root, changes) {
  const base = '.open-vibecoding/knowledge';
  const update = async (relative, transform) => {
    const file = path.join(root, base, relative);
    await assertProjectSkillParents(root, path.posix.join(base, relative));
    if (!(await lstat(file))?.isFile()) return;
    const old = await readJsonIfExists(file);
    if (!old || typeof old !== 'object') return;
    const next = transform(old);
    if (JSON.stringify(old) !== JSON.stringify(next)) await atomicWriteJson(file, next);
  };
  const conflictByName = new Map(changes.filter(change =>
    change.preservedAt && change.from.startsWith('.open-vibecoding/knowledge/skills/'))
    .map(change => [path.posix.basename(change.from), change.preservedAt + '/SKILL.md']));
  const candidate = item => {
    if (!item?.promotedSkillPath) return item;
    const name = path.posix.basename(path.posix.dirname(item.promotedSkillPath.replaceAll('\\','/')));
    const linked = migratedPath(root, item.promotedSkillPath, name);
    const preserved = conflictByName.get(name);
    return { ...item, promotedSkillPath: preserved ?? linked, ...(preserved && { migrationConflict: preserved }) };
  };
  await update('index.json', index => ({
    ...index,
    ...(Array.isArray(index.skills) && { skills: index.skills.map(item => ({
      ...item, path: migratedPath(root, item.path, item.skillName),
      ...(conflictByName.has(item.skillName) && { migrationConflict: conflictByName.get(item.skillName) }),
    })) }),
    ...(Array.isArray(index.candidates) && { candidates: index.candidates.map(candidate) }),
  }));
  await assertProjectSkillParents(root, path.posix.join(base, 'candidates/check'));
  for (const folder of await entries(path.join(root, base, 'candidates'))) {
    if (folder.isDirectory()) await update(`candidates/${folder.name}/candidate.json`, candidate);
  }
}

export async function migrateProjectSkills(root) {
  const changes = [];
  await assertProjectSkillParents(root, '.agents/skill-migration.lock');
  const lock = path.join(root, '.agents', 'skill-migration.lock');
  await withFileLock(lock, async () => {
    const contribution = await readJsonIfExists(path.join(root, 'open-vibecoding.capabilities.json'));
    const extensionNames = new Set((Array.isArray(contribution?.scenarios) ? contribution.scenarios : [])
      .map(item => item?.skill).filter(validSkillName));
    for (const [origin, relative] of [['extension', 'skills'], ...LEGACY_SKILL_ROOTS]) {
      if (origin === 'extension' && !extensionNames.size) continue;
      await assertProjectSkillParents(root, relative);
      if ((await lstat(path.join(root, relative)))?.isSymbolicLink()) {
        if (origin !== 'extension') {
          await archiveLegacy(root, relative, relative, origin, 'archived-legacy-skill-link', changes);
        }
        continue;
      }
      for (const item of await entries(path.join(root, relative))) {
        if (origin === 'extension' && !extensionNames.has(item.name)) continue;
        const source = path.posix.join(relative, item.name);
        const skill = path.join(root, source, 'SKILL.md');
        if (item.isSymbolicLink()) {
          await archiveLegacy(root, source, source, origin, 'archived-legacy-skill-link', changes);
          continue;
        }
        if (!item.isDirectory()) continue;
        const skillStat = await lstat(skill);
        if (skillStat?.isSymbolicLink()) {
          await archiveLegacy(root, source, source, origin, 'archived-legacy-skill-link', changes);
          continue;
        }
        if (!skillStat?.isFile()) continue;
        const metadata = skillMetadata(await fs.readFile(skill, 'utf8'));
        if (!validSkillName(metadata.name) || typeof metadata.description !== 'string' || !metadata.description.trim()) {
          await archiveLegacy(root, source, source, origin, 'archived-invalid-skill-metadata', changes);
          continue;
        }
        await relocate(root, source, path.posix.dirname(installedSkillPath(metadata.name)), origin, changes);
      }
      if (origin !== 'extension' && !(await entries(path.join(root, relative))).length) {
        await fs.rmdir(path.join(root, relative)).catch(error => {
          if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
        });
      }
    }
    const previousQuality = '.open-vibecoding/quality/SKILL.md';
    await assertProjectSkillParents(root, previousQuality);
    const previousQualityStat = await lstat(path.join(root, previousQuality));
    if (previousQualityStat?.isSymbolicLink()) {
      await archiveLegacy(root, previousQuality, previousQuality, 'open-vibecoding/quality', 'archived-legacy-skill-link', changes);
    } else if (previousQualityStat?.isFile()) {
      const destination = projectSkillPath('project-quality');
      await assertProjectSkillParents(root, destination);
      await fs.mkdir(path.dirname(path.join(root, destination)), { recursive: true });
      await relocate(root, previousQuality, destination, 'open-vibecoding/quality', changes);
    }
    await updateKnowledgePointers(root, changes);
  });
  return changes;
}
