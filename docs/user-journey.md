# SuperSmartX Studio — Complete User Journey (FROZEN)

> Status: **Frozen** — the single source of truth for product behavior.
> The differentiation between Free and Creator is the **workflow**, not feature count.

## Product positioning

> **SuperSmartX Studio is the fastest way for a non-editor to turn a script into publishable video content.**

## Core promise

> **Record once. Publish everywhere.**

## Core workflow

```text
LANDING
   ↓
SIGN UP / SIGN IN
   ↓
STUDIO
   ↓
SCRIPT
   ↓
TELEPROMPTER
   ↓
RECORD
   ↓
PLATFORM
   ↓
PREVIEW
   ↓
EXPORT
   ↓
DOWNLOAD / CLOUD LIBRARY
   ↓
PUBLISH
```

Free and Creator follow the same core journey. Creator does not become a different product — it removes constraints and expands the workflow.

---

## 1. LANDING PAGE

### Hero

**Headline:**
> Record once. Publish everywhere.

**Supporting copy:**
> Turn your script into a camera-ready video without learning video editing.

Position Studio as:
- Creator Content Studio

Not:
- Video editor
- Generic recorder
- Just a teleprompter
- AI video generator

**Primary CTA:** `Start Recording — Free`

**Secondary:** `See how it works`

## 2. PRICING PREVIEW

The landing page makes the two plans immediately understandable.

### FREE

> Make short videos.

- ¥0
- 10 min/day recording
- 3 min teleprompter per recording
- 720p
- YouTube 16:9
- Unlimited local downloads
- Watermark

CTA: `Start Free`

### CREATOR

> Create without limits.

- ¥349/month *(India geo price; pricing is geo-localized server-side)*
- or ¥2,899/year

- Unlimited recording
- Unlimited teleprompter
- 1080p
- All platforms
- No watermark
- Voice teleprompter
- Cloud library
- Unlimited exports

CTA: `Start Creating`

## 3. SIGN UP / SIGN IN

Entry options:

```text
Email
Google
```

After authentication:

```text
Authentication
      ↓
Plan detected
      ↓
Studio
```

New users start as **Free**. No forced payment.

## 4. FIRST STUDIO EXPERIENCE

The user enters the single Studio workspace. The Studio communicates:

> I can make a video here.

Not "I have entered a complicated video editor."

```text
┌─────────────────────────────────────────────┐
│ SuperSmartX Studio                         │
│                                             │
│ Script → Teleprompter → Record → Platform  │
│                                             │
│                 Camera                      │
│                                             │
│              Teleprompter                  │
│                                             │
│              Recording Controls            │
└─────────────────────────────────────────────┘
```

## 5. SCRIPT

The user can enter/paste their script. The purpose is simple:

> What do you want to say?

```text
Paste script
      ↓
Adjust teleprompter
      ↓
Ready to record
```

## 6. FREE USER — TELEPROMPTER

Free user sees:

### `Teleprompter · 03:00 left`

Per **recording session**. Two independent allowances:

```text
Recording allowance    10:00 TOTAL / DAY
Teleprompter allowance 03:00 / RECORDING
```

Example — Recording #1 starts:

```text
Daily recording remaining:  10:00
Teleprompter:               03:00
```

After 2 minutes:

```text
Daily recording remaining:  08:00
Teleprompter:               01:00
```

If the teleprompter reaches 0:

> Teleprompter limit reached. Free teleprompter supports up to 3 min per recording.

### Critical behavior

**Camera continues recording.** Only the teleprompter stops/hides. Teleprompter time never deducts from the 10 min/day recording budget. The user can finish the video manually.

## 7. FREE DAILY RECORDING UI

Idle:
> Free · 10:00 / 10:00 min available today

After usage:
> Free · 06:00 / 10:00 min available today

During recording:
> ● Recording · 06:00 remaining today

Progress indicator labeled "Free recording time":

```text
Free recording time
████████████░░░░░░░░
06:00 remaining today
```

## 8. RECORDING

The UI shows both timers distinctly:

```text
● Recording
06:42 remaining today
```

```text
Teleprompter
02:18 remaining
```

- **Pause** — recording elapsed time pauses; teleprompter usage pauses.
- **Resume** — both continue.
- **Stop** — recording is finalized.

