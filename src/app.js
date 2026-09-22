import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CSS2DObject,
  CSS2DRenderer,
} from 'three/addons/renderers/CSS2DRenderer.js';

import {
  AUTO_LOAD_PATHS,
  DEFAULT_STATE,
  DXF_COLOR_PRESETS,
} from './config.js';
import {
  buildMeshFromGeometry,
  parseDxfGeometry,
  validateMesh,
} from './dxf-core.js';
import { createDxfClient } from './dxf-client.js';
import { createDataLoader } from './data-loader.js';
import { parseMonitoringCsv } from './monitoring-core.js';
import { createRenderScheduler } from './render-scheduler.js';
import { SceneController } from './scene-controller.js';

const state = {
  ...DEFAULT_STATE,
  mesh: null,
  monitoring: null,
  rawGeometry: null,
  dataSource: 'none',
};
let dxfFile = null;
let csvFile = null;
let sceneController;

const container = document.getElementById('canvas-container');
const scheduler = createRenderScheduler({
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  isHidden: () => document.hidden,
  updateControls: () => sceneController?.updateControls() || false,
  render: () => sceneController?.render(),
});
sceneController = new SceneController({
  THREE,
  OrbitControls,
  CSS2DRenderer,
  CSS2DObject,
  container,
  debugElement: document.getElementById('debug-info'),
  scheduler,
});

const dxfClient = createDxfClient({
  syncParser(payload, settings, operation) {
    const rawGeometry = operation === 'parse'
      ? parseDxfGeometry(new TextDecoder().decode(payload), {
          DxfParser: window.DxfParser,
        })
      : payload;
    const mesh = buildMeshFromGeometry(rawGeometry, settings, {
      Delaunator: window.Delaunator,
    });
    if (!validateMesh(mesh)) throw new Error('Parser sinkron menghasilkan mesh tidak valid');
    return { rawGeometry, mesh };
  },
  onProgress(progress) {
    if (progress.stage === 'parse') setStatus('Parsing DXF di worker...');
    if (progress.stage === 'reprocess') setStatus('Re-processing mesh...');
    if (progress.stage === 'sync-fallback') {
      setStatus('Mode kompatibilitas: parsing di browser...');
    }
  },
});
const dataLoader = createDataLoader({ dxfClient });

const LOADING = document.getElementById('loading');
const STATUS = document.getElementById('status');
const ERROR_CONTAINER = document.getElementById('error-container');
const MODE_INDICATOR = document.getElementById('mode-indicator');
const UPLOAD_SECTION = document.getElementById('upload-section');
const UPLOAD_TOGGLE = document.getElementById('upload-section-toggle');
const REPROCESS_BTN = document.getElementById('reprocess-btn');

function setStatus(message) {
  STATUS.textContent = message;
}

function clearError() {
  ERROR_CONTAINER.replaceChildren();
}

function showError(message) {
  const element = document.createElement('div');
  element.className = 'error';
  element.textContent = message;
  ERROR_CONTAINER.replaceChildren(element);
  LOADING.classList.add('hidden');
}

function setModeManual() {
  state.dataSource = 'none';
  MODE_INDICATOR.textContent = 'Manual';
  MODE_INDICATOR.className = '';
}

function setModeLoaded(source) {
  state.dataSource = source;
  if (source === 'auto') {
    MODE_INDICATOR.textContent = 'Auto';
    MODE_INDICATOR.className = 'auto';
    UPLOAD_SECTION.classList.add('section-collapsed');
    UPLOAD_TOGGLE.classList.add('collapsed');
  } else {
    MODE_INDICATOR.textContent = 'Manual';
    MODE_INDICATOR.className = '';
  }
}

