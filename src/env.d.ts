interface Env {
  /** Set with `wrangler secret put ADMIN_PASSWORD`. Not a wrangler.toml var. */
  ADMIN_PASSWORD: string;
  /** Set with `wrangler secret put BLOG_API_TOKEN`. Not a wrangler.toml var. */
  BLOG_API_TOKEN: string;
}