The two timers are never confused.

## 9. FREE — 10 MINUTE DAILY LIMIT

```text
Take 1 → 4 minutes
Take 2 → 3 minutes
Take 3 → 3 minutes
```

Total: 10 minutes.

> Free · 00:00 / 10:00 min available today

Attempting another recording:

> You've used today's 10 minutes.

Then:

> Upgrade to Creator for unlimited recording.

CTA: `Upgrade to Creator`

Next calendar day:

> Free · 10:00 / 10:00 min available today

## 10. RECORDING COMPLETE

```text
Recording complete
       ↓
Preview
       ↓
Choose platform
```

The product transitions from **CREATE** to **PUBLISH**.

## 11. PLATFORM SELECTION — FREE

```text
✓ YouTube            Landscape · 16:9
🔒 YouTube Shorts    Vertical · 9:16     CREATOR
🔒 Reels             Vertical · 9:16     CREATOR
🔒 Instagram         Square · 1:1        CREATOR
🔒 Instagram         Portrait · 4:5      CREATOR
🔒 TikTok            Vertical · 9:16     CREATOR
🔒 LinkedIn          Vertical · 9:16     CREATOR
🔒 Custom            Define your own     CREATOR
```

Free default: **YouTube 16:9** preselected. Free output: **1280×720 / 720p**.

## 12. FREE USER CLICKS A LOCKED PLATFORM

Never just say "Feature locked." Show a contextual upgrade moment:

> Create for Instagram Reels
>
> Creator unlocks:
>
> ✓ Reels & Shorts
> ✓ 1080p
> ✓ No watermark
> ✓ Unlimited recording
> ✓ Unlimited teleprompter
>
> ¥349/month
>
> `[Upgrade to Creator]`

The user understands *why* they need Creator.

## 13. INSPECTOR

The Inspector follows exactly the same entitlement logic as the Platform selector.

Free:

```text
Inspector — Platform
YouTube 16:9          ✓
YouTube Shorts        🔒 CREATOR
Reels                 🔒 CREATOR
Square                🔒 CREATOR
Portrait              🔒 CREATOR
TikTok                🔒 CREATOR
LinkedIn              🔒 CREATOR
Custom                🔒 CREATOR
```

Creator: everything unlocked.

**There is one entitlement source of truth.** Platform selector and Inspector never disagree.

## 14. FREE PREVIEW

```text
Preview
720p
16:9
Watermark
```

Free local flow:

```text
Browser → Encode → Preview → Download → IndexedDB/local
```

No permanent cloud storage.

CTA: `Download`

## 15. FREE DOWNLOAD

**NO 3-export limit.** Downloads are repeatable. The daily 10-minute limit applies to **recording**, not downloads.

## 16. FREE WATERMARK

A tasteful

> Made with SuperSmartX

branding, not an aggressive payment prompt.

## 17. CREATOR UPGRADE

Any contextual upgrade point:

```text
Free → user encounters meaningful need → Creator value explained → Upgrade
```

Triggers:
- **A — Longer teleprompter:** Free teleprompter supports up to 3 min per recording.
- **B — Daily recording limit:** You've used today's 10 minutes.
- **C — Platform:** Create for Instagram Reels with Creator.
- **D — 1080p:** Export in 1080p with Creator.
- **E — Watermark:** Publish without SuperSmartX branding.
- **F — Cloud:** Save recordings to your cloud library.

## 18. PRICING MODAL

Outcomes first, not a feature dump.

## Creator

> **Create without limits.**
>
> Everything you need to create and publish consistently.

```text
✓ Unlimited recording
✓ Unlimited teleprompter
✓ 1080p Full HD
✓ All platform formats
✓ No watermark
✓ Voice teleprompter
✓ Cloud video library
✓ Unlimited exports
```

¥349/month or ¥2,899/year *(geo-localized)*

CTA: `Upgrade to Creator`

## 19. PAYMENT

```text
Upgrade to Creator
       ↓
Cashfree Checkout
       ↓
Payment
       ↓
Webhook verification
       ↓
Creator activated
       ↓
Return to Studio
```

The server remains authoritative for: plan, price, currency, payment verification.

## 20. CREATOR EXPERIENCE

Recording indicator shows:

> Creator · Unlimited recording

