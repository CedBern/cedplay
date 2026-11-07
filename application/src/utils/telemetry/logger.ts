import { TelemetryEvent, TelemetryEventType, TelemetryExportBundle, summarizeTelemetry } from '@/types/telemetry';
// Lazy import helpers to avoid circular dependency / bundle impact when not used
type PersistFns = {
  saveTelemetryEventsToDB: (events: TelemetryEvent[]) => Promise<void>;
  getTelemetryEventsFromDB: () => Promise<TelemetryEvent[] | undefined>;
};

/** In-memory ring buffer logger (UI session scoped) */
export class TelemetryLogger {
  private buffer: TelemetryEvent[] = [];
  private max = 300;
  private listeners = new Set<(ev: TelemetryEvent) => void>();
  private persistEnabled = false;
  private persistDebounce: number | null = null;
  private persistFnsPromise?: Promise<PersistFns>;

  log(type: TelemetryEventType, data: Partial<Omit<TelemetryEvent,'ts'|'type'>> = {}) {
    const ev: TelemetryEvent = { ts: Date.now(), type, ...(data as Record<string, unknown>) } as TelemetryEvent;
    this.buffer.push(ev);
    if (this.buffer.length > this.max) this.buffer.splice(0, this.buffer.length - this.max);
    this.listeners.forEach(l => l(ev));
  if (this.persistEnabled) this.schedulePersist();
    return ev;
  }

  getAll(): TelemetryEvent[] { return [...this.buffer]; }
  clear() { this.buffer = []; }
  on(listener: (ev: TelemetryEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  exportBundle(channelId?: string, notes?: string): TelemetryExportBundle {
  return { generatedAt: Date.now(), channelId: channelId ?? undefined, events: this.getAll(), notes: notes ?? undefined, version: 1 } as TelemetryExportBundle;
  }

  exportJson(channelId?: string, notes?: string): string { return JSON.stringify(this.exportBundle(channelId, notes), null, 2); }

  summary() { return summarizeTelemetry(this.buffer); }

  /** Enable IndexedDB persistence (no-op if already enabled). Loads existing events (if any) */
  async enablePersistence() {
    if (this.persistEnabled) return;
    this.persistEnabled = true;
    const fns = await this.getPersistFns();
    try {
      const existing = await fns.getTelemetryEventsFromDB();
      if (existing && existing.length) {
        // Only take last max events and append to current (current likely empty at startup)
        const tail = existing.slice(-this.max);
        this.buffer = tail;
      }
    } catch (e) {
      console.warn('Telemetry persistence load failed', e);
    }
  }

  disablePersistence() {
    this.persistEnabled = false;
    if (this.persistDebounce) {
      window.clearTimeout(this.persistDebounce);
      this.persistDebounce = null;
    }
  }
  isPersisting() { return this.persistEnabled; }

  private async getPersistFns(): Promise<PersistFns> {
    if (!this.persistFnsPromise) {
      this.persistFnsPromise = import('@/utils/idb').then(m => ({
        saveTelemetryEventsToDB: m.saveTelemetryEventsToDB as (events: TelemetryEvent[]) => Promise<void>,
        getTelemetryEventsFromDB: m.getTelemetryEventsFromDB as () => Promise<TelemetryEvent[] | undefined>
      }));
    }
    return this.persistFnsPromise;
  }

  private schedulePersist() {
  if (this.persistDebounce) window.clearTimeout(this.persistDebounce);
  this.persistDebounce = window.setTimeout(() => { this.flushPersist(); }, 750);
  }

  private async flushPersist() {
    if (!this.persistEnabled) return;
    try {
      const fns = await this.getPersistFns();
      await fns.saveTelemetryEventsToDB(this.buffer);
    } catch (e) {
      console.warn('Telemetry persistence save failed', e);
    }
  }
}

export const globalTelemetryLogger = new TelemetryLogger();
