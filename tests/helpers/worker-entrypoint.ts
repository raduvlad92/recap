/** Node-only import shim. Real RPC/ctx.exports is verified separately under
 * workerd; this class cannot simulate cross-service behavior. */
export class WorkerEntrypoint<Env> {
  protected ctx: { exports: unknown };
  protected env: Env;
  constructor(ctx: { exports: unknown }, env: Env) { this.ctx = ctx; this.env = env; }
}
