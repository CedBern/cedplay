import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TelemetryEvent } from '@/types/telemetry';

// Stored events for mock
let stored: TelemetryEvent[] = [];
vi.mock('@/utils/idb', () => ({
  saveTelemetryEventsToDB: vi.fn(async (events: TelemetryEvent[]) => { stored = [...events]; }),
  getTelemetryEventsFromDB: vi.fn(async () => stored)
}));

import { TelemetryLogger } from '@/utils/telemetry/logger';

describe('TelemetryLogger persistence toggle', () => {
  beforeEach(() => { stored = []; });
  it('enables then disables persistence without saving after disable', async () => {
    const logger = new TelemetryLogger();
  await logger.enablePersistence();
  // Initially nothing stored
  // Monkey patch schedulePersist to immediate flush for deterministic test
  // accessing private member intentionally for test determinism; make persistence immediate & synchronous
  // Access private via index signature cast for deterministic behavior (acceptable in test scope)
  (logger as unknown as { schedulePersist: () => void }).schedulePersist = () => { stored = [...logger.getAll()]; };
  logger.log('play');
    expect(stored.length).toBe(1);
    logger.disablePersistence();
    logger.log('pause');
    vi.useFakeTimers();
    vi.runAllTimers();
    vi.useRealTimers();
    expect(stored.length).toBe(1); // unchanged after disable
  });
});