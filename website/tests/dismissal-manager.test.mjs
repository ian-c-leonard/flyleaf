import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
// Transform only TypeScript syntax (including the existing parameter property).
// Tests execute the actual unchanged source, not a copied predicate.
const source = await readFile(
  new URL('../app/lib/dismissal.ts', import.meta.url),
  'utf8',
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { dismissalManager } = await import(
  'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64')
);

// Synthetic adapter exercises the real manager's gesture/unmount/listener
// lifecycle. Native touch is checked separately; this is not browser acceptance.
function fixture(options = {}) {
  const callbacks = new Map();
  const frames = [];
  const reasons = [];
  let active = null;
  const element = (left, top, width, height) => ({
    isConnected: true,
    getClientRects: () => [
      { left, top, width, height, right: left + width, bottom: top + height },
    ],
    contains: (other) => other === panel,
    matches: (selector) => selector === 'dialog:modal' && !!options.modal,
    closest: () => null,
    focus: () => {
      active = opener;
    },
  });
  const opener = element(10, 10, 100, 50);
  const panel = element(100, 100, 200, 200);
  const outside = {};
  const doc = {
    documentElement: { clientWidth: 390, clientHeight: 844 },
    body: {},
    get activeElement() {
      return active;
    },
    querySelector: (selector) => {
      // Safari before :open support rejects the selector outright.
      if (options.noOpenSelector && selector.includes(':open'))
        throw new SyntaxError(`'${selector}' is not a valid selector.`);
      return null;
    },
    addEventListener(type, listener) {
      if (!callbacks.has(type)) callbacks.set(type, new Set());
      callbacks.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      callbacks.get(type)?.delete(listener);
    },
    defaultView: {
      requestAnimationFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame: () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      getComputedStyle: () => ({ visibility: 'visible' }),
    },
  };
  const manager = dismissalManager(doc);
  const unregister = manager.register({
    id: Symbol('fixture'),
    root: () => panel,
    inside: () => [panel],
    trigger: () => opener,
    ...options,
    onDismiss: (reason) => {
      reasons.push(reason);
      panel.isConnected = false;
      unregister();
    },
  });
  const emit = (type, fields = {}) => {
    const event = {
      target: outside,
      clientX: 50,
      clientY: 417,
      pageX: 50,
      pageY: 1523,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      timeStamp: 100,
      detail: type === 'click' || type === 'mousedown' ? 1 : 0,
      defaultPrevented: false,
      stopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
      ...fields,
    };
    for (const callback of callbacks.get(type) || []) callback(event);
    return event;
  };
  const dismissTouch = (fields = {}) => {
    emit('pointerdown', fields);
    return emit('pointerup', fields);
  };
  return {
    emit,
    dismissTouch,
    reasons,
    doc,
    opener,
    flushFocus: () => frames.splice(0).forEach((callback) => callback()),
  };
}
void test('collapsing touch consumes shifted compatibility mouse while the touch sequence remains pending', () => {
  const f = fixture({ consumeOutside: true });
  assert.equal(f.dismissTouch().defaultPrevented, true);
  const mouse = f.emit('mousedown', { clientY: 659, timeStamp: 102 });
  const click = f.emit('click', { clientY: 659, timeStamp: 102 });
  assert.equal(mouse.defaultPrevented, true);
  assert.equal(mouse.stopped, true);
  assert.equal(click.defaultPrevented, true);
  assert.deepEqual(f.reasons, ['outside']);
  f.flushFocus();
  assert.equal(f.doc.activeElement, f.opener);
});
void test('original client-point compatibility remains consumed for modal and narrow nonmodal layers', () => {
  for (const options of [{ modal: true }, { consumeOutside: true }]) {
    const f = fixture(options);
    f.dismissTouch();
    assert.equal(
      f.emit('mousedown', { pageY: 1281, timeStamp: 102 }).defaultPrevented,
      true,
    );
    assert.equal(
      f.emit('click', { pageY: 1281, timeStamp: 102 }).defaultPrevented,
      true,
    );
  }
});
void test('retargeted compatibility events with both coordinate systems shifted remain the same consumed touch', () => {
  const f = fixture({ consumeOutside: true });
  f.dismissTouch({ clientX: 160, clientY: 329, pageX: 160, pageY: 3875 });
  const retargeted = {
    clientX: 151,
    clientY: 523,
    pageX: 151,
    pageY: 3866,
    timeStamp: 104,
  };
  assert.equal(f.emit('mousedown', retargeted).defaultPrevented, true);
  assert.equal(f.emit('click', retargeted).defaultPrevented, true);
});
void test('expired touch token cannot consume compatibility events', () => {
  const f = fixture({ consumeOutside: true });
  f.dismissTouch();
  assert.equal(f.emit('mousedown', { timeStamp: 600 }).defaultPrevented, false);
  assert.equal(f.emit('click', { timeStamp: 600 }).defaultPrevented, false);
});
void test('mouse-origin dismissal still requires the original client point', () => {
  const f = fixture({ consumeOutside: true });
  f.dismissTouch({ pointerType: 'mouse' });
  assert.equal(
    f.emit('mousedown', { clientY: 659, timeStamp: 102 }).defaultPrevented,
    false,
  );
  assert.equal(
    f.emit('click', { clientY: 659, timeStamp: 102 }).defaultPrevented,
    false,
  );
});
void test('mouse-origin dismissal still consumes the original client-point compatibility click', () => {
  const f = fixture({ consumeOutside: true });
  f.dismissTouch({ pointerType: 'mouse' });
  assert.equal(
    f.emit('mousedown', { pageY: 1281, timeStamp: 102 }).defaultPrevented,
    true,
  );
  assert.equal(
    f.emit('click', { pageY: 1281, timeStamp: 102 }).defaultPrevented,
    true,
  );
});
void test('keyboard activation and a new same-point pointer remain independent', () => {
  const keyboard = fixture({ consumeOutside: true });
  keyboard.dismissTouch();
  assert.equal(
    keyboard.emit('click', { detail: 0, timeStamp: 102 }).defaultPrevented,
    false,
  );
  const fresh = fixture({ consumeOutside: true });
  fresh.dismissTouch();
  fresh.emit('pointerdown', { timeStamp: 102 });
  fresh.emit('pointerup', { timeStamp: 103 });
  assert.equal(
    fresh.emit('mousedown', { timeStamp: 103 }).defaultPrevented,
    false,
  );
  assert.equal(fresh.emit('click', { timeStamp: 103 }).defaultPrevented, false);
});
void test('drag and pointercancel never create a dismissal or suppression token', () => {
  for (const type of ['pointermove', 'pointercancel']) {
    const f = fixture({ consumeOutside: true });
    f.emit('pointerdown');
    f.emit(type, { clientY: 437 });
    f.emit('pointerup');
    assert.deepEqual(f.reasons, []);
    assert.equal(f.emit('click', { timeStamp: 102 }).defaultPrevented, false);
  }
});
void test('ordinary nonmodal outside still dismisses and allows native activation', () => {
  const f = fixture({ consumeOutside: false });
  assert.equal(f.dismissTouch().defaultPrevented, false);
  assert.equal(f.emit('mousedown', { timeStamp: 102 }).defaultPrevented, false);
  assert.equal(f.emit('click', { timeStamp: 102 }).defaultPrevented, false);
  assert.deepEqual(f.reasons, ['outside']);
});

void test('a browser without the :open selector can open and dismiss layers', () => {
  const view = fixture({ noOpenSelector: true });
  assert.doesNotThrow(() => view.flushFocus());
  view.emit('keydown', {
    key: 'Escape',
    repeat: false,
    isComposing: false,
    stopPropagation() {},
  });
  assert.deepEqual(view.reasons, ['escape']);
});
