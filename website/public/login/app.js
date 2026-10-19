import { loadClerk, allowedSession, destination } from './runtime.js';

// Who invites the family and helps them sign in, from the page itself.
const maintainer = document.body.dataset.maintainer || 'the family historian';
const maintainerObject = document.body.dataset.maintainerObject || 'them';
const status = document.getElementById('status');
const retry = document.getElementById('retry');
const switchAccount = document.getElementById('switch-account');
const form = document.getElementById('clerk-form');
let busy = false;
let clerk;
function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}
async function start() {
  if (busy) return;
  busy = true;
  retry.hidden = true;
  message('Opening sign-in…');
  try {
    clerk = await loadClerk();
    if (clerk.isSignedIn) {
      await clerk.session.getToken({ skipCache: true });
      if (await allowedSession()) {
        location.replace(destination());
        return;
      }
      message(
        `You’re signed in, but this account cannot open the collection yet. Use the email ${maintainer} invited, or contact ${maintainerObject} for help.`,
        true,
      );
      switchAccount.hidden = false;
      retry.hidden = false;
      return;
    }
    message('');
    const props = {
      routing: 'hash',
      forceRedirectUrl: '/login?returnTo=' + encodeURIComponent(destination()),
      signInForceRedirectUrl:
        '/login?returnTo=' + encodeURIComponent(destination()),
      signUpForceRedirectUrl:
        '/login?returnTo=' + encodeURIComponent(destination()),
      signInUrl: '/login',
      signUpUrl: '/login/accept-invitation',
    };
    if (location.pathname === '/login/accept-invitation')
      clerk.mountSignUp(form, props);
    else clerk.mountSignIn(form, props);
  } catch {
    message(
      `Sign-in could not load. Please check your connection and try again. If it still won’t open, get in touch with ${maintainer}.`,
      true,
    );
    retry.hidden = false;
  } finally {
    busy = false;
  }
}
retry.addEventListener('click', () => void start());
switchAccount.addEventListener('click', async () => {
  switchAccount.disabled = true;
  try {
    const next = '/login?returnTo=' + encodeURIComponent(destination());
    await clerk.signOut({ redirectUrl: next });
    location.replace(next);
  } catch {
    message('Sign-out did not finish. Please try again.', true);
    switchAccount.disabled = false;
  }
});
void start();
