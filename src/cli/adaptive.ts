export interface AdaptivePercentageOpts {
  basePercentage: number;
  fnrLow: number;
  fnrHigh: number;
  minPercentage: number;
  step: number;
}

export interface AdaptivePercentageResult {
  percentage: number;
  reason: string;
}

export interface AdaptiveSignals {
  falseNegativeRate: number | null;
  divergenceRate: number | null;
}

function formatSignals(signals: AdaptiveSignals): string {
  const parts: string[] = [];
  if (signals.falseNegativeRate != null) {
    parts.push(`FNR ${(signals.falseNegativeRate * 100).toFixed(1)}%`);
  }
  if (signals.divergenceRate != null) {
    parts.push(`divergence ${(signals.divergenceRate * 100).toFixed(1)}%`);
  }
  return parts.join(", ");
}

export function computeAdaptivePercentage(
  signals: AdaptiveSignals,
  opts: AdaptivePercentageOpts,
): AdaptivePercentageResult {
  const { falseNegativeRate: fnr, divergenceRate: div } = signals;

  if (fnr == null && div == null) {
    return {
      percentage: opts.basePercentage,
      reason: "adaptive: no data, using base percentage",
    };
  }

  const effectiveRate = Math.max(fnr ?? 0, div ?? 0);
  const driverSignal = (div ?? 0) >= (fnr ?? 0) ? "divergence" : "FNR";
  const signalsStr = formatSignals(signals);

  if (effectiveRate < opts.fnrLow) {
    const reduced = Math.max(opts.minPercentage, opts.basePercentage - opts.step);
    return {
      percentage: reduced,
      reason: `adaptive: ${signalsStr} (${driverSignal} drove) < ${(opts.fnrLow * 100).toFixed(0)}% threshold, reduced to ${reduced}%`,
    };
  }

  if (effectiveRate > opts.fnrHigh) {
    const increased = opts.basePercentage + opts.step;
    return {
      percentage: increased,
      reason: `adaptive: ${signalsStr} (${driverSignal} drove) > ${(opts.fnrHigh * 100).toFixed(0)}% threshold, increased to ${increased}%`,
    };
  }

  return {
    percentage: opts.basePercentage,
    reason: `adaptive: ${signalsStr} (${driverSignal} drove) within target range, keeping ${opts.basePercentage}%`,
  };
}
