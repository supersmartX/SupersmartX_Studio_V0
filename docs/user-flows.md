# SupersmartX Studio User Flows

## Approved Flow List

1. First-Time Launch & Permission Setup
2. Device Selection
3. Teleprompter Setup
4. Studio Recording
5. Export or Share
6. Recovery, Retry, and Abandonment

## Validation Summary
- Duplicates removed by separating setup flows from recording flows.
- Overlap minimized by making Teleprompter Setup and Device Selection explicit preparatory flows.
- Transitions are clear: permission setup → device setup → teleprompter setup → recording → export/share.
- Naming is consistent across the Create/Review/Complete lifecycle.
- Information architecture is aligned with the app: onboarding first, then studio tools, then completion or recovery.

## 1. First-Time Launch & Permission Setup

Entry
User opens SupersmartX Studio for the first time.

↓

Journey
- App shows initial studio state with camera/mic setup prompt.
- User clicks Camera to initialize.
- Browser requests camera + microphone permission.
- User grants permission or denies it.
- On grant, preview appears and devices enumerate.
- On deny, app switches into a recovery state with clear next steps.

↓

Exit
User has either granted permissions and entered the studio, or received a clear recovery path.

## 2. Device Selection

Entry
User needs to choose or change camera/mic hardware before or during recording.

↓

Journey
- User opens Device Selector.
- User selects a camera from the dropdown.
- User selects a microphone from the dropdown.
- User optionally refreshes the list after connecting hardware.
- App reinitializes stream with chosen devices.

↓

Exit
Preferred camera and microphone are active, and the studio is ready to record.

## 3. Teleprompter Setup

Entry
User wants to prepare teleprompter content before recording.

↓

Journey
- User opens the Inspector panel.
- User enters or loads a script.
- User adjusts font, width, alignment, color, and scroll speed.
- User opens the Teleprompter overlay.
- App scrolls the script to the top for review.
- User validates readability and timing.

↓

Exit
Teleprompter is configured and ready for recording.

## 4. Studio Recording

Entry
User wants to record a polished video using the studio.

↓

Journey
- User initializes camera if needed.
- User confirms the teleprompter and microphone settings.
- User taps Record.
- Recording starts with teleprompter scroll.
- User stops recording after finishing.

↓

Exit
Recording is complete and export/share actions are available.

## 5. Export or Share

Entry
User has finished the recording and wants to save or distribute it.

↓

Journey
- Recording ends and the export drawer appears.
- User reviews available recording output.
- User clicks Download to save the take.
- Or user clicks Share to copy or publish the studio link.
- App confirms completion of the chosen action.

↓

Exit
User has exported or shared the recording successfully.

## 6. Recovery, Retry, and Abandonment

Entry
User encounters an error, missing hardware, or declines permission.

↓

Journey
- App detects initialization failure or missing devices.
- App shows a specific error state: permission denied, device unavailable, or general error.
- User retries permission or reconnects hardware.
- If recovery is not possible immediately, the app preserves script state.
- User may leave and return later without losing work.

↓

Exit
User either recovers and returns to the studio, or pauses and returns later with saved content.

## 8. Interaction Design

