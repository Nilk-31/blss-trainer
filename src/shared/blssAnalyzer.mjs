const DEFAULTS = {
  minTurnIntervalMs: 42,
  minTurnAmplitude: 0.14,
  velocityThreshold: 0.22,
  centerIdealRadius: 0.08,
  centerWarningRadius: 0.24,
  neutralRadius: 0.18,
  maxSamples: 90000,
  minBlssSpeed: 2.71,
  speedCap: 104.71,
  optimalOscillationsPerSecond: 5,
  minimumAccelerationOscillationsPerSecond: 1,
  baseSpeedcapWiggles: 60,
  overspeedExtraWigglesPerOsc: 10,
  coastingStickSpeedThreshold: 0.22,
  coastingDecayBaseSpeed: 1.521,
  coastingDecayTimeConstantSec: 31.874
};

export const RATING_THRESHOLDS = {
  exceptional: 920,
  excellent: 780,
  solid: 560,
  improving: 340
};

const EMPTY_SUBSCORES = {
  frequency: 0,
  speedcap: 0,
  center: 0,
  bHold: 0,
  direction: 0,
  inputs: 0
};

export class BLSSAnalyzer {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.samples = [];
  }

  reset() {
    this.samples = [];
  }

  addSample(sample) {
    const time = Number(sample.time);
    const x = clamp(Number(sample.x), -1, 1);
    const y = clamp(Number(sample.y), -1, 1);

    if (!Number.isFinite(time) || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    this.samples.push({
      time,
      x,
      y,
      bPressed: Boolean(sample.bPressed),
      hazardPressed: Boolean(sample.hazardPressed),
      hazardButtons: Array.isArray(sample.hazardButtons) ? sample.hazardButtons.slice(0, 8) : []
    });

    if (this.samples.length > this.options.maxSamples) {
      this.samples.splice(0, this.samples.length - this.options.maxSamples);
    }
  }

  getDurationMs() {
    if (this.samples.length < 2) {
      return 0;
    }

    return this.samples[this.samples.length - 1].time - this.samples[0].time;
  }

  getSamples() {
    return this.samples.slice();
  }

  getTrail(windowMs = 1600) {
    if (this.samples.length === 0) {
      return [];
    }

    const end = this.samples[this.samples.length - 1].time;
    return this.samples.filter((sample) => sample.time >= end - windowMs);
  }

  getLiveStats(windowMs = 2600) {
    if (this.samples.length === 0) {
      return createEmptyStats(this.options);
    }

    const end = this.samples[this.samples.length - 1].time;
    return analyzeSamples(
      this.samples.filter((sample) => sample.time >= end - windowMs),
      this.options
    );
  }

  getSessionStats() {
    return analyzeSamples(this.samples, this.options);
  }

  getHeatmap(size = 56) {
    const grid = Array.from({ length: size * size }, () => 0);
    let max = 0;

    for (const sample of this.samples) {
      const ix = clamp(Math.floor(((sample.x + 1) / 2) * size), 0, size - 1);
      const iy = clamp(Math.floor(((1 - sample.y) / 2) * size), 0, size - 1);
      const index = iy * size + ix;
      grid[index] += 1;
      max = Math.max(max, grid[index]);
    }

    return { grid, max, size };
  }
}

