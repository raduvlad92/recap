/** The app uses DOM/Node fetch types. Importing all Workers globals changes
 * Response.json across the browser app; scope only this runtime class here. */
declare module 'cloudflare:workers' {
  export abstract class WorkerEntrypoint<Env = unknown> {
    protected ctx: { exports: unknown };
    protected env: Env;
    constructor(ctx: { exports: unknown }, env: Env);
  }
}
