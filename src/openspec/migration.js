/* Detect historical Open VibeCoding directories without moving or rewriting them. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  LEGACY_OPEN_VIBECODING_ACCEPTED_SPEC_ROOT,
  LEGACY_OPEN_VIBECODING_ARCHIVE_CHANGE_ROOT,
  LEGACY_OPEN_VIBECODING_CHANGE_ROOT,
} from './constants.js';

export async function hasLegacyOpenPrdArtifacts(projectRoot) {
  for (const parts of [
    LEGACY_OPEN_VIBECODING_CHANGE_ROOT,
    LEGACY_OPEN_VIBECODING_ACCEPTED_SPEC_ROOT,
    LEGACY_OPEN_VIBECODING_ARCHIVE_CHANGE_ROOT,
  ]) {
    if (await fs.access(path.join(projectRoot, ...parts)).then(() => true, () => false)) return true;
  }
  return false;
}