No artificial timer.

## 21. CREATOR TELEPROMPTER

> Creator · Unlimited teleprompter

No 3-minute restriction. Long scripts (5, 10, 20+ minutes) record without interruption.

## 22. CREATOR PLATFORM EXPERIENCE

All formats available:

```text
✓ YouTube
✓ YouTube Shorts
✓ Reels
✓ Instagram Square
✓ Instagram Portrait
✓ TikTok
✓ LinkedIn
✓ Custom
```

No Creator badges. No lock icons. No upgrade prompts.

## 23. CREATOR OUTPUT

```text
1080p + no watermark + platform format
```

Choose platform → get the right output. No Smart Crop, no AI Reframe, no focal-point complexity, no batch export.

## 24. CREATOR CLOUD LIBRARY

```text
Export → Private R2 → Metadata → Turso → Cloud Library
```

- Preview, download, delete.
- Cloud exports remain available after logout/login.

## 25. FREE LIBRARY

Clearly communicates:

> Saved locally on this device

```text
Recent recordings
Local exports
Saved locally on this device
```

No cloud storage expectation.

## 26. PROFILE / SETTINGS

```text
Profile
   │
   ├── Settings
   ├── Plan
   └── Account
```

Settings opens correctly on desktop and mobile.

Plan displays:

**Free:**
> Free — 10 min/day recording
> `[Upgrade to Creator]`

**Creator:**
> Creator — Unlimited recording
> `[Manage Plan]`

## 27. HELP / SHORTCUTS

Keep it simple:

```text
Shortcuts
Space    Start / Stop recording
P        Pause / Resume
M        Mute microphone
↑ ↓      Move text
Esc      Close
```

No preferences, no editor terminology.

## 28. COMPLETE FREE JOURNEY

```text
VISITOR → Landing → Start Recording — Free → Sign up → Studio
→ Paste script → Teleprompter (3 min/session)
→ Record (10 min/day) → Recording complete → Platform (YouTube ✓, others 🔒)
→ Preview → 720p + watermark → Download → Local device
→ User returns → Repeat
```

## 29. COMPLETE CREATOR JOURNEY

```text
LANDING → SIGN UP → FREE EXPERIENCE → Creator trigger → UPGRADE
→ Cashfree → Creator activated → Studio → Script
→ Unlimited Teleprompter → Unlimited Recording
→ Choose platform (all) → 1080p → No watermark
→ Export → Cloud Library → Download / Preview → RETURN → CREATE AGAIN
```

## 30. THE GROWTH LOOP

```text
        CREATE → RECORD → EXPORT → PUBLISH → SEE YOUR VIDEO → CREATE AGAIN
                                                     │
                                                     ▼
                                               CREATOR HABIT
                                                     │
                                                     ▼
                                                    UPGRADE
```

And eventually: Record once → YouTube → Shorts → Reels → TikTok → LinkedIn.
That is where "Record once. Publish everywhere." becomes more than marketing copy.

## 31. THREE STAGES

The entire Studio is mentally organized as:

- **CREATE** — *What do you want to say?* Script → Teleprompter → Record
- **PREPARE** — *Where are you publishing?* Choose platform
- **PUBLISH** — *Ready to go.* Preview → Export → Download / Cloud

Three words:

# Create → Prepare → Publish

Underneath:

> Record once. Publish everywhere.

## 32. FREE vs CREATOR PHILOSOPHY

| Dimension          | Free                     | Creator             |
| ------------------ | ------------------------ | ------------------- |
| Purpose            | Try + make short content | Create consistently |
| Recording          | 10 min/day               | Unlimited           |
| Teleprompter       | 3 min/session            | Unlimited           |
| Quality            | 720p                     | 1080p               |
| Platforms          | YouTube 16:9             | All supported       |
| Watermark          | Yes                      | No                  |
| Downloads          | Unlimited local          | Unlimited           |
| Storage            | Local                    | Cloud               |
| Voice teleprompter | No                       | Yes                 |
| Export             | Local                    | Local + Cloud       |
| Upgrade trigger    | Meaningful limitation    | None                |

### Psychological message

- **Free:** "I can actually make a video."
- **Creator:** "I can make content professionally and repeatedly."

**Do not add more features as differentiation. The differentiation is the workflow.**