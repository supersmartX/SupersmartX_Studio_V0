/**
 * Planned studio modules — the target information architecture the navigation
 * and panel system are being prepared for. This registry is DOCUMENTATION, not
 * rendered navigation: no entry here may appear in the IconRail or the compact
 * menu until its module actually ships, because a nav item without a
 * destination is a dead link and a dead promise.
 *
 * When a module ships:
 *   1. Move its id into `TabType` (src/types/index.ts) — panels switch on it.
 *   2. Add its entry to the IconRail primary group and the CompactNavMenu list
 *      (both components note where), reusing the existing item pattern
 *      (40px min target, Tooltip on the rail, aria-current for the active one).
 *   3. Delete it from this registry. What remains here is still-unshipped.
 *
 * 'account' is already live as the /settings page (linked from the Header user
 * menu and from /billing); it is listed so the module map stays complete.
 */
export type FutureModuleId =
  | 'recording'
  | 'create'
  | 'video-editor'
  | 'my-projects'
  | 'templates'
  | 'account';

export interface FutureModule {
  id: FutureModuleId;
  /** Label as it should appear in navigation when the module ships. */
  label: string;
  /** One-line product intent, so the module's scope stays traceable. */
  intent: string;
  /** Shipped modules: live today, listed for completeness only. */
  status: 'shipped' | 'planned';
}

export const FUTURE_STUDIO_MODULES: readonly FutureModule[] = [
  { id: 'recording', label: 'Recording', intent: 'The teleprompter + capture studio (today the default studio canvas).', status: 'shipped' },
  { id: 'create', label: 'Create', intent: 'Scripted/templated creation entry point feeding the Recording studio.', status: 'planned' },
  { id: 'video-editor', label: 'Video Editor', intent: 'Clip trimming and editing over a mastered take.', status: 'planned' },
  { id: 'my-projects', label: 'My Projects', intent: 'Project grouping above individual recordings (extends the library).', status: 'planned' },
  { id: 'templates', label: 'Templates', intent: 'Reusable teleprompter scripts and format presets.', status: 'planned' },
  { id: 'account', label: 'Account', intent: 'Profile, plan and billing — live at /settings.', status: 'shipped' },
] as const;
