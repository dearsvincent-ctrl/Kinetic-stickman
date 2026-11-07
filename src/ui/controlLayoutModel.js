export const CONTROL_IDS = Object.freeze([
  "move",
  "block",
  "jump",
  "punch",
  "kick",
]);
export const NEW_CONTROL_DEFAULTS = Object.freeze({
  punch: Object.freeze({ x: 0.89, y: 0.54 }),
  kick: Object.freeze({ x: 0.89, y: 0.75 }),
});
export const STORAGE_KEY = "kinetic.controls.v1";
export const LAYOUT_MARGIN = 8;
export const LAYOUT_GAP = 8;

const EPSILON = 1e-7;
const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function validBounds(bounds) {
  return (
    record(bounds) &&
    [bounds.left, bounds.top, bounds.right, bounds.bottom].every(
      Number.isFinite,
    ) &&
    bounds.right > bounds.left &&
    bounds.bottom > bounds.top
  );
}

function readRect(value) {
  if (!record(value)) return null;
  const left = value.left ?? value.x;
  const top = value.top ?? value.y;
  const width = value.width;
  const height = value.height;
  if (
    ![left, top, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  return { left, top, width, height };
}

function validPositions(positions) {
  if (!record(positions)) return false;
  return CONTROL_IDS.every((id) => {
    if (!Object.hasOwn(positions, id)) return false;
    const point = positions[id];
    return (
      record(point) &&
      ["x", "y"].every(
        (axis) =>
          Object.hasOwn(point, axis) &&
          Number.isFinite(point[axis]) &&
          point[axis] >= 0 &&
          point[axis] <= 1,
      )
    );
  });
}

/** Treat browser storage as untrusted data and return only the known schema. */
export function validateLayout(value) {
  if (!record(value) || value.version !== 1 || !record(value.positions))
    return null;
  const positions = { ...NEW_CONTROL_DEFAULTS, ...value.positions };
  if (!validPositions(positions)) return null;
  return {
    version: 1,
    positions: Object.fromEntries(
      CONTROL_IDS.map((id) => [
        id,
        {
          x: positions[id].x,
          y: positions[id].y,
        },
      ]),
    ),
  };
}

export function loadLayout(storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    const raw = target?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const source = JSON.parse(raw);
    const layout = validateLayout(source);
    // The normalized schema and storage key stay compatible. Remove only the
    // retired Sprint/Dash entries and initialize the two new actions; a failed migration write must not discard a layout.
    if (
      layout &&
      (Object.hasOwn(source.positions, "sprint") ||
        Object.hasOwn(source.positions, "dash") ||
        !Object.hasOwn(source.positions, "punch") ||
        !Object.hasOwn(source.positions, "kick"))
    ) {
      try {
        target.setItem(STORAGE_KEY, JSON.stringify(layout));
      } catch {
        /* still usable in memory */
      }
    }
    return layout;
  } catch {
    return null;
  }
}

export function saveLayout(storage, layout) {
  const validated = validateLayout(layout);
  if (!validated) return false;
  try {
    const target = storage ?? globalThis.localStorage;
    if (typeof target?.setItem !== "function") return false;
    target.setItem(STORAGE_KEY, JSON.stringify(validated));
    return true;
  } catch {
    return false;
  }
}

export function clearLayout(storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    if (typeof target?.removeItem !== "function") return false;
    target.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Positions are centres relative to the playable viewport, never pixel offsets. */
export function normalizeCenters(rects, bounds) {
  if (!validBounds(bounds) || !record(rects)) return null;
  const positions = {};
  for (const id of CONTROL_IDS) {
    const rect = readRect(rects[id]);
    if (!rect) return null;
    positions[id] = {
      x: clamp(
        (rect.left + rect.width / 2 - bounds.left) /
          (bounds.right - bounds.left),
        0,
        1,
      ),
      y: clamp(
        (rect.top + rect.height / 2 - bounds.top) /
          (bounds.bottom - bounds.top),
        0,
        1,
      ),
    };
  }
  return positions;
}

function overlaps(a, b) {
  return (
    a.left < b.left + b.width + LAYOUT_GAP - EPSILON &&
    a.left + a.width > b.left - LAYOUT_GAP + EPSILON &&
    a.top < b.top + b.height + LAYOUT_GAP - EPSILON &&
    a.top + a.height > b.top - LAYOUT_GAP + EPSILON
  );
}

function placementCandidates(desired, size, bounds, obstacles) {
  if (
    !record(desired) ||
    ![desired.x, desired.y].every(Number.isFinite) ||
    !record(size) ||
    ![size.width, size.height].every(Number.isFinite) ||
    size.width <= 0 ||
    size.height <= 0 ||
    !validBounds(bounds)
  )
    return [];
  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;
  const minimumX = bounds.left + LAYOUT_MARGIN + halfWidth;
  const maximumX = bounds.right - LAYOUT_MARGIN - halfWidth;
  const minimumY = bounds.top + LAYOUT_MARGIN + halfHeight;
  const maximumY = bounds.bottom - LAYOUT_MARGIN - halfHeight;
  if (minimumX > maximumX || minimumY > maximumY) return [];

  const xValues = [clamp(desired.x, minimumX, maximumX), minimumX, maximumX];
  const yValues = [clamp(desired.y, minimumY, maximumY), minimumY, maximumY];
  // The nearest point outside axis-aligned exclusions lies on a desired axis
  // or an exclusion edge. Their intersections find it without a pixel/grid scan.
  for (const rect of obstacles) {
    xValues.push(
      clamp(rect.left - LAYOUT_GAP - halfWidth, minimumX, maximumX),
      clamp(
        rect.left + rect.width + LAYOUT_GAP + halfWidth,
        minimumX,
        maximumX,
      ),
    );
    yValues.push(
      clamp(rect.top - LAYOUT_GAP - halfHeight, minimumY, maximumY),
      clamp(
        rect.top + rect.height + LAYOUT_GAP + halfHeight,
        minimumY,
        maximumY,
      ),
    );
  }
  const candidates = [];
  for (const x of new Set(xValues)) {
    for (const y of new Set(yValues)) {
      const rect = {
        left: x - halfWidth,
        top: y - halfHeight,
        width: size.width,
        height: size.height,
      };
      if (!obstacles.some((obstacle) => overlaps(rect, obstacle)))
        candidates.push({
          x,
          y,
          distance: (x - desired.x) ** 2 + (y - desired.y) ** 2,
        });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  return candidates;
}

export function constrainPosition(
  desired,
  size,
  bounds,
  exclusions = [],
  occupied = [],
) {
  const obstacles = [...exclusions, ...occupied].map(readRect).filter(Boolean);
  const nearest = placementCandidates(desired, size, bounds, obstacles)[0];
  return nearest ? { x: nearest.x, y: nearest.y } : null;
}

/** Reproject raw saved anchors on resize, then make room for actual control
 * sizes and essential UI. Raw anchors are left untouched so rotating back can
 * restore the player's intent instead of permanently accumulating clamps.
 */
export function resolveLayout(
  positions,
  sizes,
  bounds,
  exclusions = [],
  defaultCenters = {},
) {
  if (!validPositions(positions) || !validBounds(bounds) || !record(sizes))
    return null;
  for (const id of CONTROL_IDS) {
    if (
      !record(sizes[id]) ||
      ![sizes[id].width, sizes[id].height].every(Number.isFinite) ||
      sizes[id].width <= 0 ||
      sizes[id].height <= 0
    )
      return null;
  }
  const obstacles = exclusions.map(readRect).filter(Boolean);
  const desired = Object.fromEntries(
    CONTROL_IDS.map((id) => [
      id,
      {
        x: bounds.left + positions[id].x * (bounds.right - bounds.left),
        y: bounds.top + positions[id].y * (bounds.bottom - bounds.top),
      },
    ]),
  );
  const byArea = [...CONTROL_IDS].sort(
    (a, b) =>
      sizes[b].width * sizes[b].height - sizes[a].width * sizes[a].height,
  );
  const orders = [
    byArea,
    [...byArea].reverse(),
    ...CONTROL_IDS.map((first) => [
      first,
      ...byArea.filter((id) => id !== first),
    ]),
  ];

  const attempt = (centers, order) => {
    const result = {};
    const occupied = [];
    for (const id of order) {
      const size = sizes[id];
      const center = constrainPosition(
        centers[id],
        size,
        bounds,
        obstacles,
        occupied,
      );
      if (!center) return null;
      const rect = {
        left: center.x - size.width / 2,
        top: center.y - size.height / 2,
        width: size.width,
        height: size.height,
      };
      result[id] = rect;
      occupied.push(rect);
    }
    return Object.fromEntries(CONTROL_IDS.map((id) => [id, result[id]]));
  };
  for (const order of orders) {
    const result = attempt(desired, order);
    if (result) return result;
  }
  // CSS defaults are an optional last resort when a crowded projection cannot
  // fit. The caller can fall back to untouched CSS if no legal layout exists.
  if (
    CONTROL_IDS.every(
      (id) =>
        record(defaultCenters[id]) &&
        [defaultCenters[id].x, defaultCenters[id].y].every(Number.isFinite),
    )
  ) {
    for (const order of orders) {
      const result = attempt(defaultCenters, order);
      if (result) return result;
    }
  }
  return null;
}
