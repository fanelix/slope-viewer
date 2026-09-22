import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export async function loadLegacyDependencies() {
  const context = vm.createContext({ console, globalThis: null });
  context.globalThis = context;
  context.self = context;

  for (const path of [
    '../../lib/dxf-parser.js',
    '../../lib/delaunator.min.js',
    '../../lib/papaparse.min.js',
  ]) {
    const code = await readFile(new URL(path, import.meta.url), 'utf8');
    new vm.Script(code, { filename: path }).runInContext(context);
  }

  return {
    DxfParser: context.DxfParser,
    Delaunator: context.Delaunator,
    Papa: context.Papa,
  };
}

function meshBounds(mesh) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index < mesh.x.length; index += 1) {
    minX = Math.min(minX, mesh.x[index]);
    maxX = Math.max(maxX, mesh.x[index]);
    minY = Math.min(minY, mesh.y[index]);
    maxY = Math.max(maxY, mesh.y[index]);
    minZ = Math.min(minZ, mesh.z[index]);
    maxZ = Math.max(maxZ, mesh.z[index]);
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function legacyExtractDxf(dxfText, { DxfParser }) {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfText);
  if (!dxf?.entities?.length) {
    throw new Error('DXF tidak mengandung entity yang dapat dibaca');
  }

  const typeCount = {};
  for (const entity of dxf.entities) {
    typeCount[entity.type] = (typeCount[entity.type] || 0) + 1;
  }

  if ((typeCount['3DFACE'] || 0) > 0) {
    const vertexMap = new Map();
    const x = [];
    const y = [];
    const z = [];
    const i = [];
    const j = [];
    const k = [];
    const precision = 1000;

    function addVertex(vx, vy, vz) {
      const key = `${Math.round(vx * precision)},${Math.round(vy * precision)},${Math.round(vz * precision)}`;
      let index = vertexMap.get(key);
      if (index === undefined) {
        index = x.length;
        x.push(vx);
        y.push(vy);
        z.push(vz);
        vertexMap.set(key, index);
      }
      return index;
    }

    let skippedFaces = 0;
    let quadCount = 0;
    for (const entity of dxf.entities) {
      if (entity.type !== '3DFACE') continue;
      const vertices = entity.vertices || [];
      if (vertices.length < 3) {
        skippedFaces += 1;
        continue;
      }

      const [v0, v1, v2] = vertices;
      if (v0 == null || v1 == null || v2 == null) {
        skippedFaces += 1;
        continue;
      }

      const i0 = addVertex(v0.x, v0.y, v0.z || 0);
      const i1 = addVertex(v1.x, v1.y, v1.z || 0);
      const i2 = addVertex(v2.x, v2.y, v2.z || 0);
      if (i0 === i1 || i1 === i2 || i0 === i2) {
        skippedFaces += 1;
        continue;
      }
      i.push(i0);
      j.push(i1);
      k.push(i2);

      if (vertices.length >= 4 && vertices[3] != null) {
        const v3 = vertices[3];
        const v3z = v3.z || 0;
        const dx = v3.x - v2.x;
        const dy = v3.y - v2.y;
        const dz = v3z - (v2.z || 0);
        if (
          Math.abs(dx) > 1e-6
          || Math.abs(dy) > 1e-6
          || Math.abs(dz) > 1e-6
        ) {
          const i3 = addVertex(v3.x, v3.y, v3z);
          if (i3 !== i0 && i3 !== i2) {
            i.push(i0);
            j.push(i2);
            k.push(i3);
            quadCount += 1;
          }
        }
      }
    }

    if (i.length === 0) {
      throw new Error('DXF 3DFACE ditemukan tapi semua face degenerate');
    }

    const mesh = {
      x,
      y,
      z,
      i,
      j,
      k,
      stats: {
        vertexCount: x.length,
        validTriangles: i.length,
        source: '3DFACE direct',
        quadSplit: quadCount,
        skipped: skippedFaces,
      },
    };
    return { kind: 'mesh', mesh, bbox: meshBounds(mesh), typeCount };
  }

  const points = [];
  for (const entity of dxf.entities) {
    if (entity.type === 'LINE') {
      for (const vertex of entity.vertices) {
        points.push([vertex.x, vertex.y, vertex.z || 0]);
      }
    } else if (entity.type === 'LWPOLYLINE') {
      const elevation = entity.elevation || 0;
      for (const vertex of entity.vertices) {
        points.push([
          vertex.x,
          vertex.y,
          vertex.z != null ? vertex.z : elevation,
        ]);
      }
    } else if (entity.type === 'POLYLINE') {
      if (!entity.vertices) continue;
      for (const vertex of entity.vertices) {
        points.push([vertex.x, vertex.y, vertex.z || 0]);
      }
    } else if (entity.type === 'POINT') {
      points.push([
        entity.position.x,
        entity.position.y,
        entity.position.z || 0,
      ]);
    }
  }

  if (points.length === 0) {
    throw new Error('Tidak ada geometry yang dapat diekstrak.');
  }
  return { kind: 'points', points, typeCount };
}

const LEGACY_COLUMN_ALIASES = {
  id: ['ID', 'ID_POINT', 'POINT_ID', 'NAME', 'NAMA'],
  e0: ['E_AWAL', 'EASTING_AWAL', 'E0', 'X_AWAL'],
  n0: ['N_AWAL', 'NORTHING_AWAL', 'N0', 'Y_AWAL'],
  z0: ['EL_AWAL', 'ELEV_AWAL', 'Z_AWAL', 'ELEVASI_AWAL'],
  e1: ['E_AKHIR', 'EASTING_AKHIR', 'E1', 'X_AKHIR'],
  n1: ['N_AKHIR', 'NORTHING_AKHIR', 'N1', 'Y_AKHIR'],
  z1: ['EL_AKHIR', 'ELEV_AKHIR', 'Z_AKHIR', 'ELEVASI_AKHIR'],
};

const LEGACY_THRESHOLDS = [
  { max: 0.005, name: 'Aman', color: '#2ecc71' },
  { max: 0.015, name: 'Waspada', color: '#f1c40f' },
  { max: Infinity, name: 'Bahaya', color: '#e74c3c' },
];

export function legacyParseMonitoring(text, Papa) {
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
  for (const key in LEGACY_COLUMN_ALIASES) {
    columns[key] = findColumn(LEGACY_COLUMN_ALIASES[key]);
  }
  const classify = (displacement) => {
    for (const threshold of LEGACY_THRESHOLDS) {
      if (displacement <= threshold.max) return threshold;
    }
    return LEGACY_THRESHOLDS[LEGACY_THRESHOLDS.length - 1];
  };

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
