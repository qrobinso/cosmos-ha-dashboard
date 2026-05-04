export const config = {
  port: Number(process.env.PORT ?? 8099),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/cosmos.db',
  staticDir: process.env.STATIC_DIR ?? '../display/build',
};
