/** One gesture closes one visible transient surface. Native dialogs keep their
 * own focus containment and platform cancel behavior. */
export type DismissReason = 'escape' | 'outside' | 'close';
export type DismissLayer = {
  id: symbol;
  root: () => HTMLElement | null;
  inside: () => (HTMLElement | null)[];
  trigger: () => HTMLElement | null;
  fallback?: () => HTMLElement | null;
  parent?: symbol | null;
  modal?: boolean;
  /** Narrow popovers consume an outside gesture without making the page inert. */
  consumeOutside?: boolean;
  onDismiss: (reason: DismissReason) => void;
};

type Gesture = {
  layer: DismissLayer;
  pointerId: number;
  x: number;
  y: number;
};
const managers = new WeakMap<Document, DismissalManager>();
export function dismissalManager(document: Document) {
  let manager = managers.get(document);
  if (!manager) {
    manager = new DismissalManager(document);
    managers.set(document, manager);
  }
  return manager;
}

class DismissalManager {
  private layers: DismissLayer[] = [];
  private gesture: Gesture | null = null;
  private consumedClick: {
    x: number;
    y: number;
    pointerType: string;
    at: number;
    modal: boolean;
  } | null = null;
  private cleanupTimer = 0;
  private pickerFrame = 0;
  private pickerOpen = false;
  private pickerEscape = false;
  private pickerSelector = true;
  constructor(private document: Document) {}

  register(layer: DismissLayer) {
    if (!this.layers.length) this.listen(true);
    this.layers.push(layer);
    return () => {
      this.layers = this.layers.filter((entry) => entry !== layer);
      if (this.gesture?.layer === layer) this.gesture = null;
      if (!this.layers.length) this.listen(false);
    };
  }

  private owns(parent: DismissLayer, child: DismissLayer): boolean {
    const root = parent.root(),
      target = child.root();
    if (root && target && root !== target && root.contains(target)) return true;
    const seen = new Set<symbol>();
    let owner = child.parent;
    while (owner && !seen.has(owner)) {
      if (owner === parent.id) return true;
      seen.add(owner);
      owner = this.layers.find((layer) => layer.id === owner)?.parent;
    }
    return false;
  }

  private top() {
    const visible = this.layers.filter((layer) => {
      const root = layer.root();
      return root?.isConnected && root.getClientRects().length;
    });
    // A native modal makes unrelated page panels inert, even if a responsive
    // rerender registered one of those panels more recently.
    const modal = visible
      .filter((layer) => layer.modal && layer.root()?.matches('dialog:modal'))
      .at(-1);
    const available = modal
      ? visible.filter((layer) => layer === modal || this.owns(modal, layer))
      : visible.filter((layer) => !layer.modal);
    return available
      .filter(
        (layer) =>
          !available.some(
            (other) => other !== layer && this.owns(layer, other),
          ),
      )
      .at(-1);
  }

  private inside(layer: DismissLayer, x: number, y: number) {
    // An opener behind a native modal is inert, not a hole in its backdrop.
    const boundaries = layer.modal
      ? layer.inside()
      : [...layer.inside(), layer.trigger()];
    return boundaries.some((element) => {
      if (!element?.isConnected) return false;
      return [...element.getClientRects()].some(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom,
      );
    });
  }

  dismiss(layer: DismissLayer, reason: DismissReason) {
    if (this.top() !== layer) return;
    this.gesture = null;
    const trigger = layer.trigger();
    layer.onDismiss(reason);
    if (reason === 'outside' && !layer.modal && !layer.consumeOutside) return;
    this.document.defaultView?.requestAnimationFrame(() => {
      // A replacement surface may have been opened by the callback. Never
      // move focus out of that new surface or into an inert ancestor.
      const remaining = this.top();
      const eligible = (
        element: HTMLElement | null | undefined,
      ): element is HTMLElement => {
        if (
          !element?.isConnected ||
          !element.getClientRects().length ||
          element === this.document.body ||
          element === this.document.documentElement ||
          element.closest('[inert]') ||
          element.matches(':disabled')
        )
          return false;
        const visibility =
          this.document.defaultView?.getComputedStyle(element).visibility;
        return visibility !== 'hidden' && visibility !== 'collapse';
      };
      for (const focus of [trigger, layer.fallback?.()]) {
        if (!eligible(focus)) continue;
        if (
          remaining &&
          !remaining.root()?.contains(focus) &&
          !remaining.inside().some((element) => element?.contains(focus))
        )
          continue;
        focus.focus({ preventScroll: true });
        // Visible text can still be non-focusable. Try the explicit fallback,
        // unless a focus handler just opened a different surface.
        if (
          this.document.activeElement === focus ||
          focus.contains(this.document.activeElement) ||
          this.top() !== remaining
        )
          return;
      }
    });
  }

  /** Browser Back can dismiss a known surface through the same focus policy. */
  dismissRoot(root: HTMLElement | null, reason: DismissReason = 'close') {
    const layer = this.layers.find((entry) => entry.root() === root);
    if (layer) this.dismiss(layer, reason);
  }

  cancel(id: symbol, event: Event) {
    event.preventDefault();
    if (this.pickerEscape) return;
    const owner = this.layers.find((layer) => layer.id === id);
    const top = this.top();
    if (owner && top && (owner === top || this.owns(owner, top)))
      this.dismiss(top, 'escape');
  }

