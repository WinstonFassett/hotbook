// Type-only augmentation: the bireactive Tween class is used as an Animator
// (Generator), but its published declarations don't include [Symbol.dispose].
// The project's ES2022 lib loads esnext.disposable, which makes Generator
// require [Symbol.dispose], so Tween must carry it at the type level.
// Runtime never calls it; Anim only uses next/return/throw/iterator.

import "bireactive";

declare module "bireactive" {
  interface Tween<T> extends Disposable {}
}
