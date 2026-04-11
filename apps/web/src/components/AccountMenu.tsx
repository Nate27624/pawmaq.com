import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ThemeMode } from "../types";

interface AccountMenuProps {
  mode: ThemeMode;
  isSignedIn: boolean;
  signedInProfile: {
    name: string;
    email?: string;
  } | null;
  onSignOut: () => void;
  onSignInWithGoogle: () => Promise<boolean>;
  googleSignInEnabled: boolean;
  authStatusMessage: string | null;
  nativeLanguage: string;
  onNativeLanguageChange: (language: string) => void;
  feedSortMode: "likes" | "approval";
  onFeedSortModeChange: (mode: "likes" | "approval") => void;
  onOpenProfile: () => void;
  profileButtonLabel: string;
  savedCount: number;
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

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3C9.8 3 8 4.8 8 7C8 9.2 9.8 11 12 11C14.2 11 16 9.2 16 7C16 4.8 14.2 3 12 3Z" />
      <path d="M12 13C7.6 13 4 15.6 4 18.8V21H20V18.8C20 15.6 16.4 13 12 13Z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.14 12.94C19.18 12.64 19.2 12.32 19.2 12C19.2 11.68 19.18 11.36 19.14 11.06L21.02 9.59C21.19 9.45 21.24 9.21 21.14 9L19.34 5.89C19.24 5.68 19 5.6 18.78 5.68L16.57 6.57C16.1 6.21 15.58 5.91 15.01 5.69L14.67 3.35C14.64 3.13 14.45 2.96 14.22 2.96H10.62C10.39 2.96 10.2 3.13 10.17 3.35L9.83 5.69C9.26 5.91 8.74 6.21 8.27 6.57L6.06 5.68C5.84 5.6 5.6 5.68 5.5 5.89L3.7 9C3.6 9.21 3.65 9.45 3.82 9.59L5.7 11.06C5.66 11.36 5.64 11.68 5.64 12C5.64 12.32 5.66 12.64 5.7 12.94L3.82 14.41C3.65 14.55 3.6 14.79 3.7 15L5.5 18.11C5.6 18.32 5.84 18.4 6.06 18.32L8.27 17.43C8.74 17.79 9.26 18.09 9.83 18.31L10.17 20.65C10.2 20.87 10.39 21.04 10.62 21.04H14.22C14.45 21.04 14.64 20.87 14.67 20.65L15.01 18.31C15.58 18.09 16.1 17.79 16.57 17.43L18.78 18.32C19 18.4 19.24 18.32 19.34 18.11L21.14 15C21.24 14.79 21.19 14.55 21.02 14.41L19.14 12.94ZM12.42 15.24C10.66 15.24 9.22 13.8 9.22 12.04C9.22 10.28 10.66 8.84 12.42 8.84C14.18 8.84 15.62 10.28 15.62 12.04C15.62 13.8 14.18 15.24 12.42 15.24Z" />
    </svg>
  );
}

export function AccountMenu({
  mode,
  isSignedIn,
  signedInProfile,
  onSignOut,
  onSignInWithGoogle,
  googleSignInEnabled,
  authStatusMessage,
  nativeLanguage,
  onNativeLanguageChange,
  feedSortMode,
  onFeedSortModeChange,
  onOpenProfile,
  profileButtonLabel,
  savedCount
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [signInBusy, setSignInBusy] = useState(false);
  const canUsePortal = typeof document !== "undefined";

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  async function handleGoogleSignIn() {
    if (signInBusy || !googleSignInEnabled) {
      return;
    }
    setSignInBusy(true);
    const success = await onSignInWithGoogle();
    setSignInBusy(false);
    if (success) {
      setOpen(false);
    }
  }

  return (
    <div className="account-menu">
      <button
        type="button"
        className="account-menu__trigger"
        onClick={onOpenProfile}
        aria-label="Open profile"
      >
        <span className="account-menu__trigger-icon" aria-hidden="true">
          <UserIcon />
        </span>
        {profileButtonLabel}
      </button>
      <button
        type="button"
        className="account-menu__settings"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label="Open account settings"
      >
        <SettingsIcon />
      </button>
      {open && canUsePortal
        ? createPortal(
            <div
              className={`account-menu__backdrop mode-${mode}`}
              role="presentation"
              onClick={() => setOpen(false)}
            >
              <div
                className="account-menu__panel panel"
                role="dialog"
                aria-modal="true"
                aria-label="Account settings"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="account-menu__header">
                  <div>
                    <strong>{isSignedIn ? `Signed in as ${signedInProfile?.name ?? "member"}` : "Guest mode"}</strong>
                    <p>
                      {isSignedIn
                        ? signedInProfile?.email ?? "Your profile controls are here."
                        : "Browse freely. Sign in is required to post or comment."}
                    </p>
                    {authStatusMessage ? <p className="account-menu__auth-status">{authStatusMessage}</p> : null}
                  </div>
                  <div className="account-menu__header-actions">
                    {isSignedIn ? (
                      <button type="button" className="account-menu__signin" onClick={onSignOut}>
                        Sign out
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="account-menu__signin account-menu__signin--google"
                        onClick={() => void handleGoogleSignIn()}
                        disabled={!googleSignInEnabled || signInBusy}
                      >
                        {signInBusy
                          ? "Signing in..."
                          : googleSignInEnabled
                            ? "Sign in with Google"
                            : "Google sign-in unavailable"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="account-menu__close"
                      onClick={() => setOpen(false)}
                      aria-label="Close account settings"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="account-menu__profile">
                  <section className="account-menu__section">
                    <h4>Preferences</h4>
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
                      onChange={(event) =>
                        onFeedSortModeChange(event.target.value === "approval" ? "approval" : "likes")
                      }
                    >
                      <option value="likes">Most likes</option>
                      <option value="approval">Highest approval</option>
                    </select>
                  </label>
                  </section>

                  <div className="account-menu__meta-row">
                    <p className="account-menu__meta">Saved posts: {savedCount}</p>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
