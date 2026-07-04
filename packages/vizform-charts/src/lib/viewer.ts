import { type Cell, num, tween, easeOut } from "bireactive";
import { GESTURE_ACTIVE_CLASS } from "./transitions";

export interface ViewerBounds {
  a0: number; a1: number;  // axis A (depth / angle / x)
  b0: number; b1: number;  // axis B (sibling / radius / y)
}

export interface ViewerOpts {
  anim: { start: (...gens: Generator[]) => () => void };  // this.anim
  host: HTMLElement;           // for gesture-active class
  gestureClassMs?: number;     // default: DRILL_DURATION + 60
  ease?: typeof easeOut;       // default: easeOut
}

export class Viewer {
  /** Reactive bounds cells. Charts read these in their remap functions. */
  readonly a0: Cell<number>;
  readonly a1: Cell<number>;
  readonly b0: Cell<number>;
  readonly b1: Cell<number>;

  private _anim: ViewerOpts["anim"];
  private _host: HTMLElement;
  private _gestureClassMs: number;
  private _ease: typeof easeOut;
  private _inited = false;
  private _cancel: (() => void) | null = null;
  private _classTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ViewerOpts);
  constructor(initial: ViewerBounds, opts: ViewerOpts);
  constructor(arg1: ViewerBounds | ViewerOpts, arg2?: ViewerOpts) {
    let initial: ViewerBounds;
    let opts: ViewerOpts;

    if ('anim' in arg1) {
      // First overload: constructor(opts: ViewerOpts)
      opts = arg1;
      initial = { a0: 0, a1: 0, b0: 0, b1: 0 };
    } else {
      // Second overload: constructor(initial: ViewerBounds, opts: ViewerOpts)
      initial = arg1;
      opts = arg2!;
    }

    this._anim = opts.anim;
    this._host = opts.host;
    this._gestureClassMs = opts.gestureClassMs ?? 860;  // DRILL_DURATION + 60
    this._ease = opts.ease ?? easeOut;

    this.a0 = num(initial.a0);
    this.a1 = num(initial.a1);
    this.b0 = num(initial.b0);
    this.b1 = num(initial.b1);
  }

  /** Snap to target (no animation). Resets the "first call" flag. */
  snap(target: ViewerBounds): void {
    this._cancel?.();
    this._cancel = null;
    this.a0.value = target.a0;
    this.a1.value = target.a1;
    this.b0.value = target.b0;
    this.b1.value = target.b1;
    this._inited = true;
  }

  /** Animate to target. Cancels any in-flight animation. */
  animateTo(target: ViewerBounds, sec: number, opts?: { flashGesture?: boolean }): void {
    if (!this._inited) {
      this.snap(target);
      return;
    }

    this._cancel?.();
    this._cancel = null;

    if (opts?.flashGesture) {
      if (this._classTimer) {
        clearTimeout(this._classTimer);
        this._classTimer = null;
      }
      this._host.classList.add(GESTURE_ACTIVE_CLASS);
      this._classTimer = setTimeout(() => {
        this._classTimer = null;
        this._host.classList.remove(GESTURE_ACTIVE_CLASS);
      }, this._gestureClassMs);
    }

    this._cancel = this._anim.start(
      tween(this.a0, target.a0, sec, this._ease),
      tween(this.a1, target.a1, sec, this._ease),
      tween(this.b0, target.b0, sec, this._ease),
      tween(this.b1, target.b1, sec, this._ease),
    );
  }

  /** Current bounds as a plain object (reactive read). */
  get bounds(): ViewerBounds {
    return {
      a0: this.a0.value,
      a1: this.a1.value,
      b0: this.b0.value,
      b1: this.b1.value,
    };
  }

  /** Cancel in-flight animation + clear gesture class timer. Call on scene teardown. */
  dispose(): void {
    if (this._classTimer) {
      clearTimeout(this._classTimer);
      this._classTimer = null;
    }
    this._cancel?.();
    this._cancel = null;
  }
}