function updateStats() {
  if (state.mesh) {
    document.getElementById('stat-vertices').textContent = (
      state.mesh.stats.vertexCount.toLocaleString()
    );
    document.getElementById('stat-triangles').textContent = (
      state.mesh.stats.validTriangles.toLocaleString()
    );
  }
  if (state.monitoring) {
    document.getElementById('stat-points').textContent = state.monitoring.length;
    let maximumDisplacement = 0;
    let dangerCount = 0;
    for (const point of state.monitoring) {
      if (point.dispTotal > maximumDisplacement) {
        maximumDisplacement = point.dispTotal;
      }
      if (point.category.name === 'Bahaya') dangerCount += 1;
    }
    document.getElementById('stat-max-disp').textContent = `${(
      maximumDisplacement * 1000
    ).toFixed(1)} mm`;
    document.getElementById('stat-bahaya').textContent = dangerCount;
  }
  document.getElementById('stat-source').textContent = state.dataSource === 'auto'
    ? 'Auto (repo)'
    : state.dataSource === 'manual'
      ? 'Upload'
      : '—';
}

function updateUIMode() {
  const meshControls = document.getElementById('controls-mesh-mode');
  const pointsControls = document.getElementById('controls-points-mode');
  const sourceInfo = document.getElementById('mesh-source-info');
  const sourceLabel = document.getElementById('mesh-source-label');
  if (!state.rawGeometry) {
    meshControls.style.display = 'none';
    pointsControls.style.display = 'none';
    sourceInfo.style.display = 'none';
    return;
  }
  sourceInfo.style.display = 'block';
  meshControls.style.display = 'block';
  if (state.rawGeometry.kind === 'mesh') {
    pointsControls.style.display = 'none';
    const mesh = state.rawGeometry.mesh;
    sourceLabel.replaceChildren();
    const title = document.createElement('b');
    title.textContent = 'Mode: Direct Mesh (3DFACE)';
    sourceLabel.append(
      title,
      document.createElement('br'),
      `${mesh.i.length.toLocaleString()} triangles, ${mesh.x.length.toLocaleString()} vertex`,
    );
  } else {
    pointsControls.style.display = 'block';
    const pointCount = state.rawGeometry.points.length / 3;
    sourceLabel.replaceChildren();
    const title = document.createElement('b');
    title.textContent = 'Mode: Point Cloud → Delaunay';
    sourceLabel.append(
      title,
      document.createElement('br'),
      `${pointCount.toLocaleString()} titik input`,
    );
  }
}

function applyDxfResult(result) {
  state.rawGeometry = result.rawGeometry;
  state.mesh = result.mesh;
  updateUIMode();
  sceneController.setMesh(result.mesh);
  REPROCESS_BTN.style.display = 'block';
}

function applyMonitoring(points) {
  state.monitoring = points;
  sceneController.setMonitoring(points);
}

function setPresetView(view) {
  state.currentView = view;
  sceneController.setPresetView(view);
}

async function fetchMonitoring(signal) {
  const response = await fetch(AUTO_LOAD_PATHS.csv, { signal });
  if (!response.ok) throw new Error(`CSV HTTP ${response.status}`);
  return parseMonitoringCsv(await response.text(), window.Papa);
}

async function tryAutoLoad() {
  LOADING.classList.remove('hidden');
  setStatus('Mencari data di repo...');
  const controller = new AbortController();
  try {
    const [monitoringResult, dxfResult] = await Promise.allSettled([
      fetchMonitoring(controller.signal),
      dataLoader.loadAutoData({ settings: state, signal: controller.signal }),
    ]);
    if (monitoringResult.status === 'fulfilled') {
      applyMonitoring(monitoringResult.value);
    } else {
      console.warn('Monitoring auto-load failed:', monitoringResult.reason);
    }
    if (dxfResult.status === 'fulfilled') {
      applyDxfResult(dxfResult.value);
    } else {
      console.warn('DXF auto-load failed:', dxfResult.reason);
    }
    if (
      monitoringResult.status !== 'fulfilled'
      && dxfResult.status !== 'fulfilled'
    ) {
      setModeManual();
      return false;
    }
    setModeLoaded('auto');
    updateStats();
    setPresetView('iso');
    return true;
  } catch (error) {
    console.warn('Auto-load failed:', error);
    setModeManual();
    return false;
  } finally {
    LOADING.classList.add('hidden');
  }
}

