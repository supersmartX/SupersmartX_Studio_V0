# SupersmartX Studio User Flows

## Approved Flow List

1. Landing Page & First Visit
2. First-Time Launch & Permission Setup
3. Device Selection
4. Teleprompter Setup
5. Studio Recording
6. Export or Share
7. Support & Payment
8. Recovery, Retry, and Abandonment

## Validation Summary
- Duplicates removed by separating setup flows from recording flows.
- Overlap minimized by making Teleprompter Setup and Device Selection explicit preparatory flows.
- Transitions are clear: landing page → permission setup → device setup → teleprompter setup → recording → export/share.
- Naming is consistent across the Create/Review/Complete lifecycle.
- Information architecture is aligned with the app: landing page first, then onboarding, then studio tools, then completion or recovery.

## 1. Landing Page & First Visit

Entry
User visits SupersmartX Studio for the first time via `https://studio.supersmartx.com/`.

↓

Journey
- App renders the marketing landing page at `/` with hero section, features, how-it-works, privacy info, and feedback/support links.
- User can explore features without signing in.
- User clicks "Try Studio Free" or "Open Studio" to navigate to `/studio`.
- If user is signed in, header shows avatar with user menu (Open Studio, Sign out).
- If user is not signed in, header shows Sign In button which opens `AuthModal`.

↓

Exit
User navigates to the studio or closes the browser. No data is collected.

## 2. First-Time Launch & Permission Setup

Entry
User opens SupersmartX Studio for the first time at `/studio`.

↓

Journey
- `WelcomeModal` may appear on first visit with onboarding guidance.
- App shows initial studio state with camera/mic setup prompt via `InitOverlay`.
- User clicks Camera to initialize.
- Browser requests camera + microphone permission.
- User grants permission or denies it.
- On grant, `CameraPreview` appears and devices enumerate.
- On deny, app switches into a recovery state with clear next steps via `InitOverlay` error messaging.

↓

Exit
User has either granted permissions and entered the studio, or received a clear recovery path.

## 3. Device Selection

Entry
User needs to choose or change camera/mic hardware before or during recording.

↓

Journey
- User opens `DeviceSelectorBar` (visible at top of studio when camera is initialized).
- User selects a camera from the video dropdown.
- User selects a microphone from the audio dropdown.
- User optionally refreshes the list after connecting hardware.
- App reinitializes stream with chosen devices via `useCamera`.

↓

Exit
Preferred camera and microphone are active, and the studio is ready to record.

## 4. Teleprompter Setup

Entry
User wants to prepare teleprompter content before recording.

↓

Journey
- User opens the `InspectorPanel` (desktop: right panel, mobile: bottom drawer).
- User enters or loads a script (with optional `InspirationLoader` for template scripts).
- User adjusts font, width, alignment, color, and scroll speed.
- User opens the `TeleprompterOverlay` via `IconRail`.
- App scrolls the script to the top for review.
- User validates readability and timing.

↓

Exit
Teleprompter is configured and ready for recording.

## 5. Studio Recording

Entry
User wants to record a polished video using the studio.

↓

Journey
- User initializes camera if needed.
- User confirms the teleprompter and microphone settings.
- User taps Record on `TransportBar` or via `IconRail`.
- 3-second countdown appears (`CountdownOverlay`).
- Recording starts with teleprompter scroll and `RecordingBadge` visible.
- `Timer` tracks elapsed time.
- User pauses or stops recording.
- `FocalGuideway` provides eye-line guidance throughout.

↓

Exit
Recording is complete and export/share actions are available.

## 6. Export or Share

Entry
User has finished the recording and wants to save or distribute it.

↓

Journey
- Recording ends and `ExportModal` drawer appears automatically.
- User reviews video/audio playback with seek, speed, and fullscreen controls.
- User clicks Download to save the take (requires authentication via `AuthModal` if not signed in).
- User clicks Share to copy or publish the studio link via `useShare` (Web Share API with clipboard fallback).
- User can click "Practice Again" to reset and re-record.
- `DiscordFeedback` component available for community feedback.

↓

Exit
User has exported or shared the recording successfully.

## 7. Support & Payment

Entry
User wants to support SupersmartX development.

↓

Journey
- Support modal (`SupportModal`) opens automatically after every 3rd recording, or when user clicks Support.
- User can also access support via `/studio?support=1` URL parameter.
- Support card in `IconRail` (desktop) or `BottomNav` (mobile) provides quick access.
- User selects a support amount and completes payment via Cashfree SDK.
- Payment success redirects to `/support/success`.

↓

Exit
User has completed a support payment or closed the modal.

## 8. Recovery, Retry, and Abandonment

Entry
User encounters an error, missing hardware, or declines permission.

↓

Journey
- `useCamera` detects initialization failure or missing devices.
- `InitOverlay` shows a specific error state: permission denied, device unavailable, or general error.
- User retries permission or reconnects hardware.
- If recovery is not possible immediately, the app preserves script state via `useScriptStorage` (localStorage).
- User may leave and return later without losing work.
- Camera `track ended` listener detects disconnection and surfaces recovery UI.

↓

Exit
User either recovers and returns to the studio, or pauses and returns later with saved content.

## 9. Interaction Design