  private down = (event: PointerEvent) => {
    // The prior pointerup can unmount the last modal before a click is emitted.
    // A new pointer sequence must never inherit its suppression token.
    this.consumedClick = null;
    if (!this.layers.length) this.listen(false);
    this.gesture = null;
    // WebKit can target HTML for its native scrollbar strip even when
    // clientWidth includes that strip. This is scrolling, not a backdrop tap.
    // Genuine native-dialog backdrop events are retargeted to the dialog.
    if (event.target === this.document.documentElement) return;
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      event.clientX >= this.document.documentElement.clientWidth ||
      event.clientY >= this.document.documentElement.clientHeight
    )
      return;
    const layer = this.top();
    if (layer && !this.inside(layer, event.clientX, event.clientY))
      this.gesture = {
        layer,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
  };
  private move = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (
      gesture &&
      (gesture.pointerId !== event.pointerId ||
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8)
    )
      this.gesture = null;
  };
  private cancelPointer = () => {
    this.gesture = null;
  };
  private up = (event: PointerEvent) => {
    const gesture = this.gesture;
    this.gesture = null;
    if (
      !gesture ||
      event.button !== 0 ||
      gesture.pointerId !== event.pointerId ||
      this.top() !== gesture.layer ||
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8 ||
      this.inside(gesture.layer, event.clientX, event.clientY)
    )
      return;
    const inAncestor = this.layers.some(
      (layer) =>
        layer !== gesture.layer &&
        this.owns(layer, gesture.layer) &&
        this.inside(layer, event.clientX, event.clientY),
    );
    if (gesture.layer.modal || gesture.layer.consumeOutside || inAncestor) {
      event.preventDefault();
      this.consumedClick = {
        x: event.clientX,
        y: event.clientY,
        pointerType: event.pointerType,
        at: event.timeStamp,
        modal: !!(gesture.layer.modal || gesture.layer.consumeOutside),
      };
    }
    this.dismiss(gesture.layer, 'outside');
  };
  private mouseDown = (event: MouseEvent) => {
    const consumed = this.consumedClick;
    // Touch can emit compatibility mousedown after the dialog has unmounted
    // and its opener has regained focus. Its default blur must not undo that
    // restoration. Nonmodal outside clicks retain their ordinary focus action.
    if (consumed?.modal && this.matchesConsumedMouse(event, consumed)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  private matchesConsumedMouse(
    event: MouseEvent,
    consumed: NonNullable<DismissalManager['consumedClick']>,
  ) {
    return (
      event.detail !== 0 &&
      event.timeStamp - consumed.at < 500 &&
      // WebKit can retarget compatibility mouse coordinates when an inline
      // surface collapses. A pending touch is still the same sequence until
      // the next pointerdown clears its token; mouse pointers keep their match.
      (consumed.pointerType === 'touch' ||
        Math.hypot(event.clientX - consumed.x, event.clientY - consumed.y) < 8)
    );
  }
  private click = (event: MouseEvent) => {
    const consumed = this.consumedClick;
    this.consumedClick = null;
    if (consumed && this.matchesConsumedMouse(event, consumed)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  private key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing)
      return;
    if (event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Chromium can close the native picker before dispatching keydown. Keep
    // its observed open state through that event, then clear it next frame.
    this.pickerEscape = this.pickerOpen || this.selectPickerOpen();
    if (this.pickerEscape) return;
    const layer = this.top();
    // Leave native modal/picker cancellation to the browser. A child panel's
    // handled Escape prevents the same key from also cancelling its dialog.
    if (!layer || layer.modal) return;
    event.preventDefault();
    event.stopPropagation();
    this.dismiss(layer, 'escape');
  };
  // Safari before :open support throws on this selector. An uncaught throw
  // here unmounted the whole app on iPhone whenever a preview opened.
  private selectPickerOpen() {
    if (!this.pickerSelector) return false;
    try {
      return !!this.document.querySelector('select:open');
    } catch {
      this.pickerSelector = false;
      return false;
    }
  }
  private observePicker = () => {
    this.pickerOpen = this.selectPickerOpen();
    this.pickerFrame =
      this.document.defaultView?.requestAnimationFrame(this.observePicker) || 0;
  };
  private listen(add: boolean) {
    const view = this.document.defaultView;
    if (this.cleanupTimer) view?.clearTimeout(this.cleanupTimer);
    this.cleanupTimer = 0;
    const listen = <K extends keyof DocumentEventMap>(
      type: K,
      listener: (event: DocumentEventMap[K]) => void,
      enabled = add,
      capture = true,
    ) => {
      if (enabled) this.document.addEventListener(type, listener, capture);
      else this.document.removeEventListener(type, listener, capture);
    };
    // Retain the gesture guards even when pointerup unmounts the last modal.
    listen('pointerdown', this.down, add || !!this.consumedClick);
    listen('mousedown', this.mouseDown, add || !!this.consumedClick);
    listen('pointermove', this.move);
    listen('pointerup', this.up);
    listen('pointercancel', this.cancelPointer);
    if (add) this.document.addEventListener('click', this.click, true);
    else if (this.consumedClick) {
      // React can unmount the last dialog between pointerup and click. Keep
      // this one capture listener long enough to consume that same gesture.
      this.cleanupTimer =
        view?.setTimeout(() => {
          if (!this.layers.length) {
            this.document.removeEventListener('click', this.click, true);
            this.document.removeEventListener('pointerdown', this.down, true);
            this.document.removeEventListener(
              'mousedown',
              this.mouseDown,
              true,
            );
            this.consumedClick = null;
          }
          this.cleanupTimer = 0;
        }, 550) || 0;
    } else this.document.removeEventListener('click', this.click, true);
    listen('keydown', this.key, add, false);
    if (this.pickerFrame) view?.cancelAnimationFrame(this.pickerFrame);
    this.pickerFrame = 0;
    if (add) this.observePicker();
    else this.pickerOpen = false;
  }
}
