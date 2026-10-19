import { useEffect, useRef, useState } from 'react';
import {
  ArrowClockwiseIcon,
  SignOutIcon,
} from '@phosphor-icons/react';
import { loadClerk } from '../../public/login/runtime.js';
import { onLiveSite } from '../lib/settings';
import { sitePath } from '../lib/paths';

export default function SessionControls() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const signingOut = useRef(false);
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
          if (session === null && !signingOut.current)
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
    signingOut.current = true;
    setBusy(true);
    setError('');
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
    } catch {
      signingOut.current = false;
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