| Action | Response | Feedback |
| --- | --- | --- |
| Click | Buttons and tool actions immediately invoke handlers and update state. Examples: `TransportBar` record/pause/stop, `Header` share/export, `IconRail` teleprompter/camera/mic toggles, `InitOverlay` initialize button. | Immediate visual response through active/hover styles, color changes, toast notifications, and overlay transitions. |
| Hover | Interactive controls use hover classes to show affordance. Examples: `Button`, `IconButton`, `Tabs`, `IconRail`, `BottomNav`. | `hover:text-text-primary`, `hover:bg-elevated`, `hover:bg-red-600`, `hover:text-white`, and similar styles provide instant feedback. |
| Swipe | Not implemented in the current codebase. | There are no swipe gesture handlers in active components; mobile interaction relies on buttons and taps. |
| Long Press | Not implemented in the current codebase. | No long-press handlers exist; future support should include immediate press-state feedback and confirmation. |
| Loading | Camera initialization uses `useCamera` status `requesting` and `InitOverlay` displays retry/error messaging. `VideoPlayer` shows a spinner and "Loading..." while metadata loads. | Overlay panels, inline spinners, and descriptive loading text keep users informed during waits. |
| Success | Share and feedback actions trigger `showToast`. `DiscordFeedback` and `useShare` emit success messages. | `Toast` displays brief confirmation with polite message timing. Buttons and icons also show active/ready state. |
| Error | `useCamera` maps permission/device failures into explicit states; `InitOverlay` shows `errorMessage`; `ExportModal` surfaces playback validation errors. | Error banners, red text/backgrounds, and retry labels provide clear recovery guidance. |
| Disabled | Buttons use disabled styling and behavior (`disabled:opacity-40 disabled:pointer-events-none`, `disabled:cursor-not-allowed`). `Header` export button is disabled when no recording exists. | Controls look inactive and cannot be clicked, making unavailable actions obvious. |
| Feedback Timing | All interactions provide immediate styling or toast feedback on click or keyboard action. Toasts auto-dismiss after 2700ms. | Immediate and clear feedback is delivered consistently, satisfying the design rule.

### Design Rule
- Every interaction must provide immediate and clear feedback.

## 9. Screen Inventory

| Flow | Screen | Components | Navigation |
| --- | --- | --- | --- |
| First-Time Launch & Permission Setup | Studio screen with `InitOverlay` | `InitOverlay`, `Header`, `BottomNav`, `IconRail`, `Toast` | Click `Camera` in `IconRail` or `BottomNav` to trigger browser permission prompt; overlay appears for retry or readiness. |
| Device Selection | Studio screen with `DeviceSelectorBar` drawer/panel | `DeviceSelectorBar`, `IconRail`, `InspectorPanel`, `Toast` | Open device selectors from the studio interface; choose camera/mic from dropdown; refresh devices if hardware changes. |
| Teleprompter Setup | Studio screen with `InspectorPanel` drawer + `TeleprompterOverlay` | `InspectorPanel`, `TeleprompterOverlay`, `IconRail` Teleprompter button, `Toast` | Open teleprompter via `IconRail`; use the inspector drawer for script editing and teleprompter settings. |
| Studio Recording | Core Studio screen | `CameraPreview`, `TransportBar`, `RecordingBadge`, `Timer`, `FocalGuideway`, `Canvas`, `Toast` | Start/stop recording from `TransportBar`; use mic toggle and camera controls in `IconRail`. |
| Export or Share | Export `Modal` dialog | `ExportModal`, `DiscordFeedback`, `Toast`, `Modal` | Open from `Header` export/share actions; download or share within the modal. |
| Recovery, Retry, and Abandonment | Studio screen with `InitOverlay` / media error state | `InitOverlay`, `Toast` | Detect camera/mic initialization failures in `useCamera`; prompt retry via `InitOverlay` and preserve script state. |

### Notes
- Every screen listed maps directly to a validated user flow.
- This inventory is grounded in `src/app/page.tsx`: the app uses a single `HomePage` studio screen, with `activePanel` controlling studio/library/insights content.
- The studio screen renders `DeviceSelectorBar`, `CameraPreview`, `TeleprompterOverlay`, `TransportBar`, `RecordingBadge`, `Timer`, `FocalGuideway`, and `InitOverlay` based on state.
- `ExportModal` and `WelcomeModal` are handled as modal dialogs; `InspectorPanel` functions as a desktop panel or mobile drawer; `Tooltip` is used in `BottomNav` and elsewhere, and now supports hover and focus activation with `aria-describedby`.
- There are no new full-screen screens required beyond the existing studio flow structure.
