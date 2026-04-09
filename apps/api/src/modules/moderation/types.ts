export type ModerationContentType = "post" | "reply" | "profile";

export type ModerationAction = "allow" | "label" | "review" | "hide";

export interface ModerationEvent {
  id: string;
  contentType: ModerationContentType;
  text: string;
  authorId: string;
  createdAt: string;
}

export interface ModerationSignal {
  label: string;
  confidence: number;
  source: "rules" | "oss-model";
}

export interface ModerationDecision {
  action: ModerationAction;
  reason: string;
}

export interface ModerationResult {
  signals: ModerationSignal[];
  decision: ModerationDecision;
  modelRuntime: "ollama" | "vllm" | "tgi";
  deploymentMode: "self-hosted-open-source";
}
