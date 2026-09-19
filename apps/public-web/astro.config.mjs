import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://nelyon.app',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'file' },
});