export function analyzeSamples(samples, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const clean = samples
    .filter((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.x) && Number.isFinite(sample.y))
    .sort((a, b) => a.time - b.time);

  if (clean.length < 2) {
    return createEmptyStats(opts);
  }

  const durationMs = Math.max(0, clean[clean.length - 1].time - clean[0].time);
  const durationSec = durationMs / 1000;

  if (durationSec <= 0) {
    return createEmptyStats(opts);
  }

  const axis = estimateDominantAxis(clean);
  const projected = [];
  const perpendicular = [];
  const radial = [];

  for (const sample of clean) {
    projected.push(sample.x * axis.x + sample.y * axis.y);
    perpendicular.push(-sample.x * axis.y + sample.y * axis.x);
    radial.push(Math.hypot(sample.x, sample.y));
  }

  const smoothedProjection = movingAverage(projected, 5);
  const speeds = computeStickSpeeds(clean);
  const turns = detectTurns(clean, smoothedProjection, perpendicular, opts);
  const crossings = detectCenterCrossings(clean, projected, perpendicular);
  const directionChangesPerSecond = turns.length / durationSec;
  const oscillationsPerSecond = directionChangesPerSecond / 2;
  const bHold = analyzeBHold(clean);
  const center = analyzeCenter(crossings, turns, opts);
  const direction = analyzeDirectionSide(perpendicular, radial);
  const inputs = analyzeForbiddenInputs(clean);
  const speedcap = simulateSpeedcap(clean, turns, radial, opts);
  const frequencyScore = frequencySubscore(oscillationsPerSecond, opts);
  const score = computeRating({
    frequencyScore,
    speedcapScore: speedcap.score,
    centerScore: center.score,
    bHoldScore: bHold.score,
    directionScore: direction.score,
    inputScore: inputs.score
  });

  const subScores = {
    frequency: frequencyScore * 100,
    speedcap: speedcap.score * 100,
    center: center.score * 100,
    bHold: bHold.score * 100,
    direction: direction.score * 100,
    inputs: inputs.score * 100
  };

  return {
    ready: clean.length >= 6,
    sampleCount: clean.length,
    durationMs,
    score,
    ratingTier: getRatingTier(score),
    axis,
    frequency: {
      score: frequencyScore,
      oscillationsPerSecond,
      directionChangesPerSecond,
      optimalOscillationsPerSecond: opts.optimalOscillationsPerSecond,
      currentStickSpeed: speeds.at(-1) ?? 0,
      averageStickSpeed: average(speeds),
      maxStickSpeed: maxValue(speeds)
    },
    speedcap,
    center,
    bHold,
    direction,
    inputs,
    subScores,
    chartValues: {
      frequency: oscillationsPerSecond,
      speed: speedcap.currentSpeed,
      blssSpeed: speedcap.currentSpeed,
      speedcap: speedcap.progress * 100,
      center: center.score * 100
    }
  };
}

function createEmptyStats(options = DEFAULTS) {
  return {
    ready: false,
    sampleCount: 0,
    durationMs: 0,
    score: 0,
    ratingTier: "waiting",
    axis: { x: 1, y: 0, angle: 0 },
    frequency: {
      score: 0,
      oscillationsPerSecond: 0,
      directionChangesPerSecond: 0,
      optimalOscillationsPerSecond: options.optimalOscillationsPerSecond,
      currentStickSpeed: 0,
      averageStickSpeed: 0,
      maxStickSpeed: 0
    },
    speedcap: {
      score: 0,
      currentSpeed: options.minBlssSpeed,
      progress: 0,
      rawProgress: 0,
      exceeded: false,
      overspeedAmount: 0,
      reached: false,
      reachedAtMs: 0,
      timeToCapSec: 0,
      estimatedTimeToCapSec: 0,
      averageAccelerationOscillationsPerSecond: 0,
      requiredWiggles: options.baseSpeedcapWiggles,
      wiggleProgress: 0,
      pauseSlowdownMs: 0
    },
    center: {
      score: 0,
      crossings: 0,
      averageDistance: 0,
      medianDistance: 0,
      withinIdealRatio: 0,
      contourPenalty: 1
    },
    bHold: {
      score: 0,
      heldRatio: 0,
      releaseCount: 0,
      microReleaseCount: 0,
      releaseDurationMs: 0,
      maxReleaseMs: 0,
      isHeldNow: false
    },
    direction: {
      score: 1,
      dominantSide: 0,
      dominantSideRatio: 1,
      sideFlipCount: 0,
      wrongSideRatio: 0
    },
    inputs: {
      score: 1,
      forbiddenPressCount: 0,
      forbiddenSampleRatio: 0,
      buttons: []
    },
    subScores: { ...EMPTY_SUBSCORES },
    chartValues: {
      frequency: 0,
      speed: options.minBlssSpeed,
      blssSpeed: options.minBlssSpeed,
      speedcap: 0,
      center: 0
    }
  };
}

