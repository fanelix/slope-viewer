import { parse3dFaceStream } from './dxf-3dface-stream.js';

// Canonical benchmark: exact digest with a measured heap reduction above 30%.
export const USE_STREAMING_3DFACE = true;

function toTypedMesh(mesh) {
  return {
    ...mesh,
    x: mesh.x instanceof Float64Array ? mesh.x : new Float64Array(mesh.x),
    y: mesh.y instanceof Float64Array ? mesh.y : new Float64Array(mesh.y),
    z: mesh.z instanceof Float64Array ? mesh.z : new Float64Array(mesh.z),
    i: mesh.i instanceof Uint32Array ? mesh.i : new Uint32Array(mesh.i),
    j: mesh.j instanceof Uint32Array ? mesh.j : new Uint32Array(mesh.j),
    k: mesh.k instanceof Uint32Array ? mesh.k : new Uint32Array(mesh.k),
  };
}

export function parseDxfGeometry(
  dxfText,
  {
    DxfParser,
    useStreaming3dFace = USE_STREAMING_3DFACE,
  } = {},
) {
  if (useStreaming3dFace) {
    const streamed = parse3dFaceStream(dxfText);
    if (streamed.supported) {
      return {
        kind: streamed.kind,
        mesh: streamed.mesh,
        typeCount: streamed.typeCount,
      };
    }
  }

  if (typeof DxfParser !== 'function') {
    throw new TypeError('DxfParser dependency is required');
  }

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

    return {
      kind: 'mesh',
      mesh: toTypedMesh({
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
      }),
      typeCount,
    };
  }

  const points = [];
  for (const entity of dxf.entities) {
    if (entity.type === 'LINE') {
      for (const vertex of entity.vertices) {
        points.push(vertex.x, vertex.y, vertex.z || 0);
      }
    } else if (entity.type === 'LWPOLYLINE') {
      const elevation = entity.elevation || 0;
      for (const vertex of entity.vertices) {
        points.push(
          vertex.x,
          vertex.y,
          vertex.z != null ? vertex.z : elevation,
        );
      }
    } else if (entity.type === 'POLYLINE') {
      if (!entity.vertices) continue;
      for (const vertex of entity.vertices) {
        points.push(vertex.x, vertex.y, vertex.z || 0);
      }
    } else if (entity.type === 'POINT') {
      points.push(
        entity.position.x,
        entity.position.y,
        entity.position.z || 0,
      );
    }
  }

  if (points.length === 0) {
    throw new Error('Tidak ada geometry yang dapat diekstrak.');
  }
  return { kind: 'points', points: new Float64Array(points), typeCount };
}

export function filterMesh(mesh, maxSlopeDeg, maxEdgeLen) {
  if (maxSlopeDeg >= 90 && maxEdgeLen >= 1e9) return mesh;

  const { x, y, z, i, j, k } = mesh;
  const nextI = [];
  const nextJ = [];
  const nextK = [];
  let filteredEdge = 0;
  let filteredSlope = 0;

  for (let index = 0; index < i.length; index += 1) {
    const a = i[index];
    const b = j[index];
    const c = k[index];
    const ax = x[a];
    const ay = y[a];
    const az = z[a];
    const bx = x[b];
    const by = y[b];
    const bz = z[b];
    const cx = x[c];
    const cy = y[c];
    const cz = z[c];
    const edge0 = Math.hypot(bx - ax, by - ay);
    const edge1 = Math.hypot(cx - bx, cy - by);
    const edge2 = Math.hypot(ax - cx, ay - cy);
    const maximumEdge = Math.max(edge0, edge1, edge2);
    if (maximumEdge > maxEdgeLen) {
      filteredEdge += 1;
      continue;
    }

    if (maxSlopeDeg < 90) {
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const norm = Math.hypot(nx, ny, nz);
      const cosTheta = norm > 0 ? Math.abs(nz) / norm : 0;
      const slope = Math.acos(
        Math.min(1, Math.max(-1, cosTheta)),
      ) * 180 / Math.PI;
      if (slope > maxSlopeDeg) {
        filteredSlope += 1;
        continue;
      }
    }

    nextI.push(a);
    nextJ.push(b);
    nextK.push(c);
  }

  return {
    x,
    y,
    z,
    i: new Uint32Array(nextI),
    j: new Uint32Array(nextJ),
    k: new Uint32Array(nextK),
    stats: {
      ...mesh.stats,
      validTriangles: nextI.length,
      filteredEdge,
      filteredSlope,
    },
  };
}

