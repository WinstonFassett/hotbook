// Live tweaks panel for the motion runtime-config cells (WIN-352).
// Mounts a lil-gui panel bound to the `motion` cells so a slider bump instantly
// retimes every chart on screen. The panel is positioned fixed on the page and
// uses lil-gui's built-in collapsible header to toggle visibility.
//
// Ephemeral by design — closing the tab discards changes. Persistence lives in
// a later wave.

import { effect } from "bireactive";
import GUI from "lil-gui";
import { motion, MOTION_DEFAULTS, resetMotionToDefaults } from "./runtime-config";

export interface MountMotionTweaksOptions {
  /** Absolute position of the panel on the page. Defaults to
   *  { top: 8, right: 8 } (top-right). */
  position?: Partial<Record<"top" | "right" | "bottom" | "left", number | string>>;
  /** Title shown in the collapsible header. */
  label?: string;
  /** Start collapsed (default true). */
  closedByDefault?: boolean;
  /** Overrides the CSS z-index applied to the panel. */
  zIndex?: number;
}

export interface MountedMotionTweaks {
  /** The lil-gui root. */
  gui: GUI;
  /** Destroy the pane and clean up effects. */
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
    closedByDefault = true,
    zIndex = 999,
  } = opts;

  const mirror = {
    baseMs:  motion.baseMs.value,
    enterMs: motion.enterMs.value,
    exitMs:  motion.exitMs.value,
    sortSec: motion.sortSec.value,
    drillMs: motion.drillMs.value,
    separation: motion.separation.value,
    reset: () => resetMotionToDefaults(),
  };

  const gui = new GUI({ title: label, autoPlace: false, closed: closedByDefault });
  const guiEl = gui.domElement;
  Object.assign(guiEl.style, {
    position: "fixed",
    zIndex: String(zIndex),
  } as Partial<CSSStyleDeclaration>);
  for (const [k, v] of Object.entries(position)) {
    if (v !== undefined) (guiEl.style as any)[k] = typeof v === "number" ? `${v}px` : v;
  }
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
  gui.add(mirror, "separation", 0, 6, 0.5).name("separation (px)")
    .onChange((v: number) => { motion.separation.value = v; });
  gui.add(mirror, "reset").name(`reset to defaults`);

  const syncEffects = [
    effect(() => { mirror.baseMs  = motion.baseMs.value;  gui.controllersRecursive().forEach(c => c.updateDisplay()); }),
    effect(() => { mirror.enterMs = motion.enterMs.value; gui.controllersRecursive().forEach(c => c.updateDisplay()); }),
    effect(() => { mirror.exitMs  = motion.exitMs.value;  gui.controllersRecursive().forEach(c => c.updateDisplay()); }),
    effect(() => { mirror.sortSec = motion.sortSec.value; gui.controllersRecursive().forEach(c => c.updateDisplay()); }),
    effect(() => { mirror.drillMs = motion.drillMs.value; gui.controllersRecursive().forEach(c => c.updateDisplay()); }),
    effect(() => { mirror.separation = motion.separation.value; gui.controllersRecursive().forEach(c => c.updateDisplay()); }),
  ];

  return {
    gui,
    destroy() {
      for (const dispose of syncEffects) dispose();
      gui.destroy();
    },
  };
}
