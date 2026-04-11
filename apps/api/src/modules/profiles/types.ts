export type ProfileProvider = "google";
export type ProfilePostInteractionAction =
  | "seen"
  | "liked"
  | "disliked"
  | "neutral"
  | "saved"
  | "unsaved"
  | "reposted"
  | "unreposted"
  | "commented";

export interface ProfilePostInteractionHistory {
  seen_post_ids: string[];
  liked_post_ids: string[];
  disliked_post_ids: string[];
  neutral_post_ids: string[];
  saved_post_ids: string[];
  reposted_post_ids: string[];
  commented_post_ids: string[];
}

export interface ProfileDailyQuotaRecord {
  bytes_used: number;
  limit_bytes: number;
  remaining_bytes: number;
}

export interface ProfilePrivateEncryptedBlock {
  algorithm: string;
  key_fingerprint: string;
  iv_base64: string;
  ciphertext_base64: string;
  updated_at: string;
}

export interface ProfilePrivateCryptoBundle {
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt_base64: string;
  wrap_iv_base64: string;
  wrapped_master_key_base64: string;
  updated_at: string;
}

export interface ProfileLedgerUserRecord {
  user_id: string;
  provider: ProfileProvider;
  provider_subject_hash: string;
  username: string;
  username_normalized: string;
  usertag: string;
  name: string;
  bio: string;
  location: string;
  avatar_url: string;
  banner_url: string;
  share_social_graph: boolean;
  following_handles: string[];
  follower_handles: string[];
  posts: string[];
  post_interaction_history: ProfilePostInteractionHistory;
  private_profile_encrypted?: ProfilePrivateEncryptedBlock;
  private_crypto_bundle?: ProfilePrivateCryptoBundle;
  created_at: string;
  updated_at: string;
}

export interface ProfileLedger {
  ledger_version: string;
  generated_at: string;
  users: Record<string, ProfileLedgerUserRecord>;
  username_index: Record<string, string>;
  usertag_index: Record<string, string>;
  daily_ledger_quota_by_user: Record<string, Record<string, ProfileDailyQuotaRecord>>;
}

export interface SessionSyncInput {
  provider: ProfileProvider;
  subject: string;
  name: string;
  email?: string;
  picture?: string;
}

export interface ProfileUpdateInput {
  provider: ProfileProvider;
  subject: string;
  name: string;
  username: string;
  handle: string;
  bio: string;
  location: string;
  avatarUrl: string;
  bannerUrl: string;
  shareSocialGraph: boolean;
}

export interface SetFollowInput {
  provider: ProfileProvider;
  subject: string;
  targetHandle: string;
  follow: boolean;
}

export interface RecordPostInteractionInput {
  provider: ProfileProvider;
  subject: string;
  postId: string;
  action: ProfilePostInteractionAction;
}

export interface RecordCreatedPostInput {
  provider: ProfileProvider;
  subject: string;
  postId: string;
  anonymous?: boolean;
}

export interface PublicProfile {
  userId: string;
  provider: ProfileProvider;
  name: string;
  username: string;
  handle: string;
  bio: string;
  location: string;
  avatarUrl: string;
  bannerUrl: string;
  shareSocialGraph: boolean;
  followingHandles: string[];
  followerCount: number;
  followingCount: number;
  posts: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePrivateEncryptedBlockInput {
  provider: ProfileProvider;
  subject: string;
  algorithm: string;
  keyFingerprint: string;
  ivBase64: string;
  ciphertextBase64: string;
}

export interface UpdatePrivateCryptoBundleInput {
  provider: ProfileProvider;
  subject: string;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  saltBase64: string;
  wrapIvBase64: string;
  wrappedMasterKeyBase64: string;
}
