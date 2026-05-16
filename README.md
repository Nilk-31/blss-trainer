# BLSS Trainer

BLSS Trainer is an Electron desktop app for practicing and analyzing the left-stick wiggle used for BLSS in Zelda Breath of the Wild.

It is built like a lightweight speedrun telemetry tool: Gamepad API input, live stick trail, heatmap, charts, automatic attempt stops, local history, and an open rating.

This project is still in development. The BLSS speed model is a practical training approximation, not an official game-physics simulator.

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
- `Train speedcap` starts on B press and challenges you to get close to 104.71 m/s without exceeding it.

During any active attempt, the session stops if B is released or if the left stick stays centered too long, because either state means the BLSS attempt has been lost. Pressing +, -, X, Y, L, or D-pad up/left/right is tracked as a BLSS-breaking input and lowers the score. The stop reason is shown in the session status and in the session analysis.

## Current Scoring Model

The score now focuses on the essentials:

- Wiggle frequency, with 5 Osc/s treated as the ideal target. Too slow is weaker, and too fast is penalized harder.
- Simulated BLSS speed toward the 104.71 m/s speedcap. Between 1 and 5 Osc/s, the model uses 60 clean wiggles to reach cap; wiggles that miss the center or use shallow stick travel accelerate less. Above 5 Osc/s it adds extra required wiggles and never allows an estimated best time below 12 seconds.
- Center crossing quality.
- B hold quality.
- Staying on the same steering side of the wiggle.
- Avoiding inputs that disable BLSS.

If the attempt ends before speedcap, BLSS Trainer estimates the time to cap from the average Osc/s.

## Architecture

- `src/main.cjs`: Electron main process.
- `src/preload.cjs`: isolated preload bridge.
- `src/shared/blssAnalyzer.mjs`: pure BLSS analysis engine.
- `src/renderer/app.mjs`: real-time loop, Gamepad API, session logic, and rendering.
- `src/renderer/i18n.mjs`: English/French UI strings and tooltips.
- `src/renderer/gamepad.mjs`: controller reading and calibration.
- `src/renderer/charts.mjs`: canvas chart rendering.
- `src/renderer/styles.css`: dark telemetry UI.
