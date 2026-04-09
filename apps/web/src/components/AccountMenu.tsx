import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ThemeMode } from "../types";

interface AccountMenuProps {
  mode: ThemeMode;
  isSignedIn: boolean;
  signedInProfile: {
    name: string;
    email: string;
  } | null;
  onSignOut: () => void;
  onSignInWithGoogle: () => Promise<boolean>;
  googleSignInEnabled: boolean;
  authStatusMessage: string | null;
  nativeLanguage: string;
  onNativeLanguageChange: (language: string) => void;
  feedSortMode: "likes" | "approval";
  onFeedSortModeChange: (mode: "likes" | "approval") => void;
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
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="account-menu__trigger-icon" aria-hidden="true">
          <UserIcon />
        </span>
        Guest
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