function simulateSpeedcap(samples, turns, radial, opts) {
  let currentSpeed = opts.minBlssSpeed;
  let reachedAtMs = 0;
  let wiggleProgress = 0;
  let pauseSlowdownMs = 0;
  let lastTurnTime = samples[0].time;
  let lastTurnIndex = 0;
  let recentTurns = [];

  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index];
    const dtMs = Math.max(0, sample.time - samples[index - 1].time);
    const dtSec = Math.max(dtMs / 1000, 1 / 240);
    const stickSpeed = Math.hypot(sample.x - samples[index - 1].x, sample.y - samples[index - 1].y) / dtSec;

    while (lastTurnIndex < turns.length && turns[lastTurnIndex].time <= sample.time) {
      const turn = turns[lastTurnIndex];
      recentTurns = recentTurns.filter((time) => turn.time - time <= 1400);
      recentTurns.push(turn.time);

      const recentOsc = recentTurns.length > 1 ? ((recentTurns.length - 1) / ((recentTurns.at(-1) - recentTurns[0]) / 1000)) / 2 : 0;

      if (recentOsc >= opts.minimumAccelerationOscillationsPerSecond) {
        const requiredWiggles = requiredWigglesForFrequency(recentOsc, opts);
        const gainPerHalfWiggle = (opts.speedCap - opts.minBlssSpeed) / requiredWiggles / 2;
        currentSpeed = Math.min(opts.speedCap * 1.22, currentSpeed + gainPerHalfWiggle);
        wiggleProgress += 0.5;
      }

      lastTurnTime = turn.time;
      lastTurnIndex += 1;
    }

    if (
      sample.bPressed &&
      radial[index] > opts.neutralRadius &&
      wiggleProgress > 0 &&
      stickSpeed <= opts.coastingStickSpeedThreshold
    ) {
      pauseSlowdownMs += dtMs;
      currentSpeed = decayBlssSpeed(currentSpeed, dtMs / 1000, opts);
    }

    if (!reachedAtMs && currentSpeed >= opts.speedCap) {
      reachedAtMs = sample.time - samples[0].time;
    }
  }

  const durationSec = (samples.at(-1).time - samples[0].time) / 1000;
  const averageOsc = turns.length / Math.max(durationSec, 0.001) / 2;
  const requiredWiggles = requiredWigglesForFrequency(Math.max(averageOsc, opts.minimumAccelerationOscillationsPerSecond), opts);
  const estimatedTimeToCapSec =
    averageOsc >= opts.minimumAccelerationOscillationsPerSecond
      ? Math.max(12, requiredWiggles / averageOsc)
      : Infinity;
  const reached = reachedAtMs > 0;
  const timeToCapSec = reached ? reachedAtMs / 1000 : 0;
  const timeBasis = reached ? timeToCapSec : estimatedTimeToCapSec;
  const rawProgress = (currentSpeed - opts.minBlssSpeed) / (opts.speedCap - opts.minBlssSpeed);
  const progress = clamp(rawProgress, 0, 1);
  const timeScore = Number.isFinite(timeBasis) ? clamp(Math.pow(12 / Math.max(timeBasis, 12), 1.35), 0, 1) : 0;
  const progressScore = reached ? 1 : clamp(progress, 0, 1);
  const pausePenalty = clamp(1 - pauseSlowdownMs / 8500, 0.45, 1);
  const score = clamp(timeScore * (reached ? 1 : progressScore) * pausePenalty, 0, 1);

  return {
    score,
    currentSpeed,
    progress,
    rawProgress,
    exceeded: currentSpeed > opts.speedCap,
    overspeedAmount: Math.max(0, currentSpeed - opts.speedCap),
    reached,
    reachedAtMs,
    timeToCapSec,
    estimatedTimeToCapSec: Number.isFinite(estimatedTimeToCapSec) ? estimatedTimeToCapSec : 0,
    averageAccelerationOscillationsPerSecond: averageOsc,
    requiredWiggles,
    wiggleProgress,
    pauseSlowdownMs
  };
}

