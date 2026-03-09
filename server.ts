import express from 'express';
import { createServer as createViteServer } from 'vite';
import { initDb } from './server/db.js';
import apiRouter from './server/api.js';
import path from 'path';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Initialize DB
  initDb();

  // API Routes
  app.use('/api', apiRouter);

  // Serve audio files
  app.use('/audio', express.static(path.join(process.cwd(), 'intel-stack', 'audio')));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
