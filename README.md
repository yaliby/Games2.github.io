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

1. Push your code to GitHub
2. Go to your repository Settings → Pages
3. Under "Source", select "GitHub Actions"
4. The workflow will automatically deploy on every push to `main` or `master` branch

### Manual Deployment

1. Update `REPO_NAME` in `vite.config.ts` to match your repository name
2. Build the project: `npm run build`
3. Go to repository Settings → Pages
4. Under "Source", select "Deploy from a branch"
5. Select `gh-pages` branch and `/root` folder
6. Push the `dist` folder to the `gh-pages` branch:

```bash
npm run build
git add dist
git commit -m "Deploy to GitHub Pages"
git subtree push --prefix dist origin gh-pages
```

### Important Notes

- If your repository is named `username.github.io`, set `REPO_NAME = 'username.github.io'` in `vite.config.ts` and it will use base path `/`
- For any other repository name, it will use base path `/repo-name/`
- Make sure to update `REPO_NAME` in `vite.config.ts` before building for production

