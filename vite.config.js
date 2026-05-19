import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';

const rootAssetPattern = /^\/(metadata\.json|explanations\.json|videos\.json|20\d{2}\/.+\.png)$/;
const contentTypes = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ccc-root-static-assets',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = req.url ? decodeURIComponent(req.url.split('?')[0]) : '';
          if (!rootAssetPattern.test(pathname)) {
            next();
            return;
          }
          const file = path.join(process.cwd(), pathname);
          if (!existsSync(file)) {
            next();
            return;
          }
          res.setHeader('Content-Type', contentTypes[path.extname(file)] ?? 'application/octet-stream');
          createReadStream(file).pipe(res);
        });
      }
    }
  ]
});