| Action | Response | Feedback |
| --- | --- | --- |
| Click | Buttons and tool actions immediately invoke handlers and update state. Examples: `TransportBar` record/pause/stop, `Header` share/export, `IconRail` teleprompter/camera/mic toggles, `InitOverlay` initialize button. | Immediate visual response through active/hover styles, color changes, toast notifications, and overlay transitions. |
| Hover | Interactive controls use hover classes to show affordance. Examples: `Button`, `IconButton`, `Tabs`, `IconRail`, `BottomNav`. | `hover:text-text-primary`, `hover:bg-elevated`, `hover:bg-red-600`, `hover:text-white`, and similar styles provide instant feedback. |
| Swipe | Not implemented in the current codebase. | There are no swipe gesture handlers in active components; mobile interaction relies on buttons and taps. |
| Long Press | Not implemented in the current codebase. | No long-press handlers exist; future support should include immediate press-state feedback and confirmation. |
| Loading | Camera initialization uses `useCamera` status `requesting` and `InitOverlay` displays retry/error messaging. `VideoPlayer` shows a spinner and "Loading..." while metadata loads. | Overlay panels, inline spinners, and descriptive loading text keep users informed during waits. |
| Success | Share and feedback actions trigger `showToast`. `DiscordFeedback` and `useShare` emit success messages. Payment success redirects to `/support/success`. | `Toast` displays brief confirmation with polite message timing. Buttons and icons also show active/ready state. |
| Error | `useCamera` maps permission/device failures into explicit states; `InitOverlay` shows `errorMessage`; `ExportModal` surfaces playback validation errors; `recorder.onerror` saves partial recordings. | Error banners, red text/backgrounds, and retry labels provide clear recovery guidance. |
| Disabled | Buttons use disabled styling and behavior (`disabled:opacity-40 disabled:pointer-events-none`, `disabled:cursor-not-allowed`). `Header` export button is disabled when no recording exists. | Controls look inactive and cannot be clicked, making unavailable actions obvious. |
| Feedback Timing | All interactions provide immediate styling or toast feedback on click or keyboard action. Toasts auto-dismiss after 2700ms. | Immediate and clear feedback is delivered consistently, satisfying the design rule. |

### Design Rule
- Every interaction must provide immediate and clear feedback.

## 10. Screen Inventory

| Flow | Screen | Components | Navigation |
| --- | --- | --- | --- |
| Landing Page & First Visit | Marketing landing page at `/` | `LandingPage`, `AuthModal`, `Link` (next/link) | Header nav links, "Try Studio Free" CTA buttons, footer links |
| First-Time Launch & Permission Setup | Studio screen with `WelcomeModal` + `InitOverlay` | `WelcomeModal`, `InitOverlay`, `Header`, `BottomNav`, `IconRail`, `Toast` | Click `Camera` in `IconRail` or `BottomNav` to trigger browser permission prompt; overlay appears for retry or readiness. |
| Device Selection | Studio screen with `DeviceSelectorBar` | `DeviceSelectorBar`, `IconRail`, `InspectorPanel`, `Toast` | Open device selectors from the studio interface; choose camera/mic from dropdown; refresh devices if hardware changes. |
| Teleprompter Setup | Studio screen with `InspectorPanel` + `TeleprompterOverlay` | `InspectorPanel`, `TeleprompterOverlay`, `InspirationLoader`, `IconRail` Teleprompter button, `Toast` | Open teleprompter via `IconRail`; use the inspector drawer for script editing and teleprompter settings. |
| Studio Recording | Core Studio screen | `CameraPreview`, `TransportBar`, `RecordingBadge`, `Timer`, `FocalGuideway`, `CountdownOverlay`, `Canvas`, `Toast` | Start/stop recording from `TransportBar`; use mic toggle and camera controls in `IconRail`. |
| Export or Share | `ExportModal` dialog | `ExportModal`, `VideoPlayer`, `DiscordFeedback`, `Toast`, `Modal` | Open from `Header` export/share actions or automatically after recording; download or share within the modal. |
| Support & Payment | `SupportModal` dialog | `SupportModal`, `Toast`, `Modal` | Open from `IconRail` support card, `BottomNav`, or automatically after every 3rd recording. |
| Recovery, Retry, and Abandonment | Studio screen with `InitOverlay` / media error state | `InitOverlay`, `useCamera`, `Toast` | Detect camera/mic initialization failures in `useCamera`; prompt retry via `InitOverlay` and preserve script state. |

### Notes
- Every screen listed maps directly to a validated user flow.
- This inventory is grounded in `src/app/studio/page.tsx`: the app uses a single `HomePage` studio screen, with `activePanel` controlling studio/library/insights content.
- The studio screen renders `DeviceSelectorBar`, `CameraPreview`, `TeleprompterOverlay`, `TransportBar`, `RecordingBadge`, `Timer`, `FocalGuideway`, and `InitOverlay` based on state.
- `ExportModal`, `WelcomeModal`, `SupportModal`, and `AuthModal` are handled as modal dialogs; `InspectorPanel` functions as a desktop panel or mobile drawer; `Tooltip` is used in `BottomNav` and elsewhere, and supports hover and focus activation with `aria-describedby`.
- The landing page at `/` (`src/app/page.tsx`) is a full marketing page separate from the studio.
- CSS visibility (`hidden` class) is used instead of conditional rendering for `Canvas`/`CameraPreview` to prevent stream unmount on tab switch.
