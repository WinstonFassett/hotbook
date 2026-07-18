// Live tweaks panel for the motion runtime-config cells (WIN-352).
// Renders an unobtrusive fixed-position "tweaks" trigger; clicking it opens a
// lil-gui panel bound to the `motion` cells so a slider bump instantly retimes
// every chart on screen.
//
// Ephemeral by design — closing the tab discards changes. Persistence lives in
// a later wave.
//
// The trigger element is not draggable; the panel is (lil-gui exposes drag on
// its title bar via the built-in `draggable` option). Trigger and panel are
// both attached to `document.body` so page layout can't clip them.

import { effect } from "bireactive";
import GUI from "lil-gui";
import { motion, MOTION_DEFAULTS, resetMotionToDefaults } from "./runtime-config";

export interface MountMotionTweaksOptions {
  /** Absolute position of the trigger button on the page. Defaults to
   *  { top: 8, right: 8 } (top-right). Callers pass e.g. { top: 8, left: '50%' }
   *  with a transform on the returned element for top-middle placement. */
  position?: Partial<Record<"top" | "right" | "bottom" | "left", number | string>>;
  /** Text on the collapsed trigger. */
  label?: string;
  /** Start expanded (default false). */
  openByDefault?: boolean;
  /** Overrides the CSS z-index applied to trigger + panel. */
  zIndex?: number;
}

export interface MountedMotionTweaks {
  /** The trigger button element (not draggable). */
  trigger: HTMLButtonElement;
  /** The lil-gui root. */
  gui: GUI;
  /** Destroy both the trigger and the pane. */
  destroy(): void;
}

/**
 * Mount the motion tweaks panel on `document.body`. Safe to call once per app;
 * calling twice will create two panels.
 */
export function mountMotionTweaks(opts: MountMotionTweaksOptions = {}): MountedMotionTweaks {
  const {
    position = { top: 8, right: 8 },
    label = "tweaks",
    openByDefault = false,
    zIndex = 999,
  } = opts;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.textContent = label;
  Object.assign(trigger.style, {
    position: "fixed",
    zIndex: String(zIndex),
    padding: "4px 12px",
    background: "rgba(20, 20, 24, 0.85)",
    color: "#e8e8e8",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "999px",
    font: "12px/1.4 -apple-system, system-ui, sans-serif",
    cursor: "pointer",
    userSelect: "none",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
  } as Partial<CSSStyleDeclaration>);
  for (const [k, v] of Object.entries(position)) {
    if (v !== undefined) (trigger.style as any)[k] = typeof v === "number" ? `${v}px` : v;
  }
  document.body.appendChild(trigger);

  // Plain object mirror for lil-gui — the panel binds against these properties
  // and we push changes into the cells on each onChange; a reverse-sync effect
  // pulls changes back out (e.g. reset button, future MIDI, remote debug) so
  // the panel display stays in sync.
  const mirror = {
    baseMs:  motion.baseMs.value,
    enterMs: motion.enterMs.value,
    exitMs:  motion.exitMs.value,
    sortSec: motion.sortSec.value,
    drillMs: motion.drillMs.value,
    reset: () => resetMotionToDefaults(),
  };

  const gui = new GUI({ title: label, autoPlace: false });
  const guiEl = gui.domElement;
  Object.assign(guiEl.style, {
    position: "fixed",
    zIndex: String(zIndex),
    display: openByDefault ? "" : "none",
  } as Partial<CSSStyleDeclaration>);
  // Anchor the pane below the trigger. lil-gui defaults to fixed top-right;
  // reuse the trigger's computed position + a small offset.
  const anchorPane = () => {
    const rect = trigger.getBoundingClientRect();
    guiEl.style.top = `${rect.bottom + 6}px`;
    // Prefer right-anchor if trigger is right-anchored; else left.
    if (position.right !== undefined) {
      guiEl.style.right = typeof position.right === "number" ? `${position.right}px` : position.right;
      guiEl.style.left = "";
    } else {
      guiEl.style.left = `${rect.left}px`;
      guiEl.style.right = "";
    }
  };
  document.body.appendChild(guiEl);

  gui.add(mirror, "baseMs",  10, 1000, 10).name("base (ms)")
    .onChange((v: number) => { motion.baseMs.value = v; });
  gui.add(mirror, "enterMs", 0, 2000, 20).name("enter (ms)")
    .onChange((v: number) => { motion.enterMs.value = v; });
  gui.add(mirror, "exitMs",  0, 2000, 20).name("exit (ms)")
    .onChange((v: number) => { motion.exitMs.value = v; });
  gui.add(mirror, "sortSec", 0, 2,    0.05).name("sort (s)")
    .onChange((v: number) => { motion.sortSec.value = v; });
  gui.add(mirror, "drillMs", 50, 3000, 50).name("drill (ms)")
    .onChange((v: number) => { motion.drillMs.value = v; });
  gui.add(mirror, "reset").name(`reset to defaults`);

  // Pull cell → mirror so external writes (reset, future remote) refresh
  // the panel display.
  const syncEffects = [
    effect(() => { mirror.baseMs  = motion.baseMs.value;  gui.controllersRecursive().forEach(c => c.updateDisplay()); }),
    effect(() => { mirror.enterMs = motion.enterMs.value; gui.controllersRecursive().forEach(c => c.updateDisplay()); }),
    effect(() => { mirror.exitMs  = motion.exitMs.value;  gui.controllersRecursive().forEach(c => c.updateDisplay()); }),
    effect(() => { mirror.sortSec = motion.sortSec.value; gui.controllersRecursive().forEach(c => c.updateDisplay()); }),
    effect(() => { mirror.drillMs = motion.drillMs.value; gui.controllersRecursive().forEach(c => c.updateDisplay()); }),
  ];

  let open = openByDefault;
  const setOpen = (next: boolean) => {
    open = next;
    guiEl.style.display = open ? "" : "none";
    trigger.setAttribute("aria-expanded", String(open));
    if (open) anchorPane();
  };
  trigger.setAttribute("aria-expanded", String(open));
  trigger.addEventListener("click", () => setOpen(!open));

  const onResize = () => { if (open) anchorPane(); };
  window.addEventListener("resize", onResize);

  return {
    trigger,
    gui,
    destroy() {
      window.removeEventListener("resize", onResize);
      for (const dispose of syncEffects) dispose();
      gui.destroy();
      trigger.remove();
    },
  };
}
