import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import * as THREE from 'three';

import { SceneController } from '../src/scene-controller.js';

class FakeRenderer {
  constructor() {
    this.domElement = { style: {}, parentNode: null };
    this.shadowMap = {};
    this.info = { render: { calls: 0 } };
    this.disposeCalls = 0;
  }

  setSize(width, height) {
    this.size = [width, height];
  }

  setPixelRatio(value) {
    this.pixelRatio = value;
  }

  render() {
    this.info.render.calls += 1;
  }

  dispose() {
    this.disposeCalls += 1;
  }
}

class FakeLabelRenderer extends FakeRenderer {}

class FakeControls {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.mouseButtons = {};
    this.touches = {};
    this.listeners = new Map();
    this.disposeCalls = 0;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type) {
    this.listeners.delete(type);
  }

  update() {
    return false;
  }

  dispose() {
    this.disposeCalls += 1;
  }
}

class FakeCss2DObject extends THREE.Object3D {
  constructor(element) {
    super();
    this.element = element;
  }
}

function fakeDom() {
  const elements = [];
  const documentRef = {
    createElement() {
      const element = {
        className: '',
        textContent: '',
        style: {},
        parentNode: null,
        removeCalls: 0,
        remove() {
          this.removeCalls += 1;
          this.parentNode?.removeChild?.(this);
        },
      };
      elements.push(element);
      return element;
    },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
  const listeners = new Map();
  const windowRef = {
    devicePixelRatio: 1,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const container = {
    clientWidth: 900,
    clientHeight: 600,
    children: [],
    appendChild(element) {
      element.parentNode = this;
      this.children.push(element);
    },
    removeChild(element) {
      element.parentNode = null;
      this.children = this.children.filter((child) => child !== element);
    },
  };
  return { container, documentRef, elements, listeners, windowRef };
}

function fixtureMesh(offset = 0) {
  return {
    x: new Float64Array([0 + offset, 10 + offset, 10 + offset, 0 + offset]),
    y: new Float64Array([0, 0, 10, 10]),
    z: new Float64Array([0, 0, 5, 5]),
    i: new Uint32Array([0, 0]),
    j: new Uint32Array([1, 2]),
    k: new Uint32Array([2, 3]),
    stats: { vertexCount: 4, validTriangles: 2 },
  };
}

function fixtureMonitoring() {
  return [
    {
      id: 'A', e0: 1, n0: 1, z0: 1,
      dE: 0, dN: 0, dZ: 0, disp2D: 0,
      category: { name: 'Aman', color: '#2ecc71' },
    },
    {
      id: 'B', e0: 9, n0: 9, z0: 4,
      dE: 0.01, dN: 0, dZ: -0.01, disp2D: 0.01,
      category: { name: 'Bahaya', color: '#e74c3c' },
    },
  ];
}

function createControllerFixture() {
  const dom = fakeDom();
  const renderer = new FakeRenderer();
  const labelRenderer = new FakeLabelRenderer();
  const scheduler = {
    invalidate: mock.fn(),
    pendingFrameCount: () => 0,
    dispose: mock.fn(),
  };
  const controller = new SceneController({
    THREE,
    OrbitControls: FakeControls,
    CSS2DRenderer: FakeLabelRenderer,
    CSS2DObject: FakeCss2DObject,
    container: dom.container,
    debugElement: { textContent: '', innerHTML: '' },
    scheduler,
    renderer,
    labelRenderer,
    documentRef: dom.documentRef,
    windowRef: dom.windowRef,
  });
  return { controller, dom, labelRenderer, renderer, scheduler };
}

test('opacity change mutates material without rebuilding geometry', () => {
  const scene = createControllerFixture();
  scene.controller.setMesh(fixtureMesh());
  const before = scene.controller.debugHandles().terrain;

  for (let index = 0; index < 50; index += 1) {
    scene.controller.setTerrainOpacity(0.5 + index / 200);
  }
  const after = scene.controller.debugHandles().terrain;

  assert.equal(after, before);
  assert.equal(after.geometry, before.geometry);
  assert.equal(after.material, before.material);
  assert.equal(after.material.opacity, 0.745);
});

test('grid changes leave terrain and monitoring identities untouched', () => {
  const scene = createControllerFixture();
  scene.controller.setMesh(fixtureMesh());
  scene.controller.setMonitoring(fixtureMonitoring());
  const before = scene.controller.debugHandles();
  assert.ok(scene.controller.getDiagnostics().monitoringDrawObjects < 25);

  for (let index = 0; index < 50; index += 1) {
    scene.controller.setGridOptions({
      showGrid: true,
      gridSpacing: 100 + index * 10,
    });
  }
  const after = scene.controller.debugHandles();

  assert.equal(after.terrain, before.terrain);
  assert.equal(after.monitoring, before.monitoring);
  assert.notEqual(after.grid, before.grid);
});

test('Z exaggeration replaces only owned geometry and disposes each old geometry once', () => {
  const scene = createControllerFixture();
  scene.controller.setMesh(fixtureMesh());
  const material = scene.controller.debugHandles().terrain.material;
  const disposed = [];

  for (let index = 0; index < 20; index += 1) {
    const geometry = scene.controller.debugHandles().terrain.geometry;
    let calls = 0;
    geometry.addEventListener('dispose', () => { calls += 1; });
    scene.controller.setZExaggeration(2 + index);
    disposed.push(calls);
  }

  assert.deepEqual(disposed, new Array(20).fill(1));
  assert.equal(scene.controller.debugHandles().terrain.material, material);
});

test('mesh replacement disposes old geometry and keeps one terrain object', () => {
  const scene = createControllerFixture();
  scene.controller.setMesh(fixtureMesh());
  const terrain = scene.controller.debugHandles().terrain;
  const oldGeometry = terrain.geometry;
  let disposeCalls = 0;
  oldGeometry.addEventListener('dispose', () => { disposeCalls += 1; });

  scene.controller.setMesh(fixtureMesh(100));

  assert.equal(disposeCalls, 1);
  assert.equal(scene.controller.debugHandles().terrain, terrain);
  assert.notEqual(terrain.geometry, oldGeometry);
});

test('monitoring rebuild disposes shared resources once and removes labels', () => {
  const scene = createControllerFixture();
  scene.controller.setMesh(fixtureMesh());
  scene.controller.setMonitoring(fixtureMonitoring());
  scene.controller.setMonitoringOptions({ showLabels: true });
  const group = scene.controller.debugHandles().monitoring;
  const geometries = new Set();
  group.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
  });
  const disposalCounts = new Map();
  for (const geometry of geometries) {
    disposalCounts.set(geometry, 0);
    geometry.addEventListener('dispose', () => {
      disposalCounts.set(geometry, disposalCounts.get(geometry) + 1);
    });
  }

  scene.controller.setMonitoringOptions({ showLabels: false });

  assert.ok([...disposalCounts.values()].every((count) => count === 1));
  assert.ok(scene.dom.elements.some((element) => element.removeCalls === 1));
});

test('dispose is idempotent and releases renderer, controls, and current resources once', () => {
  const scene = createControllerFixture();
  scene.controller.setMesh(fixtureMesh());
  scene.controller.setMonitoring(fixtureMonitoring());
  const { terrain, controls } = scene.controller.debugHandles();
  let geometryDisposals = 0;
  let materialDisposals = 0;
  terrain.geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
  terrain.material.addEventListener('dispose', () => { materialDisposals += 1; });

  scene.controller.dispose();
  scene.controller.dispose();

  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(scene.renderer.disposeCalls, 1);
  assert.equal(scene.labelRenderer.disposeCalls, 1);
  assert.equal(controls.disposeCalls, 1);
  assert.equal(scene.scheduler.dispose.mock.callCount(), 1);
  assert.equal(scene.dom.container.children.length, 0);
});
