import labels from './aso-market-labels.json' with { type: 'json' };

export const asoMarketLabels = new Map(Object.entries(labels));

export function listAsoMarkets() {
  return Array.from(asoMarketLabels, ([id, label]) => ({ id, label }));
}
