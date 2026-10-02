/// <reference types="mdui/jsx.en" />

declare const __BUILD_TARGET__: 'standard' | 'single';

declare global {
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
