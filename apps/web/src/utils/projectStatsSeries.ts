export function statSparkValues(values?: number[]): number[] | undefined {
  return values && values.length >= 2 ? values : undefined;
}

export function statTrendFromSeries(values?: number[]): number | undefined {
  if (!values || values.length < 2) return undefined;
  const first = values[0];
  const last = values[values.length - 1];
  if (first === 0) return undefined;
  return Math.round(((last - first) / Math.abs(first)) * 100);
}

export function statSeriesHint(values?: number[]): string | undefined {
  return statSparkValues(values) ? "近 12 周" : undefined;
}
