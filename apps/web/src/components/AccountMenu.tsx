import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import type { ThemeMode } from "../types";

type DevicePairingIntent = "sign_in" | "link";

interface AccountMenuProps {
  mode: ThemeMode;
  isSignedIn: boolean;
  signedInProfile: {
    name: string;
    email?: string;
  } | null;
  onSignOut: () => void;
  onSignInWithPasskey: () => Promise<boolean>;
  onCreatePasskeyOnDevice: () => Promise<boolean>;
  onStartDevicePairing: (intent: DevicePairingIntent) => Promise<{
    pairingId: string;
    approvalSecret: string;
    pollSecret: string;
    expiresAtMs: string;
  } | null>;
  onPollDevicePairing: (
    pairingId: string,
    pollSecret: string
  ) => Promise<{ status: "pending" | "approved" | "consumed" | "expired"; handoffToken?: string }>;
  onCompleteDevicePairing: (pairingId: string, pollSecret: string, handoffToken: string) => Promise<boolean>;
  passkeySignInEnabled: boolean;
  authStatusMessage: string | null;
  onOpenProfile: () => void;
  profileButtonLabel: string;
}

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
  onSignInWithPasskey,
  onCreatePasskeyOnDevice,
  onStartDevicePairing,
  onPollDevicePairing,
  onCompleteDevicePairing,
  passkeySignInEnabled,
  authStatusMessage,
  onOpenProfile,
  profileButtonLabel
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signin");
  const [signInBusyProvider, setSignInBusyProvider] = useState<"passkey" | null>(null);
  const [pairingDialogOpen, setPairingDialogOpen] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingStatus, setPairingStatus] = useState<string | null>(null);
  const [pairingSession, setPairingSession] = useState<{
    pairingId: string;
    approvalSecret: string;
    pollSecret: string;
    expiresAtMs: string;
    qrText: string;
    intent: DevicePairingIntent;
  } | null>(null);
  const [pairingQrDataUrl, setPairingQrDataUrl] = useState<string | null>(null);
  const [phoneFirstStarted, setPhoneFirstStarted] = useState(false);
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

  async function handlePasskeySignIn() {
    if (signInBusyProvider || !passkeySignInEnabled) {
      return;
    }
    setSignInBusyProvider("passkey");
    const success = await onSignInWithPasskey();
    setSignInBusyProvider(null);
    if (success) {
      setOpen(false);
    }
  }

  async function handleCreatePasskeyOnDevice() {
    if (signInBusyProvider || !passkeySignInEnabled) {
      return;
    }
    setSignInBusyProvider("passkey");
    const success = await onCreatePasskeyOnDevice();
    setSignInBusyProvider(null);
    if (success) {
      setOpen(false);
    }
  }

  async function handleCrossDevicePairing(intent: DevicePairingIntent) {
    if (pairingBusy) {
      return;
    }
    setPairingBusy(true);
    setPairingStatus("Preparing QR code...");
    try {
      const pairing = await onStartDevicePairing(intent);
      if (!pairing) {
        setPairingStatus("Unable to start device pairing.");
        return;
      }
      const qrText = `${window.location.origin}/?linkDevice=1&pairingId=${encodeURIComponent(pairing.pairingId)}&approvalSecret=${encodeURIComponent(pairing.approvalSecret)}`;
      setPairingSession({
        ...pairing,
        qrText,
        intent
      });
      setPairingDialogOpen(true);
      setPairingStatus(
        intent === "link"
          ? "Scan this code from the device you want to link."
          : "Scan this code from your signed-in phone to approve."
      );
    } finally {
      setPairingBusy(false);
    }
  }

  useEffect(() => {
    if (!open) {
      setPhoneFirstStarted(false);
      return;
    }
    if (isSignedIn || authTab !== "signin" || pairingDialogOpen || pairingSession || pairingBusy || phoneFirstStarted) {
      return;
    }
    setPhoneFirstStarted(true);
    void handleCrossDevicePairing("sign_in");
  }, [open, isSignedIn, authTab, pairingDialogOpen, pairingSession, pairingBusy, phoneFirstStarted]);

  useEffect(() => {
    if (!pairingDialogOpen || !pairingSession) {
      setPairingQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const dataUrl = await QRCode.toDataURL(pairingSession.qrText, {
          width: 260,
          margin: 1
        });
        if (!cancelled) {
          setPairingQrDataUrl(dataUrl);
        }
      } catch {
        if (!cancelled) {
          setPairingStatus("Unable to render QR code.");
          setPairingQrDataUrl(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pairingDialogOpen, pairingSession?.qrText]);

  useEffect(() => {
    if (!pairingDialogOpen || !pairingSession) {
      return;
    }
    let cancelled = false;
    let timeoutId: number | null = null;
    const poll = async () => {
      try {
        const result = await onPollDevicePairing(pairingSession.pairingId, pairingSession.pollSecret);
        if (cancelled) {
          return;
        }
        if (result.status === "approved" && result.handoffToken) {
          setPairingStatus(
            pairingSession.intent === "link" ? "Approval detected. Finalizing account link..." : "Approval detected. Finalizing sign-in..."
          );
          const completed = await onCompleteDevicePairing(
            pairingSession.pairingId,
            pairingSession.pollSecret,
            result.handoffToken
          );
          if (cancelled) {
            return;
          }
          if (completed) {
            setPairingStatus("Device linked successfully.");
            setPairingDialogOpen(false);
            setOpen(false);
            setPairingSession(null);
            return;
          }
          setPairingStatus("Pairing could not be completed. Retry.");
          return;
        }
        if (result.status === "expired") {
          setPairingStatus("QR code expired. Start again.");
          setPairingSession(null);
          return;
        }
        if (result.status === "consumed") {
          setPairingStatus("Pairing already used.");
          setPairingSession(null);
          return;
        }
      } catch {
        if (cancelled) {
          return;
        }
        setPairingStatus("Waiting for phone approval...");
      } finally {
        if (!cancelled && pairingDialogOpen) {
          timeoutId = window.setTimeout(() => {
            void poll();
          }, 1750);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [pairingDialogOpen, pairingSession, onPollDevicePairing, onCompleteDevicePairing]);

  function handleTriggerClick() {
    if (isSignedIn) {
      onOpenProfile();
      return;
    }
    setOpen(true);
  }

  return (
    <div className="account-menu">
      <button
        type="button"
        className="account-menu__trigger"
        onClick={handleTriggerClick}
        aria-label="Open profile"
      >
        <span className="account-menu__trigger-icon" aria-hidden="true">
          <UserIcon />
        </span>
        {profileButtonLabel}
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
                        : "Browse freely. Sign in to post, comment, vote, and save posts."}
                    </p>
                    {authStatusMessage ? <p className="account-menu__auth-status">{authStatusMessage}</p> : null}
                  </div>
                  <div className="account-menu__header-actions">
                    {isSignedIn ? (
                      <button type="button" className="account-menu__signin" onClick={onSignOut}>
                        Sign out
                      </button>
                    ) : null}
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
                  {!isSignedIn ? (
                    <section className="account-menu__section account-menu__section--signin">
                      <h4>{authTab === "signin" ? "Sign in" : "Sign up"}</h4>
                      <div className="account-menu__auth-tabs" role="tablist" aria-label="Authentication mode">
                        <button
                          type="button"
                          className={authTab === "signin" ? "account-menu__auth-tab is-active" : "account-menu__auth-tab"}
                          onClick={() => setAuthTab("signin")}
                          role="tab"
                          aria-selected={authTab === "signin"}
                        >
                          Sign in
                        </button>
                        <button
                          type="button"
                          className={authTab === "signup" ? "account-menu__auth-tab is-active" : "account-menu__auth-tab"}
                          onClick={() => setAuthTab("signup")}
                          role="tab"
                          aria-selected={authTab === "signup"}
                        >
                          Sign up
                        </button>
                      </div>
                      <p className="account-menu__section-note">
                        Phone QR sign-in is default. Scan using a phone that is already signed in, then approve from the phone.
                      </p>
                      {authTab === "signin" ? (
                        <>
                          <button
                            type="button"
                            className="account-menu__signin account-menu__signin-cta"
                            onClick={() => void handleCrossDevicePairing("sign_in")}
                            disabled={pairingBusy || signInBusyProvider !== null}
                          >
                            {pairingBusy
                              ? "Preparing secure QR..."
                              : pairingDialogOpen
                                ? "Refresh phone QR"
                                : "Sign in with phone QR"}
                          </button>
                          <button
                            type="button"
                            className="account-menu__signin"
                            onClick={() => void handlePasskeySignIn()}
                            disabled={!passkeySignInEnabled || signInBusyProvider !== null}
                          >
                            {signInBusyProvider === "passkey"
                              ? "Checking device..."
                              : passkeySignInEnabled
                                ? "Sign in on this device"
                                : "Passkey unavailable"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="account-menu__signin account-menu__signin-cta"
                          onClick={() => void handleCreatePasskeyOnDevice()}
                          disabled={!passkeySignInEnabled || signInBusyProvider !== null}
                        >
                          {signInBusyProvider === "passkey"
                            ? "Setting up..."
                            : passkeySignInEnabled
                              ? "Create passkey on this device"
                              : "Passkey unavailable"}
                        </button>
                      )}
                    </section>
                  ) : (
                    <section className="account-menu__section account-menu__section--signin">
                      <h4>Linked devices</h4>
                      <p className="account-menu__section-note">
                        Link another device or account by scanning a secure QR and approving from that device.
                      </p>
                      <button
                        type="button"
                        className="account-menu__signin account-menu__signin-cta"
                        onClick={() => void handleCrossDevicePairing("link")}
                        disabled={pairingBusy}
                      >
                        {pairingBusy ? "Preparing secure QR..." : "Link another device"}
                      </button>
                    </section>
                  )}
                </div>

                {pairingDialogOpen ? (
                  <section className="account-menu__section account-menu__section--signin">
                    <h4>{pairingSession?.intent === "link" ? "Link Account" : "Link This Device"}</h4>
                    <p className="account-menu__section-note">
                      {pairingSession?.intent === "link"
                        ? "Scan with the other signed-in device to merge identities into your current account."
                        : "Scan with your signed-in phone. Approval happens on the phone, which acts as the trusted authenticator."}
                    </p>
                    {pairingQrDataUrl ? (
                      <img className="account-menu__qr" src={pairingQrDataUrl} alt="Device linking QR code" />
                    ) : (
                      <div className="account-menu__qr account-menu__qr--placeholder">Generating QR…</div>
                    )}
                    {pairingSession ? (
                      <p className="account-menu__section-note">
                        Expires: {new Date(pairingSession.expiresAtMs).toLocaleTimeString()}
                      </p>
                    ) : null}
                    {pairingStatus ? <p className="account-menu__auth-status">{pairingStatus}</p> : null}
                    <div className="auth-modal__actions">
                      <button
                        type="button"
                        className="account-menu__signin"
                        onClick={() => {
                          setPairingDialogOpen(false);
                          setPairingSession(null);
                          setPairingStatus(null);
                        }}
                      >
                        Close
                      </button>
                    </div>
                  </section>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
