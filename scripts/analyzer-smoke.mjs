import { analyzeSamples, getRatingTier } from "../src/shared/blssAnalyzer.mjs";

const good = generateSession({
  durationMs: 6200,
  frequencyHz: 8.4,
  amplitude: 0.86,
  centerNoise: 0.018,
  bDropEveryMs: 0
});

const weak = generateSession({
  durationMs: 6200,
  frequencyHz: 3.1,
  amplitude: 0.38,
  centerNoise: 0.22,
  bDropEveryMs: 1200
});

const goodStats = analyzeSamples(good);
const weakStats = analyzeSamples(weak);

console.log("Good score:", Math.round(goodStats.score));
console.log("Weak score:", Math.round(weakStats.score));

if (goodStats.score <= 900) {
  throw new Error(`Expected strong synthetic session to score above 900, got ${goodStats.score}`);
}

if (weakStats.score >= goodStats.score) {
  throw new Error("Expected weak synthetic session to score lower than strong session");
}

if (goodStats.subScores.center <= weakStats.subScores.center) {
  throw new Error("Expected clean center passes to beat noisy center passes");
}

if (getRatingTier(599) !== "improving" || getRatingTier(600) !== "solid") {
  throw new Error("Expected rating labels to switch from improving to solid at 600");
}

if (getRatingTier(839) !== "solid" || getRatingTier(840) !== "excellent") {
  throw new Error("Expected rating labels to switch from solid to excellent at 840");
}

function generateSession({ durationMs, frequencyHz, amplitude, centerNoise, bDropEveryMs }) {
  const samples = [];
  const stepMs = 1000 / 120;

  for (let time = 0; time <= durationMs; time += stepMs) {
    const t = time / 1000;
    const phase = Math.sin(Math.PI * 2 * frequencyHz * t);
    const wobble = Math.sin(Math.PI * 2 * frequencyHz * 0.5 * t) * centerNoise;
    const drop = bDropEveryMs > 0 && Math.floor(time / bDropEveryMs) % 2 === 1 && time % bDropEveryMs < 58;

    samples.push({
      time,
      x: phase * amplitude,
      y: wobble,
      bPressed: !drop
    });
  }

  return samples;
}
