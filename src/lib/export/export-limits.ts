/**
 * Single source of truth for export artifact limits.
 *
 * The server cap and the encoder bitrate have to agree, otherwise the product
 * advertises one thing and enforces another. Creator recording duration is
 * unlimited (entitlements.ts: maxDurationSeconds === null), so the binding
 * constraint on a Creator export is the artifact ceiling below — and that
 * ceiling is expressed here as a consequence of the encoder's own bitrate
 * rather than as an independent number someone picked.
 *
 * Previously the cap was 200 MB against a 10 Mbps encode, which is 164.6
 * seconds: a Creator recording was allowed to be unlimited in length but its
 * export failed after under three minutes, and only after the whole file had
 * been encoded and uploaded.
 */

// Nominal encoder output. These are the values the Mediabunny engine encodes
// with; changing them changes the artifact size of every future export, so they
// live here and the engine imports them instead of redeclaring them.
export const EXPORT_VIDEO_BITRATE = 10_000_000;
export const EXPORT_AUDIO_BITRATE = 192_000;

// Worst-case steady-state artifact size per second of recording. Audio is
// transcoded only when the source has a decodable audio track, so this is an
// upper bound on size per second, which is the safe direction for a cap.
export const EXPORT_BYTES_PER_SECOND = (EXPORT_VIDEO_BITRATE + EXPORT_AUDIO_BITRATE) / 8;

/**
 * Maximum accepted exported artifact, in mebibytes.
 *
 * 2048 MiB is what the encoder's bitrate produces in ~28 minutes of 1080p. It
 * sits below R2's 5 GiB single-PUT limit and is a per-object ceiling, so
 * Creator's unlimited *recording* is untouched. Storage cost is still bounded
 * per export and the Creator library still owns deletion (the user deletes
 * individual exports; account deletion removes every object).
 */
export const MAX_EXPORT_SIZE_MB = 2048;
export const MAX_EXPORT_SIZE_BYTES = MAX_EXPORT_SIZE_MB * 1024 * 1024;

/**
 * Longest recording whose encoded artifact can fit under the cap, derived from
 * the two constants above so the two can never drift apart.
 */
export const MAX_EXPORT_DURATION_SECONDS = Math.floor(MAX_EXPORT_SIZE_BYTES / EXPORT_BYTES_PER_SECOND);

/** User-facing rejection text for a recording too long to export at this bitrate. */
export function describeExportDurationLimit(): string {
  const minutes = Math.floor(MAX_EXPORT_DURATION_SECONDS / 60);
  const seconds = MAX_EXPORT_DURATION_SECONDS % 60;
  const duration = seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} minutes`;
  return `Recording too long to export. At the current export quality the maximum is ${duration} (exports are capped at ${MAX_EXPORT_SIZE_MB}MB). Record in shorter segments and export each one.`;
}