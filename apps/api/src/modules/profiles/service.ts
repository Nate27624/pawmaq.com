import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  ProfileLedger,
  ProfileLinkedAuthIdentity,
  ProfilePrivateCryptoBundle,
  ProfileDailyQuotaRecord,
  ProfilePrivateEncryptedBlock,
  ProfilePostInteractionHistory,
  ProfileLedgerUserRecord,
  ProfileProvider,
  EnsureBotProfileInput,
  RecordCreatedPostByHandleInput,
  RecordCreatedPostInput,
  RecordPostInteractionInput,
  ProfileUpdateInput,
  PublicProfile,
  SessionSyncInput,
  SetFollowInput,
  UpdatePrivateCryptoBundleInput,
  UpdatePrivateEncryptedBlockInput
} from "./types.js";

const DAILY_LEDGER_LIMIT_BYTES = 200 * 1024 * 1024;

function hashFromString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").slice(0, 64);
}

function normalizeHandle(value: string): string {
  const stripped = value.trim().replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (stripped.length < 2 || stripped.length > 32) {
    throw new Error("Handle must be 2-32 characters using letters, numbers, dot, underscore, or dash.");
  }
  return `@${stripped}`;
}

function fallbackUsernameFromName(name: string): string {
  const normalized = normalizeUsername(name);
  return normalized.length >= 2 ? normalized : "member";
}

function formatAnonymousAlias(sequence: number): string {
  const safe = Number.isFinite(sequence) ? Math.max(1, Math.floor(sequence)) : 1;
  return `Anonymous${safe.toString().padStart(6, "0")}`;
}

function dedupeAndSort(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizePostIds(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const entry of values) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function avatarFallback(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
  const safeInitials = (initials || "U").replace(/[^A-Z0-9]/g, "").slice(0, 2) || "U";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256' viewBox='0 0 256 256'><rect width='256' height='256' fill='#1f2937'/><text x='50%' y='53%' dominant-baseline='middle' text-anchor='middle' font-family='Arial,sans-serif' font-size='96' font-weight='700' fill='#ffffff'>${safeInitials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function isGoogleAccountAvatarUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname.includes("googleusercontent.com") ||
      hostname.includes("ggpht.com") ||
      hostname.includes("google.com")
    );
  } catch {
    return false;
  }
}

function bannerFallback(seed: string): string {
  const hue = Number.parseInt(hashFromString(seed).slice(0, 2), 16) % 360;
  return `https://singlecolorimage.com/get/${hue.toString(16).padStart(2, "0")}3b5f/1200x320`;
}

function emptyPostInteractionHistory(): ProfilePostInteractionHistory {
  return {
    seen_post_ids: [],
    liked_post_ids: [],
    disliked_post_ids: [],
    neutral_post_ids: [],
    saved_post_ids: [],
    reposted_post_ids: [],
    commented_post_ids: []
  };
}

function normalizePostInteractionHistory(
  raw: Partial<ProfilePostInteractionHistory> | undefined
): ProfilePostInteractionHistory {
  const source = raw ?? {};
  const readIds = (values: unknown): string[] => {
    if (!Array.isArray(values)) {
      return [];
    }
    return dedupeAndSort(values.filter((value): value is string => typeof value === "string" && value.length > 0));
  };
  return {
    seen_post_ids: readIds(source.seen_post_ids),
    liked_post_ids: readIds(source.liked_post_ids),
    disliked_post_ids: readIds(source.disliked_post_ids),
    neutral_post_ids: readIds(source.neutral_post_ids),
    saved_post_ids: readIds(source.saved_post_ids),
    reposted_post_ids: readIds(source.reposted_post_ids),
    commented_post_ids: readIds(source.commented_post_ids)
  };
}

function isoDateYmd(iso: string): string {
  return iso.slice(0, 10);
}

function bytesFromJson(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function hashProviderSubject(provider: ProfileProvider, subject: string): string {
  return createHash("sha256")
    .update(`${provider}:${subject.trim()}`)
    .digest("hex");
}

function authIdentityKey(provider: ProfileProvider, providerSubjectHash: string): string {
  return `${provider}:${providerSubjectHash}`;
}

function normalizeAccountId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
}

function normalizeLinkedAuthIdentities(
  raw: unknown,
  fallbackProvider: ProfileProvider,
  fallbackProviderSubjectHash: string
): ProfileLinkedAuthIdentity[] {
  const fallbackIdentity: ProfileLinkedAuthIdentity = {
    provider: fallbackProvider,
    provider_subject_hash: fallbackProviderSubjectHash,
    linked_at: new Date().toISOString()
  };
  if (!Array.isArray(raw)) {
    return [fallbackIdentity];
  }
  const deduped = new Map<string, ProfileLinkedAuthIdentity>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<ProfileLinkedAuthIdentity>;
    const provider: ProfileProvider =
      candidate.provider === "bot" ? "bot" : candidate.provider === "passkey" ? "passkey" : "google";
    const providerSubjectHash =
      typeof candidate.provider_subject_hash === "string" ? candidate.provider_subject_hash.trim().toLowerCase() : "";
    if (!providerSubjectHash) {
      continue;
    }
    const key = authIdentityKey(provider, providerSubjectHash);
    if (deduped.has(key)) {
      continue;
    }
    deduped.set(key, {
      provider,
      provider_subject_hash: providerSubjectHash,
      linked_at:
        typeof candidate.linked_at === "string" && candidate.linked_at.trim().length > 0
          ? candidate.linked_at
          : new Date().toISOString()
    });
  }
  const fallbackKey = authIdentityKey(fallbackProvider, fallbackProviderSubjectHash);
  if (!deduped.has(fallbackKey)) {
    deduped.set(fallbackKey, fallbackIdentity);
  }
  return [...deduped.values()];
}

function normalizePrivateEncryptedBlock(raw: unknown): ProfilePrivateEncryptedBlock | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<ProfilePrivateEncryptedBlock>;
  if (
    typeof candidate.algorithm !== "string" ||
    typeof candidate.key_fingerprint !== "string" ||
    typeof candidate.iv_base64 !== "string" ||
    typeof candidate.ciphertext_base64 !== "string"
  ) {
    return undefined;
  }
  return {
    algorithm: candidate.algorithm.slice(0, 80),
    key_fingerprint: candidate.key_fingerprint.slice(0, 160),
    iv_base64: candidate.iv_base64.slice(0, 240),
    ciphertext_base64: candidate.ciphertext_base64.slice(0, 1_200_000),
    updated_at: typeof candidate.updated_at === "string" ? candidate.updated_at : new Date().toISOString()
  };
}

