import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import {
  createNodeApiMiddleware,
  type NodeApiMiddlewareOptions,
  type WebRequestHandler,
} from './node-adapter.js';
import { handleApiRequest } from './router.js';

export interface WallgoApiPluginOptions extends NodeApiMiddlewareOptions {
  handler?: WebRequestHandler;
}

/**
 * Vite plugin mounting `/api/*` middleware on BOTH `vite dev` (`configureServer`)
 * and `vite preview` (`configurePreviewServer`, used by Playwright E2E) BEFORE
 * Vite's static assets and SPA `index.html` fallback middleware.
 */
export function wallgoApiPlugin(options: WallgoApiPluginOptions = {}): Plugin {
  const middleware = createNodeApiMiddleware(options.handler ?? handleApiRequest, {
    maxBodyBytes: options.maxBodyBytes,
  });

  return {
    name: 'wallgo-api-middleware',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(middleware);
    },
  };
}
