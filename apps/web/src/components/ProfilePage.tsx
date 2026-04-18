import { useEffect, useState } from "react";

type EditableProfileField =
  | "name"
  | "username"
  | "handle"
  | "bio"
  | "location"
  | "avatarUrl"
  | "bannerUrl"
  | "shareSocialGraph";

interface ProfileEditorDraft {
  name: string;
  username: string;
  handle: string;
  bio: string;
  location: string;
  avatarUrl: string;
  bannerUrl: string;
  shareSocialGraph: boolean;
}

interface FollowingProfileSummary {
  handle: string;
  name: string;
  avatarUrl?: string;
}

interface ProfilePageProps {
  profileName: string;
  profileUsername: string;
  profileHandle: string;
  profileBio: string;
  profileLocation: string | null;
  profileAvatarUrl?: string;
  profileBannerUrl?: string;
  postsCount: number;
  followersCount: number;
  followingCount: number;
  followingProfiles: FollowingProfileSummary[];
  isOwnProfile: boolean;
  isFollowing: boolean;
  onBackToFeed: () => void;
  onSignOut: () => void;
  onToggleFollow: () => void;
  onOpenFollowingProfile: (handle: string, name: string) => void;
  profileEditorDraft: ProfileEditorDraft | null;
  profileEditorBusy: boolean;
  profileEditorMessage: string | null;
  profileEditorMessageTone: "neutral" | "success" | "warning" | "error";
  nativeLanguage: string;
  onNativeLanguageChange: (language: string) => void;
  feedSortMode: "likes" | "approval";
  onFeedSortModeChange: (mode: "likes" | "approval") => void;
  onProfileFieldChange: (field: EditableProfileField, value: string | boolean) => void;
  onSaveProfile: () => void;
}

const NATIVE_LANGUAGE_OPTIONS = [
  "English",
  "Spanish",
  "Portuguese",
  "French",
  "German",
  "Italian",
  "Japanese",
  "Korean",
  "Hindi",
  "Chinese"
];

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "U";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 1).toUpperCase();
  }
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}

function formatCount(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toString();
}

