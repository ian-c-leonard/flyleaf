import { useEffect, useState } from 'react';
import {
  ArrowClockwiseIcon,
  SignOutIcon,
} from '@phosphor-icons/react';
import { loadClerk } from '../../public/login/runtime.js';
import { onLiveSite } from '../lib/settings';
import { sitePath } from '../lib/paths';

// True from the moment a reader asks to sign out, so the listener below does
// not also send them to the sign-in page with a way back.
let signingOut = false;

/** End the visit and show the sign-in page. Rejects when the sign-in service
 * cannot be reached; the reader is then still signed in. */
async function signOutOfSite() {
  signingOut = true;
  try {
    await (await loadClerk()).signOut({ redirectUrl: sitePath('login') });
    try {
      for (const key of Object.keys(sessionStorage))
        if (key.startsWith('family-contribution:'))
          sessionStorage.removeItem(key);
    } catch {
      /* Storage restrictions must not prevent an actual sign-out. */
    }
    location.replace(sitePath('login'));
  } catch (error) {
    signingOut = false;
    throw error;
  }
}

/** Sign out as a labelled row in the phone's menu. In the phone's header it
 * was a bare icon beside the menu button, one stray tap from ending a
 * relative's visit. */
export function MenuSignOut() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!onLiveSite()) return null; // The offline reader has no account service.
  return (
    <button
      className="kin-menu-sign-out"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        setFailed(false);
        signOutOfSite().catch(() => {
          setFailed(true);
          setBusy(false);
        });
      }}
    >
      {busy
        ? 'Signing out…'
        : failed
          ? 'Sign-out did not finish. Try again'
          : 'Sign out'}
      <SignOutIcon size={19} aria-hidden="true" />
    </button>
  );
}

export default function SessionControls() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const hosted = onLiveSite();
  useEffect(() => {
    if (!hosted) return;
    let dispose: (() => void) | undefined;
    let active = true;
    setError('');
    void loadClerk()
      .then((clerk) => {
        if (!active) return;
        setReady(true);
        dispose = clerk.addListener(({ session }) => {
          if (session === null && !signingOut)
            location.replace(
              sitePath('login?returnTo=') +
                encodeURIComponent(
                  location.pathname + location.search + location.hash,
                ),
            );
        });
      })
      .catch(() => {
        if (active) setError('Sign-in connection interrupted.');
      });
    return () => {
      active = false;
      dispose?.();
    };
  }, [hosted, attempt]);
  if (!hosted) return null; // The portable offline reader has no account service.
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await signOutOfSite();
    } catch {
      setError('Sign-out did not finish. Please try again.');
      setBusy(false);
    }
  }
  return (
    <div className="kin-session">
      <button
        className="kin-sign-out"
        disabled={busy || (!ready && !error)}
        onClick={() => {
          if (ready) void signOut();
          else setAttempt((n) => n + 1);
        }}
        aria-label={ready ? 'Sign out' : 'Reconnect sign-in'}
      >
        {ready ? <SignOutIcon size={18} /> : <ArrowClockwiseIcon size={18} />}
        <span>
          {busy
            ? 'Signing out…'
            : ready
              ? 'Sign out'
              : error
                ? 'Reconnect'
                : 'Connecting…'}
        </span>
      </button>
      {error && (
        <span className="kin-session-error" role="alert">
          {error}
          {!ready && (
            <button
              className="kin-reconnect-action"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Reconnect
            </button>
          )}
        </span>
      )}
    </div>
  );
}
