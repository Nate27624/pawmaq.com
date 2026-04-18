import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildApp } from "../../server.js";
import type { AppEnv } from "../../config/env.js";

interface ScenarioRow {
  scenarioId: string;
  ok: boolean;
  assertions: Array<{ name: string; pass: boolean; details: string }>;
}

async function run(): Promise<void> {
  const suiteStamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const suiteDir = resolve(process.cwd(), ".context", "test-lab-suite");
  await mkdir(suiteDir, { recursive: true });

  const env: AppEnv = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 0,
    CORS_ALLOWED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173",
    AUTH_COOKIE_SAME_SITE: "strict",
    AUTH_COOKIE_SECURE: false,
    AUTH_COOKIE_DOMAIN: "",
    MODERATION_MODEL_RUNTIME: "ollama",
    PROFILE_LEDGER_PATH: `.context/test-lab-suite/profile-ledger-${suiteStamp}.json`,
    POST_LEDGER_PATH: `.context/test-lab-suite/post-ledger-${suiteStamp}.json`,
    MEDIA_INDEX_PATH: `.context/test-lab-suite/media-index-${suiteStamp}.json`,
    MEDIA_STORAGE_DIR: `.context/test-lab-suite/media-${suiteStamp}`,
    MEDIA_PUBLIC_BASE_URL: "http://localhost:3000",
    PRE_LEDGER_QUEUE_MAX_PENDING: 80,
    PRE_LEDGER_POSTS_PER_MINUTE_PER_IP: 90,
    PRE_LEDGER_MEDIA_UPLOADS_PER_10M_PER_IP: 20,
    AUTH_SESSION_TTL_HOURS: 168,
    AUTH_SESSION_STORE: "memory",
    AUTH_SESSION_REDIS_PREFIX: "pawmaq:test:session:",
    PASSKEY_LEDGER_PATH: `.context/test-lab-suite/passkey-ledger-${suiteStamp}.json`,
    WEBAUTHN_RP_NAME: "pawmaq.com",
    WEBAUTHN_RP_ID: "localhost",
    WEBAUTHN_EXPECTED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173",
    GUEST_PASSKEY_SESSION_TTL_MINUTES: 15,
    RSS_BOTS_ENABLED: false,
    RSS_BOTS_INTERVAL_MINUTES: 15,
    RSS_BOTS_MAX_ITEMS_PER_FEED_PER_RUN: 20,
    RSS_BOTS_USER_AGENT: "pawmaq-rss-bot-test/1.0",
    RSS_BOTS_FEEDS: "",
    TEST_LAB_ENABLED: true,
    DATABASE_URL: "test-db-not-used",
    REDIS_URL: "redis://127.0.0.1:6379",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434"
  };

  const app = await buildApp(env);
  await app.ready();

  try {
    const scenariosResponse = await app.inject({
      method: "GET",
      url: "/v1/test-lab/scenarios"
    });
    assert.equal(scenariosResponse.statusCode, 200, "scenario list should load");
    const scenariosPayload = scenariosResponse.json() as {
      scenarios: Array<{ id: string }>;
    };
    assert.ok(Array.isArray(scenariosPayload.scenarios), "scenario payload should include scenarios array");
    assert.ok(scenariosPayload.scenarios.length > 0, "scenario payload should have at least one scenario");

    const scenarioRows: ScenarioRow[] = [];
    for (const scenario of scenariosPayload.scenarios) {
      const runResponse = await app.inject({
        method: "POST",
        url: "/v1/test-lab/scenarios/run",
        payload: {
          scenarioId: scenario.id
        }
      });
      assert.equal(runResponse.statusCode, 200, `scenario ${scenario.id} should return 200`);
      const runPayload = runResponse.json() as ScenarioRow;
      assert.equal(runPayload.scenarioId, scenario.id, "scenario id should round-trip");
      scenarioRows.push({
        scenarioId: scenario.id,
        ok: runPayload.ok,
        assertions: runPayload.assertions
      });
    }

    const customUserResponse = await app.inject({
      method: "POST",
      url: "/v1/test-lab/users/upsert",
      payload: {
        handle: "@suite_user",
        displayName: "Suite User",
        countryCode: "US",
        countryName: "United States"
      }
    });
    assert.equal(customUserResponse.statusCode, 200, "custom user upsert should return 200");

    const customPostResponse = await app.inject({
      method: "POST",
      url: "/v1/test-lab/posts",
      payload: {
        handle: "@suite_user",
        caption: "suite custom post #suite",
        upvotes: 3,
        neutralVotes: 1,
        downvotes: 0
      }
    });
    assert.equal(customPostResponse.statusCode, 200, "custom post create should return 200");
    const customPostPayload = customPostResponse.json() as { postId: string };
    assert.ok(typeof customPostPayload.postId === "string" && customPostPayload.postId.length > 0, "post id returned");

    const customCommentResponse = await app.inject({
      method: "POST",
      url: "/v1/test-lab/comments",
      payload: {
        handle: "@suite_user",
        postId: customPostPayload.postId,
        text: "suite comment"
      }
    });
    assert.equal(customCommentResponse.statusCode, 200, "custom comment should return 200");
    const customCommentPayload = customCommentResponse.json() as { comment: { comment_id: string } };
    assert.ok(customCommentPayload.comment?.comment_id, "comment id returned");

    const customReplyResponse = await app.inject({
      method: "POST",
      url: "/v1/test-lab/replies",
      payload: {
        handle: "@suite_user",
        postId: customPostPayload.postId,
        commentId: customCommentPayload.comment.comment_id,
        text: "suite reply"
      }
    });
    assert.equal(customReplyResponse.statusCode, 200, "custom reply should return 200");

    const failed = scenarioRows.filter((row) => !row.ok);
    for (const row of failed) {
      for (const assertion of row.assertions) {
        if (!assertion.pass) {
          console.error(`[${row.scenarioId}] ${assertion.name}: ${assertion.details}`);
        }
      }
    }
    assert.equal(failed.length, 0, "all scenarios should pass");

    console.log("Test lab suite passed.");
    console.table(
      scenarioRows.map((row) => ({
        scenario: row.scenarioId,
        ok: row.ok,
        assertions: row.assertions.length
      }))
    );
  } finally {
    await app.close();
  }
}

void run().catch((error) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  console.error(`Test lab suite failed:\n${message}`);
  process.exitCode = 1;
});
