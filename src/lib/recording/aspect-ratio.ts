/**
 * The take's real aspect ratio label, derived from its ACTUAL dimensions —
 * never a hardcoded constant. Chooses the closest known ratio (landscape,
 * portrait, square and 4:5 sensors all land truthfully); unknown dimensions
 * degrade to '16:9' rather than inventing one.
 */
export function deriveAspectRatioLabel(width: number, height: number): string {
  if (!width || !height) return '16:9';
  const target = width / height;
  const candidates: Array<{ ratio: string; value: number }> = [
    { ratio: '16:9', value: 16 / 9 },
    { ratio: '9:16', value: 9 / 16 },
    { ratio: '4:3', value: 4 / 3 },
    { ratio: '1:1', value: 1 },
    { ratio: '4:5', value: 4 / 5 },
  ];
  return candidates.reduce((best, c) =>
    Math.abs(c.value - target) < Math.abs(best.value - target) ? c : best
  ).ratio;
}
