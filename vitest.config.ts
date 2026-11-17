import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.resolve('migrations'));
      return {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            ADMIN_PASSWORD: 'test-admin-password',
            BLOG_API_TOKEN: 'test-blog-token',
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
});
