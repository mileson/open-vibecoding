import fs from 'node:fs/promises';
import path from 'node:path';
import {
  LEGACY_OPEN_VIBECODING_ACCEPTED_SPEC_ROOT,
  LEGACY_OPEN_VIBECODING_ARCHIVE_CHANGE_ROOT,
  LEGACY_OPEN_VIBECODING_CHANGE_ROOT,
  OPEN_VIBECODING_ACCEPTED_SPEC_ROOT,
  OPEN_VIBECODING_ARCHIVE_CHANGE_ROOT,
  OPEN_VIBECODING_CHANGE_ROOT,
  OPEN_VIBECODING_DISCOVERY_CONFIG_PATH,
  OPEN_VIBECODING_DISCOVERY_DIR,
} from './constants.js';

export function cjoin(...parts) {
  return path.join(...parts);
}

export function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

export function openPrdDiscoveryDir(projectRoot) {
  return cjoin(projectRoot, ...OPEN_VIBECODING_DISCOVERY_DIR);
}

export function openPrdDiscoveryConfigPath(projectRoot) {
  return cjoin(projectRoot, ...OPEN_VIBECODING_DISCOVERY_CONFIG_PATH);
}

export async function readDiscoveryConfig(projectRoot, readJson) {
  return (await readJson(openPrdDiscoveryConfigPath(projectRoot)).catch(() => null)) ?? {};
}

export function openPrdChangeRoot(projectRoot) {
  return cjoin(projectRoot, ...OPEN_VIBECODING_CHANGE_ROOT);
}

export function openPrdAcceptedSpecRoot(projectRoot) {
  return cjoin(projectRoot, ...OPEN_VIBECODING_ACCEPTED_SPEC_ROOT);
}

export function legacyAcceptedSpecRoot(projectRoot) {
  return cjoin(projectRoot, ...LEGACY_OPEN_VIBECODING_ACCEPTED_SPEC_ROOT);
}

export function openPrdArchiveChangeRoot(projectRoot) {
  return cjoin(projectRoot, ...OPEN_VIBECODING_ARCHIVE_CHANGE_ROOT);
}

export async function resolveChangeDir(projectRoot, changeId) {
  const candidates = [
    cjoin(openPrdChangeRoot(projectRoot), changeId),
    cjoin(openPrdArchiveChangeRoot(projectRoot), changeId),
    cjoin(projectRoot, ...LEGACY_OPEN_VIBECODING_CHANGE_ROOT, changeId),
    cjoin(projectRoot, ...LEGACY_OPEN_VIBECODING_ARCHIVE_CHANGE_ROOT, changeId),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return cjoin(openPrdChangeRoot(projectRoot), changeId);
}

export async function listChangeDirs(projectRoot) {
  const roots = [
    { root: openPrdChangeRoot(projectRoot), source: 'open-vibecoding', archived: false },
    { root: openPrdArchiveChangeRoot(projectRoot), source: 'open-vibecoding-archive', archived: true },
    { root: cjoin(projectRoot, ...LEGACY_OPEN_VIBECODING_CHANGE_ROOT), source: 'legacy', archived: false },
    { root: cjoin(projectRoot, ...LEGACY_OPEN_VIBECODING_ARCHIVE_CHANGE_ROOT), source: 'legacy-archive', archived: true },
  ];
  const changes = [];
  const seen = new Set();

  for (const entryRoot of roots) {
    let entries = [];
    try {
      entries = await fs.readdir(entryRoot.root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const key = `${entry.name}:${entryRoot.source}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      changes.push({
        id: entry.name,
        source: entryRoot.source,
        archived: entryRoot.archived,
        changeDir: cjoin(entryRoot.root, entry.name),
      });
    }
  }

  return changes.sort((a, b) => a.id.localeCompare(b.id) || a.source.localeCompare(b.source));
}