export function ProfilePage({
  profileName,
  profileUsername,
  profileHandle,
  profileBio,
  profileLocation,
  profileAvatarUrl,
  profileBannerUrl,
  postsCount,
  followersCount,
  followingCount,
  followingProfiles,
  isOwnProfile,
  isFollowing,
  onBackToFeed,
  onSignOut,
  onToggleFollow,
  onOpenFollowingProfile,
  profileEditorDraft,
  profileEditorBusy,
  profileEditorMessage,
  profileEditorMessageTone,
  nativeLanguage,
  onNativeLanguageChange,
  feedSortMode,
  onFeedSortModeChange,
  onProfileFieldChange,
  onSaveProfile
}: ProfilePageProps) {
  const [showPreview, setShowPreview] = useState(true);
  const [showFollowingList, setShowFollowingList] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [followingAvatarFailures, setFollowingAvatarFailures] = useState<Record<string, boolean>>({});
  const previewName = profileEditorDraft?.name.trim() || profileName;
  const previewUsername = profileEditorDraft?.username.trim() || profileUsername;
  const previewHandleRaw = profileEditorDraft?.handle.trim() || profileHandle;
  const previewHandle = previewHandleRaw.startsWith("@") ? previewHandleRaw : `@${previewHandleRaw}`;
  const handleInputRaw = profileEditorDraft?.handle.trim() ?? profileHandle;
  const handleInputDisplay = handleInputRaw.startsWith("@") ? handleInputRaw : `@${handleInputRaw}`;
  const normalizedCurrentHandle = profileHandle.trim().toLowerCase();
  const normalizedDraftHandle = handleInputDisplay.trim().toLowerCase();
  const handleWillChange = normalizedDraftHandle.length > 1 && normalizedDraftHandle !== normalizedCurrentHandle;
  const previewBio = profileEditorDraft?.bio.trim() || profileBio;
  const previewLocation = profileEditorDraft?.location.trim() || profileLocation || "";
  const previewAvatarUrl = profileEditorDraft?.avatarUrl.trim() || profileAvatarUrl || "";
  const previewBannerUrl = profileEditorDraft?.bannerUrl.trim() || profileBannerUrl || "";
  const previewShareGraph = profileEditorDraft?.shareSocialGraph ?? true;
  const isPreviewActive = Boolean(isOwnProfile && profileEditorDraft && showPreview);
  const displayName = isPreviewActive ? previewName : profileName;
  const displayHandle = isPreviewActive ? previewHandle : profileHandle;
  const displayAvatarUrl = isPreviewActive ? previewAvatarUrl : profileAvatarUrl;
  const displayBannerUrl = isPreviewActive ? previewBannerUrl : profileBannerUrl;
  const displayBio = isPreviewActive ? (previewBio || "No bio yet.") : profileBio;
  const displayLocation = isPreviewActive ? (previewLocation || null) : profileLocation;
  const displayUsername = isPreviewActive ? previewUsername : profileUsername;
  const socialGraphVisible = !(isPreviewActive && !previewShareGraph);

  useEffect(() => {
    setShowFollowingList(false);
  }, [profileHandle, isPreviewActive, previewShareGraph, isOwnProfile]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [displayAvatarUrl, displayName, displayHandle]);

  useEffect(() => {
    setFollowingAvatarFailures({});
  }, [profileHandle, followingProfiles]);

  return (
    <section className="panel profile-page reveal">
      <div
        className="profile-page__banner"
        style={displayBannerUrl ? { backgroundImage: `url(${displayBannerUrl})` } : undefined}
      />
      <div className="profile-page__body">
        <div className="profile-page__top-row">
          <button type="button" className="profile-page__back" onClick={onBackToFeed}>
            Back to feed
          </button>
          {isOwnProfile && profileEditorDraft ? (
            <div className="profile-page__own-actions">
              <button
                type="button"
                className="profile-page__sign-out"
                onClick={onSignOut}
              >
                Sign out
              </button>
              <button
                type="button"
                className={showPreview ? "profile-page__preview-toggle is-active" : "profile-page__preview-toggle"}
                onClick={() => setShowPreview((current) => !current)}
              >
                {showPreview ? "Edit profile" : "Preview profile"}
              </button>
            </div>
          ) : !isOwnProfile ? (
            <button
              type="button"
              className={isFollowing ? "profile-page__follow is-following" : "profile-page__follow"}
              onClick={onToggleFollow}
            >
              {isFollowing ? "Following" : "Follow"}
            </button>
          ) : null}
        </div>

        <div className="profile-page__identity">
          <div className="profile-page__avatar">
            {displayAvatarUrl && !avatarFailed ? (
              <img
                src={displayAvatarUrl}
                alt={`${displayName} avatar`}
                loading="lazy"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              initialsFromName(displayName)
            )}
          </div>
          <div className="profile-page__identity-text">
            <h2>{displayName}</h2>
            <p>{displayHandle}</p>
          </div>
        </div>

        {isOwnProfile && profileEditorDraft && !isPreviewActive ? (
            <div className="profile-page__editor">
              <label>
                Name
                <input
                  type="text"
                  value={profileEditorDraft.name}
                  onChange={(event) => onProfileFieldChange("name", event.target.value)}
                  maxLength={120}
                />
              </label>
              <label>
                Username
                <input
                  type="text"
                  value={profileEditorDraft.username}
                  onChange={(event) => onProfileFieldChange("username", event.target.value)}
                  maxLength={64}
                />
              </label>
              <label>
                Handle
                <input
                  type="text"
                  value={profileEditorDraft.handle}
                  onChange={(event) => onProfileFieldChange("handle", event.target.value)}
                  maxLength={33}
                />
                <span className={handleWillChange ? "profile-page__handle-warning is-active" : "profile-page__handle-warning"}>
                  Changing your @handle lets other users reclaim your previous handle.
                </span>
              </label>
              <label>
                Bio
                <textarea
                  value={profileEditorDraft.bio}
                  onChange={(event) => onProfileFieldChange("bio", event.target.value)}
                  maxLength={300}
                />
              </label>
              <label>
                Location
                <input
                  type="text"
                  value={profileEditorDraft.location}
                  onChange={(event) => onProfileFieldChange("location", event.target.value)}
                  maxLength={120}
                />
              </label>
              <label>
                Avatar URL
                <input
                  type="url"
                  value={profileEditorDraft.avatarUrl}
                  onChange={(event) => onProfileFieldChange("avatarUrl", event.target.value)}
                />
              </label>
              <label>
                Banner URL
                <input
                  type="url"
                  value={profileEditorDraft.bannerUrl}
                  onChange={(event) => onProfileFieldChange("bannerUrl", event.target.value)}
                />
              </label>
              <label className="profile-page__checkbox">
                <input
                  type="checkbox"
                  checked={profileEditorDraft.shareSocialGraph}
                  onChange={(event) => onProfileFieldChange("shareSocialGraph", event.target.checked)}
                />
                Share followers/following counts publicly
              </label>
              <label>
                Native language
                <select
                  value={nativeLanguage}
                  onChange={(event) => onNativeLanguageChange(event.target.value)}
                >
                  {NATIVE_LANGUAGE_OPTIONS.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Feed sort
                <select
                  value={feedSortMode}
                  onChange={(event) => onFeedSortModeChange(event.target.value === "approval" ? "approval" : "likes")}
                >
                  <option value="likes">Most likes</option>
                  <option value="approval">Highest approval</option>
                </select>
              </label>
              <div className="profile-page__editor-actions">
                <button type="button" className="profile-page__save" onClick={onSaveProfile} disabled={profileEditorBusy}>
                  {profileEditorBusy ? "Saving..." : "Save profile"}
                </button>
                {profileEditorMessage ? (
                  <p className={`profile-page__editor-message is-${profileEditorMessageTone}`}>{profileEditorMessage}</p>
                ) : null}
              </div>
            </div>
        ) : (
          <>
            <p className="profile-page__bio">{displayBio}</p>
            {displayLocation ? <p className="profile-page__location">{displayLocation}</p> : null}
            {isPreviewActive && profileEditorMessage ? (
              <p className={`profile-page__editor-status is-${profileEditorMessageTone}`}>{profileEditorMessage}</p>
            ) : null}
          </>
        )}

        <div className="profile-page__stats">
          <span><strong>{formatCount(postsCount)}</strong> posts</span>
          {!socialGraphVisible ? (
            <span><strong>hidden</strong> social graph</span>
          ) : (
            <>
              {isOwnProfile ? (
                <button
                  type="button"
                  className={showFollowingList ? "profile-page__stats-toggle is-active" : "profile-page__stats-toggle"}
                  onClick={() => setShowFollowingList((current) => !current)}
                  aria-expanded={showFollowingList}
                >
                  <strong>{formatCount(followingCount)}</strong> following
                </button>
              ) : (
                <span><strong>{formatCount(followingCount)}</strong> following</span>
              )}
              <span><strong>{formatCount(followersCount)}</strong> followers</span>
            </>
          )}
          <span><strong>{displayUsername}</strong> username</span>
        </div>
        {isOwnProfile && socialGraphVisible && showFollowingList ? (
          <div className="profile-page__following-drawer">
            {followingProfiles.length > 0 ? (
              <div className="profile-page__following-list">
                {followingProfiles.map((profile) => (
                  <button
                    key={profile.handle}
                    type="button"
                    className="profile-page__following-item"
                    onClick={() => onOpenFollowingProfile(profile.handle, profile.name)}
                  >
                    <span className="profile-page__following-avatar" aria-hidden="true">
                      {profile.avatarUrl && !followingAvatarFailures[profile.handle] ? (
                        <img
                          src={profile.avatarUrl}
                          alt=""
                          loading="lazy"
                          onError={() =>
                            setFollowingAvatarFailures((current) => ({
                              ...current,
                              [profile.handle]: true
                            }))
                          }
                        />
                      ) : (
                        initialsFromName(profile.name)
                      )}
                    </span>
                    <span className="profile-page__following-text">
                      <strong>{profile.name}</strong>
                      <span>{profile.handle}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="profile-page__following-empty">You are not following anyone yet.</p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
