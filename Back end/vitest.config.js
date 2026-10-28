import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    // Blank Supabase settings so tests can never reach a real project; dotenv does not override variables that are already set.
    env: { NODE_ENV: 'test', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' },
  },
});
