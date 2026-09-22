export const ALGORITHM_VERSION = 'dxf-v1';

export const AUTO_LOAD_PATHS = Object.freeze({
  manifest: 'data/assets-manifest.json',
  dxf: 'data/topografi.dxf',
  gzip: 'data/topografi.dxf.gz',
  csv: 'data/monitoring.csv',
});

export const DEFAULT_STATE = Object.freeze({
  opacity: 0.9,
  voxelSize: 2,
  showTopo: true,
  colorByElev: true,
  scaleH: 100,
  scaleV: 200,
  showH: true,
  showV: true,
  showLabels: false,
  zExag: 6,
  maxSlopeDeg: 90,
  maxEdgeLen: 1e9,
  edgeMultiplier: 4,
  faceted: true,
  preserveEdges: true,
  wireframe: false,
  showGrid: true,
  gridSpacing: 1000,
  dxfSolidColor: '#8B8B5E',
  currentView: 'iso',
});

export const COLUMN_ALIASES = Object.freeze({
  id: Object.freeze(['ID', 'ID_POINT', 'POINT_ID', 'NAME', 'NAMA']),
  e0: Object.freeze(['E_AWAL', 'EASTING_AWAL', 'E0', 'X_AWAL']),
  n0: Object.freeze(['N_AWAL', 'NORTHING_AWAL', 'N0', 'Y_AWAL']),
  z0: Object.freeze(['EL_AWAL', 'ELEV_AWAL', 'Z_AWAL', 'ELEVASI_AWAL']),
  e1: Object.freeze(['E_AKHIR', 'EASTING_AKHIR', 'E1', 'X_AKHIR']),
  n1: Object.freeze(['N_AKHIR', 'NORTHING_AKHIR', 'N1', 'Y_AKHIR']),
  z1: Object.freeze(['EL_AKHIR', 'ELEV_AKHIR', 'Z_AKHIR', 'ELEVASI_AKHIR']),
});

export const THRESHOLDS = Object.freeze([
  Object.freeze({ max: 0.005, name: 'Aman', color: '#2ecc71' }),
  Object.freeze({ max: 0.015, name: 'Waspada', color: '#f1c40f' }),
  Object.freeze({ max: Infinity, name: 'Bahaya', color: '#e74c3c' }),
]);

export const DXF_COLOR_PRESETS = Object.freeze([
  Object.freeze({ name: 'Olive', hex: '#8B8B5E' }),
  Object.freeze({ name: 'Brown', hex: '#8B5A2B' }),
  Object.freeze({ name: 'Grey', hex: '#808080' }),
  Object.freeze({ name: 'Tan', hex: '#D2B48C' }),
  Object.freeze({ name: 'Slate Blue', hex: '#4A6D8C' }),
  Object.freeze({ name: 'Forest Green', hex: '#2D5016' }),
  Object.freeze({ name: 'Steel', hex: '#4682B4' }),
  Object.freeze({ name: 'Red-Brown', hex: '#A0522D' }),
  Object.freeze({ name: 'Orange', hex: '#D68910' }),
  Object.freeze({ name: 'White', hex: '#E8E8E0' }),
]);
