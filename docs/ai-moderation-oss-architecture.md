# Open-Source AI Moderation Architecture

## Goals

- Keep moderation AI fully open-source and self-hosted
- Support explainable, reviewable moderation decisions
- Reduce moderator load while preserving human override

## Principles

- Closed-source APIs are not used for policy enforcement decisions
- Model inputs/outputs are logged with privacy controls and retention limits
- AI produces `signals`, not irreversible punishment
- Human moderation remains final authority for severe enforcement

## Moderation Pipeline

1. `Ingestion`: content is created or edited (`post`, `reply`, `profile`, `media metadata`)
2. `Rule Engine`: deterministic checks run first (blocklist, rate, duplicate, URL risk)
3. `Model Inference`: open-source classifiers produce category scores
4. `Policy Evaluator`: maps scores + context to policy labels/actions
5. `Action Router`: publish actions:
   - allow
   - allow + label
   - soft-limit visibility
   - queue for review
   - temporarily hide pending review
6. `Audit Log`: persist features, model versions, thresholds, and decision reason

## Model Stack (Open-Source)

- Text toxicity/harassment:
  - `Detoxify` variants or equivalent OSS toxicity classifiers
  - Optional multilingual fallback with lightweight transformer models
- Spam/phishing detection:
  - Fine-tuned open-source encoder (e.g., `XLM-R`, `MiniLM`) + heuristics
- NSFW/media safety:
  - Open-source vision classifiers running on self-hosted inference
- Coordinated abuse signals:
  - Graph features + anomaly models trained on platform events

Inference runtime:

- `vLLM` for high-throughput text models
- `Ollama` for local/dev and small deployments
- `Text Generation Inference (TGI)` if model serving standardization is needed

## Decision Policy

Each inference returns:

- `policy_labels`: e.g., `toxicity.high`, `spam.suspected`, `harassment.targeted`
- `confidence`: 0.0-1.0
- `model_version`
- `feature_snapshot_id`
- `recommended_action`

The policy engine applies explicit thresholds by content type and author trust tier:

- Tier A: new/low-trust users (stricter)
- Tier B: established users
- Tier C: trusted contributors (higher tolerance before hard action)

## Human-in-the-Loop

- `Auto-action` only for high-confidence, low-ambiguity categories
- `Moderator queue` for borderline/severe categories
- `Appeals` always available for non-trivial penalties
- Sampling-based QA to catch model drift and unfair bias

## Data Governance

- Retain minimum text excerpts for decision reproducibility
- Hash/highlight sensitive features instead of storing full payload when possible
- Role-based access to moderation evidence
- Expiring storage for low-risk events

## Reliability and Safety Controls

- Canary rollout for model updates
- Shadow-mode scoring before enabling new enforcement thresholds
- Rollback switch by model version
- SLOs:
  - P95 inference latency < 300ms for text classification
  - Queueing delay < 60s for review-targeted content
  - False-positive budget tracked weekly by category

## Implementation Interfaces

- `ModerationEvent`: normalized content and metadata payload
- `ModerationSignal`: model outputs + reason codes
- `ModerationDecision`: final policy outcome + routing target
- `ModerationAuditRecord`: immutable event for compliance and debugging
