// Device-independent speed intent. Camera-relative direction, target-facing,
// collision and ability physics remain separate consumers of that intent.
export const ANALOGUE_DEFAULTS = Object.freeze({
  walkThreshold: 0.35,
  jogThreshold: 0.55,
  runThreshold: 0.7,
  magnitudeExponent: 1,
  accelerationResponse: 11,
  decelerationResponse: 15,
});

export function createAnalogueProfile(speeds, overrides = {}) {
  const profile = { ...ANALOGUE_DEFAULTS, ...overrides };
  for (const [key, value] of Object.entries(profile))
    if (
      !Object.hasOwn(ANALOGUE_DEFAULTS, key) ||
      !Number.isFinite(value) ||
      value <= 0
    )
      throw new RangeError(`Invalid analogue parameter: ${key}`);
  const xs = [
    0,
    profile.walkThreshold,
    profile.jogThreshold,
    profile.runThreshold,
    1,
  ];
  if (xs.some((x, i) => i > 0 && x <= xs[i - 1]))
    throw new RangeError("Analogue thresholds must increase below one");
  const ys = [
    0,
    speeds.walkSpeed,
    (speeds.walkSpeed + speeds.runSpeed) / 2,
    speeds.runSpeed,
    speeds.sprintSpeed,
  ];
  if (ys.some((y, i) => i > 0 && y < ys[i - 1]))
    throw new RangeError("Analogue speed anchors must not decrease");
  const secants = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
  const points = xs.map((magnitude, i) => {
    // Monotone cubic interpolation with matching, positive interior slopes.
    // There is no zero-slope plateau or speed jump at a gait threshold.
    const slope =
      i === 0
        ? secants[0]
        : i === xs.length - 1
          ? secants.at(-1)
          : secants[i - 1] === 0 || secants[i] === 0
            ? 0
            : 2 / (1 / secants[i - 1] + 1 / secants[i]);
    return Object.freeze({ magnitude, speed: ys[i], slope });
  });
  return Object.freeze({ ...profile, points: Object.freeze(points) });
}

export function speedForMagnitude(magnitude, profile) {
  const m = Math.pow(
    Math.max(0, Math.min(1, Number.isFinite(magnitude) ? magnitude : 0)),
    profile.magnitudeExponent,
  );
  const points = profile.points;
  for (let i = 1; i < points.length; i++) {
    const b = points[i],
      a = points[i - 1];
    if (m > b.magnitude) continue;
    if (m === a.magnitude) return a.speed;
    if (m === b.magnitude) return b.speed;
    const length = b.magnitude - a.magnitude;
    const t = (m - a.magnitude) / length,
      t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * a.speed +
      (t3 - 2 * t2 + t) * length * a.slope +
      (-2 * t3 + 3 * t2) * b.speed +
      (t3 - t2) * length * b.slope
    );
  }
  return points.at(-1).speed;
}

/** Useful for desktop gait presets and tests expressed in world speed. */
export function magnitudeForSpeed(speed, profile) {
  for (const point of profile.points)
    if (speed === point.speed)
      return Math.pow(point.magnitude, 1 / profile.magnitudeExponent);
  if (speed <= 0) return 0;
  if (speed >= profile.points.at(-1).speed) return 1;
  let low = 0,
    high = 1;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (speedForMagnitude(middle, profile) < speed) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
