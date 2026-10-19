import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BookMapHistory,
  type MapHistoryPort,
} from '../app/lib/book-map-history.ts';

function fixture() {
  let index = 1;
  const entries = [
    { state: { bookAnchor: 'earlier', scroll: 15 }, url: '#earlier' },
    { state: { bookAnchor: 'reading', scroll: 200 }, url: '#reading' },
  ];
  let callback = () => {};
  const deferred: (() => void)[] = [];
  const observed: string[] = [];
  let backs = 0;
  let listens = 0;
  let modal = true;
  const port: MapHistoryPort = {
    history: {
      get state() {
        return entries[index].state;
      },
      pushState(state, _unused, url) {
        entries.splice(++index, Infinity, { state, url: String(url) });
      },
      back() {
        backs++;
      },
    },
    url: () => entries[index].url,
    snapshot: () => {
      entries[index].state.scroll = 345;
    },
    modal: () => modal,
    listen: (listener) => {
      callback = listener;
      listens++;
      return () => {
        listens--;
        callback = () => {};
      };
    },
    defer: (action) => deferred.push(action),
  };
  const controller = new BookMapHistory(
    port,
    () => observed.push('dismiss through manager'),
    () => observed.push('open on Forward'),
  );
  return {
    controller,
    entries,
    observed,
    setModal(value: boolean) {
      modal = value;
    },
    get index() {
      return index;
    },
    get backs() {
      return backs;
    },
    get listens() {
      return listens;
    },
    backCompletes() {
      index--;
      callback();
    },
    forwardCompletes() {
      index++;
      callback();
    },
    flush() {
      deferred.splice(0).forEach((action) => action());
    },
    navigate() {
      port.history.pushState(
        { bookAnchor: 'destination', scroll: 0 },
        '',
        '#destination',
      );
    },
  };
}

await test('Map adds one same-URL entry and Back dismisses before earlier reading history', () => {
  const f = fixture();
  f.controller.open();
  f.controller.open();
  assert.equal(f.entries.length, 3);
  assert.equal(f.entries[2].url, '#reading');
  assert.equal(f.entries[1].state.scroll, 345);
  assert.equal(f.entries[2].state.scroll, 345);
  f.backCompletes();
  assert.equal(f.index, 1);
  assert.equal(f.entries[f.index].state.bookAnchor, 'reading');
  assert.deepEqual(f.observed, ['dismiss through manager']);
  f.controller.dispose();
  assert.equal(f.listens, 0);
});

await test('explicit close removes the boundary before a requested Read or place route', () => {
  const f = fixture();
  f.controller.open();
  f.controller.close(() => {
    f.observed.push('navigate');
    f.navigate();
  });
  f.controller.close(); // rerender of the now-closed surface
  assert.equal(f.backs, 1);
  assert.deepEqual(f.observed, []);
  f.backCompletes();
  assert.equal(f.index, 1);
  assert.deepEqual(f.observed, []);
  f.flush();
  assert.deepEqual(f.observed, ['navigate']);
  assert.deepEqual(
    f.entries.map((entry) => entry.url),
    ['#earlier', '#reading', '#destination'],
  );
  f.backCompletes();
  assert.equal(f.index, 1);
  assert.equal(f.entries[f.index].url, '#reading');
  f.controller.dispose();
});

await test('Back then Forward reopens the same map entry, without adding another entry', () => {
  const f = fixture();
  f.controller.open();
  f.backCompletes();
  f.forwardCompletes();
  f.controller.open(); // React's open effect must be idempotent after Forward
  assert.equal(f.entries.length, 3);
  assert.deepEqual(f.observed, ['dismiss through manager', 'open on Forward']);
  f.controller.close();
  f.backCompletes();
  f.controller.dispose();
});

await test('closing for a permanent wide column does not issue another surface dismissal', () => {
  const f = fixture();
  f.controller.open();
  f.controller.close();
  f.backCompletes();
  assert.deepEqual(f.observed, []);
  assert.equal(f.backs, 1);
  f.controller.close();
  assert.equal(f.backs, 1);
  f.controller.dispose();
});

await test('a rapid reopen waits for removal instead of stacking a boundary on itself', () => {
  const f = fixture();
  f.controller.open();
  f.controller.close();
  f.controller.open();
  f.backCompletes();
  assert.equal(f.index, 2);
  assert.equal(f.entries.length, 3);
  assert.deepEqual(f.observed, []);
  f.controller.dispose();
  f.backCompletes();
  assert.equal(f.listens, 0);
});

await test('unmount removes only an owned current boundary and cancels deferred navigation', () => {
  const f = fixture();
  f.controller.open();
  f.controller.close(() => f.observed.push('stale navigation'));
  f.controller.dispose();
  assert.equal(f.backs, 1);
  f.backCompletes();
  f.flush();
  assert.deepEqual(f.observed, []);
  assert.equal(f.listens, 0);

  const moved = fixture();
  moved.controller.open();
  moved.navigate();
  moved.controller.dispose();
  assert.equal(moved.backs, 0);
  assert.equal(moved.index, 3);
  assert.equal(moved.listens, 0);
});

await test('unmount after Back but before the animation frame cancels the captured action', () => {
  const f = fixture();
  f.controller.open();
  f.controller.close(() => f.observed.push('stale navigation'));
  f.backCompletes(); // callback has already moved into the animation-frame queue
  f.controller.dispose();
  f.flush();
  assert.deepEqual(f.observed, []);
  assert.equal(f.listens, 0);
});

await test('Forward through an old phone entry cannot open or close a permanent wide map', () => {
  const f = fixture();
  f.controller.open();
  f.setModal(false);
  f.controller.close();
  f.backCompletes();
  f.forwardCompletes();
  f.backCompletes();
  assert.deepEqual(f.observed, []);
  assert.equal(f.entries[f.index].url, '#reading');
  f.controller.open();
  assert.equal(f.index, 1, 'wide mode cannot push a new phone boundary');
  f.setModal(true);
  f.controller.open();
  f.backCompletes();
  assert.deepEqual(f.observed, ['dismiss through manager']);
  f.controller.dispose();
});