export function voxelDownsample(points, voxelSize, preserveEdges) {
  if (!(points instanceof Float64Array) || points.length % 3 !== 0) {
    throw new TypeError('Point geometry must be an interleaved Float64Array');
  }

  const grid = new Map();
  for (let offset = 0; offset < points.length; offset += 3) {
    const px = points[offset];
    const py = points[offset + 1];
    const pz = points[offset + 2];
    const key = `${Math.round(px / voxelSize)},${Math.round(py / voxelSize)}`;
    let current = grid.get(key);
    if (!current) {
      current = {
        sx: px,
        sy: py,
        sz: pz,
        n: 1,
        minZ: pz,
        maxZ: pz,
        minPt: [px, py, pz],
        maxPt: [px, py, pz],
      };
      grid.set(key, current);
    } else {
      current.sx += px;
      current.sy += py;
      current.sz += pz;
      current.n += 1;
      if (pz < current.minZ) {
        current.minZ = pz;
        current.minPt = [px, py, pz];
      }
      if (pz > current.maxZ) {
        current.maxZ = pz;
        current.maxPt = [px, py, pz];
      }
    }
  }

  const output = [];
  const threshold = voxelSize * 0.3;
  for (const current of grid.values()) {
    if (
      preserveEdges
      && current.maxZ - current.minZ > threshold
      && current.n >= 2
    ) {
      output.push(...current.minPt, ...current.maxPt);
      if (current.n >= 5) {
        output.push(
          current.sx / current.n,
          current.sy / current.n,
          current.sz / current.n,
        );
      }
    } else {
      output.push(
        current.sx / current.n,
        current.sy / current.n,
        current.sz / current.n,
      );
    }
  }
  return new Float64Array(output);
}

export function triangulate(points, maxSlopeDeg, edgeMultiplier, { Delaunator } = {}) {
  if (typeof Delaunator !== 'function') {
    throw new TypeError('Delaunator dependency is required');
  }
  if (!(points instanceof Float64Array) || points.length % 3 !== 0) {
    throw new TypeError('Point geometry must be an interleaved Float64Array');
  }

  const resolvedMaxSlope = maxSlopeDeg != null ? maxSlopeDeg : 89;
  const resolvedEdgeMultiplier = edgeMultiplier != null ? edgeMultiplier : 4;
  const pointCount = points.length / 3;
  const coordinates = new Float64Array(pointCount * 2);
  for (let index = 0; index < pointCount; index += 1) {
    coordinates[index * 2] = points[index * 3];
    coordinates[index * 2 + 1] = points[index * 3 + 1];
  }

  const delaunay = new Delaunator(coordinates);
  const triangles = delaunay.triangles;
  const triangleCount = triangles.length / 3;
  const edgeLengths = new Float64Array(triangleCount);
  const slopes = new Float64Array(triangleCount);
  const areas = new Float64Array(triangleCount);

  for (let index = 0; index < triangleCount; index += 1) {
    const a = triangles[index * 3];
    const b = triangles[index * 3 + 1];
    const c = triangles[index * 3 + 2];
    const ax = points[a * 3];
    const ay = points[a * 3 + 1];
    const az = points[a * 3 + 2];
    const bx = points[b * 3];
    const by = points[b * 3 + 1];
    const bz = points[b * 3 + 2];
    const cx = points[c * 3];
    const cy = points[c * 3 + 1];
    const cz = points[c * 3 + 2];
    const edge0 = Math.hypot(bx - ax, by - ay);
    const edge1 = Math.hypot(cx - bx, cy - by);
    const edge2 = Math.hypot(ax - cx, ay - cy);
    edgeLengths[index] = Math.max(edge0, edge1, edge2);

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const norm = Math.hypot(nx, ny, nz);
    const cosTheta = norm > 0 ? Math.abs(nz) / norm : 0;
    slopes[index] = Math.acos(
      Math.min(1, Math.max(-1, cosTheta)),
    ) * 180 / Math.PI;
    areas[index] = 0.5 * Math.abs(
      (bx - ax) * (cy - ay) - (cx - ax) * (by - ay),
    );
  }

  const sortedEdges = Array.from(edgeLengths).sort((a, b) => a - b);
  const p50 = sortedEdges[Math.floor(sortedEdges.length * 0.5)];
  const p75 = sortedEdges[Math.floor(sortedEdges.length * 0.75)];
  const baseline = Math.max(p50, p75 * 0.7);
  const maximumEdge = baseline * resolvedEdgeMultiplier;
  const validI = [];
  const validJ = [];
  const validK = [];

  for (let index = 0; index < triangleCount; index += 1) {
    if (
      edgeLengths[index] <= maximumEdge
      && slopes[index] <= resolvedMaxSlope
      && areas[index] > 0.01
    ) {
      validI.push(triangles[index * 3]);
      validJ.push(triangles[index * 3 + 1]);
      validK.push(triangles[index * 3 + 2]);
    }
  }

  if (validI.length === 0) {
    throw new Error('Tidak ada triangle valid.');
  }

  const x = new Float64Array(pointCount);
  const y = new Float64Array(pointCount);
  const z = new Float64Array(pointCount);
  for (let index = 0; index < pointCount; index += 1) {
    x[index] = points[index * 3];
    y[index] = points[index * 3 + 1];
    z[index] = points[index * 3 + 2];
  }

  return {
    x,
    y,
    z,
    i: new Uint32Array(validI),
    j: new Uint32Array(validJ),
    k: new Uint32Array(validK),
    stats: {
      validTriangles: validI.length,
      vertexCount: pointCount,
      totalTriangles: triangleCount,
      filteredOut: triangleCount - validI.length,
      medianEdge: p50,
      p75Edge: p75,
      maxEdgeUsed: maximumEdge,
    },
  };
}

