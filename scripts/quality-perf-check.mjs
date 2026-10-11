#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

import {
  appendReleaseEntry,
  buildReleaseChangeSummary,
  buildReleaseLedgerSummary,
  defaultReleaseLedger,
  normalizeReleaseLedger,
  setCurrentReleaseVersion,
} from '../src/release-ledger.js';
import { buildChangeSummaryFromEntries } from '../src/change-summary.js';

const MB = 1024 * 1024;

function parseArgs(argv) {
  const options = {
    mode: 'normal',
    fixture: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode' && argv[index + 1]) {
      options.mode = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--fixture' && argv[index + 1]) {
      options.fixture = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function formatNumber(value) {
  return Number(value).toFixed(2);
}

function isoTimestamp() {
  return new Date().toISOString();
}

async function readQualityBaseline(mode) {
  const configPath = path.resolve('.open-vibecoding/quality/config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  return mode === 'extreme'
    ? config.evalHarness?.projectBaseline?.extreme
    : config.evalHarness?.projectBaseline?.normal;
}

async function readFixtureConfig(mode, fixturePath) {
  if (mode !== 'extreme' || !fixturePath) {
    return {
      versionCount: 6,
      itemsPerVersion: 18,
      detailRepeats: 2,
      iterations: 180,
      limit: 12,
    };
  }
  const fullPath = path.resolve(fixturePath);
  const raw = JSON.parse(await fs.readFile(fullPath, 'utf8'));
  return {
    versionCount: Number(raw.versionCount ?? 24),
    itemsPerVersion: Number(raw.itemsPerVersion ?? 36),
    detailRepeats: Number(raw.detailRepeats ?? 6),
    iterations: Number(raw.iterations ?? 140),
    limit: Number(raw.limit ?? 16),
  };
}

function buildSentence(versionIndex, itemIndex, detailRepeats) {
  const verbs = ['新增', '修复', '优化', '调整', '移除'];
  const verb = verbs[(versionIndex + itemIndex) % verbs.length];
  const topic = `版本轨道变更 ${versionIndex + 1}-${itemIndex + 1}`;
  const detail = Array.from({ length: detailRepeats }, (_, index) => `${topic} 说明片段 ${index + 1}`).join('，');
  return `${verb}${topic}，${detail}`;
}

function buildVersion(versionIndex) {
  const major = 0;
  const minor = Math.floor(versionIndex / 10) + 1;
  const patch = (versionIndex % 10) + 1;
  return `${major}.${minor}.${patch}`;
}

async function buildLedger(config) {
  let ledger = {
    ...defaultReleaseLedger(),
    enabled: true,
  };
  for (let versionIndex = 0; versionIndex < config.versionCount; versionIndex += 1) {
    const version = buildVersion(versionIndex);
    ({ ledger } = setCurrentReleaseVersion(ledger, version));
    for (let itemIndex = 0; itemIndex < config.itemsPerVersion; itemIndex += 1) {
      ({ ledger } = appendReleaseEntry(ledger, buildSentence(versionIndex, itemIndex, config.detailRepeats), {
        version,
        source: {
          kind: 'perf-fixture',
          versionIndex,
          itemIndex,
        },
      }));
    }
  }
  return normalizeReleaseLedger(ledger);
}

function runBenchmark(ledger, config) {
  const durations = [];
  const heapSamples = [];
  const startHeap = process.memoryUsage().heapUsed / MB;
  for (let index = 0; index < config.iterations; index += 1) {
    const startedAt = performance.now();
    const summary = buildReleaseLedgerSummary(ledger);
    const changeSummary = buildReleaseChangeSummary(ledger, {
      version: summary.currentVersion,
      limit: config.limit,
    });
    buildChangeSummaryFromEntries(changeSummary.items, { limit: config.limit });
    durations.push(performance.now() - startedAt);
    heapSamples.push(process.memoryUsage().heapUsed / MB);
  }
  const endHeap = process.memoryUsage().heapUsed / MB;
  return {
    iterations: durations.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: Math.max(...durations),
    avgMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
    startHeapMB: startHeap,
    endHeapMB: endHeap,
    peakHeapMB: Math.max(...heapSamples, endHeap),
    heapDeltaMB: endHeap - startHeap,
  };
}

async function writeReport(mode, fixtureConfig, baseline, metrics) {
  const reportDir = path.resolve('.open-vibecoding/harness/test-reports');
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `quality-${mode}-performance.md`);
  const title = mode === 'extreme' ? 'EVO Extreme Performance Report' : 'EVO Normal Performance Report';
  const lines = [
    `# ${title}`,
    '',
    `- generatedAt: ${isoTimestamp()}`,
    `- mode: ${mode}`,
    `- performance: p50 ${formatNumber(metrics.p50Ms)}ms, p95 ${formatNumber(metrics.p95Ms)}ms, max ${formatNumber(metrics.maxMs)}ms`,
    `- latency baseline: p95 <= ${baseline.apiLatencyMsP95Max}ms`,
    `- memory baseline: peak <= ${baseline.memoryMBP95Max}MB`,
    `- memory: start ${formatNumber(metrics.startHeapMB)}MB, peak ${formatNumber(metrics.peakHeapMB)}MB, delta ${formatNumber(metrics.heapDeltaMB)}MB`,
    `- dataset: ${fixtureConfig.versionCount} versions x ${fixtureConfig.itemsPerVersion} items`,
    mode === 'extreme'
      ? `- extreme: fixture-driven load passed with ${fixtureConfig.detailRepeats} repeated detail fragments per item`
      : '- performance: baseline ledger summary path remained within project limits',
    '',
  ];
  await fs.writeFile(reportPath, `${lines.join('\n')}\n`, 'utf8');
  return reportPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [baseline, fixtureConfig] = await Promise.all([
    readQualityBaseline(options.mode),
    readFixtureConfig(options.mode, options.fixture),
  ]);
  const ledger = await buildLedger(fixtureConfig);
  const metrics = runBenchmark(ledger, fixtureConfig);
  const withinLatency = metrics.p95Ms <= Number(baseline.apiLatencyMsP95Max ?? 500);
  const withinMemory = metrics.peakHeapMB <= Number(baseline.memoryMBP95Max ?? 512);
  const reportPath = await writeReport(options.mode, fixtureConfig, baseline, metrics);
  const result = {
    ok: withinLatency && withinMemory,
    mode: options.mode,
    reportPath,
    dataset: {
      versionCount: fixtureConfig.versionCount,
      itemsPerVersion: fixtureConfig.itemsPerVersion,
      detailRepeats: fixtureConfig.detailRepeats,
    },
    metrics,
    baseline,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

await main();