export function requiredWigglesForFrequency(oscillationsPerSecond, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const osc = Math.max(0, Number(oscillationsPerSecond) || 0);

  if (osc <= opts.optimalOscillationsPerSecond) {
    return opts.baseSpeedcapWiggles;
  }

  const overspeedRequired =
    opts.baseSpeedcapWiggles + (osc - opts.optimalOscillationsPerSecond) * opts.overspeedExtraWigglesPerOsc;

  return Math.max(overspeedRequired, 12 * osc);
}

function decayBlssSpeed(currentSpeed, elapsedSec, opts) {
  const tau = Math.max(0.001, opts.coastingDecayTimeConstantSec);
  const decay = Math.exp(-Math.max(0, elapsedSec) / tau);
  return opts.coastingDecayBaseSpeed + (currentSpeed - opts.coastingDecayBaseSpeed) * decay;
}

function frequencySubscore(oscillationsPerSecond, opts) {
  const osc = Math.max(0, oscillationsPerSecond);

  if (osc < opts.minimumAccelerationOscillationsPerSecond) {
    return clamp(osc / opts.minimumAccelerationOscillationsPerSecond, 0, 1) * 0.28;
  }

  if (osc <= opts.optimalOscillationsPerSecond) {
    return clamp(0.42 + 0.58 * smoothStep(1, opts.optimalOscillationsPerSecond, osc), 0, 1);
  }

  const overspeed = osc - opts.optimalOscillationsPerSecond;
  return clamp(Math.exp(-Math.pow(overspeed / 1.15, 2)), 0, 1);
}

function computeRating(parts) {
  const quality =
    parts.frequencyScore * 0.32 +
    parts.speedcapScore * 0.34 +
    parts.centerScore * 0.15 +
    parts.bHoldScore * 0.1 +
    parts.directionScore * 0.06 +
    parts.inputScore * 0.03;

  return Math.max(0, quality * 1000);
}

function analyzeBHold(samples) {
  let releasedMs = 0;
  let releaseCount = 0;
  let microReleaseCount = 0;
  let maxReleaseMs = 0;
  let activeReleaseStart = null;
  let activeReleaseDuration = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const dt = Math.max(0, current.time - previous.time);

    if (!previous.bPressed) {
      releasedMs += dt;
      activeReleaseDuration += dt;
    }

    if (previous.bPressed && !current.bPressed) {
      releaseCount += 1;
      activeReleaseStart = current.time;
      activeReleaseDuration = 0;
    }

    if (!previous.bPressed && current.bPressed && activeReleaseStart !== null) {
      if (activeReleaseDuration <= 80) {
        microReleaseCount += 1;
      }

      maxReleaseMs = Math.max(maxReleaseMs, activeReleaseDuration);
      activeReleaseStart = null;
      activeReleaseDuration = 0;
    }
  }

  if (activeReleaseStart !== null) {
    if (activeReleaseDuration <= 80) {
      microReleaseCount += 1;
    }

    maxReleaseMs = Math.max(maxReleaseMs, activeReleaseDuration);
  }

  const durationMs = Math.max(samples.at(-1).time - samples[0].time, 1);
  const releasedRatio = clamp(releasedMs / durationMs, 0, 1);
  const heldRatio = 1 - releasedRatio;
  const score = clamp(1 - releasedRatio * 6 - microReleaseCount * 0.09 - Math.max(0, maxReleaseMs - 90) / 360, 0, 1);

  return {
    score,
    heldRatio,
    releaseCount,
    microReleaseCount,
    releaseDurationMs: releasedMs,
    maxReleaseMs,
    isHeldNow: Boolean(samples.at(-1).bPressed)
  };
}

