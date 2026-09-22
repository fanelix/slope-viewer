import { DEFAULT_STATE } from './config.js';
import { createMonitoringBatch } from './monitoring-batch.js';
import { exaggerateZ } from './monitoring-core.js';

function disposeMaterial(material, disposeResource) {
  if (Array.isArray(material)) {
    for (const value of material) disposeResource(value);
  } else {
    disposeResource(material);
  }
}

function createLineSegments(THREE, positions, material) {
  if (positions.length === 0) {
    material.dispose();
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  return new THREE.LineSegments(geometry, material);
}

export class SceneController {
  constructor({
    THREE,
    OrbitControls,
    CSS2DRenderer,
    CSS2DObject,
    container,
    debugElement,
    scheduler,
    renderer,
    labelRenderer,
    documentRef = globalThis.document,
    windowRef = globalThis.window,
  }) {
    this.THREE = THREE;
    this.CSS2DObject = CSS2DObject;
    this.container = container;
    this.debugElement = debugElement;
    this.scheduler = scheduler;
    this.document = documentRef;
    this.window = windowRef;
    this.state = { ...DEFAULT_STATE, mesh: null, monitoring: null };
    this.bounds = null;
    this.zCenter = 0;
    this.disposed = false;
    this.removedElements = new WeakSet();
    this.counters = {
      terrainGeometryRebuilds: 0,
      terrainMaterialRebuilds: 0,
      monitoringRebuilds: 0,
      gridRebuilds: 0,
      resourceDisposals: 0,
      shadowInvalidations: 0,
      renders: 0,
    };

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8eaed);
    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100000,
    );

    this.renderer = renderer || new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(windowRef.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = labelRenderer || new CSS2DRenderer();
    this.labelRenderer.setSize(container.clientWidth, container.clientHeight);
    Object.assign(this.labelRenderer.domElement.style, {
      position: 'absolute',
      top: '0px',
      left: '0px',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    container.appendChild(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.rotateSpeed = 0.8;
    this.controls.panSpeed = 1;
    this.controls.zoomSpeed = 1.2;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 100000;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.minPolarAngle = 0;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;

    this._onControlsChange = () => this.scheduler.invalidate('controls');
    this.controls.addEventListener?.('change', this._onControlsChange);
    this.shiftHeld = false;
    this._onKeyDown = (event) => {
      if (event.key === 'Shift' && !this.shiftHeld) {
        this.shiftHeld = true;
        this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      }
    };
    this._onKeyUp = (event) => {
      if (event.key === 'Shift') {
        this.shiftHeld = false;
        this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      }
    };
    this._onBlur = () => {
      this.shiftHeld = false;
      this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    };
    windowRef.addEventListener('keydown', this._onKeyDown);
    windowRef.addEventListener('keyup', this._onKeyUp);
    windowRef.addEventListener('blur', this._onBlur);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    this.scene.add(this.hemiLight);
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.dirLight.position.set(200, 400, 300);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 5000;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);
    this.fillLight = new THREE.DirectionalLight(0xffeedd, 0.4);
    this.fillLight.position.set(-200, -200, 100);
    this.scene.add(this.fillLight);
    this.backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    this.backLight.position.set(0, 0, -500);
    this.scene.add(this.backLight);

    this.topoGroup = new THREE.Group();
    this.monitorGroup = new THREE.Group();
    this.scene.add(this.topoGroup);
    this.scene.add(this.monitorGroup);
    this.terrain = null;
    this.monitoringBatch = null;
    this.gridHelper = null;
    this.axesHelper = null;
    this.gridLabelsGroup = null;
    this.elevationLinesGroup = null;
  }

  _disposeResource = (resource) => {
    if (
      !resource
      || typeof resource !== 'object'
      || typeof resource.dispose !== 'function'
    ) {
      return;
    }
    resource.dispose();
    this.counters.resourceDisposals += 1;
  };

  _markShadowsDirty() {
    if (!this.renderer.shadowMap?.enabled) return;
    this.renderer.shadowMap.needsUpdate = true;
    this.counters.shadowInvalidations += 1;
  }

  _removeElement(element) {
    if (!element || this.removedElements.has(element)) return;
    this.removedElements.add(element);
    if (typeof element.remove === 'function') {
      element.remove();
    } else if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }

  _disposeObjectTree(object) {
    if (!object) return;
    const geometries = new Set();
    const materials = new Set();
    object.traverse((child) => {
      if (child.geometry) geometries.add(child.geometry);
      if (Array.isArray(child.material)) {
        for (const material of child.material) materials.add(material);
      } else if (child.material) {
        materials.add(child.material);
      }
      if (child.element) this._removeElement(child.element);
    });
    for (const geometry of geometries) this._disposeResource(geometry);
    for (const material of materials) this._disposeResource(material);
  }

  _clearGroup(group) {
    this._disposeObjectTree(group);
    while (group.children.length > 0) group.remove(group.children[0]);
  }

  _computeBounds(mesh) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let index = 0; index < mesh.x.length; index += 1) {
      const x = mesh.x[index];
      const y = mesh.y[index];
      const z = mesh.z[index];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return {
      minX,
      maxX,
      minY,
      maxY,
      minZ,
      maxZ,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      cz: (minZ + maxZ) / 2,
      spanXY: Math.max(maxX - minX, maxY - minY),
      spanZ: maxZ - minZ,
    };
  }

  _elevationColor(z, zMin, zMax) {
    const t = Math.max(
      0,
      Math.min(1, (z - zMin) / Math.max(zMax - zMin, 1e-6)),
    );
    const color = new this.THREE.Color();
    if (t < 0.25) {
      color.setRGB(0.05, 0.25 + t * 2, 0.55 - t * 1.2);
    } else if (t < 0.5) {
      color.setRGB((t - 0.25) * 3.2, 0.75, 0.25);
    } else if (t < 0.75) {
      color.setRGB(0.8, 0.75 - (t - 0.5) * 1.4, 0.15);
    } else {
      color.setRGB(0.75 + (t - 0.75), 0.35 - (t - 0.75) * 1.4, 0.1);
    }
    return color;
  }

  _createTerrainGeometry() {
    const { THREE } = this;
    const mesh = this.state.mesh;
    const { minZ, maxZ } = this.bounds;
    const triangleCount = mesh.i.length;
    const vertexCount = mesh.x.length;
    const geometry = new THREE.BufferGeometry();

    if (this.state.faceted && this.state.colorByElev) {
      const positions = new Float32Array(triangleCount * 9);
      const colors = new Float32Array(triangleCount * 9);
      for (let index = 0; index < triangleCount; index += 1) {
        const a = mesh.i[index];
        const b = mesh.j[index];
        const c = mesh.k[index];
        const az = exaggerateZ(mesh.z[a], this.zCenter, this.state.zExag);
        const bz = exaggerateZ(mesh.z[b], this.zCenter, this.state.zExag);
        const cz = exaggerateZ(mesh.z[c], this.zCenter, this.state.zExag);
        const color = this._elevationColor(
          (mesh.z[a] + mesh.z[b] + mesh.z[c]) / 3,
          minZ,
          maxZ,
        );
        positions.set([
          mesh.x[a], mesh.y[a], az,
          mesh.x[b], mesh.y[b], bz,
          mesh.x[c], mesh.y[c], cz,
        ], index * 9);
        colors.set([
          color.r, color.g, color.b,
          color.r, color.g, color.b,
          color.r, color.g, color.b,
        ], index * 9);
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
    } else {
      const positions = new Float32Array(vertexCount * 3);
      const colors = this.state.colorByElev
        ? new Float32Array(vertexCount * 3)
        : null;
      for (let index = 0; index < vertexCount; index += 1) {
        positions[index * 3] = mesh.x[index];
        positions[index * 3 + 1] = mesh.y[index];
        positions[index * 3 + 2] = exaggerateZ(
          mesh.z[index],
          this.zCenter,
          this.state.zExag,
        );
        if (colors) {
          const color = this._elevationColor(mesh.z[index], minZ, maxZ);
          colors[index * 3] = color.r;
          colors[index * 3 + 1] = color.g;
          colors[index * 3 + 2] = color.b;
        }
      }
      const indices = new Uint32Array(triangleCount * 3);
      for (let index = 0; index < triangleCount; index += 1) {
        indices[index * 3] = mesh.i[index];
        indices[index * 3 + 1] = mesh.j[index];
        indices[index * 3 + 2] = mesh.k[index];
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeVertexNormals();
    }
    this.counters.terrainGeometryRebuilds += 1;
    return geometry;
  }

  _createTerrainMaterial() {
    const { THREE } = this;
    this.counters.terrainMaterialRebuilds += 1;
    if (this.state.wireframe) {
      return new THREE.MeshBasicMaterial({
        color: 0x333333,
        wireframe: true,
        transparent: true,
        opacity: 0.9,
      });
    }
    return new THREE.MeshLambertMaterial({
      color: this.state.colorByElev
        ? 0xffffff
        : new THREE.Color(this.state.dxfSolidColor),
      vertexColors: this.state.colorByElev,
      transparent: true,
      opacity: this.state.opacity,
      flatShading: this.state.faceted,
      side: THREE.DoubleSide,
    });
  }

  _replaceTerrainGeometry() {
    if (!this.state.mesh) return;
    const geometry = this._createTerrainGeometry();
    if (!this.terrain) {
      this.terrain = new this.THREE.Mesh(
        geometry,
        this._createTerrainMaterial(),
      );
      this.terrain.castShadow = true;
      this.terrain.receiveShadow = true;
      this.topoGroup.add(this.terrain);
    } else {
      this._disposeResource(this.terrain.geometry);
      this.terrain.geometry = geometry;
    }
    this.terrain.visible = this.state.showTopo;
    this._markShadowsDirty();
  }

  _replaceTerrainMaterial() {
    if (!this.terrain) return;
    const previous = this.terrain.material;
    this.terrain.material = this._createTerrainMaterial();
    disposeMaterial(previous, this._disposeResource);
  }

  _removeHelper(property) {
    const object = this[property];
    if (!object) return;
    this.scene.remove(object);
    this._disposeObjectTree(object);
    this[property] = null;
  }

  _rebuildHelpers() {
    const { THREE } = this;
    this.counters.gridRebuilds += 1;
    this._removeHelper('gridHelper');
    this._removeHelper('axesHelper');
    this._removeHelper('gridLabelsGroup');
    this._removeHelper('elevationLinesGroup');
    const bounds = this.bounds;
    if (!this.state.showGrid || !bounds || bounds.spanXY <= 0) return;

    const spacing = this.state.gridSpacing;
    const pad = bounds.spanXY * 0.1;
    const xMinGrid = Math.floor((bounds.minX - pad) / spacing) * spacing;
    const xMaxGrid = Math.ceil((bounds.maxX + pad) / spacing) * spacing;
    const yMinGrid = Math.floor((bounds.minY - pad) / spacing) * spacing;
    const yMaxGrid = Math.ceil((bounds.maxY + pad) / spacing) * spacing;
    const gridZ = exaggerateZ(bounds.cz, bounds.cz, this.state.zExag);
    const lineMajor = new THREE.LineBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.6,
    });
    const lineMinor = new THREE.LineBasicMaterial({
      color: 0xbbbbbb,
      transparent: true,
      opacity: 0.35,
    });
    const gridGroup = new THREE.Group();
    gridGroup.name = 'GridGroup';
    const majorStep = spacing * 5;
    for (let x = xMinGrid; x <= xMaxGrid + 0.001; x += spacing) {
      const isMajor = Math.abs(Math.round(x / majorStep) * majorStep - x) < 0.5;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        x, yMinGrid, gridZ,
        x, yMaxGrid, gridZ,
      ]), 3));
      gridGroup.add(new THREE.Line(geometry, isMajor ? lineMajor : lineMinor));
    }
    for (let y = yMinGrid; y <= yMaxGrid + 0.001; y += spacing) {
      const isMajor = Math.abs(Math.round(y / majorStep) * majorStep - y) < 0.5;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        xMinGrid, y, gridZ,
        xMaxGrid, y, gridZ,
      ]), 3));
      gridGroup.add(new THREE.Line(geometry, isMajor ? lineMajor : lineMinor));
    }
    this.gridHelper = gridGroup;
    this.scene.add(gridGroup);

    this.axesHelper = new THREE.AxesHelper(bounds.spanXY * 0.12);
    this.axesHelper.position.set(bounds.cx, bounds.cy, gridZ);
    this.scene.add(this.axesHelper);

    const zExMin = exaggerateZ(bounds.minZ, bounds.cz, this.state.zExag);
    const zExMax = exaggerateZ(bounds.maxZ, bounds.cz, this.state.zExag);
    this.elevationLinesGroup = new THREE.Group();
    this.elevationLinesGroup.name = 'ElevationLines';
    const elevationMaterial = new THREE.LineBasicMaterial({
      color: 0x3498db,
      transparent: true,
      opacity: 0.6,
    });
    const verticalLine = createLineSegments(
      THREE,
      [
        xMinGrid, yMaxGrid, zExMin,
        xMinGrid, yMaxGrid, zExMax,
      ],
      elevationMaterial,
    );
    if (verticalLine) this.elevationLinesGroup.add(verticalLine);
    const elevationTickSpacing = Math.max(
      50,
      Math.round((bounds.maxZ - bounds.minZ) / 10 / 50) * 50,
    );
    const tickMaterial = new THREE.LineBasicMaterial({
      color: 0x2980b9,
      transparent: true,
      opacity: 0.8,
    });
    const elevationMin = Math.ceil(bounds.minZ / elevationTickSpacing)
      * elevationTickSpacing;
    const elevationMax = Math.floor(bounds.maxZ / elevationTickSpacing)
      * elevationTickSpacing;
    const tickLength = bounds.spanXY * 0.015;
    const tickPositions = [];
    for (
      let elevation = elevationMin;
      elevation <= elevationMax + 0.001;
      elevation += elevationTickSpacing
    ) {
      const z = exaggerateZ(elevation, bounds.cz, this.state.zExag);
      tickPositions.push(
        xMinGrid, yMaxGrid, z,
        xMinGrid - tickLength, yMaxGrid + tickLength, z,
      );
    }
    const tickLines = createLineSegments(THREE, tickPositions, tickMaterial);
    if (tickLines) this.elevationLinesGroup.add(tickLines);
    this.scene.add(this.elevationLinesGroup);

    this.gridLabelsGroup = new THREE.Group();
    this.gridLabelsGroup.name = 'GridLabels';
    for (let x = xMinGrid; x <= xMaxGrid + 0.001; x += majorStep) {
      const element = this.document.createElement('div');
      element.className = 'grid-label grid-label-easting';
      element.textContent = `E ${x.toFixed(0)}`;
      const label = new this.CSS2DObject(element);
      label.position.set(x, yMinGrid - spacing * 0.3, gridZ);
      this.gridLabelsGroup.add(label);
    }
    for (let y = yMinGrid; y <= yMaxGrid + 0.001; y += majorStep) {
      const element = this.document.createElement('div');
      element.className = 'grid-label grid-label-northing';
      element.textContent = `N ${y.toFixed(0)}`;
      const label = new this.CSS2DObject(element);
      label.position.set(xMinGrid - spacing * 0.3, y, gridZ);
      this.gridLabelsGroup.add(label);
    }
    for (
      let elevation = elevationMin;
      elevation <= elevationMax + 0.001;
      elevation += elevationTickSpacing
    ) {
      const z = exaggerateZ(elevation, bounds.cz, this.state.zExag);
      const element = this.document.createElement('div');
      element.className = 'grid-label grid-label-elevation';
      element.textContent = `EL ${elevation.toFixed(0)} m`;
      const label = new this.CSS2DObject(element);
      label.position.set(
        xMinGrid - tickLength * 1.2,
        yMaxGrid + tickLength * 1.2,
        z,
      );
      this.gridLabelsGroup.add(label);
    }
    this.scene.add(this.gridLabelsGroup);
  }

  _rebuildMonitoring() {
    this.counters.monitoringRebuilds += 1;
    const points = this.state.monitoring;
    if (!points?.length) {
      if (this.monitoringBatch) {
        this.monitorGroup.remove(this.monitoringBatch.group);
        this.monitoringBatch.dispose();
        this.monitoringBatch = null;
      }
      this._markShadowsDirty();
      return;
    }
    const settings = {
      scaleH: this.state.scaleH,
      scaleV: this.state.scaleV,
      zCenter: this.zCenter,
      zExag: this.state.zExag,
      showH: this.state.showH,
      showV: this.state.showV,
      showLabels: this.state.showLabels,
    };
    if (this.monitoringBatch) {
      this.monitoringBatch.update({ points, settings });
    } else {
      this.monitoringBatch = createMonitoringBatch({
        THREE: this.THREE,
        CSS2DObject: this.CSS2DObject,
        documentRef: this.document,
        points,
        settings,
      });
      this.monitorGroup.add(this.monitoringBatch.group);
    }
    this._markShadowsDirty();
  }

  _updateFrustumAndShadows() {
    if (!this.bounds) return;
    const bounds = this.bounds;
    const zCenter = exaggerateZ(bounds.cz, bounds.cz, this.state.zExag);
    const zMin = exaggerateZ(bounds.minZ, bounds.cz, this.state.zExag);
    const zMax = exaggerateZ(bounds.maxZ, bounds.cz, this.state.zExag);
    const zSpan = zMax - zMin;
    const distance = Math.max(bounds.spanXY * 1.5, zSpan * 2, 100);
    this.camera.near = Math.max(0.1, distance * 0.001);
    this.camera.far = Math.max(10000, distance * 10);
    this.camera.updateProjectionMatrix();
    const shadowDistance = distance * 1.2;
    this.dirLight.shadow.camera.left = -shadowDistance;
    this.dirLight.shadow.camera.right = shadowDistance;
    this.dirLight.shadow.camera.top = shadowDistance;
    this.dirLight.shadow.camera.bottom = -shadowDistance;
    this.dirLight.shadow.camera.updateProjectionMatrix();
    this._markShadowsDirty();
    this._rebuildHelpers(
      bounds.spanXY,
      new this.THREE.Vector3(bounds.cx, bounds.cy, zCenter),
      bounds,
    );
  }

  _updateDebugInfo() {
    if (!this.debugElement) return;
    if (!this.bounds) {
      this.debugElement.textContent = 'Menunggu data...';
      return;
    }
    const bounds = this.bounds;
    this.debugElement.innerHTML = `BBox: ${bounds.minX.toFixed(0)},${bounds.minY.toFixed(0)},${bounds.minZ.toFixed(0)}<br>→ ${bounds.maxX.toFixed(0)},${bounds.maxY.toFixed(0)},${bounds.maxZ.toFixed(0)}<br>Span: ${bounds.spanXY.toFixed(0)}m<br>Cam: ${this.camera.position.x.toFixed(0)},${this.camera.position.y.toFixed(0)},${this.camera.position.z.toFixed(0)}<br>Target: ${this.controls.target.x.toFixed(0)},${this.controls.target.y.toFixed(0)},${this.controls.target.z.toFixed(0)}`;
  }

  setMesh(mesh) {
    this.state.mesh = mesh;
    if (!mesh) {
      if (this.terrain) {
        this.topoGroup.remove(this.terrain);
        this._disposeObjectTree(this.terrain);
        this.terrain = null;
      }
      this.bounds = null;
      this._rebuildHelpers();
      this._markShadowsDirty();
      this.scheduler.invalidate('mesh-clear');
      return;
    }
    this.bounds = this._computeBounds(mesh);
    this.zCenter = (this.bounds.minZ + this.bounds.maxZ) / 2;
    this._replaceTerrainGeometry();
    this._rebuildMonitoring();
    this._updateFrustumAndShadows();
    this._updateDebugInfo();
    this.scheduler.invalidate('mesh');
  }

  setMonitoring(points) {
    this.state.monitoring = points;
    this._rebuildMonitoring();
    this.scheduler.invalidate('monitoring');
  }

  setTerrainOpacity(value) {
    this.state.opacity = value;
    if (this.terrain && !this.state.wireframe) {
      this.terrain.material.opacity = value;
    }
    this.scheduler.invalidate('opacity');
  }

  setTerrainVisible(value) {
    this.state.showTopo = value;
    if (this.terrain) this.terrain.visible = value;
    this._markShadowsDirty();
    this.scheduler.invalidate('terrain-visible');
  }

  setSolidColor(value) {
    this.state.dxfSolidColor = value;
    if (this.terrain && !this.state.colorByElev && !this.state.wireframe) {
      this.terrain.material.color.set(value);
    }
    this.scheduler.invalidate('solid-color');
  }

  setWireframe(value) {
    if (this.state.wireframe === value) return;
    this.state.wireframe = value;
    this._replaceTerrainMaterial();
    this.scheduler.invalidate('wireframe');
  }

  setMeshStyle(next) {
    const geometryChanged = (
      ('faceted' in next && next.faceted !== this.state.faceted)
      || ('colorByElev' in next && next.colorByElev !== this.state.colorByElev)
    );
    Object.assign(this.state, next);
    if (geometryChanged && this.state.mesh) this._replaceTerrainGeometry();
    if (geometryChanged) this._replaceTerrainMaterial();
    this.scheduler.invalidate('mesh-style');
  }

  setZExaggeration(value) {
    const previous = this.state.zExag;
    if (previous === value) return;
    if (this.state.mesh && Number.isFinite(this.zCenter) && previous > 0) {
      const cameraRawZ = (this.camera.position.z - this.zCenter) / previous
        + this.zCenter;
      this.camera.position.z = (cameraRawZ - this.zCenter) * value
        + this.zCenter;
      const targetRawZ = (this.controls.target.z - this.zCenter) / previous
        + this.zCenter;
      this.controls.target.z = (targetRawZ - this.zCenter) * value
        + this.zCenter;
      this.controls.update();
    }
    this.state.zExag = value;
    if (this.state.mesh) this._replaceTerrainGeometry();
    this._rebuildMonitoring();
    this._updateFrustumAndShadows();
    this._updateDebugInfo();
    this.scheduler.invalidate('z-exaggeration');
  }

  setMonitoringOptions(next) {
    Object.assign(this.state, next);
    this._rebuildMonitoring();
    this.scheduler.invalidate('monitoring-options');
  }

  setGridOptions(next) {
    Object.assign(this.state, next);
    this._rebuildHelpers();
    this.scheduler.invalidate('grid');
  }

  setPresetView(viewName) {
    if (!this.bounds) return;
    const { THREE } = this;
    const bounds = this.bounds;
    const zCenter = exaggerateZ(bounds.cz, bounds.cz, this.state.zExag);
    const zMax = exaggerateZ(bounds.maxZ, bounds.cz, this.state.zExag);
    const zMin = exaggerateZ(bounds.minZ, bounds.cz, this.state.zExag);
    const zSpan = zMax - zMin;
    const fov = this.camera.fov * (Math.PI / 180);
    const distanceXY = bounds.spanXY / (2 * Math.tan(fov / 2)) * 1.4;
    const distanceZ = zSpan / (2 * Math.tan(fov / 2)) * 1.4;
    const target = new THREE.Vector3(bounds.cx, bounds.cy, zCenter);
    let cameraPosition;
    let up;
    switch (viewName) {
      case 'plan':
        cameraPosition = new THREE.Vector3(bounds.cx, bounds.cy, zMax + distanceXY);
        up = new THREE.Vector3(0, 1, 0);
        break;
      case 'front':
        cameraPosition = new THREE.Vector3(
          bounds.cx,
          bounds.cy - distanceXY,
          zCenter + zSpan * 0.3,
        );
        up = new THREE.Vector3(0, 0, 1);
        break;
      case 'side':
        cameraPosition = new THREE.Vector3(
          bounds.cx + distanceXY,
          bounds.cy,
          zCenter + zSpan * 0.3,
        );
        up = new THREE.Vector3(0, 0, 1);
        break;
      case 'iso':
      default: {
        const distance = Math.max(
          distanceXY,
          distanceZ * 2,
          bounds.spanXY * 1.2,
        );
        cameraPosition = new THREE.Vector3(
          bounds.cx - distance * 0.6,
          bounds.cy - distance * 0.8,
          zCenter + distance * 0.4,
        );
        up = new THREE.Vector3(0, 0, 1);
        break;
      }
    }
    this.camera.position.copy(cameraPosition);
    this.controls.target.copy(target);
    this.camera.up.copy(up);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.state.currentView = viewName;
    this.document.querySelectorAll('.view-buttons button').forEach((button) => {
      button.classList.remove('active-view');
      button.classList.add('secondary');
    });
    const activeButton = this.document.getElementById(`view-${viewName}`);
    if (activeButton) {
      activeButton.classList.remove('secondary');
      activeButton.classList.add('active-view');
    }
    this._updateDebugInfo();
    this.scheduler.invalidate('preset-view');
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
    this.scheduler.invalidate('resize');
  }

  updateControls() {
    return this.controls.update();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    this.counters.renders += 1;
    this._updateDebugInfo();
  }

  getDiagnostics() {
    let objectCount = 0;
    this.scene.traverse(() => { objectCount += 1; });
    return {
      ...this.counters,
      pendingFrames: this.scheduler.pendingFrameCount?.() || 0,
      drawCalls: this.renderer.info?.render?.calls || 0,
      objectCount,
      monitoringDrawObjects: this.monitoringBatch?.drawObjectCount || 0,
      shadowAutoUpdate: this.renderer.shadowMap?.autoUpdate,
      shadowNeedsUpdate: this.renderer.shadowMap?.needsUpdate,
    };
  }

  debugHandles() {
    return {
      scene: this.scene,
      camera: this.camera,
      controls: this.controls,
      terrain: this.terrain,
      monitoring: this.monitorGroup,
      monitoringBatch: this.monitoringBatch,
      grid: this.gridHelper,
      renderer: this.renderer,
      labelRenderer: this.labelRenderer,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.window.removeEventListener('keydown', this._onKeyDown);
    this.window.removeEventListener('keyup', this._onKeyUp);
    this.window.removeEventListener('blur', this._onBlur);
    this.controls.removeEventListener?.('change', this._onControlsChange);
    this.controls.dispose?.();
    if (this.terrain) {
      this.topoGroup.remove(this.terrain);
      this._disposeObjectTree(this.terrain);
      this.terrain = null;
    }
    if (this.monitoringBatch) {
      this.monitorGroup.remove(this.monitoringBatch.group);
      this.monitoringBatch.dispose();
      this.monitoringBatch = null;
    }
    this._removeHelper('gridHelper');
    this._removeHelper('axesHelper');
    this._removeHelper('gridLabelsGroup');
    this._removeHelper('elevationLinesGroup');
    this.renderer.dispose?.();
    this.labelRenderer.dispose?.();
    for (const element of [
      this.renderer.domElement,
      this.labelRenderer.domElement,
    ]) {
      if (element?.parentNode === this.container) this.container.removeChild(element);
    }
    this.scheduler.dispose?.();
  }
}
