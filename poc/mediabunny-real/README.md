# Mediabunny real-recording POC

This POC is isolated from production. It does not modify `src/`, `package.json`, production dependencies, the export engine, or the Recordings UI.

It captures a real browser `MediaStream` with `MediaRecorder` using the same WebM/VP9/Opus preference order as SuperSmartX, then runs Mediabunny conversion to H.264/AAC MP4.

The browser page tests:

- Real 5-second WebM fixture
- 1920x1080, 1280x720, 1080x1920, 1080x1080, and 1080x1350
- Free watermark and Creator no-watermark composition
- Real Opus audio decode and AAC output
- Audio presence, channel count, sample rate, measured non-silence, duration, dimensions
- Chromium playback of each output
- Real approximately 20-second conversion
- AbortSignal cancellation during conversion

Run a static server from the repository root:

```powershell
python -m http.server 4174 --directory poc/mediabunny-real
```

Open `http://localhost:4174` and click the button. For automated real-device capture in Chromium, launch with:

```powershell
npx playwright chromium --help
```

The repository-side automated probe uses Chromium flags for fake camera/microphone devices. The captured stream remains a real `MediaRecorder` WebM, not synthetic audio samples.