async function loadFilesManual() {
  clearError();
  LOADING.classList.remove('hidden');
  try {
    let monitoring = null;
    let dxfResult = null;
    if (csvFile) {
      setStatus('Membaca CSV...');
      monitoring = parseMonitoringCsv(await csvFile.text(), window.Papa);
    }
    if (dxfFile) {
      setStatus('Membaca DXF...');
      dxfResult = await dataLoader.loadManualDxf({
        buffer: await dxfFile.arrayBuffer(),
        settings: state,
      });
    }
    if (monitoring) applyMonitoring(monitoring);
    if (dxfResult) applyDxfResult(dxfResult);
    setModeLoaded('manual');
    updateStats();
    setPresetView('iso');
    LOADING.classList.add('hidden');
  } catch (error) {
    console.error(error);
    showError(`Error: ${error.message}`);
  }
}

async function reprocessMesh() {
  if (!state.rawGeometry) return;
  LOADING.classList.remove('hidden');
  setStatus('Re-processing mesh...');
  try {
    const result = await dxfClient.reprocess(state.rawGeometry, state);
    applyDxfResult(result);
    updateStats();
    LOADING.classList.add('hidden');
  } catch (error) {
    showError(`Error: ${error.message}`);
  }
}

function checkReady() {
  document.getElementById('load-btn').disabled = !(dxfFile || csvFile);
}

document.getElementById('dxf-input').addEventListener('change', (event) => {
  dxfFile = event.target.files[0] || null;
  checkReady();
});
document.getElementById('csv-input').addEventListener('change', (event) => {
  csvFile = event.target.files[0] || null;
  checkReady();
});
document.getElementById('load-btn').addEventListener('click', loadFilesManual);
REPROCESS_BTN.addEventListener('click', reprocessMesh);
document.getElementById('reset-cam-btn').addEventListener('click', () => {
  setPresetView(state.currentView);
});
for (const view of ['plan', 'front', 'side', 'iso']) {
  document.getElementById(`view-${view}`).addEventListener('click', () => {
    setPresetView(view);
  });
}

UPLOAD_TOGGLE.addEventListener('click', () => {
  UPLOAD_SECTION.classList.toggle('section-collapsed');
  UPLOAD_TOGGLE.classList.toggle('collapsed');
});

window.addEventListener('keydown', (event) => {
  if (event.target.tagName === 'INPUT') return;
  const view = { 1: 'plan', 2: 'front', 3: 'side', 4: 'iso' }[event.key];
  if (view) setPresetView(view);
});

const MESH_CONTROLS = new Set(['voxel', 'maxslope', 'edgemult', 'maxedge']);
function wireRange(id, valueId, key, suffix, transform) {
  const slider = document.getElementById(id);
  const valueElement = document.getElementById(valueId);
  slider.addEventListener('input', (event) => {
    const rawValue = Number(event.target.value);
    const value = transform ? transform(rawValue) : rawValue;
    state[key] = value;
    valueElement.textContent = `${rawValue}${suffix}`;
    if (id === 'opacity') sceneController.setTerrainOpacity(value);
    if (id === 'zexag') sceneController.setZExaggeration(value);
    if (id === 'scale-h') sceneController.setMonitoringOptions({ scaleH: value });
    if (id === 'scale-v') sceneController.setMonitoringOptions({ scaleV: value });
    if (!MESH_CONTROLS.has(id) && ![
      'opacity',
      'zexag',
      'scale-h',
      'scale-v',
    ].includes(id)) {
      scheduler.invalidate(`range-${id}`);
    }
  });
}
wireRange('opacity', 'opacity-val', 'opacity', '%', (value) => value / 100);
wireRange('zexag', 'zexag-val', 'zExag', '×');
wireRange('voxel', 'voxel-val', 'voxelSize', ' m');
wireRange('maxslope', 'maxslope-val', 'maxSlopeDeg', '°');
wireRange('edgemult', 'edgemult-val', 'edgeMultiplier', '×');
wireRange('scale-h', 'scale-h-val', 'scaleH', '×');
wireRange('scale-v', 'scale-v-val', 'scaleV', '×');

