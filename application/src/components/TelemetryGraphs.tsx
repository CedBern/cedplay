// Telemetry debug graphs, lazy-loaded so the ~400 Ko recharts library
// only downloads when the user opens a graph in the diagnostics panel.
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { LineChart, Line, XAxis, YAxis, ComposedChart, Bar } from 'recharts';

export interface StartupPoint { index: number; ms: number }
export interface AttemptPoint { attempt: number; buffers: number; ok: number; err: number }
export interface RatePoint { attempt: number; successRate: number; errorRate: number }

interface TelemetryGraphsProps {
  showStartup: boolean;
  showAttempts: boolean;
  showRate: boolean;
  startupSeries: StartupPoint[];
  attemptSeries: AttemptPoint[];
  rateSeries: RatePoint[];
}

export function TelemetryGraphs({ showStartup, showAttempts, showRate, startupSeries, attemptSeries, rateSeries }: TelemetryGraphsProps) {
  return (
    <>
      {showStartup && startupSeries.length > 1 && (
        <div className="h-24 mb-2">
          <ChartContainer
            config={{ ms: { label: 'Startup ms', color: 'hsl(var(--primary))' } }}
            className="w-full"
          >
            <LineChart data={startupSeries} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
              <XAxis dataKey="index" hide />
              <YAxis dataKey="ms" width={28} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={10} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Line type="monotone" dataKey="ms" stroke="var(--color-ms)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        </div>
      )}
      {showAttempts && attemptSeries.length > 0 && (
        <div className="h-28 mb-2">
          <ChartContainer
            config={{ buffers: { label: 'Buffers', color: 'hsl(var(--warning))' }, ok: { label: 'OK', color: 'hsl(var(--primary))' }, err: { label: 'Err', color: 'hsl(var(--destructive))' } }}
            className="w-full"
          >
            <ComposedChart data={attemptSeries} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
              <XAxis dataKey="attempt" hide />
              <YAxis width={24} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={10} allowDecimals={false} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="buffers" fill="var(--color-buffers)" barSize={6} radius={2} />
              <Line type="monotone" dataKey="ok" stroke="var(--color-ok)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="err" stroke="var(--color-err)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ChartContainer>
        </div>
      )}
      {showRate && rateSeries.length > 1 && (
        <div className="h-24 mb-2">
          <ChartContainer
            config={{ successRate: { label: 'Success %', color: 'hsl(var(--primary))' }, errorRate: { label: 'Error %', color: 'hsl(var(--destructive))' } }}
            className="w-full"
          >
            <LineChart data={rateSeries} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
              <XAxis dataKey="attempt" hide />
              <YAxis width={28} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={10} domain={[0,1]} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Line type="monotone" dataKey="successRate" stroke="var(--color-successRate)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="errorRate" stroke="var(--color-errorRate)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        </div>
      )}
    </>
  );
}
