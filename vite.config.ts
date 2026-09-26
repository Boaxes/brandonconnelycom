import { defineConfig, type Plugin } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Dev-only: POST /__shot with a data URL body saves a screenshot for review. */
function shotPlugin(): Plugin {
  const dir = process.env.SHOT_DIR || join(process.cwd(), '.shots');
  return {
    name: 'shot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const name = new URL(req.url || '/', 'http://x').searchParams.get('name') || 'shot';
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          const m = body.match(/^data:image\/(png|jpeg);base64,(.*)$/s);
          if (!m) {
            res.statusCode = 400;
            res.end('bad body');
            return;
          }
          mkdirSync(dir, { recursive: true });
          const file = join(dir, `${name.replace(/[^\w-]/g, '_')}.${m[1] === 'png' ? 'png' : 'jpg'}`);
          writeFileSync(file, Buffer.from(m[2], 'base64'));
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [shotPlugin()],
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