function analyzeCenter(crossings, turns, opts) {
  if (crossings.length === 0) {
    return {
      score: 0,
      crossings: 0,
      averageDistance: 1,
      medianDistance: 1,
      withinIdealRatio: 0,
      contourPenalty: 1
    };
  }

  const distances = crossings.map((crossing) => crossing.distance);
  const averageDistance = average(distances);
  const medianDistance = percentile(distances, 0.5);
  const withinIdealRatio = distances.filter((distance) => distance <= opts.centerIdealRadius).length / distances.length;
  const distanceScore = clamp(1 - Math.pow(averageDistance / opts.centerWarningRadius, 1.35), 0, 1);
  const consistencyScore = clamp(1 - standardDeviation(distances) / 0.18, 0, 1);
  const expectedCrossings = Math.max(1, turns.length - 1);
  const coverageScore = clamp(crossings.length / expectedCrossings, 0, 1);
  const contourPenalty = clamp(averageDistance / opts.centerWarningRadius, 0, 1);
  const score = clamp(distanceScore * 0.72 + consistencyScore * 0.18 + coverageScore * 0.1, 0, 1);

  return {
    score,
    crossings: crossings.length,
    averageDistance,
    medianDistance,
    withinIdealRatio,
    contourPenalty
  };
}

function analyzeDirectionSide(perpendicular, radial) {
  const sideSamples = [];

  for (let index = 0; index < perpendicular.length; index += 1) {
    if (radial[index] > 0.28 && Math.abs(perpendicular[index]) > 0.1) {
      sideSamples.push(Math.sign(perpendicular[index]));
    }
  }

  if (sideSamples.length < 8) {
    return {
      score: 1,
      dominantSide: 0,
      dominantSideRatio: 1,
      sideFlipCount: 0,
      wrongSideRatio: 0
    };
  }

  const positiveCount = sideSamples.filter((side) => side > 0).length;
  const negativeCount = sideSamples.length - positiveCount;
  const dominantSide = positiveCount >= negativeCount ? 1 : -1;
  const dominantCount = Math.max(positiveCount, negativeCount);
  const dominantSideRatio = dominantCount / sideSamples.length;
  const wrongSideRatio = 1 - dominantSideRatio;
  let sideFlipCount = 0;
  let lastSide = sideSamples[0];

  for (const side of sideSamples.slice(1)) {
    if (side !== lastSide) {
      sideFlipCount += 1;
      lastSide = side;
    }
  }

  const score = clamp(1 - wrongSideRatio * 2.7 - sideFlipCount * 0.075, 0, 1);

  return {
    score,
    dominantSide,
    dominantSideRatio,
    sideFlipCount,
    wrongSideRatio
  };
}

function analyzeForbiddenInputs(samples) {
  let forbiddenPressCount = 0;
  let forbiddenSampleCount = 0;
  let wasPressed = false;
  const buttons = new Set();

  for (const sample of samples) {
    if (sample.hazardPressed) {
      forbiddenSampleCount += 1;
      sample.hazardButtons.forEach((button) => buttons.add(button));

      if (!wasPressed) {
        forbiddenPressCount += 1;
      }
    }

    wasPressed = Boolean(sample.hazardPressed);
  }

  const forbiddenSampleRatio = samples.length > 0 ? forbiddenSampleCount / samples.length : 0;
  const score = clamp(1 - forbiddenPressCount * 0.32 - forbiddenSampleRatio * 3.2, 0, 1);

  return {
    score,
    forbiddenPressCount,
    forbiddenSampleRatio,
    buttons: Array.from(buttons)
  };
}

function estimateDominantAxis(samples) {
  const mx = average(samples.map((sample) => sample.x));
  const my = average(samples.map((sample) => sample.y));
  let xx = 0;
  let yy = 0;
  let xy = 0;

  for (const sample of samples) {
    const dx = sample.x - mx;
    const dy = sample.y - my;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }

  if (xx + yy < 0.0001) {
    return { x: 1, y: 0, angle: 0 };
  }

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
    angle
  };
}

