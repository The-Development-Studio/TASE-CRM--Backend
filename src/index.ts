import { app } from './app.js';
import { config } from './config.js';
import { closeDatabase, createIndexes } from './database.js';

const server = app.listen(config.SERVER_PORT, async () => {
  console.log(`TDS CRM API listening on http://localhost:${config.SERVER_PORT}`);
  if (!config.MONGODB_URI) {
    console.warn('MongoDB is not configured. Copy .env.example to .env and add the real password.');
    return;
  }

  try {
    await createIndexes();
    console.log(`MongoDB connected: ${config.MONGODB_DB_NAME}`);
  } catch (error) {
    console.error('MongoDB startup failed', error);
    server.close(() => {
      process.exitCode = 1;
    });
  }
});

const shutdown = async () => {
  server.close();
  await closeDatabase();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
