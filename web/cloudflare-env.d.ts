declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    LIVE_PLAYERS?: DurableObjectNamespace;
    BUCKET?: R2Bucket;
  }
}
