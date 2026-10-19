import { createClerkClient } from '@clerk/backend';
import { protect, message, archiveKey, readArchive } from './archive.ts';
import { submissions } from './submissions.ts';
import { configure, site } from './site.ts';
const publicAssets = new Set([
  '/login/style.css',
  '/login/app.js',
  '/login/runtime.js',
  '/login/monogram.png',
  '/login/fonts/eb-garamond-latin-400-normal.woff2',
  '/login/fonts/source-sans-3-latin-wght-normal.woff2',
  '/login/fonts/eb-garamond-OFL.txt',
  '/login/fonts/source-sans-3-OFL.txt',
  '/favicon.svg',
]);
const loginPages = new Set(['/login', '/login/', '/login/accept-invitation']);

function withSessionHeaders(response: Response, sessionHeaders: Headers) {
  const headers = new Headers(response.headers);
  // Authentication headers contain internal diagnostics: forward only cookies.
  for (const cookie of sessionHeaders.getSetCookie())
    headers.append('Set-Cookie', cookie);
  return protect(
    new Response(response.body, { status: response.status, headers }),
  );
}

function signIn(request: Request, forbidden = false) {
  const url = new URL(request.url);
  if (
    request.method === 'GET' &&
    (url.pathname === '/' ||
      request.headers.get('Accept')?.includes('text/html'))
  ) {
    const login = new URL('/login', site().origin);
    const params = new URLSearchParams();
    for (const [key, value] of url.searchParams)
      if (!key.startsWith('__clerk') && key !== '__session')
        params.append(key, value);
    const target = url.pathname + (params.size ? '?' + params.toString() : '');
    if (target !== '/' && target.length <= 2048)
      login.searchParams.set('returnTo', target);
    if (forbidden) login.searchParams.set('notice', 'invitation');
    return protect(Response.redirect(login.toString(), 302));
  }
  return message(
    forbidden ? 403 : 401,
    forbidden
      ? `This account does not have an invitation. Please contact ${site().maintainer}.`
      : 'Please sign in to the family website.',
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { origin, host, clerkOrigin } = configure(env);
    if (!host || !clerkOrigin || url.origin !== origin)
      return message(403, 'Please use the family website address.');
    const intake =
      url.pathname === '/api/submissions' ||
      url.pathname.startsWith('/api/submissions/');
    const mutation = !['GET', 'HEAD'].includes(request.method);
    if (mutation && !(intake && ['POST', 'PUT'].includes(request.method)))
      return message(405, 'Method not allowed.', { Allow: 'GET, HEAD' });
    if (mutation && request.headers.get('Origin') !== origin)
      return message(403, 'Please submit through the family website.');
    if (publicAssets.has(url.pathname))
      return protect(await env.ASSETS.fetch(request));
    if (loginPages.has(url.pathname))
      return protect(
        await env.ASSETS.fetch(
          new Request(origin + '/login/index.html', { method: request.method }),
        ),
      );
    if (
      !env.CLERK_SECRET_KEY ||
      !env.CLERK_PUBLISHABLE_KEY ||
      !env.ALLOWED_EMAILS.trim()
    )
      return message(503, 'The family website is being prepared.');
    if (url.pathname === '/login/config.json')
      return protect(
        Response.json({
          publishableKey: env.CLERK_PUBLISHABLE_KEY,
          frontendApi: clerkOrigin,
          clerkVersion: '6.31.1',
          uiVersion: '1.32.3',
        }),
      );
    try {
      const headers = new Headers(request.headers);
      // The canonical origin above is authoritative; never trust client forwarding headers.
      headers.set('Host', host);
      headers.set('X-Forwarded-Host', host);
      headers.set('X-Forwarded-Proto', 'https');
      const canonical = new Request(request, { headers });
      const clerk = createClerkClient({
        secretKey: env.CLERK_SECRET_KEY,
        publishableKey: env.CLERK_PUBLISHABLE_KEY,
        telemetry: { disabled: true },
      });
      const state = await clerk.authenticateRequest(canonical, {
        acceptsToken: 'session_token',
        authorizedParties: [origin],
        signInUrl: origin + '/login',
        signUpUrl: origin + '/login/accept-invitation',
        clockSkewInMs: 5000,
      });
      if (state.status === 'handshake') {
        // A 307 would forward the contribution body to the identity provider.
        if (mutation) return signIn(canonical);
        const location = state.headers.get('Location');
        if (!location) return message(503, 'Please reopen the sign-in page.');
        const destination = new URL(location, origin);
        // The SDK may return a refresh on FAPI or a callback on this origin.
        if (![origin, clerkOrigin].includes(destination.origin))
          return message(503, 'Please reopen the sign-in page.');
        return withSessionHeaders(
          Response.redirect(destination.toString(), 307),
          state.headers,
        );
      }
      const auth = state.toAuth({ treatPendingAsSignedOut: true });
      const claims = auth.sessionClaims;
      // Clerk adds these two claims only when the session token is customized
      // (docs/hosting.md). Without them nobody can be let in, so say so plainly
      // instead of telling an invited relative they have no invitation.
      if (
        typeof auth.userId === 'string' &&
        !!auth.userId &&
        claims?.iss === clerkOrigin &&
        (typeof claims.email !== 'string' ||
          typeof claims.email_verified !== 'boolean')
      ) {
        console.error(JSON.stringify({ event: 'family_login_claims_missing' }));
        return withSessionHeaders(
          message(503, missingClaims(site().maintainer)),
          state.headers,
        );
      }
      const email =
        typeof claims?.email === 'string'
          ? claims.email.trim().toLowerCase()
          : '';
      const allowed =
        typeof auth.userId === 'string' &&
        !!auth.userId &&
        typeof auth.sessionId === 'string' &&
        !!auth.sessionId &&
        claims?.iss === clerkOrigin &&
        claims.email_verified === true &&
        !!email &&
        env.ALLOWED_EMAILS.split(',').some(
          (entry) => entry.trim().toLowerCase() === email,
        );
      if (!allowed)
        return withSessionHeaders(
          signIn(request, !!auth.userId),
          state.headers,
        );
      let response: Response;
      if (url.pathname === '/api/session')
        response = Response.json({ allowed: true, ...viewerFor(env, email) });
      else if (intake)
        response = await submissions(canonical, env, {
          userId: auth.userId!,
          email,
        });
      else if (url.pathname.startsWith('/api/'))
        response = message(404, 'Not found.');
      else if (
        url.pathname.startsWith('/data/images/') ||
        url.pathname.startsWith('/data/publications/')
      ) {
        const key = archiveKey(url.pathname);
        response = key
          ? await readArchive(request, env, key)
          : message(404, 'File not found.');
      } else response = await env.ASSETS.fetch(request);
      return withSessionHeaders(response, state.headers);
    } catch {
      // Never log a Request, exception details, session, email or invitation ticket.
      console.error(JSON.stringify({ event: 'family_login_unavailable' }));
      return message(
        503,
        'Sign-in is temporarily unavailable. Please try again shortly.',
      );
    }
  },
} satisfies ExportedHandler<Env>;

