/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Build targets
 * ------------
 * - default  : standard multi-file build, works from ANY url sub-path
 *              (`base: './'` => every asset url is relative).
 * - `single` : everything inlined into one `dist-single/index.html`, runnable
 *              straight from `file://` (double click, no web server).
 *
 * Both targets keep the `#!` hash router, so no server rewrite is ever needed.
 */
export default defineConfig(({ mode }) => {
  const isSingle = mode === 'single';

  return {
    // Relative base is what makes "run from any directory" work.
    base: './',

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    plugins: [
      react(),
      // PWA is meaningless for the single-file target (there is no sw.js file
      // next to the document), so it is only wired up for the standard build.
      ...(isSingle
        ? []
        : [
            VitePWA({
              registerType: 'prompt',
              injectRegister: false,
              includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'],
              manifest: {
                id: 'ariang-next',
                name: 'AriaNg Next',
                short_name: 'AriaNg Next',
                description: 'A modern web frontend for aria2-next',
                lang: 'en',
                dir: 'ltr',
                start_url: './',
                scope: './',
                display: 'standalone',
                orientation: 'any',
                background_color: '#fef7ff',
                theme_color: '#6750a4',
                categories: ['utilities', 'productivity'],
                icons: [
                  { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
                  { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
                  {
                    src: 'pwa-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
                // Never fall back to index.html for the JSON-RPC endpoint.
                // (vite-plugin-pwa types this as RegExp[], workbox wants string[].)
                navigateFallback: 'index.html',
                navigateFallbackDenylist: [/^\/(jsonrpc|rpc)(\/|$)/] as never,
                maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
                cleanupOutdatedCaches: true,
                runtimeCaching: [
                  {
                    urlPattern: ({ request }) =>
                      request.destination === 'image' ||
                      request.destination === 'font' ||
                      request.destination === 'style',
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'ariang-next-assets',
                      expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 365 },
                    },
                  },
                ],
              },
              devOptions: { enabled: false },
            }),
          ]),
      ...(isSingle
        ? [
            viteSingleFile({ removeViteModuleLoader: true }),
          ]
        : []),
    ],

    define: {
      __BUILD_TARGET__: JSON.stringify(isSingle ? 'single' : 'standard'),
    },

    build: {
      target: 'es2022',
      outDir: isSingle ? 'dist-single' : 'dist',
      emptyOutDir: true,
      cssCodeSplit: !isSingle,
      assetsInlineLimit: isSingle ? 1024 * 1024 : 4096,
      chunkSizeWarningLimit: 1024,
      reportCompressedSize: false,
      rollupOptions: isSingle
        ? {
            output: {
              // A classic IIFE script is the only format that survives `file://`.
              format: 'iife',
              inlineDynamicImports: true,
              entryFileNames: 'assets/[name].js',
              assetFileNames: 'assets/[name].[ext]',
            },
          }
        : {
            output: {
              manualChunks: {
                react: ['react', 'react-dom', 'react-router-dom'],
                mdui: ['mdui'],
                echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
              },
            },
          },
    },

    esbuild: {
      legalComments: 'none',
    },

    server: {
      port: 5173,
      strictPort: false,
    },

    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      css: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/domain/**', 'src/rpc/**', 'src/config/**'],
      },
    },
  };
});
