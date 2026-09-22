const HANDLED_ENTITY_TYPES = new Set([
  '3DFACE',
  'ARC',
  'ATTDEF',
  'CIRCLE',
  'DIMENSION',
  'ELLIPSE',
  'INSERT',
  'LINE',
  'LWPOLYLINE',
  'MTEXT',
  'POINT',
  'POLYLINE',
  'SOLID',
  'SPLINE',
  'TEXT',
]);

const GROUP_CODE = /^[+-]?\d+$/;
const VERTEX_PRECISION = 1000;

function unsupported(reason) {
  return { supported: false, reason };
}

function nextLine(text, cursor) {
  if (cursor.offset >= text.length) return null;

  const lineEnd = text.indexOf('\n', cursor.offset);
  let line;
  if (lineEnd === -1) {
    line = text.slice(cursor.offset);
    cursor.offset = text.length;
  } else {
    line = text.slice(cursor.offset, lineEnd);
    cursor.offset = lineEnd + 1;
  }
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function nextPair(text, cursor) {
  const codeLine = nextLine(text, cursor);
  if (codeLine == null) return null;
  const valueLine = nextLine(text, cursor);
  const normalizedCode = codeLine.trim();
  if (valueLine == null || !GROUP_CODE.test(normalizedCode)) {
    return { malformed: true };
  }
  return {
    code: Number.parseInt(normalizedCode, 10),
    value: valueLine.trim(),
  };
}

function coordinateValue(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function appendCurrentVertex(face) {
  if (!face.current || !face.current.hasY) return false;
  face.vertices.push({
    x: face.current.x,
    y: face.current.y,
    ...(face.current.hasZ ? { z: face.current.z } : {}),
  });
  face.current = null;
  return true;
}

function consumeFaceCoordinate(face, code, value) {
  if (face.terminated) return false;

  if (code >= 10 && code <= 13) {
    if (face.current && !appendCurrentVertex(face)) return false;
    const vertexIndex = code - 10;
    if (vertexIndex !== face.vertices.length) return false;
    const x = coordinateValue(value);
    if (x == null) return false;
    face.current = {
      index: vertexIndex,
      x,
      y: 0,
      z: 0,
      hasY: false,
      hasZ: false,
    };
    face.started = true;
    return true;
  }

  if (code >= 20 && code <= 23) {
    if (!face.current || code - 20 !== face.current.index || face.current.hasY) {
      return false;
    }
    const y = coordinateValue(value);
    if (y == null) return false;
    face.current.y = y;
    face.current.hasY = true;
    return true;
  }

  if (code >= 30 && code <= 33) {
    if (!face.current || code - 30 !== face.current.index || face.current.hasZ) {
      return false;
    }
    const z = coordinateValue(value);
    if (z == null) return false;
    face.current.z = z;
    face.current.hasZ = true;
    return true;
  }

  if (face.started) {
    // dxf-parser stops its vertex reader on the first non-coordinate group
    // and does not retain the in-progress vertex. Canonical DXF files place
    // group 70 here, after the fourth coordinate set.
    face.current = null;
    face.terminated = true;
  }
  return true;
}

function typedMesh(mesh) {
  return {
    ...mesh,
    x: new Float64Array(mesh.x),
    y: new Float64Array(mesh.y),
    z: new Float64Array(mesh.z),
    i: new Uint32Array(mesh.i),
    j: new Uint32Array(mesh.j),
    k: new Uint32Array(mesh.k),
  };
}

export function parse3dFaceStream(text) {
  if (typeof text !== 'string') return unsupported('malformed-dxf');

  const cursor = { offset: 0 };
  const typeCount = {};
  const vertexMap = new Map();
  const x = [];
  const y = [];
  const z = [];
  const i = [];
  const j = [];
  const k = [];
  let skippedFaces = 0;
  let quadCount = 0;
  let faceCount = 0;
  let section = null;
  let expectSectionName = false;
  let entitiesSections = 0;
  let currentEntityType = null;
  let currentFace = null;
  let malformed = false;
  let sawEof = false;

  function addVertex(vx, vy, vz) {
    const key = `${Math.round(vx * VERTEX_PRECISION)},${Math.round(vy * VERTEX_PRECISION)},${Math.round(vz * VERTEX_PRECISION)}`;
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

  function appendFace(vertices) {
    if (vertices.length < 3) {
      skippedFaces += 1;
      return;
    }

    const [v0, v1, v2] = vertices;
    const i0 = addVertex(v0.x, v0.y, v0.z || 0);
    const i1 = addVertex(v1.x, v1.y, v1.z || 0);
    const i2 = addVertex(v2.x, v2.y, v2.z || 0);
    if (i0 === i1 || i1 === i2 || i0 === i2) {
      skippedFaces += 1;
      return;
    }
    i.push(i0);
    j.push(i1);
    k.push(i2);

    if (vertices.length >= 4) {
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

  function finishEntity() {
    if (currentEntityType !== '3DFACE' || !currentFace) {
      currentEntityType = null;
      currentFace = null;
      return;
    }

    if (!currentFace.terminated && currentFace.current) {
      if (!appendCurrentVertex(currentFace)) {
        malformed = true;
      }
    }
    if (!malformed) appendFace(currentFace.vertices);
    currentEntityType = null;
    currentFace = null;
  }

  while (true) {
    const pair = nextPair(text, cursor);
    if (pair == null) break;
    if (pair.malformed) {
      malformed = true;
      break;
    }

    const { code, value } = pair;
    if (expectSectionName) {
      if (code !== 2) {
        malformed = true;
        break;
      }
      section = value;
      expectSectionName = false;
      if (section === 'ENTITIES') {
        entitiesSections += 1;
        if (entitiesSections > 1) {
          malformed = true;
          break;
        }
      }
      continue;
    }

    if (code === 0 && value === 'SECTION') {
      if (section != null) {
        malformed = true;
        break;
      }
      expectSectionName = true;
      continue;
    }

    if (code === 0 && value === 'ENDSEC') {
      if (section === 'ENTITIES') finishEntity();
      if (section == null) {
        malformed = true;
        break;
      }
      section = null;
      continue;
    }

    if (code === 0 && value === 'EOF') {
      if (section != null || expectSectionName) malformed = true;
      sawEof = true;
      break;
    }

    if (section !== 'ENTITIES') continue;

    if (code === 0) {
      finishEntity();
      if (malformed) break;
      currentEntityType = value;
      if (HANDLED_ENTITY_TYPES.has(value)) {
        typeCount[value] = (typeCount[value] || 0) + 1;
      }
      if (value === '3DFACE') {
        faceCount += 1;
        currentFace = {
          vertices: [],
          current: null,
          started: false,
          terminated: false,
        };
      }
      continue;
    }

    if (
      currentEntityType === '3DFACE'
      && !consumeFaceCoordinate(currentFace, code, value)
    ) {
      malformed = true;
      break;
    }
  }

  if (malformed || expectSectionName || section != null || !sawEof) {
    return unsupported('malformed-dxf');
  }
  if (faceCount === 0) return unsupported('unsupported-entity');
  if (i.length === 0) {
    throw new Error('DXF 3DFACE ditemukan tapi semua face degenerate');
  }

  return {
    supported: true,
    kind: 'mesh',
    mesh: typedMesh({
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
