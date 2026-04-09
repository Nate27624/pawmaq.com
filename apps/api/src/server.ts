import cors from "@fastify/cors";
import Fastify from "fastify";
import type { AppEnv } from "./config/env.js";
import { registerHealthRoutes } from "./modules/health/routes.js";
import { registerModerationRoutes } from "./modules/moderation/routes.js";

export async function buildApp(env: AppEnv) {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: true
  });

  await registerHealthRoutes(app);
  await registerModerationRoutes(app, env.MODERATION_MODEL_RUNTIME);

  return app;
}
