import {
  buildMonitoringTransforms,
  calculateSphereRadius,
} from './monitoring-core.js';

function directionQuaternion(THREE, direction) {
  const quaternion = new THREE.Quaternion();
  if (direction.y > 0.99999) {
    quaternion.set(0, 0, 0, 1);
  } else if (direction.y < -0.99999) {
    quaternion.set(1, 0, 0, 0);
  } else {
    const axis = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
    quaternion.setFromAxisAngle(axis, Math.acos(direction.y));
  }
  return quaternion;
}

function arrowMatrices(THREE, point, arrow) {
  const origin = new THREE.Vector3(...point.origin);
  const direction = new THREE.Vector3(...arrow.direction);
  const quaternion = directionQuaternion(THREE, direction);
  const root = new THREE.Matrix4().compose(
    origin,
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );
  const lineLocal = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(
      1,
      Math.max(0.0001, arrow.length - arrow.headLength),
      1,
    ),
  );
  const lineMatrix = new THREE.Matrix4().multiplyMatrices(root, lineLocal);
  const start = new THREE.Vector3(0, 0, 0).applyMatrix4(lineMatrix);
  const end = new THREE.Vector3(0, 1, 0).applyMatrix4(lineMatrix);
  const coneLocal = new THREE.Matrix4().compose(
    new THREE.Vector3(0, arrow.length, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(arrow.headWidth, arrow.headLength, arrow.headWidth),
  );
  const headMatrix = new THREE.Matrix4().multiplyMatrices(root, coneLocal);
  const color = new THREE.Color(arrow.color);
  return {
    color: color.toArray(),
    colorKey: color.getHexString(),
    headMatrix: headMatrix.toArray(),
    shaft: [...start.toArray(), ...end.toArray()],
  };
}

export function computeBatchTransforms({ THREE, points, settings }) {
  const sphereRadius = settings.sphereRadius
    ?? calculateSphereRadius(points);
  const transformed = buildMonitoringTransforms(points, {
    ...settings,
    sphereRadius,
  });
  const spheres = [];
  const horizontalHeads = [];
  const verticalHeads = [];
  const shafts = [];
  const labels = [];

  for (const point of transformed.points) {
    spheres.push({
      id: point.id,
      category: point.category,
      matrix: new THREE.Matrix4()
        .makeTranslation(...point.origin)
        .toArray(),
    });
    if (settings.showLabels) {
      labels.push({
        id: point.id,
        position: [point.origin[0], point.origin[1], point.labelZ],
      });
    }
    for (const [kind, arrow] of [
      ['horizontal', point.horizontal],
      ['vertical', point.vertical],
    ]) {
      if (!arrow) continue;
      const matrices = arrowMatrices(THREE, point, arrow);
      const item = {
        id: point.id,
        color: matrices.color,
        colorKey: matrices.colorKey,
        matrix: matrices.headMatrix,
      };
      if (kind === 'horizontal') horizontalHeads.push(item);
      else verticalHeads.push(item);
      shafts.push({
        id: point.id,
        kind,
        color: matrices.color,
        colorKey: matrices.colorKey,
        positions: matrices.shaft,
      });
    }
  }

  return {
    sphereRadius,
    spheres,
    horizontalHeads,
    verticalHeads,
    shafts,
    labels,
    shaftPositions: shafts.flatMap((shaft) => shaft.positions),
    colors: shafts.flatMap((shaft) => shaft.color),
  };
}

