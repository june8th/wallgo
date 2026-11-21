import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { wallgoApiPlugin } from './server/vite-plugin.js';

export default defineConfig({
  base: '/',
  plugins: [react(), wallgoApiPlugin()],
});
