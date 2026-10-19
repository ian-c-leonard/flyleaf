import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useMediaQuery } from './useDismissible';

/** A gentle home-page carousel: random start, advance every few seconds,
 * pause while the reader is pointing at or working inside it, and never move
 * by itself for readers who ask for reduced motion. The reader can also
 * pause it for good with its pause button (`stopped`, `toggle`). Swipes and
 * sideways trackpad scrolls move it by hand. */
export function useCarousel(count: number, interval = 5000, active = true) {
  const [index, setIndex] = useState(0);
  const [restart, setRestart] = useState(0);
  const [stopped, setStopped] = useState(false);
  const paused = useRef(false);
  const swiped = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const lastWheel = useRef(0);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  // A new set of items starts somewhere different each time.
  useEffect(() => {
    setIndex(count > 1 ? Math.floor(Math.random() * count) : 0);
  }, [count]);
  useEffect(() => {
    // Off its page, a carousel stays still: each turn re-renders the site.
    if (!active || count < 2 || reduced || stopped) return;
    const id = window.setInterval(() => {
      if (!paused.current && !document.hidden) setIndex((i) => (i + 1) % count);
    }, interval);
    return () => window.clearInterval(id);
  }, [active, count, interval, reduced, stopped, restart]);
  const toggle = useCallback(() => setStopped((value) => !value), []);
  const go = useCallback(
    (n: number) => {
      if (count < 1) return;
      setIndex(((n % count) + count) % count);
      setRestart((r) => r + 1);
    },
    [count],
  );
  const step = useCallback(
    (by: number) => {
      if (count < 1) return;
      setIndex((i) => (((i + by) % count) + count) % count);
      setRestart((r) => r + 1);
    },
    [count],
  );
  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);
  const bind = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') paused.current = true;
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') paused.current = false;
    },
    onFocus: () => {
      paused.current = true;
    },
    onBlur: (e: React.FocusEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null))
        paused.current = false;
    },
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      touch.current = { x: t.clientX, y: t.clientY };
      // A swipe sends no click, so its mark must not outlive it and swallow
      // the next tap.
      swiped.current = false;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const start = touch.current;
      touch.current = null;
      if (!start || count < 2) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiped.current = true;
        step(dx < 0 ? 1 : -1);
      }
    },
    onClickCapture: (e: React.MouseEvent) => {
      // A swipe is not a tap on the photograph underneath it.
      if (swiped.current) {
        swiped.current = false;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onWheel: (e: React.WheelEvent) => {
      if (count < 2) return;
      if (Math.abs(e.deltaX) < 25 || Math.abs(e.deltaX) < Math.abs(e.deltaY))
        return;
      const now = Date.now();
      if (now - lastWheel.current < 600) return;
      lastWheel.current = now;
      step(e.deltaX > 0 ? 1 : -1);
    },
  };
  return {
    index: count ? index % count : 0,
    next,
    prev,
    go,
    bind,
    /** It moves by itself, so it needs a pause button. */
    moving: count > 1 && !reduced,
    stopped,
    toggle,
  };
}
