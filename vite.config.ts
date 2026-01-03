import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// For GitHub Pages: if repo is username.github.io, use '/'
// If repo is any other name, use '/repo-name/'
// Change this to match your repository name
const REPO_NAME = 'yaliby'; // Change this to your actual repo name
const isGithubIoRepo = REPO_NAME.endsWith('.github.io');
const base = process.env.NODE_ENV === 'production' 
  ? (isGithubIoRepo ? '/' : `/${REPO_NAME}/`)
  : '/';

export default defineConfig({
  plugins: [react()],
  base,
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
