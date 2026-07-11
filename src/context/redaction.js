const SECRET_KEY_PATTERN = /^(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|auth(?:orization)?|client[_-]?secret|password|passwd|secret|private[_-]?key)$/i;

const TEXT_PATTERNS = [
  {
    reason: 'private-key',
    pattern: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g,
    replacement: '[REDACTED:PRIVATE_KEY]',
  },
  {
    reason: 'bearer-token',
    pattern: /(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: '$1[REDACTED]',
  },
  {
    reason: 'credential-assignment',
    pattern: /(\b(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|client[_-]?secret|password|passwd|secret)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    replacement: '$1[REDACTED]',
  },
  {
    reason: 'provider-token',
    pattern: /\b(?:sk-(?:proj-)?|gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g,
    replacement: '[REDACTED:TOKEN]',
  },
  {
    reason: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
    replacement: '[REDACTED:JWT]',
  },
  {
    reason: 'url-credential',
    pattern: /:\/\/[^/\s:@]+:[^@\s/]+@/g,
    replacement: '://[REDACTED]@',
  },
];

function redactText(text, path, redactions) {
  let output = String(text);
  for (const item of TEXT_PATTERNS) {
    output = output.replace(item.pattern, (...args) => {
      redactions.push({ path, reason: item.reason });
      if (typeof item.replacement === 'function') {
        return item.replacement(...args);
      }
      return item.replacement.replace(/\$(\d+)/g, (_, index) => args[Number(index)] ?? '');
    });
  }
  return output;
}

function redactValue(value, path, redactions, seen) {
  if (typeof value === 'string') {
    return redactText(value, path, redactions);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, `${path}[${index}]`, redactions, seen));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    throw new TypeError('Context values must not contain circular references.');
  }
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const childPath = path ? `${path}.${key}` : key;
    if (SECRET_KEY_PATTERN.test(key)) {
      output[key] = '[REDACTED]';
      redactions.push({ path: childPath, reason: 'secret-field' });
      continue;
    }
    output[key] = redactValue(value[key], childPath, redactions, seen);
  }
  seen.delete(value);
  return output;
}

export function redactContextSecrets(value) {
  const redactions = [];
  return {
    value: redactValue(value, '$', redactions, new WeakSet()),
    redactions,
  };
}