export function buildMeshFromGeometry(geometry, settings, dependencies = {}) {
  if (geometry.kind === 'mesh') {
    return filterMesh(
      geometry.mesh,
      settings.maxSlopeDeg,
      settings.maxEdgeLen,
    );
  }
  if (geometry.kind !== 'points') {
    throw new Error(`Unsupported geometry kind: ${geometry.kind}`);
  }

  const sourcePointCount = geometry.points.length / 3;
  const downsampled = voxelDownsample(
    geometry.points,
    settings.voxelSize,
    settings.preserveEdges,
  );
  const downsampledPointCount = downsampled.length / 3;
  let mesh = triangulate(
    downsampled,
    settings.maxSlopeDeg,
    settings.edgeMultiplier,
    dependencies,
  );
  mesh.stats.source = `Delaunay (${sourcePointCount.toLocaleString()} pts → ${downsampledPointCount.toLocaleString()} after voxel)`;
  if (settings.maxEdgeLen < 1e9) {
    mesh = filterMesh(mesh, 90, settings.maxEdgeLen);
  }
  return mesh;
}

export function validateMesh(mesh) {
  if (!mesh || typeof mesh !== 'object') return false;
  if (
    !(mesh.x instanceof Float64Array)
    || !(mesh.y instanceof Float64Array)
    || !(mesh.z instanceof Float64Array)
    || !(mesh.i instanceof Uint32Array)
    || !(mesh.j instanceof Uint32Array)
    || !(mesh.k instanceof Uint32Array)
  ) {
    return false;
  }
  if (mesh.x.length !== mesh.y.length || mesh.x.length !== mesh.z.length) {
    return false;
  }
  if (
    mesh.i.length !== mesh.j.length
    || mesh.i.length !== mesh.k.length
    || mesh.i.length === 0
  ) {
    return false;
  }
  for (const values of [mesh.x, mesh.y, mesh.z]) {
    for (const value of values) {
      if (!Number.isFinite(value)) return false;
    }
  }
  for (const values of [mesh.i, mesh.j, mesh.k]) {
    for (const value of values) {
      if (value >= mesh.x.length) return false;
    }
  }
  return true;
}
