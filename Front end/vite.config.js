import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0' },
});
export default defineConfig({
  // ... other configs
  build: {
    chunkSizeWarningLimit: 1000, // raises the warning limit to 1000 kB (1MB)
  },
})