function normalizePrivateCryptoBundle(raw: unknown): ProfilePrivateCryptoBundle | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<ProfilePrivateCryptoBundle>;
  if (
    candidate.kdf !== "PBKDF2-SHA256" ||
    typeof candidate.iterations !== "number" ||
    !Number.isFinite(candidate.iterations) ||
    candidate.iterations < 50_000 ||
    candidate.iterations > 5_000_000 ||
    typeof candidate.salt_base64 !== "string" ||
    typeof candidate.wrap_iv_base64 !== "string" ||
    typeof candidate.wrapped_master_key_base64 !== "string"
  ) {
    return undefined;
  }
  return {
    kdf: "PBKDF2-SHA256",
    iterations: Math.floor(candidate.iterations),
    salt_base64: candidate.salt_base64.slice(0, 512),
    wrap_iv_base64: candidate.wrap_iv_base64.slice(0, 512),
    wrapped_master_key_base64: candidate.wrapped_master_key_base64.slice(0, 4096),
    updated_at: typeof candidate.updated_at === "string" ? candidate.updated_at : new Date().toISOString()
  };
}

function toPublicProfile(record: ProfileLedgerUserRecord): PublicProfile {
  return {
    userId: record.user_id,
    accountId: record.account_id,
    provider: record.provider,
    linkedAuthProviders: [...new Set(record.linked_auth_identities.map((identity) => identity.provider))],
    name: record.name,
    username: record.username,
    handle: record.usertag,
    bio: record.bio,
    location: record.location,
    avatarUrl: record.avatar_url,
    bannerUrl: record.banner_url,
    shareSocialGraph: record.share_social_graph,
    followingHandles: dedupeAndSort(record.following_handles),
    followerCount: dedupeAndSort(record.follower_handles).length,
    followingCount: dedupeAndSort(record.following_handles).length,
    posts: normalizePostIds(record.posts),
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

export class ProfileLedgerService {
  private readonly ledgerPath: string;

  private ledgerCache: ProfileLedger | null = null;

  private loadingLedgerPromise: Promise<ProfileLedger> | null = null;

  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(ledgerPath: string) {
    this.ledgerPath = resolve(process.cwd(), ledgerPath);
  }

  async getByHandle(rawHandle: string): Promise<PublicProfile | null> {
    const handle = normalizeHandle(rawHandle);
    const ledger = await this.getLedger();
    const userId = ledger.usertag_index[handle];
    if (!userId) {
      return null;
    }
    const record = ledger.users[userId];
    if (!record) {
      return null;
    }
    return toPublicProfile(record);
  }

  async getByProviderSubject(provider: ProfileProvider, subject: string): Promise<PublicProfile | null> {
    const ledger = await this.getLedger();
    const record = this.findByProviderSubject(ledger, provider, subject);
    if (!record) {
      return null;
    }
    return toPublicProfile(record);
  }

  async getLedgerSnapshot(): Promise<ProfileLedger> {
    const ledger = await this.getLedger();
    return structuredClone(ledger);
  }

  async syncSession(input: SessionSyncInput): Promise<PublicProfile> {
    return this.mutateLedger((ledger) => {
      const existing = this.findByProviderSubject(ledger, input.provider, input.subject);
      if (existing) {
        const nowIso = new Date().toISOString();
        this.applyDailyLedgerQuota(ledger, existing.user_id, bytesFromJson(input), nowIso);
        this.upsertLinkedIdentity(ledger, existing, input.provider, hashProviderSubject(input.provider, input.subject), nowIso);
        const incomingName = input.name.trim().slice(0, 120);
        if (!existing.name.trim() || existing.name.trim().toLowerCase() === "member") {
          existing.name = incomingName || existing.name;
        }
        existing.posts = normalizePostIds(existing.posts);
        existing.post_interaction_history = normalizePostInteractionHistory(existing.post_interaction_history);
        if (!existing.avatar_url || isGoogleAccountAvatarUrl(existing.avatar_url)) {
          existing.avatar_url = avatarFallback(existing.name);
        }
        existing.updated_at = nowIso;
        return toPublicProfile(existing);
      }

      const nowIso = new Date().toISOString();
      const userId = this.generateUniqueUserId(ledger);
      const accountId = this.generateUniqueAccountId(ledger);
      this.applyDailyLedgerQuota(ledger, userId, bytesFromJson(input), nowIso);
      ledger.anonymous_user_sequence = Math.max(0, Math.floor(ledger.anonymous_user_sequence)) + 1;
      const anonymousAlias = formatAnonymousAlias(ledger.anonymous_user_sequence);
      const username = this.ensureUniqueUsername(ledger, anonymousAlias, userId);
      const handle = this.ensureUniqueHandle(ledger, `@${username}`, userId);
      const providerSubjectHash = hashProviderSubject(input.provider, input.subject);

      const record: ProfileLedgerUserRecord = {
        user_id: userId,
        account_id: accountId,
        provider: input.provider,
        provider_subject_hash: providerSubjectHash,
        linked_auth_identities: [
          {
            provider: input.provider,
            provider_subject_hash: providerSubjectHash,
            linked_at: nowIso
          }
        ],
        username,
        username_normalized: normalizeUsername(username),
        usertag: handle,
        name: anonymousAlias,
        bio: "",
        location: "",
        avatar_url: avatarFallback(anonymousAlias),
        banner_url: bannerFallback(`${input.provider}:${hashProviderSubject(input.provider, input.subject)}`),
        share_social_graph: true,
        following_handles: [],
        follower_handles: [],
        posts: [],
        post_interaction_history: emptyPostInteractionHistory(),
        created_at: nowIso,
        updated_at: nowIso
      };

      ledger.users[userId] = record;
      ledger.account_index[accountId] = userId;
      ledger.auth_identity_index[authIdentityKey(input.provider, providerSubjectHash)] = userId;
      ledger.username_index[record.username_normalized] = userId;
      ledger.usertag_index[record.usertag] = userId;
      return toPublicProfile(record);
    });
  }

  async linkProviderSubjectToAccount(input: {
    accountProvider: ProfileProvider;
    accountSubject: string;
    identityProvider: ProfileProvider;
    identitySubject: string;
  }): Promise<PublicProfile> {
    return this.mutateLedger((ledger) => {
      const nowIso = new Date().toISOString();
      const accountRecord = this.findByProviderSubjectRawIdentity(
        ledger,
        input.accountProvider,
        input.accountSubject
      );
      if (!accountRecord) {
        throw new Error("Account profile not found for signed-in user.");
      }
      const identityHash = hashProviderSubject(input.identityProvider, input.identitySubject);
      const linkedIdentityRecord = this.findByProviderSubjectRawIdentity(
        ledger,
        input.identityProvider,
        input.identitySubject
      );

      let primary = this.resolvePrimaryAccountRecord(ledger, accountRecord.account_id) ?? accountRecord;
      if (linkedIdentityRecord && linkedIdentityRecord.user_id !== primary.user_id) {
        const linkedPrimary = this.resolvePrimaryAccountRecord(ledger, linkedIdentityRecord.account_id) ?? linkedIdentityRecord;
        if (linkedPrimary.account_id !== primary.account_id) {
          primary = this.mergeAccountIntoAccount(ledger, primary.account_id, linkedPrimary.account_id, nowIso);
        }
      }

      this.upsertLinkedIdentity(ledger, primary, input.identityProvider, identityHash, nowIso);
      primary.updated_at = nowIso;
      return toPublicProfile(primary);
    });
  }

  async ensureBotProfile(input: EnsureBotProfileInput): Promise<PublicProfile> {
    return this.mutateLedger((ledger) => {
      const nowIso = new Date().toISOString();
      const normalizedHandle = normalizeHandle(input.handle);
      const existingUserId = ledger.usertag_index[normalizedHandle];
      const botSubject = input.botSubject.trim().slice(0, 240) || `rss:${normalizedHandle}`;
      const fallbackName = input.name.trim().slice(0, 120) || "RSS Bot";

      if (existingUserId) {
        const existing = ledger.users[existingUserId];
        if (existing) {
          const nowHash = hashProviderSubject("bot", botSubject);
          existing.provider = "bot";
          existing.provider_subject_hash = nowHash;
          this.upsertLinkedIdentity(ledger, existing, "bot", nowHash, nowIso);
          existing.name = fallbackName;
          if (typeof input.bio === "string") {
            existing.bio = input.bio.trim().slice(0, 300);
          }
          if (typeof input.location === "string") {
            existing.location = input.location.trim().slice(0, 120);
          }
          if (typeof input.avatarUrl === "string" && input.avatarUrl.trim().length > 0) {
            existing.avatar_url = input.avatarUrl.trim();
          }
          if (typeof input.bannerUrl === "string" && input.bannerUrl.trim().length > 0) {
            existing.banner_url = input.bannerUrl.trim();
          }
          existing.posts = normalizePostIds(existing.posts);
          existing.post_interaction_history = normalizePostInteractionHistory(existing.post_interaction_history);
          existing.updated_at = nowIso;
          return toPublicProfile(existing);
        }
      }

      const userId = this.generateUniqueUserId(ledger);
      const accountId = this.generateUniqueAccountId(ledger);
      const providerSubjectHash = hashProviderSubject("bot", botSubject);
      const baseUsername = normalizeUsername(input.username ?? normalizedHandle.replace(/^@/, "")) || "rssbot";
      const username = this.ensureUniqueUsername(ledger, baseUsername, userId);
      const handle = this.ensureUniqueHandle(ledger, normalizedHandle, userId);
      const record: ProfileLedgerUserRecord = {
        user_id: userId,
        account_id: accountId,
        provider: "bot",
        provider_subject_hash: providerSubjectHash,
        linked_auth_identities: [
          {
            provider: "bot",
            provider_subject_hash: providerSubjectHash,
            linked_at: nowIso
          }
        ],
        username,
        username_normalized: normalizeUsername(username),
        usertag: handle,
        name: fallbackName,
        bio: typeof input.bio === "string" ? input.bio.trim().slice(0, 300) : "",
        location: typeof input.location === "string" ? input.location.trim().slice(0, 120) : "",
        avatar_url:
          typeof input.avatarUrl === "string" && input.avatarUrl.trim().length > 0
            ? input.avatarUrl.trim()
            : avatarFallback(fallbackName),
        banner_url:
          typeof input.bannerUrl === "string" && input.bannerUrl.trim().length > 0
            ? input.bannerUrl.trim()
            : bannerFallback(`bot:${botSubject}`),
        share_social_graph: false,
        following_handles: [],
        follower_handles: [],
        posts: [],
        post_interaction_history: emptyPostInteractionHistory(),
        created_at: nowIso,
        updated_at: nowIso
      };
      ledger.users[userId] = record;
      ledger.account_index[accountId] = userId;
      ledger.auth_identity_index[authIdentityKey("bot", providerSubjectHash)] = userId;
      ledger.username_index[record.username_normalized] = userId;
      ledger.usertag_index[record.usertag] = userId;
      return toPublicProfile(record);
    });
  }

  async recordCreatedPostByHandle(input: RecordCreatedPostByHandleInput): Promise<PublicProfile | null> {
    return this.mutateLedger((ledger) => {
      const postId = input.postId.trim();
      if (!postId) {
        throw new Error("Post id is required.");
      }
      const handle = normalizeHandle(input.handle);
      const userId = ledger.usertag_index[handle];
      if (!userId) {
        return null;
      }
      const record = ledger.users[userId];
      if (!record) {
        return null;
      }
      const nextPosts = [postId, ...normalizePostIds(record.posts).filter((existing) => existing !== postId)];
      record.posts = nextPosts.slice(0, 50000);
      record.updated_at = new Date().toISOString();
      return toPublicProfile(record);
    });
  }

  async updateOwnProfile(input: ProfileUpdateInput): Promise<PublicProfile> {
    return this.mutateLedger((ledger) => {
      const record = this.findByProviderSubject(ledger, input.provider, input.subject);
      if (!record) {
        throw new Error("Profile not found for signed-in user.");
      }

      const trimmedName = input.name.trim();
      if (trimmedName.length === 0 || trimmedName.length > 120) {
        throw new Error("Name must be between 1 and 120 characters.");
      }

      const normalizedUsername = normalizeUsername(input.username);
      if (normalizedUsername.length < 2) {
        throw new Error("Username must contain at least 2 valid characters.");
      }

      const nextHandle = normalizeHandle(input.handle);
      const currentHandle = record.usertag;
      const nowIso = new Date().toISOString();
      this.applyDailyLedgerQuota(ledger, record.user_id, bytesFromJson(input), nowIso);

      const usernameOwner = ledger.username_index[normalizedUsername];
      if (usernameOwner && usernameOwner !== record.user_id) {
        throw new Error("Username is already taken.");
      }

      const handleOwner = ledger.usertag_index[nextHandle];
      if (handleOwner && handleOwner !== record.user_id) {
        throw new Error("Handle is already taken.");
      }

      if (record.username_normalized !== normalizedUsername) {
        delete ledger.username_index[record.username_normalized];
        ledger.username_index[normalizedUsername] = record.user_id;
      }

      if (currentHandle !== nextHandle) {
        delete ledger.usertag_index[currentHandle];
        ledger.usertag_index[nextHandle] = record.user_id;
        this.replaceHandleReferencesAcrossLedger(ledger, currentHandle, nextHandle);
      }

      record.name = trimmedName;
      record.username = normalizedUsername;
      record.username_normalized = normalizedUsername;
      record.usertag = nextHandle;
      record.bio = input.bio.trim().slice(0, 300);
      record.location = input.location.trim().slice(0, 120);
      record.avatar_url = input.avatarUrl.trim() || avatarFallback(trimmedName);
      record.banner_url = input.bannerUrl.trim() || bannerFallback(`${record.provider}:${record.provider_subject_hash}`);
      record.share_social_graph = input.shareSocialGraph;
      record.following_handles = dedupeAndSort(record.following_handles);
      record.follower_handles = dedupeAndSort(record.follower_handles);
      record.updated_at = nowIso;

      return toPublicProfile(record);
    });
  }

  async setFollow(input: SetFollowInput): Promise<PublicProfile> {
    return this.mutateLedger((ledger) => {
      const viewer = this.findByProviderSubject(ledger, input.provider, input.subject);
      if (!viewer) {
        throw new Error("Profile not found for signed-in user.");
      }
      this.applyDailyLedgerQuota(ledger, viewer.user_id, bytesFromJson(input), new Date().toISOString());

      const targetHandle = normalizeHandle(input.targetHandle);
      if (targetHandle === viewer.usertag) {
        throw new Error("Cannot follow your own profile.");
      }

      const viewerFollowing = new Set(viewer.following_handles);
      if (input.follow) {
        viewerFollowing.add(targetHandle);
      } else {
        viewerFollowing.delete(targetHandle);
      }
      viewer.following_handles = dedupeAndSort([...viewerFollowing]);
      viewer.updated_at = new Date().toISOString();

      const targetUserId = ledger.usertag_index[targetHandle];
      if (targetUserId) {
        const target = ledger.users[targetUserId];
        if (target) {
          const followers = new Set(target.follower_handles);
          if (input.follow) {
            followers.add(viewer.usertag);
          } else {
            followers.delete(viewer.usertag);
          }
          target.follower_handles = dedupeAndSort([...followers]);
          target.updated_at = new Date().toISOString();
        }
      }

      return toPublicProfile(viewer);
    });
  }

  async recordPostInteraction(input: RecordPostInteractionInput): Promise<void> {
    return this.mutateLedger((ledger) => {
      const record = this.findByProviderSubject(ledger, input.provider, input.subject);
      if (!record) {
        throw new Error("Profile not found for signed-in user.");
      }
      this.applyDailyLedgerQuota(ledger, record.user_id, bytesFromJson(input), new Date().toISOString());

      const postId = input.postId.trim();
      if (!postId) {
        throw new Error("Post id is required.");
      }

      const history = normalizePostInteractionHistory(record.post_interaction_history);
      const add = (list: string[]) => dedupeAndSort([...list, postId]);
      const remove = (list: string[]) => dedupeAndSort(list.filter((value) => value !== postId));

      history.seen_post_ids = add(history.seen_post_ids);

      switch (input.action) {
        case "liked":
          history.liked_post_ids = add(history.liked_post_ids);
          history.disliked_post_ids = remove(history.disliked_post_ids);
          history.neutral_post_ids = remove(history.neutral_post_ids);
          break;
        case "disliked":
          history.disliked_post_ids = add(history.disliked_post_ids);
          history.liked_post_ids = remove(history.liked_post_ids);
          history.neutral_post_ids = remove(history.neutral_post_ids);
          break;
        case "neutral":
          history.neutral_post_ids = add(history.neutral_post_ids);
          history.liked_post_ids = remove(history.liked_post_ids);
          history.disliked_post_ids = remove(history.disliked_post_ids);
          break;
        case "saved":
          history.saved_post_ids = add(history.saved_post_ids);
          break;
        case "unsaved":
          history.saved_post_ids = remove(history.saved_post_ids);
          break;
        case "reposted":
          history.reposted_post_ids = add(history.reposted_post_ids);
          break;
        case "unreposted":
          history.reposted_post_ids = remove(history.reposted_post_ids);
          break;
        case "commented":
          history.commented_post_ids = add(history.commented_post_ids);
          break;
        case "seen":
          break;
        default:
          break;
      }

      record.post_interaction_history = history;
      record.updated_at = new Date().toISOString();
    });
  }

  async recordCreatedPost(input: RecordCreatedPostInput): Promise<PublicProfile> {
    return this.mutateLedger((ledger) => {
      const record = this.findByProviderSubject(ledger, input.provider, input.subject);
      if (!record) {
        throw new Error("Profile not found for signed-in user.");
      }
      this.applyDailyLedgerQuota(ledger, record.user_id, bytesFromJson(input), new Date().toISOString());

      const postId = input.postId.trim();
      if (!postId) {
        throw new Error("Post id is required.");
      }

      if (input.anonymous === true) {
        // Anonymous posts should never be attached to the user's profile ledger post list.
        const existing = normalizePostIds(record.posts);
        record.posts = existing.filter((value) => value !== postId);
        record.updated_at = new Date().toISOString();
        return toPublicProfile(record);
      }

      const nextPosts = [postId, ...normalizePostIds(record.posts).filter((existing) => existing !== postId)];
      // Keep only most recent references to avoid unbounded ledger growth.
      record.posts = nextPosts.slice(0, 50000);
      record.updated_at = new Date().toISOString();
      return toPublicProfile(record);
    });
  }

  async updatePrivateEncryptedBlock(input: UpdatePrivateEncryptedBlockInput): Promise<void> {
    return this.mutateLedger((ledger) => {
      const record = this.findByProviderSubject(ledger, input.provider, input.subject);
      if (!record) {
        throw new Error("Profile not found for signed-in user.");
      }
      this.applyDailyLedgerQuota(ledger, record.user_id, bytesFromJson(input), new Date().toISOString());
      record.private_profile_encrypted = {
        algorithm: input.algorithm.trim().slice(0, 80),
        key_fingerprint: input.keyFingerprint.trim().slice(0, 160),
        iv_base64: input.ivBase64.trim().slice(0, 240),
        ciphertext_base64: input.ciphertextBase64.trim().slice(0, 1_200_000),
        updated_at: new Date().toISOString()
      };
      record.updated_at = new Date().toISOString();
    });
  }

  async updatePrivateCryptoBundle(input: UpdatePrivateCryptoBundleInput): Promise<void> {
    return this.mutateLedger((ledger) => {
      const record = this.findByProviderSubject(ledger, input.provider, input.subject);
      if (!record) {
        throw new Error("Profile not found for signed-in user.");
      }
      this.applyDailyLedgerQuota(ledger, record.user_id, bytesFromJson(input), new Date().toISOString());
      record.private_crypto_bundle = {
        kdf: "PBKDF2-SHA256",
        iterations: Math.max(50_000, Math.floor(input.iterations)),
        salt_base64: input.saltBase64.trim().slice(0, 512),
        wrap_iv_base64: input.wrapIvBase64.trim().slice(0, 512),
        wrapped_master_key_base64: input.wrappedMasterKeyBase64.trim().slice(0, 4096),
        updated_at: new Date().toISOString()
      };
      record.updated_at = new Date().toISOString();
    });
  }

  async getPrivateEncryptedBlock(
    provider: ProfileProvider,
    subject: string
  ): Promise<ProfilePrivateEncryptedBlock | null> {
    const ledger = await this.getLedger();
    const record = this.findByProviderSubject(ledger, provider, subject);
    if (!record || !record.private_profile_encrypted) {
      return null;
    }
    return structuredClone(record.private_profile_encrypted);
  }

  async getPrivateCryptoBundle(
    provider: ProfileProvider,
    subject: string
  ): Promise<ProfilePrivateCryptoBundle | null> {
    const ledger = await this.getLedger();
    const record = this.findByProviderSubject(ledger, provider, subject);
    if (!record || !record.private_crypto_bundle) {
      return null;
    }
    return structuredClone(record.private_crypto_bundle);
  }

  private async getLedger(): Promise<ProfileLedger> {
    if (this.ledgerCache) {
      return this.ledgerCache;
    }

    if (this.loadingLedgerPromise) {
      return this.loadingLedgerPromise;
    }

    this.loadingLedgerPromise = this.loadLedgerFromDisk().finally(() => {
      this.loadingLedgerPromise = null;
    });
    this.ledgerCache = await this.loadingLedgerPromise;
    return this.ledgerCache;
  }

  private async loadLedgerFromDisk(): Promise<ProfileLedger> {
    await mkdir(dirname(this.ledgerPath), { recursive: true });

    try {
      const raw = await readFile(this.ledgerPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ProfileLedger>;
      if (
        typeof parsed !== "object" ||
        !parsed ||
        typeof parsed.ledger_version !== "string" ||
        typeof parsed.generated_at !== "string" ||
        typeof parsed.users !== "object" ||
        !parsed.users ||
        typeof parsed.username_index !== "object" ||
        !parsed.username_index ||
        typeof parsed.usertag_index !== "object" ||
        !parsed.usertag_index
      ) {
        throw new Error("Profile ledger shape is invalid.");
      }

      let shouldPersistSanitizedLedger = false;
      const rawUsers = parsed.users as Record<string, ProfileLedgerUserRecord & {
        provider_subject?: string;
        email?: string;
        account_id?: string;
        linked_auth_identities?: unknown;
      }>;
      const users: Record<string, ProfileLedgerUserRecord> = {};
      const remappedUserIds = new Map<string, string>();

      for (const [rawUserId, source] of Object.entries(rawUsers)) {
        if (!source || typeof source !== "object") {
          continue;
        }
        const provider: ProfileProvider =
          source.provider === "bot" ? "bot" : source.provider === "passkey" ? "passkey" : "google";
        const legacySubject = typeof source.provider_subject === "string" ? source.provider_subject.trim() : "";
        const subjectHashRaw =
          typeof source.provider_subject_hash === "string" ? source.provider_subject_hash.trim().toLowerCase() : "";
        const providerSubjectHash =
          subjectHashRaw || (legacySubject ? hashProviderSubject(provider, legacySubject) : "");
        if (!providerSubjectHash) {
          shouldPersistSanitizedLedger = true;
          continue;
        }

        let userId =
          typeof source.user_id === "string" && source.user_id.trim().length > 0
            ? source.user_id.trim()
            : rawUserId.trim();
        const userIdLeaksLegacySubject = legacySubject.length > 0 && userId.includes(legacySubject);
        if (!userId || userIdLeaksLegacySubject || users[userId]) {
          userId = this.generateUniqueUserId({ users } as ProfileLedger);
          shouldPersistSanitizedLedger = true;
        }
        if (userId !== rawUserId) {
          remappedUserIds.set(rawUserId, userId);
          shouldPersistSanitizedLedger = true;
        }
        if (legacySubject) {
          shouldPersistSanitizedLedger = true;
        }
        if (typeof source.email === "string") {
          shouldPersistSanitizedLedger = true;
        }

        const safeName = typeof source.name === "string" && source.name.trim().length > 0
          ? source.name.trim().slice(0, 120)
          : "Member";
        const usernameSeed = typeof source.username === "string" && source.username.trim().length > 0
          ? source.username
          : fallbackUsernameFromName(safeName);
        const normalizedUsername = normalizeUsername(usernameSeed) || fallbackUsernameFromName(safeName);
        const handleSeed =
          typeof source.usertag === "string" && source.usertag.trim().length > 0
            ? source.usertag
            : `@${normalizedUsername}`;
        let normalizedHandle: string;
        try {
          normalizedHandle = normalizeHandle(handleSeed);
        } catch {
          normalizedHandle = `@${normalizedUsername.slice(0, 32) || "member"}`;
          shouldPersistSanitizedLedger = true;
        }

        const rawAvatar =
          typeof source.avatar_url === "string" && source.avatar_url.trim().length > 0
            ? source.avatar_url.trim()
            : "";
        const avatarUrl = rawAvatar && !isGoogleAccountAvatarUrl(rawAvatar) ? rawAvatar : avatarFallback(safeName);
        if (avatarUrl !== rawAvatar) {
          shouldPersistSanitizedLedger = true;
        }

        const accountIdSeed =
          typeof source.account_id === "string" && source.account_id.trim().length > 0
            ? source.account_id
            : `acct_${providerSubjectHash.slice(0, 24)}`;
        let accountId = normalizeAccountId(accountIdSeed);
        if (!accountId) {
          accountId = this.generateUniqueAccountId({ account_index: {} } as ProfileLedger);
          shouldPersistSanitizedLedger = true;
        }

        const linkedAuthIdentities = normalizeLinkedAuthIdentities(
          source.linked_auth_identities,
          provider,
          providerSubjectHash
        );
        if (!Array.isArray(source.linked_auth_identities)) {
          shouldPersistSanitizedLedger = true;
        }

        users[userId] = {
          user_id: userId,
          account_id: accountId,
          provider,
          provider_subject_hash: providerSubjectHash,
          linked_auth_identities: linkedAuthIdentities,
          username: normalizedUsername,
          username_normalized: normalizedUsername,
          usertag: normalizedHandle,
          name: safeName,
          bio: typeof source.bio === "string" ? source.bio.trim().slice(0, 300) : "",
          location: typeof source.location === "string" ? source.location.trim().slice(0, 120) : "",
          avatar_url: avatarUrl,
          banner_url:
            typeof source.banner_url === "string" && source.banner_url.trim().length > 0
              ? source.banner_url.trim()
              : bannerFallback(`${provider}:${providerSubjectHash}`),
          share_social_graph: source.share_social_graph !== false,
          following_handles: dedupeAndSort(
            Array.isArray(source.following_handles)
              ? source.following_handles.filter((value): value is string => typeof value === "string" && value.startsWith("@"))
              : []
          ),
          follower_handles: dedupeAndSort(
            Array.isArray(source.follower_handles)
              ? source.follower_handles.filter((value): value is string => typeof value === "string" && value.startsWith("@"))
              : []
          ),
          posts: normalizePostIds(source.posts),
          post_interaction_history: normalizePostInteractionHistory(source.post_interaction_history),
          private_profile_encrypted: normalizePrivateEncryptedBlock(source.private_profile_encrypted),
          private_crypto_bundle: normalizePrivateCryptoBundle(source.private_crypto_bundle),
          created_at:
            typeof source.created_at === "string" && source.created_at.trim().length > 0
              ? source.created_at
              : new Date().toISOString(),
          updated_at:
            typeof source.updated_at === "string" && source.updated_at.trim().length > 0
              ? source.updated_at
              : new Date().toISOString()
        };
      }

      const normalized: ProfileLedger = {
        ledger_version: parsed.ledger_version,
        generated_at: parsed.generated_at,
        anonymous_user_sequence: 0,
        users,
        account_index: {},
        auth_identity_index: {},
        username_index: {},
        usertag_index: {},
        daily_ledger_quota_by_user: {}
      };

      const rawAnonymousSequence = (parsed as Partial<ProfileLedger>).anonymous_user_sequence;
      const parsedAnonymousSequence =
        typeof rawAnonymousSequence === "number" && Number.isFinite(rawAnonymousSequence)
          ? Math.max(0, Math.floor(rawAnonymousSequence))
          : 0;
      const existingHumanUserCount = Object.values(normalized.users).filter((user) => user.provider !== "bot").length;
      normalized.anonymous_user_sequence = Math.max(parsedAnonymousSequence, existingHumanUserCount);

      for (const record of Object.values(normalized.users)) {
        if (!record.account_id || normalizeAccountId(record.account_id) !== record.account_id) {
          record.account_id = normalizeAccountId(record.account_id) || this.generateUniqueAccountId(normalized);
          shouldPersistSanitizedLedger = true;
        }
        if (!normalized.account_index[record.account_id]) {
          normalized.account_index[record.account_id] = record.user_id;
        }
        const username = this.ensureUniqueUsername(normalized, record.username, record.user_id);
        record.username = username;
        record.username_normalized = normalizeUsername(username);
        normalized.username_index[record.username_normalized] = record.user_id;
        const handle = this.ensureUniqueHandle(normalized, record.usertag, record.user_id);
        record.usertag = handle;
        normalized.usertag_index[handle] = record.user_id;
        record.linked_auth_identities = normalizeLinkedAuthIdentities(
          record.linked_auth_identities,
          record.provider,
          record.provider_subject_hash
        );
        for (const identity of record.linked_auth_identities) {
          const identityKey = authIdentityKey(identity.provider, identity.provider_subject_hash);
          if (!normalized.auth_identity_index[identityKey]) {
            normalized.auth_identity_index[identityKey] = record.user_id;
          } else if (normalized.auth_identity_index[identityKey] !== record.user_id) {
            shouldPersistSanitizedLedger = true;
          }
        }
      }

      if (typeof parsed.daily_ledger_quota_by_user === "object" && parsed.daily_ledger_quota_by_user) {
        for (const [day, byUser] of Object.entries(
          parsed.daily_ledger_quota_by_user as Record<string, Record<string, ProfileDailyQuotaRecord>>
        )) {
          if (!normalized.daily_ledger_quota_by_user[day]) {
            normalized.daily_ledger_quota_by_user[day] = {};
          }
          for (const [rawUserId, quota] of Object.entries(byUser ?? {})) {
            const mappedUserId = remappedUserIds.get(rawUserId) ?? rawUserId;
            if (!normalized.users[mappedUserId]) {
              continue;
            }
            if (mappedUserId !== rawUserId) {
              shouldPersistSanitizedLedger = true;
            }
            const bytesUsed = Number.isFinite(quota?.bytes_used) ? Math.max(0, Math.floor(quota.bytes_used)) : 0;
            const limitBytes = Number.isFinite(quota?.limit_bytes)
              ? Math.max(1, Math.floor(quota.limit_bytes))
              : DAILY_LEDGER_LIMIT_BYTES;
            normalized.daily_ledger_quota_by_user[day][mappedUserId] = {
              bytes_used: bytesUsed,
              limit_bytes: limitBytes,
              remaining_bytes: Math.max(0, limitBytes - bytesUsed)
            };
          }
        }
      }

      if (shouldPersistSanitizedLedger) {
        await this.persistLedger(normalized);
      }
      return normalized;
    } catch {
      const initial: ProfileLedger = {
        ledger_version: "v1.0",
        generated_at: new Date().toISOString(),
        anonymous_user_sequence: 0,
        users: {},
        account_index: {},
        auth_identity_index: {},
        username_index: {},
        usertag_index: {},
        daily_ledger_quota_by_user: {}
      };
      await this.persistLedger(initial);
      return initial;
    }
  }

  private async mutateLedger<T>(mutator: (ledger: ProfileLedger) => T): Promise<T> {
    return this.withMutationLock(async () => {
      const ledger = await this.getLedger();
      const result = mutator(ledger);
      ledger.generated_at = new Date().toISOString();
      await this.persistLedger(ledger);
      return result;
    });
  }

  private async persistLedger(ledger: ProfileLedger): Promise<void> {
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    const tmpPath = `${this.ledgerPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.ledgerPath);
  }

  private async withMutationLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private applyDailyLedgerQuota(
    ledger: ProfileLedger,
    userId: string,
    bytesToAdd: number,
    timestampIso: string
  ): void {
    const safeBytes = Math.max(0, bytesToAdd);
    const day = isoDateYmd(timestampIso);
    if (!ledger.daily_ledger_quota_by_user[day]) {
      ledger.daily_ledger_quota_by_user[day] = {};
    }
    const current = ledger.daily_ledger_quota_by_user[day][userId];
    const used = current?.bytes_used ?? 0;
    const nextUsed = used + safeBytes;
    if (nextUsed > DAILY_LEDGER_LIMIT_BYTES) {
      throw new Error("Daily ledger update cap of 200MB reached.");
    }
    ledger.daily_ledger_quota_by_user[day][userId] = {
      bytes_used: nextUsed,
      limit_bytes: DAILY_LEDGER_LIMIT_BYTES,
      remaining_bytes: Math.max(0, DAILY_LEDGER_LIMIT_BYTES - nextUsed)
    };
  }

  private resolvePrimaryAccountRecord(ledger: ProfileLedger, accountIdRaw: string): ProfileLedgerUserRecord | null {
    const accountId = normalizeAccountId(accountIdRaw);
    if (!accountId) {
      return null;
    }
    const indexedUserId = ledger.account_index[accountId];
    if (indexedUserId && ledger.users[indexedUserId]) {
      return ledger.users[indexedUserId] ?? null;
    }
    for (const record of Object.values(ledger.users)) {
      if (record.account_id === accountId) {
        ledger.account_index[accountId] = record.user_id;
        return record;
      }
    }
    return null;
  }

  private findByProviderSubjectRawIdentity(
    ledger: ProfileLedger,
    provider: ProfileProvider,
    subject: string
  ): ProfileLedgerUserRecord | null {
    const subjectHash = hashProviderSubject(provider, subject);
    const indexedUserId = ledger.auth_identity_index[authIdentityKey(provider, subjectHash)];
    if (indexedUserId && ledger.users[indexedUserId]) {
      return ledger.users[indexedUserId] ?? null;
    }
    const entries = Object.values(ledger.users);
    for (const user of entries) {
      if (user.provider === provider && user.provider_subject_hash === subjectHash) {
        return user;
      }
      if (
        user.linked_auth_identities.some(
          (identity) => identity.provider === provider && identity.provider_subject_hash === subjectHash
        )
      ) {
        return user;
      }
    }
    return null;
  }

  private findByProviderSubject(
    ledger: ProfileLedger,
    provider: ProfileProvider,
    subject: string
  ): ProfileLedgerUserRecord | null {
    const exact = this.findByProviderSubjectRawIdentity(ledger, provider, subject);
    if (!exact) {
      return null;
    }
    return this.resolvePrimaryAccountRecord(ledger, exact.account_id) ?? exact;
  }

  private generateUniqueUserId(ledger: ProfileLedger): string {
    let userId = "";
    do {
      userId = `u_${randomBytes(12).toString("hex")}`;
    } while (ledger.users[userId]);
    return userId;
  }

  private generateUniqueAccountId(ledger: ProfileLedger): string {
    let accountId = "";
    do {
      accountId = `acct_${randomBytes(12).toString("hex")}`;
    } while (ledger.account_index[accountId]);
    return accountId;
  }

  private upsertLinkedIdentity(
    ledger: ProfileLedger,
    record: ProfileLedgerUserRecord,
    provider: ProfileProvider,
    providerSubjectHash: string,
    linkedAtIso: string
  ): void {
    const identityKey = authIdentityKey(provider, providerSubjectHash);
    const existing = record.linked_auth_identities.find(
      (identity) => identity.provider === provider && identity.provider_subject_hash === providerSubjectHash
    );
    if (!existing) {
      record.linked_auth_identities = [
        ...record.linked_auth_identities,
        {
          provider,
          provider_subject_hash: providerSubjectHash,
          linked_at: linkedAtIso
        }
      ];
    }
    ledger.auth_identity_index[identityKey] = record.user_id;
  }

  private mergeAccountIntoAccount(
    ledger: ProfileLedger,
    targetAccountIdRaw: string,
    sourceAccountIdRaw: string,
    nowIso: string
  ): ProfileLedgerUserRecord {
    const targetAccountId = normalizeAccountId(targetAccountIdRaw);
    const sourceAccountId = normalizeAccountId(sourceAccountIdRaw);
    const targetPrimary = this.resolvePrimaryAccountRecord(ledger, targetAccountId);
    if (!targetPrimary) {
      throw new Error("Target account not found.");
    }
    if (!sourceAccountId || targetAccountId === sourceAccountId) {
      return targetPrimary;
    }

    const sourceUsers = Object.values(ledger.users).filter((record) => record.account_id === sourceAccountId);
    for (const source of sourceUsers) {
      if (source.user_id === targetPrimary.user_id) {
        continue;
      }
      targetPrimary.following_handles = dedupeAndSort([...targetPrimary.following_handles, ...source.following_handles]);
      targetPrimary.follower_handles = dedupeAndSort([...targetPrimary.follower_handles, ...source.follower_handles]);
      targetPrimary.posts = normalizePostIds([...targetPrimary.posts, ...source.posts]).slice(0, 50000);

      const targetHistory = normalizePostInteractionHistory(targetPrimary.post_interaction_history);
      const sourceHistory = normalizePostInteractionHistory(source.post_interaction_history);
      targetPrimary.post_interaction_history = {
        seen_post_ids: dedupeAndSort([...targetHistory.seen_post_ids, ...sourceHistory.seen_post_ids]),
        liked_post_ids: dedupeAndSort([...targetHistory.liked_post_ids, ...sourceHistory.liked_post_ids]),
        disliked_post_ids: dedupeAndSort([...targetHistory.disliked_post_ids, ...sourceHistory.disliked_post_ids]),
        neutral_post_ids: dedupeAndSort([...targetHistory.neutral_post_ids, ...sourceHistory.neutral_post_ids]),
        saved_post_ids: dedupeAndSort([...targetHistory.saved_post_ids, ...sourceHistory.saved_post_ids]),
        reposted_post_ids: dedupeAndSort([...targetHistory.reposted_post_ids, ...sourceHistory.reposted_post_ids]),
        commented_post_ids: dedupeAndSort([...targetHistory.commented_post_ids, ...sourceHistory.commented_post_ids])
      };

      if (!targetPrimary.bio && source.bio) {
        targetPrimary.bio = source.bio;
      }
      if (!targetPrimary.location && source.location) {
        targetPrimary.location = source.location;
      }
      if (!targetPrimary.private_profile_encrypted && source.private_profile_encrypted) {
        targetPrimary.private_profile_encrypted = source.private_profile_encrypted;
      }
      if (!targetPrimary.private_crypto_bundle && source.private_crypto_bundle) {
        targetPrimary.private_crypto_bundle = source.private_crypto_bundle;
      }
      if (!targetPrimary.share_social_graph && source.share_social_graph) {
        targetPrimary.share_social_graph = true;
      }
      if (!targetPrimary.avatar_url && source.avatar_url) {
        targetPrimary.avatar_url = source.avatar_url;
      }
      if (!targetPrimary.banner_url && source.banner_url) {
        targetPrimary.banner_url = source.banner_url;
      }
      targetPrimary.created_at =
        new Date(targetPrimary.created_at).getTime() <= new Date(source.created_at).getTime()
          ? targetPrimary.created_at
          : source.created_at;

      for (const identity of source.linked_auth_identities) {
        this.upsertLinkedIdentity(
          ledger,
          targetPrimary,
          identity.provider,
          identity.provider_subject_hash,
          identity.linked_at || nowIso
        );
      }
      this.upsertLinkedIdentity(ledger, targetPrimary, source.provider, source.provider_subject_hash, source.created_at);

      if (source.usertag !== targetPrimary.usertag) {
        this.replaceHandleReferencesAcrossLedger(ledger, source.usertag, targetPrimary.usertag);
      }
      delete ledger.username_index[source.username_normalized];
      delete ledger.usertag_index[source.usertag];
      delete ledger.users[source.user_id];
    }

    for (const [identityKey, userId] of Object.entries(ledger.auth_identity_index)) {
      if (!ledger.users[userId]) {
        delete ledger.auth_identity_index[identityKey];
      }
    }
    delete ledger.account_index[sourceAccountId];
    ledger.account_index[targetAccountId] = targetPrimary.user_id;
    targetPrimary.account_id = targetAccountId;
    targetPrimary.updated_at = nowIso;
    return targetPrimary;
  }

  private ensureUniqueUsername(ledger: ProfileLedger, requested: string, currentUserId: string): string {
    const base = normalizeUsername(requested) || "member";
    let candidate = base;
    let suffix = 2;
    while (true) {
      const owner = ledger.username_index[candidate];
      if (!owner || owner === currentUserId) {
        return candidate;
      }
      candidate = `${base}${suffix}`;
      suffix += 1;
    }
  }

  private ensureUniqueHandle(ledger: ProfileLedger, requested: string, currentUserId: string): string {
    const normalized = normalizeHandle(requested);
    const base = normalized.replace(/^@/, "");
    let candidate = normalized;
    let suffix = 2;
    while (true) {
      const owner = ledger.usertag_index[candidate];
      if (!owner || owner === currentUserId) {
        return candidate;
      }
      candidate = `@${base}${suffix}`;
      suffix += 1;
    }
  }

  private replaceHandleReferencesAcrossLedger(
    ledger: ProfileLedger,
    previousHandle: string,
    nextHandle: string
  ): void {
    for (const record of Object.values(ledger.users)) {
      if (record.usertag === nextHandle) {
        continue;
      }
      record.following_handles = dedupeAndSort(
        record.following_handles.map((handle) => (handle === previousHandle ? nextHandle : handle))
      );
      record.follower_handles = dedupeAndSort(
        record.follower_handles.map((handle) => (handle === previousHandle ? nextHandle : handle))
      );
    }
  }
}