const maxEdgeSlider = document.getElementById('maxedge');
const maxEdgeValue = document.getElementById('maxedge-val');
maxEdgeSlider.addEventListener('input', (event) => {
  const value = Number(event.target.value);
  if (value >= 500) {
    state.maxEdgeLen = 1e9;
    maxEdgeValue.textContent = '∞ m';
  } else {
    state.maxEdgeLen = value;
    maxEdgeValue.textContent = `${value} m`;
  }
});
document.getElementById('edgemult').addEventListener('input', (event) => {
  document.getElementById('edgemult-val').textContent = `${Number(
    event.target.value,
  ).toFixed(1)}×`;
});

function wireToggle(id, key, handler) {
  document.getElementById(id).addEventListener('change', (event) => {
    state[key] = event.target.checked;
    handler?.(event.target.checked);
  });
}
wireToggle('show-topo', 'showTopo', (value) => {
  sceneController.setTerrainVisible(value);
});
wireToggle('faceted', 'faceted', (value) => {
  sceneController.setMeshStyle({ faceted: value });
});
wireToggle('preserve-edges', 'preserveEdges');
wireToggle('show-h', 'showH', (value) => {
  sceneController.setMonitoringOptions({ showH: value });
});
wireToggle('show-v', 'showV', (value) => {
  sceneController.setMonitoringOptions({ showV: value });
});
wireToggle('show-labels', 'showLabels', (value) => {
  sceneController.setMonitoringOptions({ showLabels: value });
});
wireToggle('wireframe', 'wireframe', (value) => {
  sceneController.setWireframe(value);
});
wireToggle('show-grid', 'showGrid', (value) => {
  sceneController.setGridOptions({ showGrid: value });
});

const dxfColorGroup = document.getElementById('dxf-color-group');
function updateColorPaletteEnabled() {
  dxfColorGroup.classList.toggle('disabled', state.colorByElev);
}
document.getElementById('color-by-elev').addEventListener('change', (event) => {
  state.colorByElev = event.target.checked;
  updateColorPaletteEnabled();
  sceneController.setMeshStyle({ colorByElev: state.colorByElev });
});

const paletteContainer = document.getElementById('dxf-color-palette');
const dxfColorName = document.getElementById('dxf-color-name');
for (const preset of DXF_COLOR_PRESETS) {
  const swatch = document.createElement('div');
  swatch.className = `color-swatch${
    preset.hex === state.dxfSolidColor ? ' selected' : ''
  }`;
  swatch.style.backgroundColor = preset.hex;
  swatch.title = `${preset.name} (${preset.hex})`;
  swatch.dataset.hex = preset.hex;
  swatch.dataset.name = preset.name;
  swatch.addEventListener('click', () => {
    state.dxfSolidColor = preset.hex;
    dxfColorName.textContent = preset.name;
    paletteContainer.querySelectorAll('.color-swatch').forEach((element) => {
      element.classList.remove('selected');
    });
    swatch.classList.add('selected');
    sceneController.setSolidColor(preset.hex);
  });
  paletteContainer.appendChild(swatch);
}
updateColorPaletteEnabled();
const initialPreset = DXF_COLOR_PRESETS.find((preset) => (
  preset.hex === state.dxfSolidColor
));
if (initialPreset) dxfColorName.textContent = initialPreset.name;

document.getElementById('grid-spacing').addEventListener('input', (event) => {
  const value = Number(event.target.value);
  state.gridSpacing = value;
  document.getElementById('grid-spacing-val').textContent = `${value} m`;
  sceneController.setGridOptions({ gridSpacing: value });
});

window.addEventListener('resize', () => sceneController.resize());
document.addEventListener('visibilitychange', () => {
  scheduler.setVisible(!document.hidden);
});
window.addEventListener('pagehide', () => {
  dxfClient.dispose();
  sceneController.dispose();
}, { once: true });

if (new URLSearchParams(location.search).has('test')) {
  window.__SLOPE_VIEWER_TEST_API__ = {
    diagnostics: () => sceneController.getDiagnostics(),
    handles: () => sceneController.debugHandles(),
    state: () => ({
      dataSource: state.dataSource,
      hasMesh: Boolean(state.mesh),
      hasMonitoring: Boolean(state.monitoring),
    }),
  };
}

scheduler.invalidate('initial');
tryAutoLoad();
