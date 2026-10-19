// Shared by the public welcome page and the private reader. The provider runtime
// renews Clerk's short-lived app cookie while a relative explores the collection.
let pending;
function deadline(promise, milliseconds) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Sign-in took too long. Please try again.')),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
function script(src, key) {
  return new Promise((resolve, reject) => {
    const element = document.createElement('script');
    element.src = src;
    element.async = true;
    element.crossOrigin = 'anonymous';
    if (key) element.dataset.clerkPublishableKey = key;
    const timeout = setTimeout(() => {
      element.remove();
      reject(new Error('Sign-in could not load. Please try again.'));
    }, 20000);
    element.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    element.onerror = () => {
      clearTimeout(timeout);
      element.remove();
      reject(
        new Error(
          'Sign-in could not load. Please check your connection and try again.',
        ),
      );
    };
    document.head.appendChild(element);
  });
}
/** Where to go after sign-in: the page named in ?returnTo=, if it is on this
 * site, else the family home. The address arguments default to this page's. */
export function destination(
  search = location.search,
  origin = location.origin,
  hash = location.hash,
) {
  const candidate = new URLSearchParams(search).get('returnTo') || '/';
  try {
    const target = new URL(candidate, origin);
    if (
      target.origin === origin &&
      !target.pathname.startsWith('/login') &&
      !target.pathname.startsWith('/api/') &&
      !candidate.includes('\\') &&
      !Array.from(candidate).some((c) => c.charCodeAt(0) < 32)
    ) {
      // Authentication refresh parameters never become a saved return destination.
      const params = new URLSearchParams();
      for (const [key, value] of target.searchParams)
        if (!key.startsWith('__clerk') && key !== '__session')
          params.append(key, value);
      target.search = params.toString();
      if (!target.hash && hash && !hash.startsWith('#/')) target.hash = hash;
      const path = target.pathname + target.search + target.hash;
      // A path that starts with two slashes names another site: /.//evil.example
      // passes the origin check above but cleans up to //evil.example.
      if (path.startsWith('/') && !path.startsWith('//')) return path;
    }
  } catch {
    /* Untrusted return destinations go to the family home. */
  }
  return '/';
}
// A Clerk publishable key names its own sign-in service, base64-encoded.
// A live key's service is clerk.<this site's domain>. A test key, used while
// a family sets up, names a Clerk development host instead.
export function trustedSignIn(config, host) {
  const key = /^pk_(live|test)_([A-Za-z0-9]+)$/.exec(
    config.publishableKey || '',
  );
  if (!key) return false;
  let service;
  try {
    service = atob(key[2]);
  } catch {
    return false;
  }
  if (!service.endsWith('$')) return false;
  service = service.slice(0, -1);
  const expected =
    key[1] === 'live'
      ? service === 'clerk.' + host
      : /^[a-z0-9-]+\.clerk\.accounts\.dev$/.test(service);
  return (
    expected &&
    config.frontendApi === 'https://' + service &&
    /^\d+\.\d+\.\d+$/.test(config.clerkVersion) &&
    /^\d+\.\d+\.\d+$/.test(config.uiVersion)
  );
}
// The person who invites the family, named on the sign-in page itself.
const invitedBy = () =>
  document.body?.dataset.maintainer || 'the family historian';

export function loadClerk() {
  if (!pending)
    pending = (async () => {
      const response = await fetch('/login/config.json', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error('Sign-in is being prepared. Please try again shortly.');
      const config = await response.json();
      if (!trustedSignIn(config, location.host))
        throw new Error('Sign-in is being prepared.');
      if (!window.__internal_ClerkUICtor)
        await script(
          `${config.frontendApi}/npm/@clerk/ui@${config.uiVersion}/dist/ui.browser.js`,
        );
      if (!window.Clerk)
        await script(
          `${config.frontendApi}/npm/@clerk/clerk-js@${config.clerkVersion}/dist/clerk.browser.js`,
          config.publishableKey,
        );
      await deadline(
        window.Clerk.load({
          ui: { ClerkUI: window.__internal_ClerkUICtor },
          signInUrl: '/login',
          signUpUrl: '/login/accept-invitation',
          afterSignOutUrl: '/login',
          allowedRedirectOrigins: [location.origin],
          localization: {
            signIn: {
              start: {
                title: 'Sign in',
                subtitle: `Use the email address ${invitedBy()} invited.`,
              },
              emailCode: {
                title: 'Enter your code',
              },
            },
            signUp: {
              start: {
                title: 'Accept your invitation',
                subtitle: `Use the email address ${invitedBy()} invited.`,
              },
              emailCode: {
                title: 'Verify your email',
              },
            },
          },
          appearance: {
            variables: {
              colorPrimary: '#233c35',
              colorPrimaryForeground: '#fffdf6',
              colorForeground: '#26372f',
              colorMutedForeground: '#647168',
              colorMuted: '#eeeee5',
              colorBackground: '#fbfaf5',
              colorInput: '#fffefa',
              colorInputForeground: '#26372f',
              colorDanger: '#8b3f2c',
              colorSuccess: '#315b43',
              colorWarning: '#805d28',
              colorRing: '#874b39',
              fontFamily: '"Source Sans 3 Variable", sans-serif',
              borderRadius: '4px',
            },
            elements: {
              rootBox: 'family-clerk-root',
              cardBox: 'family-clerk-cardbox',
              card: 'family-clerk-card',
              headerTitle: 'family-clerk-title',
              headerSubtitle: 'family-clerk-subtitle',
              formFieldInput: 'family-clerk-input',
              formButtonPrimary: 'family-clerk-submit',
              formResendCodeLink: 'family-clerk-resend',
              identityPreview: 'family-clerk-identity',
              identityPreviewText: 'family-clerk-identity-text',
              identityPreviewEditButton: 'family-clerk-identity-edit',
              otpCodeFieldInputs: 'family-clerk-code-digits',
              otpCodeFieldInput: 'family-clerk-code-digit',
              otpCodeFieldErrorText: 'family-clerk-feedback',
              otpCodeFieldSuccessText: 'family-clerk-feedback',
              alertText: 'family-clerk-feedback',
              footer: 'family-clerk-footer',
            },
          },
        }),
        20000,
      );
      return window.Clerk;
    })().catch((error) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
export async function allowedSession() {
  const response = await fetch('/api/session', {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok)
    throw new Error(
      'The collection could not be opened. Please try again shortly.',
    );
  const data = await response.json();
  return data.allowed === true;
}
