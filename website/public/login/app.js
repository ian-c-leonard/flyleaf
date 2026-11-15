import {
  loadClerk,
  allowedSession,
  destination,
  signInConfig,
} from './runtime.js';
import { startCards } from './card.js';

// Who invites the family and helps them sign in, from the page itself.
const maintainer = document.body.dataset.maintainer || 'the family historian';
const maintainerObject = document.body.dataset.maintainerObject || 'them';
const status = document.getElementById('status');
const retry = document.getElementById('retry');
const switchAccount = document.getElementById('switch-account');
const form = document.getElementById('clerk-form');
const invitation = location.pathname === '/login/accept-invitation';
let busy = false;
let cardsShown = false;
let clerk;
// The sign-in form's settings, kept so a relative who starts with a card and
// then changes their mind gets the form back.
let mounted;
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
      showCards();
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
    if (invitation) clerk.mountSignUp(form, props);
    else {
      clerk.mountSignIn(form, props);
      mounted = props;
    }
    showCards();
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
// A relative with a printed card starts here instead (card.js). The card box
// appears once sign-in has loaded and settled, since a card needs it too.
// While a card is in use, the ordinary sign-in form is put away: both would
// otherwise drive the same sign-in.
function showCards() {
  if (cardsShown || invitation) return;
  cardsShown = true;
  void signInConfig().then(
    (config) => {
      if (!config.cards) return;
      startCards({
        maintainer,
        pause() {
          if (mounted) clerk.unmountSignIn(form);
          form.hidden = true;
          document.getElementById('card-or').hidden = true;
          switchAccount.hidden = true;
          retry.hidden = true;
          message('');
        },
        resume() {
          form.hidden = false;
          document.getElementById('card-or').hidden = false;
          if (mounted) clerk.mountSignIn(form, mounted);
          else void start();
        },
      });
    },
    () => {},
  );
}
void start();
