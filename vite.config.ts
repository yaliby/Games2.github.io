import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// For GitHub Pages: if repo is username.github.io, use '/'
// If repo is any other name, use '/repo-name/'
// IMPORTANT: Set this to match your GitHub Pages URL path
// If your site is at: yaliby.github.io/Games2.github.io/
// Then set BASE_PATH to '/Games2.github.io/'
// If your site is at: yaliby.github.io/ (root), set to '/'
// If your site is at: yaliby.github.io/repo-name/, set to '/repo-name/'
const BASE_PATH = '/Games2.github.io/'; // Update this to match your actual GitHub Pages path
const base = process.env.NODE_ENV === 'production' ? BASE_PATH : '/';

export default defineConfig({
  plugins: [react()],
  base,
  publicDir: 'img', // Serve images from img folder as public assets
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    copyPublicDir: true, // Copy public directory to dist
  },
})
