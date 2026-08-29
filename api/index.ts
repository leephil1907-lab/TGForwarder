let runtimePromise: Promise<any> | null = null;

export default async function handler(req: any, res: any) {
  // Vercel deployment files are immutable. The application uses a small
  // runtime-local data store, so switch the working directory to /tmp before
  // loading the Express application. Local development is unaffected.
  if (process.env.VERCEL) {
    try { process.chdir('/tmp'); } catch (err) { console.warn('[Vercel] Could not switch runtime directory:', err); }
  }
  runtimePromise ??= import('./runtime.js').then((module) => module.default);
  const app = await runtimePromise;
  return app(req, res);
}