export function createMonitoringBatch({
  THREE,
  CSS2DObject,
  points,
  settings,
  documentRef = globalThis.document,
}) {
  const group = new THREE.Group();
  group.name = 'MonitoringBatch';
  let resources = new Set();
  let instancedMeshes = new Set();
  let labelElements = [];
  let drawObjectCount = 0;
  let transforms = null;
  let disposed = false;

  const clear = () => {
    for (const element of labelElements) {
      if (typeof element.remove === 'function') element.remove();
      else if (element.parentNode) element.parentNode.removeChild(element);
    }
    labelElements = [];
    while (group.children.length > 0) group.remove(group.children[0]);
    for (const mesh of instancedMeshes) mesh.dispose();
    instancedMeshes = new Set();
    for (const resource of resources) resource.dispose();
    resources = new Set();
    drawObjectCount = 0;
  };

  const own = (resource) => {
    resources.add(resource);
    return resource;
  };

  const ownInstancedMesh = (mesh) => {
    instancedMeshes.add(mesh);
    return mesh;
  };

  const build = (nextPoints, nextSettings) => {
    transforms = computeBatchTransforms({
      THREE,
      points: nextPoints,
      settings: nextSettings,
    });

    const sphereGeometry = own(new THREE.SphereGeometry(
      transforms.sphereRadius,
      16,
      16,
    ));
    const sphereGroups = new Map();
    for (const sphere of transforms.spheres) {
      const key = `${sphere.category.name}:${sphere.category.color}`;
      if (!sphereGroups.has(key)) sphereGroups.set(key, []);
      sphereGroups.get(key).push(sphere);
    }
    const matrix = new THREE.Matrix4();
    for (const [key, instances] of sphereGroups) {
      const color = instances[0].category.color;
      const material = own(new THREE.MeshLambertMaterial({
        color,
      }));
      const mesh = ownInstancedMesh(new THREE.InstancedMesh(
        sphereGeometry,
        material,
        instances.length,
      ));
      mesh.name = `MonitoringSpheres:${key}`;
      mesh.castShadow = true;
      const anchor = instances[0].matrix.slice(12, 15);
      mesh.position.set(...anchor);
      for (let index = 0; index < instances.length; index += 1) {
        const position = instances[index].matrix.slice(12, 15);
        matrix.makeTranslation(
          position[0] - anchor[0],
          position[1] - anchor[1],
          position[2] - anchor[2],
        );
        mesh.setMatrixAt(index, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      drawObjectCount += 1;
    }

    if (transforms.shafts.length > 0) {
      const shaftAnchor = transforms.shaftPositions.slice(0, 3);
      const positions = new Float32Array(
        transforms.shaftPositions.map((value, index) => (
          value - shaftAnchor[index % 3]
        )),
      );
      const colors = new Float32Array(transforms.shafts.length * 6);
      for (let index = 0; index < transforms.shafts.length; index += 1) {
        const color = transforms.shafts[index].color;
        colors.set(color, index * 6);
        colors.set(color, index * 6 + 3);
      }
      const geometry = own(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const material = own(new THREE.LineBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        toneMapped: false,
      }));
      const lines = new THREE.LineSegments(geometry, material);
      lines.name = 'MonitoringArrowShafts';
      lines.position.set(...shaftAnchor);
      group.add(lines);
      drawObjectCount += 1;
    }

    const coneGeometry = own(
      new THREE.CylinderGeometry(0, 0.5, 1, 5, 1),
    );
    coneGeometry.translate(0, -0.5, 0);
    const headGroups = new Map();
    for (const head of [
      ...transforms.horizontalHeads,
      ...transforms.verticalHeads,
    ]) {
      if (!headGroups.has(head.colorKey)) headGroups.set(head.colorKey, []);
      headGroups.get(head.colorKey).push(head);
    }
    for (const [colorKey, instances] of headGroups) {
      const material = own(new THREE.MeshBasicMaterial({
        color: `#${colorKey}`,
        toneMapped: false,
      }));
      const mesh = ownInstancedMesh(new THREE.InstancedMesh(
        coneGeometry,
        material,
        instances.length,
      ));
      mesh.name = `MonitoringArrowHeads:${colorKey}`;
      const anchor = instances[0].matrix.slice(12, 15);
      mesh.position.set(...anchor);
      for (let index = 0; index < instances.length; index += 1) {
        matrix.fromArray(instances[index].matrix);
        matrix.elements[12] -= anchor[0];
        matrix.elements[13] -= anchor[1];
        matrix.elements[14] -= anchor[2];
        mesh.setMatrixAt(index, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      drawObjectCount += 1;
    }

    for (const labelData of transforms.labels) {
      const element = documentRef.createElement('div');
      element.className = 'monitor-label';
      element.textContent = labelData.id;
      labelElements.push(element);
      const label = new CSS2DObject(element);
      label.position.set(...labelData.position);
      group.add(label);
    }
  };

  build(points, settings);
  return {
    group,
    get drawObjectCount() { return drawObjectCount; },
    get transforms() { return transforms; },
    update({ points: nextPoints, settings: nextSettings }) {
      if (disposed) throw new Error('Monitoring batch is disposed');
      clear();
      build(nextPoints, nextSettings);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
}
