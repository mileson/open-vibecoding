/* Read-only compatibility for historical PRD version identifiers and diffs. */

export function formatVersionId(versionNumber) {
  return `v${String(versionNumber).padStart(4, '0')}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function diffValues(before, after, prefix = '') {
  if (Object.is(before, after) || JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!isPlainObject(before) || !isPlainObject(after)) {
    return [{ path: prefix, before, after }];
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const key of keys) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (!(key in before)) {
      changes.push({ path: nextPrefix, before: undefined, after: after[key] });
    } else if (!(key in after)) {
      changes.push({ path: nextPrefix, before: before[key], after: undefined });
    } else {
      changes.push(...diffValues(before[key], after[key], nextPrefix));
    }
  }
  return changes;
}

export function diffSnapshots(beforeSnapshot, afterSnapshot) {
  const changes = diffValues(beforeSnapshot.sections, afterSnapshot.sections);
  return {
    fromVersionId: beforeSnapshot.versionId,
    toVersionId: afterSnapshot.versionId,
    fromVersionNumber: beforeSnapshot.versionNumber,
    toVersionNumber: afterSnapshot.versionNumber,
    changedSections: [...new Set(changes.map((change) => change.path.split('.')[0]).filter(Boolean))],
    changes,
  };
}
