/// <reference types="mdui/jsx.en" />

declare global {
  /**
   * Build target injected by vite `define`.
   *
   * `standard` → multi-file build with lazy route chunks (needs a web server,
   * works from any URL sub-path).
   * `single`   → one inlined HTML file runnable from `file://`; must not use
   * dynamic imports or register a service worker.
   */
  const __BUILD_TARGET__: 'standard' | 'single';

  interface Window {
    __ARIANG_NEXT_BUILD__?: string;
  }
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

export {};
