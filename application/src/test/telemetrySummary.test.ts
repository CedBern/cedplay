import { describe, it, expect, vi } from 'vitest';
import { summarizeTelemetry, TelemetryEvent } from '@/types/telemetry';

// Mock idb module BEFORE importing logger to intercept dynamic import
const existing: TelemetryEvent[] = [ { ts: Date.now(), type: 'play' } ];
vi.mock('@/utils/idb', () => ({
  saveTelemetryEventsToDB: vi.fn(async () => {}),
  getTelemetryEventsFromDB: vi.fn(async () => existing)
}));

import { TelemetryLogger } from '@/utils/telemetry/logger';

describe('summarizeTelemetry', () => {
  it('aggregates counts and averages', () => {
    const now = Date.now();
    const events: TelemetryEvent[] = [
      { ts: now, type: 'play' },
      { ts: now+1, type: 'buffer-level', bufferSeconds: 5 },
      { ts: now+2, type: 'buffer-level', bufferSeconds: 15 },
      { ts: now+3, type: 'retry', attempt: 1 },
      { ts: now+4, type: 'retry', attempt: 2 },
      { ts: now+5, type: 'stall-start' },
      { ts: now+6, type: 'error', message: 'x' },
      { ts: now+7, type: 'stats-sample', bitrateKbps: 3000 }
    ];
    const summary = summarizeTelemetry(events);
    expect(summary.totalEvents).toBe(events.length);
    expect(summary.errors).toBe(1);
    expect(summary.retries).toBe(2);
    expect(summary.stalls).toBe(1);
    expect(summary.avgBufferSeconds).toBeCloseTo(10, 1);
    expect(summary.lastBitrateKbps).toBe(3000);
  });
});

describe('TelemetryLogger persistence (mocked)', () => {
  it('loads existing events when persistence enabled', async () => {
    const logger = new TelemetryLogger();
    await logger.enablePersistence();
    expect(logger.getAll().length).toBe(1);
    // log new event triggers schedulePersist (debounced) - advance timers
    vi.useFakeTimers();
    logger.log('pause');
    vi.runAllTimers();
    vi.useRealTimers();
    expect(logger.getAll().length).toBe(2);
  });
});