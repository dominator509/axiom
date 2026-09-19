/**
 * A publishable bundle must carry one trusted passing ToS score for every
 * destination. Missing, duplicated, malformed, review, and block records are
 * all non-publishable; callers must fail closed rather than infer a pass.
 */
export function tosReportPassesForPlatforms(
  report: unknown,
  platforms: readonly string[],
): boolean {
  if (!isRecord(report) || report.verdict !== 'pass' || !Array.isArray(report.scores)) {
    return false;
  }

  const scores = report.scores;
  return platforms.every((platform) => {
    const matches = scores.filter(
      (score): score is Record<string, unknown> => isRecord(score) && score.platform === platform,
    );
    return matches.length === 1 && matches[0]?.verdict === 'pass';
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
