# BLSS Trainer

BLSS Trainer is an Electron desktop app for practicing and analyzing the left-stick wiggle used for BLSS in Zelda Breath of the Wild.

It is built like a lightweight speedrun telemetry tool: Gamepad API input, live stick trail, heatmap, charts, automatic attempt stops, and an open rating. Around 600 means solid, around 840 means excellent, and exceptional attempts can score above 1040.

## Run

```powershell
npm install
npm.cmd start
```

## Check

```powershell
npm.cmd run check
```

## Compile and Website

```powershell
npm.cmd run compile
```

The compile command checks the app and builds the static website into `docs/`. That folder can be served by GitHub Pages from the repository settings: `Pages > Deploy from a branch > main > /docs`.

## First Use

The app opens in English by default and shows a short tutorial the first time it starts. You can reopen it from `Settings > Show tutorial`, and switch between English and French from `Settings > Language`.

## Switch Pro Calibration

In the `Controller` panel:

- `Calibrate B button` waits for the next controller button press and uses it as B.
- `Calibrate left stick` asks you to push up, down, left, and right. The app detects axes, axis direction, center, and stick scaling.
- `Calibrate center` recalculates only the neutral position for the current stick mapping.

## Training Modes

In the `Session` panel:

- `3,2,1 + timer` starts after a countdown and records for the chosen duration.
- `Hold B` arms the session, starts on the next B press, and stops when B is released.

During any active attempt, the session stops if B is released or if the left stick stays centered too long, because either state means the BLSS attempt has been lost. The stop reason is shown in the session status and in the session analysis.

## Architecture

- `src/main.cjs`: Electron main process.
- `src/preload.cjs`: isolated preload bridge.
- `src/shared/blssAnalyzer.mjs`: pure BLSS analysis engine.
- `src/renderer/app.mjs`: real-time loop, Gamepad API, session logic, and rendering.
- `src/renderer/i18n.mjs`: English/French UI strings and tooltips.
- `src/renderer/gamepad.mjs`: controller reading and calibration.
- `src/renderer/charts.mjs`: canvas chart rendering.
- `src/renderer/styles.css`: dark telemetry UI.
