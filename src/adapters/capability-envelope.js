const ADAPTER_CONTRACT_VERSION = 1;

const CAPABILITY_STATUS = Object.freeze({
  NATIVE: 'native',
  SURFACE_DEPENDENT: 'surface-dependent',
  UNSUPPORTED: 'unsupported',
});

const BASE_CAPABILITIES = Object.freeze({
  codex: Object.freeze({
    hooks: CAPABILITY_STATUS.NATIVE,
    beforeTool: CAPABILITY_STATUS.NATIVE,
    afterTool: CAPABILITY_STATUS.NATIVE,
    approvalUI: CAPABILITY_STATUS.SURFACE_DEPENDENT,
    browser: CAPABILITY_STATUS.SURFACE_DEPENDENT,
    computerUse: CAPABILITY_STATUS.SURFACE_DEPENDENT,
    imageGeneration: CAPABILITY_STATUS.SURFACE_DEPENDENT,
    currentThreadMessaging: CAPABILITY_STATUS.SURFACE_DEPENDENT,
    backgroundAgents: CAPABILITY_STATUS.SURFACE_DEPENDENT,
  }),
  claude: Object.freeze({
    hooks: CAPABILITY_STATUS.UNSUPPORTED,
    beforeTool: CAPABILITY_STATUS.UNSUPPORTED,
    afterTool: CAPABILITY_STATUS.UNSUPPORTED,
    approvalUI: CAPABILITY_STATUS.UNSUPPORTED,
    browser: CAPABILITY_STATUS.UNSUPPORTED,
    computerUse: CAPABILITY_STATUS.UNSUPPORTED,
    imageGeneration: CAPABILITY_STATUS.UNSUPPORTED,
    currentThreadMessaging: CAPABILITY_STATUS.UNSUPPORTED,
    backgroundAgents: CAPABILITY_STATUS.SURFACE_DEPENDENT,
  }),
  cursor: Object.freeze({
    hooks: CAPABILITY_STATUS.UNSUPPORTED,
    beforeTool: CAPABILITY_STATUS.UNSUPPORTED,
    afterTool: CAPABILITY_STATUS.UNSUPPORTED,
    approvalUI: CAPABILITY_STATUS.UNSUPPORTED,
    browser: CAPABILITY_STATUS.UNSUPPORTED,
    computerUse: CAPABILITY_STATUS.UNSUPPORTED,
    imageGeneration: CAPABILITY_STATUS.SURFACE_DEPENDENT,
    currentThreadMessaging: CAPABILITY_STATUS.UNSUPPORTED,
    backgroundAgents: CAPABILITY_STATUS.SURFACE_DEPENDENT,
  }),
});

function normalizeClient(value) {
  const client = String(value ?? '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(BASE_CAPABILITIES, client)) {
    throw new Error(`Unsupported OpenPrd adapter client: ${value}`);
  }
  return client;
}

function normalizeObservedCapabilities(observed) {
  if (!Array.isArray(observed)) return new Set();
  return new Set(observed.map((item) => String(item ?? '').trim()).filter(Boolean));
}

function describeCapabilities(client, options = {}) {
  const normalized = normalizeClient(client);
  const observed = normalizeObservedCapabilities(options.observedCapabilities);
  const baseline = BASE_CAPABILITIES[normalized];
  const capabilities = {};
  for (const [name, status] of Object.entries(baseline)) {
    capabilities[name] = status === CAPABILITY_STATUS.SURFACE_DEPENDENT && observed.has(name)
      ? CAPABILITY_STATUS.NATIVE
      : status;
  }
  return {
    schema: 'openprd.adapter-capabilities.v1',
    contractVersion: ADAPTER_CONTRACT_VERSION,
    client: normalized,
    surface: options.surface ?? 'unknown',
    capabilities,
  };
}

function capabilityAvailable(envelope, name) {
  return envelope?.capabilities?.[name] === CAPABILITY_STATUS.NATIVE;
}

export {
  ADAPTER_CONTRACT_VERSION,
  BASE_CAPABILITIES,
  CAPABILITY_STATUS,
  capabilityAvailable,
  describeCapabilities,
  normalizeClient,
};
