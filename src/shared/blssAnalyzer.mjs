const DEFAULTS = {
  minTurnIntervalMs: 34,
  minTurnAmplitude: 0.16,
  velocityThreshold: 0.24,
  centerIdealRadius: 0.08,
  centerWarningRadius: 0.22,
  maxSamples: 90000
};

export const RATING_THRESHOLDS = {
  exceptional: 1040,
  excellent: 840,
  solid: 600,
  improving: 360
};

const RATING_LABELS = {
  waiting: "En attente",
  unstable: "Instable",
  improving: "En progression",
  solid: "Solide",
  excellent: "Excellent",
  exceptional: "Exceptionnel"
};

const EMPTY_SUBSCORES = {
  frequency: 0,
  rhythm: 0,
  center: 0,
  amplitude: 0,
  bHold: 0,
  fluidity: 0,
  precision: 0
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

    const normalized = {
      time,
      x,
      y,
      bPressed: Boolean(sample.bPressed)
    };

    this.samples.push(normalized);

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
    const start = end - windowMs;
    return this.samples.filter((sample) => sample.time >= start);
  }

  getLiveStats(windowMs = 2600) {
    if (this.samples.length === 0) {
      return createEmptyStats();
    }

    const end = this.samples[this.samples.length - 1].time;
    const start = end - windowMs;
    return analyzeSamples(
      this.samples.filter((sample) => sample.time >= start),
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
    return createEmptyStats();
  }

  const durationMs = Math.max(0, clean[clean.length - 1].time - clean[0].time);
  const durationSec = durationMs / 1000;

  if (durationSec <= 0) {
    return createEmptyStats();
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
  const speeds = computeSpeeds(clean);
  const turns = detectTurns(clean, smoothedProjection, perpendicular, opts);
  const crossings = detectCenterCrossings(clean, projected, perpendicular);
  const intervals = diffTimes(turns);
  const pauses = detectPauses(clean, speeds);
  const bHold = analyzeBHold(clean);
  const amplitude = analyzeAmplitude(turns, projected, radial);
  const rhythm = analyzeRhythm(intervals, pauses, durationSec);
  const center = analyzeCenter(crossings, turns, opts);
  const fluidity = analyzeFluidity(speeds, perpendicular, projected, pauses, durationSec);

  const directionChangesPerSecond = turns.length / durationSec;
  const oscillationsPerSecond = directionChangesPerSecond / 2;
  const currentSpeed = speeds.length > 0 ? speeds[speeds.length - 1] : 0;
  const averageSpeed = average(speeds);
  const maxSpeed = maxValue(speeds);
  const frequencyScore = frequencySubscore(oscillationsPerSecond);
  const precisionScore = clamp(
    center.score * 0.36 +
      rhythm.score * 0.24 +
      amplitude.score * 0.16 +
      fluidity.score * 0.14 +
      bHold.score * 0.1,
    0,
    1.18
  );
  const finalScore = computeOpenRating({
    oscillationsPerSecond,
    frequencyScore,
    rhythmScore: rhythm.score,
    centerScore: center.score,
    amplitudeScore: amplitude.score,
    bHoldScore: bHold.score,
    fluidityScore: fluidity.score,
    precisionScore,
    durationSec
  });

  const subScores = {
    frequency: frequencyScore * 100,
    rhythm: rhythm.score * 100,
    center: center.score * 100,
    amplitude: amplitude.score * 100,
    bHold: bHold.score * 100,
    fluidity: fluidity.score * 100,
    precision: precisionScore * 100
  };

  return {
    ready: clean.length >= 6,
    sampleCount: clean.length,
    durationMs,
    score: finalScore,
    ratingLabel: ratingLabel(finalScore),
    axis,
    frequency: {
      score: frequencyScore,
      oscillationsPerSecond,
      directionChangesPerSecond,
      currentSpeed,
      averageSpeed,
      maxSpeed
    },
    rhythm,
    center,
    amplitude,
    bHold,
    fluidity,
    subScores,
    chartValues: {
      speed: currentSpeed,
      frequency: oscillationsPerSecond,
      stability: rhythm.score * 100,
      center: center.score * 100,
      precision: precisionScore * 100
    }
  };
}

function createEmptyStats() {
  return {
    ready: false,
    sampleCount: 0,
    durationMs: 0,
    score: 0,
    ratingLabel: "En attente",
    axis: { x: 1, y: 0, angle: 0 },
    frequency: {
      score: 0,
      oscillationsPerSecond: 0,
      directionChangesPerSecond: 0,
      currentSpeed: 0,
      averageSpeed: 0,
      maxSpeed: 0
    },
    rhythm: {
      score: 0,
      intervalVariance: 0,
      intervalCv: 0,
      meanTurnIntervalMs: 0,
      pauseCount: 0,
      totalPauseMs: 0,
      maxPauseMs: 0,
      hesitationCount: 0
    },
    center: {
      score: 0,
      crossings: 0,
      averageDistance: 0,
      medianDistance: 0,
      withinIdealRatio: 0,
      contourPenalty: 1
    },
    amplitude: {
      score: 0,
      meanExtreme: 0,
      peak: 0,
      consistency: 0,
      edgePressure: 0
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
    fluidity: {
      score: 0,
      speedCv: 0,
      parasiteRatio: 0,
      pauseDensity: 0
    },
    subScores: { ...EMPTY_SUBSCORES },
    chartValues: {
      speed: 0,
      frequency: 0,
      stability: 0,
      center: 0,
      precision: 0
    }
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

function computeSpeeds(samples) {
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

function detectPauses(samples, speeds) {
  const pauses = [];
  let pauseStart = null;
  let totalMs = 0;
  let maxMs = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const speed = speeds[index - 1] ?? 0;
    const isPause = speed < 0.22;

    if (isPause && pauseStart === null) {
      pauseStart = samples[index - 1].time;
    }

    if ((!isPause || index === samples.length - 1) && pauseStart !== null) {
      const end = isPause ? samples[index].time : samples[index - 1].time;
      const duration = end - pauseStart;

      if (duration >= 80) {
        pauses.push(duration);
        totalMs += duration;
        maxMs = Math.max(maxMs, duration);
      }

      pauseStart = null;
    }
  }

  return {
    count: pauses.length,
    durations: pauses,
    totalMs,
    maxMs
  };
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

  const durationMs = Math.max(samples[samples.length - 1].time - samples[0].time, 1);
  const releasedRatio = clamp(releasedMs / durationMs, 0, 1);
  const heldRatio = 1 - releasedRatio;
  const score = clamp(
    1 - releasedRatio * 5.6 - microReleaseCount * 0.075 - Math.max(0, maxReleaseMs - 90) / 420,
    0,
    1
  );

  return {
    score,
    heldRatio,
    releaseCount,
    microReleaseCount,
    releaseDurationMs: releasedMs,
    maxReleaseMs,
    isHeldNow: Boolean(samples[samples.length - 1].bPressed)
  };
}

function analyzeAmplitude(turns, projected, radial) {
  const absProjected = projected.map((value) => Math.abs(value));
  const positiveExtremes = projected.filter((value) => value > 0.05).map((value) => Math.abs(value));
  const negativeExtremes = projected.filter((value) => value < -0.05).map((value) => Math.abs(value));
  const turnExtremes = turns.map((turn) => Math.abs(turn.p)).filter(Number.isFinite);
  const positiveExtreme = percentile(positiveExtremes, 0.9);
  const negativeExtreme = percentile(negativeExtremes, 0.9);
  const robustExtreme = percentile(absProjected, 0.9);
  const turnMedian = percentile(turnExtremes, 0.5);
  const hasBothSides = positiveExtreme > 0.05 && negativeExtreme > 0.05;
  const sideMeanExtreme = hasBothSides ? (positiveExtreme + negativeExtreme) / 2 : robustExtreme * 0.72;
  const sideBalance = hasBothSides
    ? clamp(Math.min(positiveExtreme, negativeExtreme) / Math.max(positiveExtreme, negativeExtreme), 0.45, 1)
    : 0.55;
  const meanExtreme = Math.max(sideMeanExtreme, turnMedian * 0.9, robustExtreme * 0.82);
  const peak = maxValue(absProjected);
  const radialPeak = maxValue(radial);
  const edgePressure = radial.length === 0 ? 0 : radial.filter((value) => value > 0.985).length / radial.length;
  const cv = coefficientOfVariation(turnExtremes);
  const rangeScore = smoothStep(0.34, 0.72, meanExtreme);
  const peakScore = smoothStep(0.45, 0.86, robustExtreme);
  const excessPenalty = 1 - clamp(edgePressure * 1.4 + smoothStep(1.01, 1.08, radialPeak) * 0.25, 0, 0.55);
  const consistency = turnExtremes.length >= 4 ? clamp(1 - cv / 0.42, 0.62, 1) : 0.88;
  const score = clamp((rangeScore * 0.78 + peakScore * 0.22) * sideBalance * excessPenalty * consistency, 0, 1);

  return {
    score,
    meanExtreme,
    peak,
    consistency,
    edgePressure
  };
}

function analyzeRhythm(intervals, pauses, durationSec) {
  const usableIntervals = intervals.filter((interval) => interval > 0.025 && interval < 0.6);
  const meanInterval = average(usableIntervals);
  const varianceValue = variance(usableIntervals);
  const cv = coefficientOfVariation(usableIntervals);
  const hesitationCount = usableIntervals.filter((interval) => meanInterval > 0 && interval > meanInterval * 1.75).length;
  const cadenceStability = usableIntervals.length < 3 ? 0.38 : 1 / (1 + Math.pow(cv / 0.22, 2));
  const pausePressure = clamp(pauses.totalMs / Math.max(durationSec * 1000, 1), 0, 1);
  const pauseFactor = clamp(1 - pausePressure * 3.2 - pauses.count * 0.045, 0, 1);
  const hesitationFactor = clamp(1 - hesitationCount * 0.075, 0.25, 1);
  const score = clamp(cadenceStability * pauseFactor * hesitationFactor, 0, 1);

  return {
    score,
    intervalVariance: varianceValue,
    intervalCv: cv,
    meanTurnIntervalMs: meanInterval * 1000,
    pauseCount: pauses.count,
    totalPauseMs: pauses.totalMs,
    maxPauseMs: pauses.maxMs,
    hesitationCount
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
  const consistencyScore = clamp(1 - standardDeviation(distances) / 0.16, 0, 1);
  const expectedCrossings = Math.max(1, turns.length - 1);
  const coverageScore = clamp(crossings.length / expectedCrossings, 0, 1);
  const contourPenalty = clamp(averageDistance / opts.centerWarningRadius, 0, 1);
  const score = clamp(
    distanceScore * 0.62 +
      consistencyScore * 0.18 +
      withinIdealRatio * 0.14 +
      coverageScore * 0.06,
    0,
    1
  );

  return {
    score,
    crossings: crossings.length,
    averageDistance,
    medianDistance,
    withinIdealRatio,
    contourPenalty
  };
}

function analyzeFluidity(speeds, perpendicular, projected, pauses, durationSec) {
  const movingSpeeds = speeds.filter((speed) => Number.isFinite(speed) && speed > 0.05);
  const speedCv = coefficientOfVariation(movingSpeeds);
  const speedContinuity = clamp(1 - Math.max(0, speedCv - 0.52) / 1.35, 0, 1);
  const parasiteRatio = rootMeanSquare(perpendicular) / Math.max(rootMeanSquare(projected), 0.001);
  const pathCoherence = clamp(1 - Math.pow(parasiteRatio / 0.72, 1.2), 0, 1);
  const pauseDensity = clamp(pauses.totalMs / Math.max(durationSec * 1000, 1), 0, 1);
  const pauseScore = clamp(1 - pauseDensity * 3.1 - pauses.count * 0.04, 0, 1);
  const score = clamp(speedContinuity * 0.34 + pathCoherence * 0.38 + pauseScore * 0.28, 0, 1);

  return {
    score,
    speedCv,
    parasiteRatio,
    pauseDensity
  };
}

function computeOpenRating(parts) {
  if (parts.durationSec <= 0) {
    return 0;
  }

  const cadenceNormalized = clamp(parts.frequencyScore, 0, 1.16);
  const quality =
    cadenceNormalized * 0.15 +
    parts.rhythmScore * 0.2 +
    parts.centerScore * 0.24 +
    parts.amplitudeScore * 0.12 +
    parts.fluidityScore * 0.12 +
    parts.bHoldScore * 0.17;
  const frequencyMultiplier = Math.pow(Math.max(parts.oscillationsPerSecond, 0.15) / 7.6, 0.28);
  const bGate = Math.pow(clamp(parts.bHoldScore, 0, 1), 1.32);
  const durationConfidence = clamp(parts.durationSec / 1.15, 0.18, 1);
  const base = 1080 * Math.pow(clamp(quality, 0, 1.12), 1.18) * frequencyMultiplier * bGate;
  const eliteCadenceBonus =
    Math.max(0, parts.oscillationsPerSecond - 7.6) *
    48 *
    Math.pow(clamp(parts.precisionScore, 0, 1.12), 2.2) *
    bGate;
  const elitePrecisionBonus = Math.max(0, quality - 0.93) * 760 * bGate;

  return Math.max(0, (base + eliteCadenceBonus + elitePrecisionBonus) * durationConfidence);
}

function frequencySubscore(oscillationsPerSecond) {
  const normal = smoothStep(1.8, 7.6, oscillationsPerSecond);
  const elite = Math.log1p(Math.max(0, oscillationsPerSecond - 7.6)) * 0.085;
  return normal + elite;
}

function ratingLabel(score) {
  return RATING_LABELS[getRatingTier(score)];
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

function variance(values) {
  if (!values || values.length < 2) {
    return 0;
  }

  const avg = average(values);
  return average(values.map((value) => Math.pow(value - avg, 2)));
}

function standardDeviation(values) {
  return Math.sqrt(variance(values));
}

function coefficientOfVariation(values) {
  if (!values || values.length < 2) {
    return 0;
  }

  const avg = Math.abs(average(values));

  if (avg < 0.000001) {
    return 0;
  }

  return standardDeviation(values) / avg;
}

function rootMeanSquare(values) {
  if (!values || values.length === 0) {
    return 0;
  }

  return Math.sqrt(average(values.map((value) => value * value)));
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
