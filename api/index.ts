import type { Request, Response, NextFunction } from 'express';

/**
 * Vercel entrypoint.
 *
 * The application is still started by server.ts for local/VPS deployments.
 * Vercel needs a request handler under /api, so this adapter forwards the
 * request to the Express instance exported by the application when available.
 * The production deployment should use the persistent worker deployment for
 * Telegram MTProto forwarding; this endpoint is intended for API/frontend use.
 */
let appPromise: Promise<any> | null = null;

async function getApp() {
  if (!appPromise) {
    appPromise = import('../server.js').then((mod: any) => {
      if (typeof mod.getApp === 'function') return mod.getApp();
      if (mod.app) return mod.app;
      throw new Error('Express application export not found.');
    });
  }
  return appPromise;
}

export default async function handler(req: Request, res: Response, next?: NextFunction) {
  try {
    const app = await getApp();
    return app(req, res, next);
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Backend initialization failed',
        message: error?.message || 'Unknown server error'
      });
    }
  }
}