/** The page a signed-in reader sees when the session token has no email
 * claims. The second paragraph is for the person who set up sign-in. */
export function missingClaims(maintainer: string) {
  return (
    `Sign-in is not set up completely yet. Please tell ${maintainer}.\n\n` +
    'For the site owner: the Clerk session token needs the claims "email" and ' +
    '"email_verified". In the Clerk dashboard, open Sessions, then Customize ' +
    'session token, and add {"email": "{{user.primary_email_address}}", ' +
    '"email_verified": "{{user.email_verified}}"}. See docs/hosting.md in Flyleaf.'
  );
}

/** Who a reader sees the family as. VIEWER_PEOPLE maps sign-in emails to
 * people ("email=refn,email=refn"); ADMIN_EMAILS may switch views. An admin
 * also gets `viewers`: every person an invited relative is, so the site can
 * be seen as any of them. It holds person ids only, never emails. */
export function viewerFor(
  env: { VIEWER_PEOPLE?: string; ADMIN_EMAILS?: string },
  email: string,
) {
  const entries = (list = '') =>
    list
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  const people = entries(env.VIEWER_PEOPLE).map((entry) => {
    const [address, person = ''] = entry.split('=');
    return { address: address.trim().toLowerCase(), person: person.trim() };
  });
  const person = people.find((p) => p.address === email)?.person || '';
  const admin = entries(env.ADMIN_EMAILS).some(
    (address) => address.toLowerCase() === email,
  );
  if (!admin) return { person, admin };
  const viewers = [
    ...new Set(people.map((p) => p.person).filter(Boolean)),
  ].sort();
  return { person, admin, viewers };
}
