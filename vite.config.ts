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

export default defineConfig({
  plugins: [react()],
  base: '/',
});

