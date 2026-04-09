import type { ModerationDecision, ModerationEvent, ModerationResult, ModerationSignal } from "./types.js";

type ModelRuntime = "ollama" | "vllm" | "tgi";

interface ModelGateway {
  analyze(event: ModerationEvent): Promise<ModerationSignal[]>;
}

class OpenSourceModelGateway implements ModelGateway {
  constructor(private readonly runtime: ModelRuntime) {}

  async analyze(event: ModerationEvent): Promise<ModerationSignal[]> {
    // Stubbed model call to keep the service interface stable while we integrate
    // a concrete open-source runtime adapter (Ollama/vLLM/TGI).
    const text = event.text.toLowerCase();
    const signals: ModerationSignal[] = [];

    if (text.includes("buy now") || text.includes("free money")) {
      signals.push({ label: "spam.suspected", confidence: 0.88, source: "oss-model" });
    }

    if (text.includes("kill yourself")) {
      signals.push({ label: "harassment.severe", confidence: 0.94, source: "oss-model" });
    }

    if (text.length > 0 && text.length < 3) {
      signals.push({ label: "content.low_context", confidence: 0.7, source: "rules" });
    }

    return signals;
  }

  getRuntime(): ModelRuntime {
    return this.runtime;
  }
}

class PolicyEngine {
  evaluate(signals: ModerationSignal[]): ModerationDecision {
    const severeHarassment = signals.find(
      (signal) => signal.label === "harassment.severe" && signal.confidence >= 0.9
    );

    if (severeHarassment) {
      return { action: "hide", reason: "high-confidence severe harassment signal" };
    }

    const likelySpam = signals.find(
      (signal) => signal.label === "spam.suspected" && signal.confidence >= 0.85
    );

    if (likelySpam) {
      return { action: "review", reason: "spam signal exceeds review threshold" };
    }

    if (signals.length > 0) {
      return { action: "label", reason: "non-blocking moderation signals present" };
    }

    return { action: "allow", reason: "no policy violations detected" };
  }
}

export class OpenSourceModerationPipeline {
  private readonly gateway: OpenSourceModelGateway;
  private readonly policyEngine: PolicyEngine;

  constructor(runtime: ModelRuntime) {
    this.gateway = new OpenSourceModelGateway(runtime);
    this.policyEngine = new PolicyEngine();
  }

  async analyze(event: ModerationEvent): Promise<ModerationResult> {
    const signals = await this.gateway.analyze(event);
    const decision = this.policyEngine.evaluate(signals);

    return {
      signals,
      decision,
      modelRuntime: this.gateway.getRuntime(),
      deploymentMode: "self-hosted-open-source"
    };
  }
}
