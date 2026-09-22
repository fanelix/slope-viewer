import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

import {
  computeBatchTransforms,
  createMonitoringBatch,
} from '../src/monitoring-batch.js';
import {
  buildMonitoringTransforms,
  calculateSphereRadius,
  parseMonitoringCsv,
} from '../src/monitoring-core.js';
import { loadLegacyDependencies } from './helpers/legacy-reference.mjs';

class FakeCss2DObject extends THREE.Object3D {
  constructor(element) {
    super();
    this.element = element;
  }
}

function createDocument() {
  const elements = [];
  return {
    elements,
    createElement() {
      const element = {
        className: '',
        textContent: '',
        parentNode: null,
        removeCalls: 0,
        remove() { this.removeCalls += 1; },
      };
      elements.push(element);
      return element;
    },
  };
}

function assertMatricesClose(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(actual[index].length, expected[index].length);
    for (let component = 0; component < actual[index].length; component += 1) {
      assert.ok(
        Math.abs(actual[index][component] - expected[index][component]) <= tolerance,
        `matrix ${index}, component ${component}: ${actual[index][component]} != ${expected[index][component]}`,
      );
    }
  }
}

function legacyMonitoringVisuals(points, settings) {
  const sphereRadius = settings.sphereRadius ?? calculateSphereRadius(points);
  const transforms = buildMonitoringTransforms(points, { ...settings, sphereRadius });
  const sphereGeometry = new THREE.SphereGeometry(sphereRadius, 16, 16);
  const spheres = [];
  const horizontalHeads = [];
  const verticalHeads = [];
  const shaftPositions = [];
  const colors = [];
  for (const point of transforms.points) {
    const sphere = new THREE.Mesh(sphereGeometry);
    sphere.position.set(...point.origin);
    sphere.updateMatrixWorld(true);
    spheres.push(sphere.matrixWorld.toArray());
    for (const [kind, arrow] of [
      ['horizontal', point.horizontal],
      ['vertical', point.vertical],
    ]) {
      if (!arrow) continue;
      const helper = new THREE.ArrowHelper(
        new THREE.Vector3(...arrow.direction),
        new THREE.Vector3(...point.origin),
        arrow.length,
        arrow.color,
        arrow.headLength,
        arrow.headWidth,
      );
      helper.updateMatrixWorld(true);
      const start = new THREE.Vector3(0, 0, 0).applyMatrix4(
        helper.line.matrixWorld,
      );
      const end = new THREE.Vector3(0, 1, 0).applyMatrix4(
        helper.line.matrixWorld,
      );
      shaftPositions.push(...start.toArray(), ...end.toArray());
      colors.push(...helper.line.material.color.toArray());
      if (kind === 'horizontal') {
        horizontalHeads.push(helper.cone.matrixWorld.toArray());
      } else {
        verticalHeads.push(helper.cone.matrixWorld.toArray());
      }
    }
  }
  return {
    spheres,
    horizontalHeads,
    verticalHeads,
    shaftPositions,
    colors,
  };
}

async function canonicalFixture() {
  const text = await readFile(
    new URL('../data/monitoring.csv', import.meta.url),
    'utf8',
  );
  const { Papa } = await loadLegacyDependencies();
  return parseMonitoringCsv(text, Papa);
}

const SETTINGS = Object.freeze({
  scaleH: 100,
  scaleV: 200,
  zCenter: 191.72355890274048,
  zExag: 6,
  showH: true,
  showV: true,
  showLabels: false,
});

test('batched transforms equal every legacy sphere and ArrowHelper transform', async () => {
  const points = await canonicalFixture();
  const legacy = legacyMonitoringVisuals(points, SETTINGS);
  const optimized = computeBatchTransforms({ THREE, points, settings: SETTINGS });

  assertMatricesClose(optimized.spheres.map((item) => item.matrix), legacy.spheres);
  assertMatricesClose(
    optimized.horizontalHeads.map((item) => item.matrix),
    legacy.horizontalHeads,
  );
  assertMatricesClose(
    optimized.verticalHeads.map((item) => item.matrix),
    legacy.verticalHeads,
  );
  assert.deepEqual(optimized.shaftPositions, legacy.shaftPositions);
  assert.deepEqual(optimized.colors, legacy.colors);
});

