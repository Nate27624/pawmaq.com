import { readEnv } from "./config/env.js";
import { buildApp } from "./server.js";

const env = readEnv();
const app = await buildApp(env);

try {
  await app.listen({
    host: env.HOST,
    port: env.PORT
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
