import type { FastifyReply, FastifyRequest } from "fastify";
import { AUTH_SESSION_COOKIE_NAME, type AuthSessionIdentity, AuthSessionService } from "./service.js";

export function readAuthenticatedIdentity(
  request: FastifyRequest,
  authSessions: AuthSessionService
): Promise<AuthSessionIdentity | null> {
  const sessionId = typeof request.cookies[AUTH_SESSION_COOKIE_NAME] === "string"
    ? request.cookies[AUTH_SESSION_COOKIE_NAME]!.trim()
    : "";
  if (!sessionId) {
    return Promise.resolve(null);
  }
  return authSessions.getIdentityFromSession(sessionId);
}

export async function requireAuthenticatedIdentity(
  request: FastifyRequest,
  reply: FastifyReply,
  authSessions: AuthSessionService
): Promise<AuthSessionIdentity | null> {
  const identity = await readAuthenticatedIdentity(request, authSessions);
  if (identity) {
    return identity;
  }
  void reply.code(401).send({
    error: "unauthorized",
    message: "Sign-in is required for this action."
  });
  return null;
}