test('canonical monitoring batch stays below the draw-object budget', async () => {
  const points = await canonicalFixture();
  const documentRef = createDocument();
  const batch = createMonitoringBatch({
    THREE,
    CSS2DObject: FakeCss2DObject,
    documentRef,
    points,
    settings: SETTINGS,
  });

  assert.ok(batch.drawObjectCount < 25);
  assert.equal(batch.transforms.spheres.length, points.length);
  assert.equal(batch.transforms.horizontalHeads.length, points.length);
  assert.equal(
    batch.transforms.verticalHeads.length,
    points.filter((point) => point.dZ !== 0).length,
  );
});

test('sphere instances use category-local origins at national-grid coordinates', () => {
  const category = { name: 'Aman', color: '#2ecc71' };
  const points = [
    {
      id: 'A', e0: 175000, n0: 9047000, z0: 100,
      dE: 0, dN: 0, dZ: 0, disp2D: 0, category,
    },
    {
      id: 'B', e0: 175025, n0: 9047040, z0: 101,
      dE: 0, dN: 0, dZ: 0, disp2D: 0, category,
    },
  ];
  const batch = createMonitoringBatch({
    THREE,
    CSS2DObject: FakeCss2DObject,
    documentRef: createDocument(),
    points,
    settings: { ...SETTINGS, zCenter: 0, zExag: 1 },
  });
  const spheres = batch.group.children.find((child) => (
    child.name.startsWith('MonitoringSpheres:')
  ));
  const localMatrix = new THREE.Matrix4();
  spheres.getMatrixAt(1, localMatrix);

  assert.deepEqual(spheres.position.toArray(), [175000, 9047000, 100]);
  assert.deepEqual(localMatrix.elements.slice(12, 15), [25, 40, 1]);
});

test('labels remain conditional and preserve position and text', () => {
  const point = {
    id: 'MON-01',
    e0: 10,
    n0: 20,
    z0: 5,
    dE: 0,
    dN: 0,
    dZ: 0,
    disp2D: 0,
    category: { name: 'Aman', color: '#2ecc71' },
  };
  const documentRef = createDocument();
  const batch = createMonitoringBatch({
    THREE,
    CSS2DObject: FakeCss2DObject,
    documentRef,
    points: [point],
    settings: { ...SETTINGS, sphereRadius: 2, zCenter: 0, showLabels: true },
  });
  const label = batch.group.children.find((child) => child.element);

  assert.equal(label.element.textContent, 'MON-01');
  assert.deepEqual(label.position.toArray(), [10, 20, 34]);
  batch.update({
    points: [point],
    settings: { ...SETTINGS, sphereRadius: 2, zCenter: 0, showLabels: false },
  });
  assert.equal(documentRef.elements[0].removeCalls, 1);
  assert.equal(batch.group.children.some((child) => child.element), false);
});

test('update and dispose release each owned shared resource exactly once', () => {
  const points = [
    {
      id: 'A', e0: 0, n0: 0, z0: 0,
      dE: 0.01, dN: 0, dZ: 0, disp2D: 0.01,
      category: { name: 'Aman', color: '#2ecc71' },
    },
    {
      id: 'B', e0: 5, n0: 5, z0: 1,
      dE: 0, dN: 0.01, dZ: -0.01, disp2D: 0.01,
      category: { name: 'Aman', color: '#2ecc71' },
    },
  ];
  const documentRef = createDocument();
  const batch = createMonitoringBatch({
    THREE,
    CSS2DObject: FakeCss2DObject,
    documentRef,
    points,
    settings: { ...SETTINGS, showLabels: true },
  });
  const group = batch.group;
  const resources = new Set();
  group.traverse((object) => {
    if (object.geometry) resources.add(object.geometry);
    if (object.material) resources.add(object.material);
  });
  const disposals = new Map();
  for (const resource of resources) {
    disposals.set(resource, 0);
    resource.addEventListener('dispose', () => {
      disposals.set(resource, disposals.get(resource) + 1);
    });
  }

  batch.update({ points, settings: SETTINGS });
  assert.equal(batch.group, group);
  assert.ok([...disposals.values()].every((count) => count === 1));
  assert.ok(documentRef.elements.every((element) => element.removeCalls === 1));

  const currentResources = new Set();
  group.traverse((object) => {
    if (object.geometry) currentResources.add(object.geometry);
    if (object.material) currentResources.add(object.material);
  });
  const currentDisposals = new Map();
  for (const resource of currentResources) {
    currentDisposals.set(resource, 0);
    resource.addEventListener('dispose', () => {
      currentDisposals.set(resource, currentDisposals.get(resource) + 1);
    });
  }
  batch.dispose();
  batch.dispose();

  assert.ok([...currentDisposals.values()].every((count) => count === 1));
  assert.equal(group.children.length, 0);
});
