import '../../lib/dxf-parser.js';
import '../../lib/delaunator.min.js';

import { collectTransferables } from '../dxf-client.js';
import {
  buildMeshFromGeometry,
  parseDxfGeometry,
  validateMesh,
} from '../dxf-core.js';

self.onmessage = (event) => {
  const {
    id,
    operation,
    buffer,
    rawGeometry,
    settings,
  } = event.data;
  try {
    if (operation !== 'parse' && operation !== 'reprocess') {
      throw new Error(`Unsupported worker operation: ${operation}`);
    }

    self.postMessage({
      id,
      type: 'progress',
      stage: operation === 'parse' ? 'parse' : 'reprocess',
    });
    const raw = operation === 'parse'
      ? parseDxfGeometry(
          new TextDecoder().decode(buffer),
          { DxfParser: self.DxfParser },
        )
      : rawGeometry;
    const mesh = buildMeshFromGeometry(
      raw,
      settings,
      { Delaunator: self.Delaunator },
    );
    if (!validateMesh(mesh)) {
      throw new Error('Worker produced invalid mesh');
    }
    self.postMessage(
      { id, type: 'success', rawGeometry: raw, mesh },
      collectTransferables(raw, mesh),
    );
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      stage: operation,
      message: String(error?.message || error),
    });
  }
};
