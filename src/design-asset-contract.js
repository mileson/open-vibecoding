const BITMAP_RENDERING_MODES = Object.freeze({
  TRANSPARENT_CUTOUT: 'transparent-cutout',
  OPAQUE_FULL_BLEED_TILE: 'opaque-full-bleed-tile',
});

const BAKED_CONTAINER_PATTERNS = [
  /rounded[- ]square background/iu,
  /rounded[- ]rectangle background/iu,
  /inside (?:a )?rounded (?:square|rectangle|card)/iu,
  /圆角(?:方形|矩形|卡片)(?:底板|背景|容器)/u,
];

function normalizeCornerAlpha(cornerAlpha) {
  if (!Array.isArray(cornerAlpha) || cornerAlpha.length !== 4) return null;
  const values = cornerAlpha.map((value) => Number(value));
  return values.every(Number.isFinite) ? values : null;
}

export function validateBitmapPixelContract(input = {}) {
  const mode = String(input.mode || '').trim();
  const prompt = String(input.prompt || '');
  const cornerAlpha = normalizeCornerAlpha(input.cornerAlpha);
  const errors = [];

  if (!Object.values(BITMAP_RENDERING_MODES).includes(mode)) {
    errors.push('rendering-mode must be transparent-cutout or opaque-full-bleed-tile');
    return { ok: false, mode, errors };
  }

  if (BAKED_CONTAINER_PATTERNS.some((pattern) => pattern.test(prompt))) {
    errors.push('source prompt bakes a rounded UI container into the bitmap');
  }

  if (mode === BITMAP_RENDERING_MODES.TRANSPARENT_CUTOUT) {
    if (cornerAlpha && cornerAlpha.some((alpha) => alpha !== 0)) {
      errors.push('transparent-cutout requires all four corners to be transparent');
    }
  } else {
    if (cornerAlpha && cornerAlpha.some((alpha) => alpha < 255)) {
      errors.push('opaque-full-bleed-tile requires all four corners to be opaque');
    }
    const requiredPromptSignals = [
      /full[- ]bleed/iu,
      /edge[- ]to[- ]edge/iu,
      /no (?:rounded rectangle|white outer margin|transparent corners)/iu,
    ];
    if (!requiredPromptSignals.every((pattern) => pattern.test(prompt))) {
      errors.push('opaque-full-bleed-tile prompt must require full-bleed edge-to-edge output and forbid rounded container, white margin, and transparent corners');
    }
  }

  return { ok: errors.length === 0, mode, errors };
}

export function selectTaskScopedDesignRecords(records = [], taskScope = '') {
  const normalizedScope = String(taskScope || '').trim();
  if (!normalizedScope) return [];
  return records.filter((record) => {
    if (!record || String(record.taskScope || '').trim() !== normalizedScope) return false;
    return record.explicitlyReferenced !== false;
  });
}

export { BITMAP_RENDERING_MODES };
