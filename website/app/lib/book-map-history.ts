/** A narrow-screen map is one Back step, without changing the reading URL.
 * This owns only history; the existing dismissal manager owns the surface. */
export interface MapHistoryPort {
  history: Pick<History, 'state' | 'pushState' | 'back'>;
  url: () => string;
  listen: (callback: () => void) => () => void;
  defer: (callback: () => void) => void;
  snapshot?: () => void;
  /** Responsive permanent columns must not react to an old phone entry. */
  modal?: () => boolean;
}

const marker = '__familyBookMap';
let nextId = 0;

export class BookMapHistory {
  private token = '';
  private active = false;
  private closing = false;
  private reopen = false;
  private disposed = false;
  private after: (() => void)[] = [];
  private remove: () => void;
  private port: MapHistoryPort;
  private onBack: () => void;
  private onForward: () => void;

  constructor(port: MapHistoryPort, onBack: () => void, onForward: () => void) {
    this.port = port;
    this.onBack = onBack;
    this.onForward = onForward;
    this.remove = port.listen(() => this.pop());
  }

  private ownsEntry() {
    return !!this.token && this.port.history.state?.[marker] === this.token;
  }

  open() {
    if (this.disposed || this.port.modal?.() === false) return;
    if (this.closing) {
      this.reopen = true;
      return;
    }
    if (this.active) return;
    this.port.snapshot?.();
    this.token = `${Date.now()}:${++nextId}`;
    this.port.history.pushState(
      { ...this.port.history.state, [marker]: this.token },
      '',
      this.port.url(),
    );
    this.active = true;
  }

  /** Explicit dismissal removes the boundary before a requested navigation. */
  close(after?: () => void) {
    if (after) this.after.push(after);
    if (this.closing) return;
    this.reopen = false;
    if (this.active && this.ownsEntry()) {
      this.closing = true;
      this.port.history.back();
      return;
    }
    this.active = false;
    this.flush();
  }

  private flush() {
    const actions = this.after.splice(0);
    if (actions.length && !this.disposed)
      this.port.defer(() => {
        if (!this.disposed) actions.forEach((action) => action());
      });
  }

  private pop() {
    if (this.ownsEntry()) {
      if (!this.active && !this.disposed) {
        this.active = true;
        if (this.port.modal?.() !== false) this.onForward();
      }
      return;
    }
    const wasActive = this.active;
    this.active = false;
    if (this.closing) {
      this.closing = false;
      this.flush();
      if (this.disposed) this.remove();
      else if (this.reopen) this.open();
    } else if (wasActive && !this.disposed && this.port.modal?.() !== false) {
      this.onBack();
    }
  }

  dispose() {
    this.disposed = true;
    this.after = [];
    this.reopen = false;
    this.close();
    // Keep the listener only until the already requested Back completes.
    if (!this.closing) this.remove();
  }
}
