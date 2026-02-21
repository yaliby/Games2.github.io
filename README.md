# Yaliby - Game Hub

A web application featuring classic board games including Checkers and Connect Four.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to GitHub Pages

### Automatic Deployment (Recommended)

1. **Update BASE_PATH in vite.config.ts:**
   - Open `vite.config.ts`
   - Set `BASE_PATH` to match your GitHub Pages URL:
     - If site is at `username.github.io/repo-name/` → set to `'/repo-name/'`
     - If site is at `username.github.io/` (root) → set to `'/'`

2. **Enable GitHub Pages:**
   - Go to your repository on GitHub
   - Click **Settings** → **Pages**
   - Under **Source**, select **"GitHub Actions"**
   - Save

3. **Push your code:**
   ```bash
   git add .
   git commit -m "Deploy to GitHub Pages"
   git push origin main
   ```

4. **Wait for deployment:**
   - Go to **Actions** tab in your repository
   - Watch the workflow run
   - Once complete, your site will be live

### Troubleshooting

- **404 errors:** Make sure `BASE_PATH` in `vite.config.ts` matches your GitHub Pages URL path
- **Blank page:** Check browser console for errors, verify assets are loading
- **Wrong paths:** Rebuild with correct `BASE_PATH` and redeploy

### Important Notes

- The `BASE_PATH` must match your GitHub Pages URL structure exactly
- After changing `BASE_PATH`, rebuild and push again
- Clear browser cache if you see old content

