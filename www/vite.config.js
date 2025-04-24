// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index:   resolve(__dirname, 'index.html'),
        gallery: resolve(__dirname, 'gallery.html'),
        app:     resolve(__dirname, 'app.html'),
      }
    }
  }
});
