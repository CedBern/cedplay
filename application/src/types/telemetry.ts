// Discrete event kinds for stronger typing (extend as needed)
export type TelemetryEventType =
  | 'play'
  | 'pause'
  | 'error'
  | 'retry'
  | 'stall-start'
  | 'stall-end'
  | 'manifest'
  | 'level-switch'
  | 'buffer-level'
  | 'stats-sample'
  | 'ended'
  | 'native-session';

export interface TelemetryEventBase {
  ts: number;            // epoch ms
  type: TelemetryEventType;
}

export interface ErrorTelemetryEvent extends TelemetryEventBase {
  type: 'error';
  code?: string;
  message?: string;
  fatal?: boolean;
}

export interface RetryTelemetryEvent extends TelemetryEventBase {
  type: 'retry';
  attempt: number;
  max?: number;
  reason?: string;
}

export interface StallTelemetryEvent extends TelemetryEventBase {
  type: 'stall-start' | 'stall-end';
  bufferSeconds?: number;
}

export interface BufferLevelTelemetryEvent extends TelemetryEventBase {
  type: 'buffer-level';
  bufferSeconds: number;
}

export interface LevelSwitchTelemetryEvent extends TelemetryEventBase {
  type: 'level-switch';
  from?: string;
  to?: string;
  reason?: string;
}

export interface StatsSampleTelemetryEvent extends TelemetryEventBase {
  type: 'stats-sample';
  bitrateKbps?: number;
  droppedFrames?: number;
  bufferedSeconds?: number;
}

export interface SimpleTelemetryEvent extends TelemetryEventBase {
  type: 'play' | 'pause' | 'manifest' | 'ended';
  info?: string;
}

/** Bilan d'une session du lecteur natif Android (aucune URL ni identifiant). */
export interface NativeSessionTelemetryEvent extends TelemetryEventBase {
  type: 'native-session';
  durationMs?: number;
  zaps?: number;
  rebuffers?: number;
  rebufferMs?: number;
  droppedFrames?: number;
  errors?: number;
  lastErrorCode?: string;
}

export type TelemetryEvent =
  | ErrorTelemetryEvent
  | RetryTelemetryEvent
  | StallTelemetryEvent
  | BufferLevelTelemetryEvent
  | LevelSwitchTelemetryEvent
  | StatsSampleTelemetryEvent
  | SimpleTelemetryEvent
  | NativeSessionTelemetryEvent;

export interface TelemetryExportBundle {
  generatedAt: number;
  channelId?: string;
  events: TelemetryEvent[];
  notes?: string;
  version?: 1;
}

export interface TelemetrySummary {
  totalEvents: number;
  errors: number;
  retries: number;
  stalls: number;
  avgBufferSeconds?: number;
  lastBitrateKbps?: number;
}

export function summarizeTelemetry(events: TelemetryEvent[]): TelemetrySummary {
  let errors = 0, retries = 0, stalls = 0;
  const bufferSamples: number[] = [];
  let lastBitrateKbps: number | undefined;
  for (const e of events) {
    switch (e.type) {
      case 'error': errors++; break;
      case 'retry': retries++; break;
      case 'stall-start': stalls++; break;
      case 'buffer-level': bufferSamples.push(e.bufferSeconds); break;
      case 'stats-sample': if (e.bitrateKbps) lastBitrateKbps = e.bitrateKbps; break;
    }
  }
  const avgBufferSeconds = bufferSamples.length ? bufferSamples.reduce((a,b)=>a+b,0)/bufferSamples.length : undefined;
  const summary: TelemetrySummary = { totalEvents: events.length, errors, retries, stalls };
  if (avgBufferSeconds !== undefined) summary.avgBufferSeconds = avgBufferSeconds;
  if (lastBitrateKbps !== undefined) summary.lastBitrateKbps = lastBitrateKbps;
  return summary;
}
