import { COLUMN_ALIASES, THRESHOLDS } from './config.js';

function classify(displacement) {
  for (const threshold of THRESHOLDS) {
    if (displacement <= threshold.max) return threshold;
  }
  return THRESHOLDS[THRESHOLDS.length - 1];
}

export function parseMonitoringCsv(text, Papa) {
  if (!Papa || typeof Papa.parse !== 'function') {
    throw new TypeError('Papa Parse dependency is required');
  }

  const results = Papa.parse(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  const headers = results.meta.fields;
  const normalizedHeaders = headers.map((header) => (
    String(header).trim().toUpperCase()
  ));
  const findColumn = (aliases) => {
    for (const alias of aliases) {
      const index = normalizedHeaders.indexOf(alias);
      if (index !== -1) return headers[index];
    }
    throw new Error(`Kolom tidak ditemukan: ${aliases.join(', ')}`);
  };

  const columns = {};
  for (const key in COLUMN_ALIASES) {
    columns[key] = findColumn(COLUMN_ALIASES[key]);
  }

  const points = [];
  for (const row of results.data) {
    const e0 = Number(row[columns.e0]);
    const n0 = Number(row[columns.n0]);
    const z0 = Number(row[columns.z0]);
    const e1 = Number(row[columns.e1]);
    const n1 = Number(row[columns.n1]);
    const z1 = Number(row[columns.z1]);
    if ([e0, n0, z0, e1, n1, z1].some((value) => !Number.isFinite(value))) {
      continue;
    }

    const dE = e1 - e0;
    const dN = n1 - n0;
    const dZ = z1 - z0;
    const disp2D = Math.hypot(dE, dN);
    const dispTotal = Math.hypot(dE, dN, dZ);
    const azimuth = (
      Math.atan2(dE, dN) * 180 / Math.PI + 360
    ) % 360;
    points.push({
      id: String(row[columns.id]),
      e0,
      n0,
      z0,
      e1,
      n1,
      z1,
      dE,
      dN,
      dZ,
      disp2D,
      dispTotal,
      azimuth,
      category: classify(dispTotal),
    });
  }

  if (points.length === 0) {
    throw new Error('Tidak ada baris valid di CSV');
  }
  return points;
}

export function exaggerateZ(z, zCenter, zExag) {
  return (z - zCenter) * zExag + zCenter;
}

export function calculateSphereRadius(points) {
  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.e0 < minE) minE = point.e0;
    if (point.e0 > maxE) maxE = point.e0;
    if (point.n0 < minN) minN = point.n0;
    if (point.n0 > maxN) maxN = point.n0;
  }
  return Math.max(1, Math.max(maxE - minE, maxN - minN) * 0.004);
}

function normalize3([x, y, z]) {
  const length = Math.hypot(x, y, z);
  if (length === 0) return [0, 0, 0];
  return [x / length, y / length, z / length];
}

export function buildMonitoringTransforms(points, settings) {
  const minimumArrowLength = settings.sphereRadius * 3;
  const makeArrow = (direction, length, color) => {
    const headLength = Math.min(
      length * 0.35,
      settings.sphereRadius * 2.5,
      length * 0.5,
    );
    return {
      direction,
      length,
      color,
      headLength,
      headWidth: Math.max(
        headLength * 0.5,
        settings.sphereRadius * 0.8,
      ),
    };
  };

  return {
    sphereRadius: settings.sphereRadius,
    points: points.map((point) => {
      const horizontalLength = Math.max(
        point.disp2D * settings.scaleH,
        minimumArrowLength,
      );
      const horizontalDirection = point.dE === 0 && point.dN === 0
        ? [0, 1, 0]
        : normalize3([point.dE, point.dN, 0]);
      const originZ = exaggerateZ(point.z0, settings.zCenter, settings.zExag);

      return {
        id: point.id,
        category: point.category,
        origin: [point.e0, point.n0, originZ],
        labelZ: originZ + settings.sphereRadius * 2,
        horizontal: settings.showH
          ? makeArrow(
              horizontalDirection,
              horizontalLength,
              point.category.color,
            )
          : null,
        vertical: settings.showV && point.dZ !== 0
          ? makeArrow(
              [0, 0, point.dZ > 0 ? 1 : -1],
              Math.max(
                Math.abs(point.dZ) * settings.scaleV,
                minimumArrowLength,
              ),
              point.dZ < 0 ? 0x1f5f8b : 0x3498db,
            )
          : null,
      };
    }),
  };
}
