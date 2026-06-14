import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Allow components in this project to declare customElement mode via
    // <svelte:options customElement="lc-..."/>. Components without that
    // option compile to normal Svelte components.
    customElement: true,
  },
};