function computeStickSpeeds(samples) {
  const speeds = [];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const dt = Math.max((current.time - previous.time) / 1000, 1 / 240);
    speeds.push(Math.hypot(current.x - previous.x, current.y - previous.y) / dt);
  }

  return speeds;
}

function detectTurns(samples, projection, perpendicular, opts) {
  const turns = [];
  let direction = 0;
  let lastTurnTime = samples[0].time;
  let lastTurnProjection = projection[0];

  for (let index = 1; index < samples.length; index += 1) {
    const dt = Math.max((samples[index].time - samples[index - 1].time) / 1000, 1 / 240);
    const velocity = (projection[index] - projection[index - 1]) / dt;

    if (Math.abs(velocity) < opts.velocityThreshold) {
      continue;
    }

    const nextDirection = Math.sign(velocity);

    if (direction === 0) {
      direction = nextDirection;
      continue;
    }

    if (nextDirection === direction) {
      continue;
    }

    const turnIndex = Math.max(0, index - 1);
    const elapsed = samples[turnIndex].time - lastTurnTime;
    const amplitudeDelta = Math.abs(projection[turnIndex] - lastTurnProjection);

    if (elapsed >= opts.minTurnIntervalMs && amplitudeDelta >= opts.minTurnAmplitude) {
      turns.push({
        time: samples[turnIndex].time,
        p: projection[turnIndex],
        q: perpendicular[turnIndex]
      });
      lastTurnTime = samples[turnIndex].time;
      lastTurnProjection = projection[turnIndex];
    }

    direction = nextDirection;
  }

  return turns;
}

function detectCenterCrossings(samples, projection, perpendicular) {
  const crossings = [];
  let lastCrossingTime = -Infinity;

  for (let index = 1; index < samples.length; index += 1) {
    const previousP = projection[index - 1];
    const currentP = projection[index];
    const crossed = previousP === 0 || currentP === 0 || Math.sign(previousP) !== Math.sign(currentP);

    if (!crossed || Math.abs(currentP - previousP) < 0.045) {
      continue;
    }

    const alpha = clamp(-previousP / (currentP - previousP), 0, 1);
    const time = samples[index - 1].time + alpha * (samples[index].time - samples[index - 1].time);

    if (time - lastCrossingTime < 28) {
      continue;
    }

    const q = perpendicular[index - 1] + alpha * (perpendicular[index] - perpendicular[index - 1]);
    crossings.push({
      time,
      distance: Math.abs(q)
    });
    lastCrossingTime = time;
  }

  return crossings;
}

export function getRatingTier(score) {
  if (score >= RATING_THRESHOLDS.exceptional) {
    return "exceptional";
  }

  if (score >= RATING_THRESHOLDS.excellent) {
    return "excellent";
  }

  if (score >= RATING_THRESHOLDS.solid) {
    return "solid";
  }

  if (score >= RATING_THRESHOLDS.improving) {
    return "improving";
  }

  if (score > 0) {
    return "unstable";
  }

  return "waiting";
}

function diffTimes(points) {
  const intervals = [];

  for (let index = 1; index < points.length; index += 1) {
    intervals.push((points[index].time - points[index - 1].time) / 1000);
  }

  return intervals;
}

function movingAverage(values, windowSize) {
  const result = [];
  const radius = Math.floor(windowSize / 2);

  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    let sum = 0;
    let count = 0;

    for (let cursor = start; cursor <= end; cursor += 1) {
      sum += values[cursor];
      count += 1;
    }

    result.push(sum / count);
  }

  return result;
}

function average(values) {
  if (!values || values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (!values || values.length < 2) {
    return 0;
  }

  const avg = average(values);
  return Math.sqrt(average(values.map((value) => Math.pow(value - avg, 2))));
}

function percentile(values, ratio) {
  if (!values || values.length === 0) {
    return 0;
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index];
}

function maxValue(values) {
  if (!values || values.length === 0) {
    return 0;
  }

  return values.reduce((max, value) => Math.max(max, value), -Infinity);
}

function smoothStep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
