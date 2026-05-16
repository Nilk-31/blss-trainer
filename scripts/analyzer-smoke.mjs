import { analyzeSamples, getRatingTier } from "../src/shared/blssAnalyzer.mjs";

const good = generateSession({
  durationMs: 15000,
  frequencyHz: 5,
  amplitude: 0.86,
  centerNoise: 0.018,
  sideOffset: 0.16,
  bDropEveryMs: 0
});

const weak = generateSession({
  durationMs: 15000,
  frequencyHz: 8.4,
  amplitude: 0.52,
  centerNoise: 0.28,
  sideOffset: 0,
  sideFlip: true,
  bDropEveryMs: 1200,
  hazardEveryMs: 2100
});

const goodStats = analyzeSamples(good);
const weakStats = analyzeSamples(weak);
const coasting = generateSession({
  durationMs: 22000,
  frequencyHz: 5,
  amplitude: 0.86,
  centerNoise: 0.018,
  sideOffset: 0.16,
  bDropEveryMs: 0,
  stopWiggleAtMs: 12000
});
const instantCoasting = generateSession({
  durationMs: 12300,
  frequencyHz: 5,
  amplitude: 0.86,
  centerNoise: 0.018,
  sideOffset: 0.16,
  bDropEveryMs: 0,
  stopWiggleAtMs: 12000
});
const coastingStats = analyzeSamples(coasting);
const instantCoastingStats = analyzeSamples(instantCoasting);
const coastingStartTime = coasting.at(-1).time - coastingStats.speedcap.pauseSlowdownMs;
const preCoastingStats = analyzeSamples(coasting.filter((sample) => sample.time <= coastingStartTime));
const expectedCoastingSpeed = expectedDecaySpeed(
  preCoastingStats.speedcap.currentSpeed,
  coastingStats.speedcap.pauseSlowdownMs / 1000
);

console.log("Good score:", Math.round(goodStats.score));
console.log("Weak score:", Math.round(weakStats.score));
console.log("Coasting speed:", coastingStats.speedcap.currentSpeed.toFixed(2));

if (goodStats.score <= 820) {
  throw new Error(`Expected strong synthetic session to score above 820, got ${goodStats.score}`);
}

if (weakStats.score >= goodStats.score) {
  throw new Error("Expected weak synthetic session to score lower than strong session");
}

if (goodStats.subScores.frequency <= weakStats.subScores.frequency) {
  throw new Error("Expected optimal 5 Osc/s session to beat overspeed session on frequency");
}

if (goodStats.speedcap.timeToCapSec < 12) {
  throw new Error("Expected speedcap model to respect the 12s best possible result");
}

if (coastingStats.speedcap.pauseSlowdownMs < 8500) {
  throw new Error("Expected stopped wiggle with held B to enter coasting decay");
}

if (instantCoastingStats.speedcap.pauseSlowdownMs < 200) {
  throw new Error("Expected stopped wiggle with held B to decay immediately without waiting for a slow Osc/s timeout");
}

if (Math.abs(coastingStats.speedcap.currentSpeed - expectedCoastingSpeed) > 0.6) {
  throw new Error(
    `Expected coasting speed ${coastingStats.speedcap.currentSpeed.toFixed(2)} to follow exponential decay near ${expectedCoastingSpeed.toFixed(2)}`
  );
}

if (getRatingTier(559) !== "improving" || getRatingTier(560) !== "solid") {
  throw new Error("Expected rating labels to switch from improving to solid at 560");
}

if (getRatingTier(779) !== "solid" || getRatingTier(780) !== "excellent") {
  throw new Error("Expected rating labels to switch from solid to excellent at 780");
}

function expectedDecaySpeed(startSpeed, seconds) {
  return 1.521 + (startSpeed - 1.521) * Math.exp(-seconds / 31.874);
}

function generateSession({
  durationMs,
  frequencyHz,
  amplitude,
  centerNoise,
  sideOffset = 0,
  sideFlip = false,
  bDropEveryMs,
  hazardEveryMs = 0,
  stopWiggleAtMs = Infinity
}) {
  const samples = [];
  const stepMs = 1000 / 120;

  for (let time = 0; time <= durationMs; time += stepMs) {
    const t = time / 1000;
    const coasting = time > stopWiggleAtMs;
    const phase = Math.sin(Math.PI * 2 * frequencyHz * t);
    const steeringSide = sideFlip ? Math.sin(Math.PI * 2 * 0.22 * t) * 0.35 : sideOffset;
    const wobble = coasting ? steeringSide : steeringSide + Math.sin(Math.PI * 2 * frequencyHz * 0.5 * t) * centerNoise;
    const drop = bDropEveryMs > 0 && Math.floor(time / bDropEveryMs) % 2 === 1 && time % bDropEveryMs < 58;
    const hazard = hazardEveryMs > 0 && Math.floor(time / hazardEveryMs) % 2 === 1 && time % hazardEveryMs < 220;

    samples.push({
      time,
      x: coasting ? amplitude : phase * amplitude,
      y: wobble,
      bPressed: !drop,
      hazardPressed: hazard,
      hazardButtons: hazard ? ["+"] : []
    });
  }

  return samples;
}
