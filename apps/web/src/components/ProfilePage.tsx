import { useState } from "react";

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
  isOwnProfile: boolean;
  isFollowing: boolean;
  onBackToFeed: () => void;
  onToggleFollow: () => void;
  profileEditorDraft: ProfileEditorDraft | null;
  profileEditorBusy: boolean;
  profileEditorMessage: string | null;
  onProfileFieldChange: (field: EditableProfileField, value: string | boolean) => void;
  onSaveProfile: () => void;
}

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
  isOwnProfile,
  isFollowing,
  onBackToFeed,
  onToggleFollow,
  profileEditorDraft,
  profileEditorBusy,
  profileEditorMessage,
  onProfileFieldChange,
  onSaveProfile
}: ProfilePageProps) {
  const [showPreview, setShowPreview] = useState(true);
  const previewName = profileEditorDraft?.name.trim() || profileName;
  const previewUsername = profileEditorDraft?.username.trim() || profileUsername;
  const previewHandleRaw = profileEditorDraft?.handle.trim() || profileHandle;
  const previewHandle = previewHandleRaw.startsWith("@") ? previewHandleRaw : `@${previewHandleRaw}`;
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
            <button
              type="button"
              className={showPreview ? "profile-page__preview-toggle is-active" : "profile-page__preview-toggle"}
              onClick={() => setShowPreview((current) => !current)}
            >
              {showPreview ? "Edit profile" : "Preview profile"}
            </button>
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
            {displayAvatarUrl ? (
              <img src={displayAvatarUrl} alt={`${displayName} avatar`} loading="lazy" />
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
              <div className="profile-page__editor-actions">
                <button type="button" className="profile-page__save" onClick={onSaveProfile} disabled={profileEditorBusy}>
                  {profileEditorBusy ? "Saving..." : "Save profile"}
                </button>
                {profileEditorMessage ? <p>{profileEditorMessage}</p> : null}
              </div>
            </div>
        ) : (
          <>
            <p className="profile-page__bio">{displayBio}</p>
            {displayLocation ? <p className="profile-page__location">{displayLocation}</p> : null}
            {isPreviewActive && profileEditorMessage ? <p className="profile-page__editor-status">{profileEditorMessage}</p> : null}
          </>
        )}

        <div className="profile-page__stats">
          <span><strong>{formatCount(postsCount)}</strong> posts</span>
          {isPreviewActive && !previewShareGraph ? (
            <span><strong>hidden</strong> social graph</span>
          ) : (
            <>
              <span><strong>{formatCount(followingCount)}</strong> following</span>
              <span><strong>{formatCount(followersCount)}</strong> followers</span>
            </>
          )}
          <span><strong>{displayUsername}</strong> username</span>
        </div>
      </div>
    </section>
  );
}
