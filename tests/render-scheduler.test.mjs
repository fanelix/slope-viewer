import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

import { createRenderScheduler } from '../src/render-scheduler.js';

class FakeAnimationClock {
  constructor() {
    this.nextId = 1;
    this.frames = new Map();
    this.cancelled = [];
  }

  requestFrame = (callback) => {
    const id = this.nextId;
    this.nextId += 1;
    this.frames.set(id, callback);
    return id;
  };

  cancelFrame = (id) => {
    this.cancelled.push(id);
    this.frames.delete(id);
  };

  flushOne() {
    const entry = this.frames.entries().next().value;
    if (!entry) return false;
    const [id, callback] = entry;
    this.frames.delete(id);
    callback(id * 16);
    return true;
  }

  flushAll(limit = 100) {
    let count = 0;
    while (this.flushOne()) {
      count += 1;
      if (count > limit) throw new Error('Scheduler did not become idle');
    }
    return count;
  }

  pendingCount() {
    return this.frames.size;
  }
}

function makeScheduler({ hidden = false, updateControls = () => false } = {}) {
  const clock = new FakeAnimationClock();
  const render = mock.fn();
  let documentHidden = hidden;
  const scheduler = createRenderScheduler({
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    isHidden: () => documentHidden,
    updateControls,
    render,
  });
  return {
    clock,
    render,
    scheduler,
    setDocumentHidden(value) { documentHidden = value; },
  };
}

test('stable scene renders once and schedules no idle frames', () => {
  const { clock, render, scheduler } = makeScheduler();

  scheduler.invalidate('initial');
  clock.flushOne();

  assert.equal(render.mock.callCount(), 1);
  assert.equal(clock.pendingCount(), 0);
  assert.equal(scheduler.pendingFrameCount(), 0);
});

test('damping continues only while controls report movement', () => {
  const movement = [true, true, false];
  const { clock, render, scheduler } = makeScheduler({
    updateControls: () => movement.shift(),
  });

  scheduler.invalidate('controls');
  clock.flushAll();

  assert.equal(render.mock.callCount(), 3);
  assert.equal(clock.pendingCount(), 0);
});

test('rapid invalidations coalesce into one pending frame', () => {
  const { clock, render, scheduler } = makeScheduler();

  for (let index = 0; index < 100; index += 1) {
    scheduler.invalidate(`change-${index}`);
  }

  assert.equal(clock.pendingCount(), 1);
  assert.equal(scheduler.pendingFrameCount(), 1);
  clock.flushAll();
  assert.equal(render.mock.callCount(), 1);
});

test('hide cancels a pending frame and show schedules one fresh frame', () => {
  const fixture = makeScheduler();
  fixture.scheduler.invalidate('before-hide');
  assert.equal(fixture.clock.pendingCount(), 1);

  fixture.setDocumentHidden(true);
  fixture.scheduler.setVisible(false);
  assert.equal(fixture.clock.pendingCount(), 0);
  assert.deepEqual(fixture.clock.cancelled, [1]);

  fixture.scheduler.invalidate('hidden-change');
  assert.equal(fixture.clock.pendingCount(), 0);

  fixture.setDocumentHidden(false);
  fixture.scheduler.setVisible(true);
  assert.equal(fixture.clock.pendingCount(), 1);
  fixture.clock.flushAll();
  assert.equal(fixture.render.mock.callCount(), 1);
});

test('dispose cancels work and ignores future invalidations', () => {
  const { clock, render, scheduler } = makeScheduler();
  scheduler.invalidate('pending');

  scheduler.dispose();
  scheduler.invalidate('after-dispose');
  scheduler.setVisible(true);

  assert.equal(clock.pendingCount(), 0);
  assert.deepEqual(clock.cancelled, [1]);
  assert.equal(render.mock.callCount(), 0);
  assert.equal(scheduler.pendingFrameCount(), 0);
});

test('invalidation during render requests exactly one follow-up frame', () => {
  const clock = new FakeAnimationClock();
  let scheduler;
  let renders = 0;
  scheduler = createRenderScheduler({
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    isHidden: () => false,
    updateControls: () => false,
    render: () => {
      renders += 1;
      if (renders === 1) {
        scheduler.invalidate('render-side-effect');
        scheduler.invalidate('duplicate-side-effect');
      }
    },
  });

  scheduler.invalidate('initial');
  assert.equal(clock.flushAll(), 2);
  assert.equal(renders, 2);
});
