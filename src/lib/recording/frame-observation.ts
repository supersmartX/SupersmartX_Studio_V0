export interface FrameObservationSummary {
  targetFps: number | null;
  actualTrackFps: number | null;
  observedPlaybackFps: number | null;
  observedFrameCallbacks: number;
  frameGapCount: number;
  maxFrameGapMs: number | null;
  presentedFrameJumps: number;
}

export interface FrameObservationAccumulator {
  targetFps: number | null;
  actualTrackFps: number | null;
  count: number;
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
  previousTimestampMs: number | null;
  previousPresentedFrameCount: number | null;
  frameGapCount: number;
  maxFrameGapMs: number | null;
  presentedFrameJumps: number;
}

export function createFrameObservationAccumulator(
  targetFps: number | null,
  actualTrackFps: number | null,
): FrameObservationAccumulator {
  return {
    targetFps, actualTrackFps, count: 0, firstTimestampMs: null, lastTimestampMs: null,
    previousTimestampMs: null, previousPresentedFrameCount: null,
    frameGapCount: 0, maxFrameGapMs: null, presentedFrameJumps: 0,
  };
}

export function observePreviewFrame(
  summary: FrameObservationAccumulator,
  timestampMs: number,
  presentedFrameCount: number,
): void {
  summary.count += 1;
  summary.firstTimestampMs ??= timestampMs;
  if (summary.previousTimestampMs !== null) {
    const gap = timestampMs - summary.previousTimestampMs;
    summary.maxFrameGapMs = summary.maxFrameGapMs === null ? gap : Math.max(summary.maxFrameGapMs, gap);
    const threshold = summary.actualTrackFps && summary.actualTrackFps > 0 ? 2000 / summary.actualTrackFps : null;
    if (threshold !== null && gap > threshold) summary.frameGapCount += 1;
  }
  if (summary.previousPresentedFrameCount !== null && presentedFrameCount > summary.previousPresentedFrameCount + 1) {
    summary.presentedFrameJumps += presentedFrameCount - summary.previousPresentedFrameCount - 1;
  }
  summary.previousTimestampMs = timestampMs;
  summary.previousPresentedFrameCount = presentedFrameCount;
  summary.lastTimestampMs = timestampMs;
}

/** Summarizes preview callback timing; it is not an encoded-frame/drop metric. */
export function summarizeFrameObservation(input: FrameObservationAccumulator): FrameObservationSummary {
  return {
    targetFps: input.targetFps,
    actualTrackFps: input.actualTrackFps,
    observedPlaybackFps: input.count > 1 && input.lastTimestampMs !== null && input.firstTimestampMs !== null && input.lastTimestampMs > input.firstTimestampMs
      ? (input.count - 1) * 1000 / (input.lastTimestampMs - input.firstTimestampMs)
      : null,
    observedFrameCallbacks: input.count,
    frameGapCount: input.frameGapCount,
    maxFrameGapMs: input.maxFrameGapMs,
    presentedFrameJumps: input.presentedFrameJumps,
  };
}
