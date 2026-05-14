const GRID_COLOR = "rgba(255,255,255,0.07)";
const TEXT_COLOR = "rgba(236,240,241,0.74)";

export function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {
    ctx,
    width: rect.width,
    height: rect.height
  };
}

export function drawLineChart(canvas, series, options) {
  const { ctx, width, height } = fitCanvas(canvas);
  const padding = { left: 38, right: 12, top: 24, bottom: 24 };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const min = options.min ?? 0;
  const max = Math.max(options.max ?? 1, min + 0.001);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#15191b";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;

  for (let line = 0; line <= 3; line += 1) {
    const y = padding.top + (plotHeight / 3) * line;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  ctx.fillText(options.label, padding.left, 15);
  ctx.fillStyle = options.color;
  ctx.textAlign = "right";
  ctx.fillText(options.formatValue(series.at(-1)?.value ?? 0), width - padding.right, 15);
  ctx.textAlign = "left";

  if (series.length < 2) {
    return;
  }

  const startTime = series[0].time;
  const endTime = series[series.length - 1].time;
  const timeRange = Math.max(endTime - startTime, 1);

  ctx.beginPath();

  series.forEach((point, index) => {
    const x = padding.left + ((point.time - startTime) / timeRange) * plotWidth;
    const normalized = (point.value - min) / (max - min);
    const y = padding.top + (1 - clamp(normalized, 0, 1)) * plotHeight;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.strokeStyle = options.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, colorWithAlpha(options.color, 0.24));
  gradient.addColorStop(1, colorWithAlpha(options.color, 0));

  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}

export function trimSeries(series, horizonMs) {
  if (series.length === 0) {
    return series;
  }

  const cutoff = series[series.length - 1].time - horizonMs;
  return series.filter((point) => point.time >= cutoff);
}

function colorWithAlpha(color, alpha) {
  if (color.startsWith("#") && color.length === 7) {
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  return color;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
