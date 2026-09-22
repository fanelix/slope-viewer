import { createHash } from 'node:crypto';

export function geometryDigest(mesh) {
  const hash = createHash('sha256');

  for (const [array, bytes] of [
    [mesh.x, 8],
    [mesh.y, 8],
    [mesh.z, 8],
    [mesh.i, 4],
    [mesh.j, 4],
    [mesh.k, 4],
  ]) {
    const buffer = Buffer.allocUnsafe(array.length * bytes);
    const view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );

    for (let index = 0; index < array.length; index += 1) {
      if (bytes === 8) {
        view.setFloat64(index * bytes, Number(array[index]), true);
      } else {
        view.setUint32(index * bytes, Number(array[index]), true);
      }
    }
    hash.update(buffer);
  }

  return hash.digest('hex');
}
