export function createRenderScheduler({
  requestFrame,
  cancelFrame,
  isHidden,
  updateControls,
  render,
}) {
  let frameId = null;
  let disposed = false;

  function invalidate() {
    if (disposed || isHidden() || frameId !== null) return;
    frameId = requestFrame(tick);
  }

  function tick() {
    frameId = null;
    if (disposed || isHidden()) return;
    const moving = updateControls();
    render();
    if (moving) invalidate('damping');
  }

  return {
    invalidate,

    setVisible(visible) {
      if (!visible) {
        if (frameId !== null) cancelFrame(frameId);
        frameId = null;
        return;
      }
      invalidate('visible');
    },

    pendingFrameCount() {
      return frameId === null ? 0 : 1;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
    },
  };
}
