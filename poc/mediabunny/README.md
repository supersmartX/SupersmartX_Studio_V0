# Mediabunny export POC

This isolated proof-of-concept does not participate in the Next.js app and does not change `package.json`, `src/`, or production behavior.

It generates two 10-second MP4 files in Chromium using Mediabunny 1.59.0:

- 1920x1080 H.264 + AAC
- 1080x1920 H.264 + AAC

The page reopens each resulting Blob with Mediabunny and verifies duration, video dimensions, audio channel count, and audio sample rate.

Run from the repository root with a static server, for example:

```powershell
python -m http.server 4173 --directory poc/mediabunny
```

Open `http://localhost:4173`, click the button, and inspect `window.pocResult` in DevTools. The POC imports Mediabunny from its published CDN URL, so internet access is required.
