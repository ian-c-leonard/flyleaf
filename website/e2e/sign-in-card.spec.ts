import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderLoginPage } from '../scripts/write-login-page.mjs';

// The sign-in page with a printed family card, in a real browser. The page
// and its scripts are the real ones. The Worker's answers and the sign-in
// service are stand-ins here; tests/cards-runtime.test.mjs checks the Worker.

const login = fileURLToPath(new URL('../public/login/', import.meta.url));
const types: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
};
// A test key, as Clerk encodes one: base64 of "relatives.clerk.accounts.dev$".
const config = {
  publishableKey: 'pk_test_cmVsYXRpdmVzLmNsZXJrLmFjY291bnRzLmRldiQ',
  frontendApi: 'https://relatives.clerk.accounts.dev',
  clerkVersion: '6.31.1',
  uiVersion: '1.32.3',
};
const code = 'K7M-4QX';

type Sent = { step: string; body: { code?: string; email?: string } };

type Start = {
  cards?: boolean;
  at?: string;
  // An account already signed in on this device, by its main address.
  signedInAs?: string;
  // The main address of the account the chosen address belongs to.
  mainEmail?: string;
  refuseConfirm?: boolean;
};

async function open(
  page: Page,
  { cards = true, at = '/login', signedInAs = '', mainEmail = '', refuseConfirm = false }: Start = {},
) {
  const sent: Sent[] = [];
  // Nothing in these tests may leave the browser.
  await page.route('**/*', (route) => route.fulfill({ status: 404, body: '' }));
  const signInPage = { contentType: 'text/html', body: renderLoginPage() };
  await page.route('**/login', (route) => route.fulfill(signInPage));
  await page.route('**/login/**', async (route) => {
    const name = new URL(route.request().url()).pathname.slice('/login/'.length);
    if (name === '' || name === 'accept-invitation')
      return route.fulfill(signInPage);
    if (name === 'config.json')
      return route.fulfill({ json: { ...config, cards } });
    try {
      return await route.fulfill({
        contentType: types[path.extname(name)] || 'application/octet-stream',
        body: await readFile(path.join(login, name)),
      });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  await page.route('**/api/card/*', async (route) => {
    const step = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON() as Sent['body'];
    sent.push({ step, body });
    const typed = (body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (typed === 'R9T6WD')
      return route.fulfill({ json: { used: true, hint: 'j…@example.com' } });
    if (typed === 'SLOWDOWN2222')
      return route.fulfill({ status: 429, json: { error: 'too-many', wait: 'hour' } });
    // Tamsin's card, and a blank card nobody has been named for yet.
    if (typed !== 'K7M4QX' && typed !== 'T4N6QW')
      return route.fulfill({ status: 404, json: { error: 'no-match' } });
    if (step === 'check')
      return route.fulfill({ json: { firstName: typed === 'K7M4QX' ? 'Tamsin' : '' } });
    if (step === 'email') {
      if (body.email?.startsWith('sixth@'))
        return route.fulfill({ status: 429, json: { error: 'too-many-emails' } });
      return body.email?.includes('@')
        ? route.fulfill({ json: { email: body.email.trim().toLowerCase() } })
        : route.fulfill({ status: 400, json: { error: 'email' } });
    }
    return refuseConfirm
      ? route.fulfill({ status: 403, json: { error: 'other-email' } })
      : route.fulfill({ json: { allowed: true } });
  });
  await page.route('**/api/session', (route) =>
    route.fulfill({ status: 403, body: '' }),
  );
  await page.route(/\/(\?.*)?$/, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>FAMILY HOME</h1>' }),
  );
  // A stand-in for the sign-in service's browser library.
  await page.addInitScript(({ signedInAs, mainEmail }) => {
    const calls: unknown[] = [];
    let asked = '';
    const account = (email: string) => ({ primaryEmailAddress: { emailAddress: email } });
    const session = { getToken: async () => 'token' };
    const attempt = {
      supportedFirstFactors: [{ strategy: 'email_code', emailAddressId: 'idn_1' }],
      prepareFirstFactor: async () => {
        calls.push('prepare');
        return attempt;
      },
    };
    const clerk = {
      loaded: false,
      isSignedIn: !!signedInAs,
      user: (signedInAs ? account(signedInAs) : null) as unknown,
      session: (signedInAs ? session : null) as unknown,
      load: async () => {
        clerk.loaded = true;
      },
      mountSignIn: (element: HTMLElement) => {
        calls.push('mountSignIn');
        element.innerHTML =
          '<h1>Sign in</h1><label>Email address <input type="email" /></label>';
      },
      unmountSignIn: (element: HTMLElement) => {
        calls.push('unmountSignIn');
        element.innerHTML = '';
      },
      mountSignUp: (element: HTMLElement) => {
        calls.push('mountSignUp');
        element.innerHTML = '<h1>Accept your invitation</h1>';
      },
      // Given a function, the real library runs it and stays on the page.
      signOut: async (after?: () => void) => {
        calls.push('signOut');
        clerk.isSignedIn = false;
        clerk.user = null;
        if (typeof after !== 'function') location.assign('/login?signed-out');
      },
      setActive: async ({ session: id }: { session: string }) => {
        calls.push(['setActive', id]);
        clerk.isSignedIn = true;
        clerk.session = session;
        clerk.user = account(mainEmail || asked);
      },
      client: {
        signIn: {
          create: async ({ identifier }: { identifier: string }) => {
            calls.push(['create', identifier]);
            asked = identifier;
            return attempt;
          },
          attemptFirstFactor: async ({ code }: { code: string }) => {
            calls.push(['attempt', code]);
            if (code !== '424242')
              throw Object.assign(new Error('incorrect'), {
                errors: [{ code: 'form_code_incorrect' }],
              });
            return { status: 'complete', createdSessionId: 'sess_1' };
          },
        },
      },
    };
    Object.assign(window, {
      Clerk: clerk,
      __internal_ClerkUICtor: function () {},
      __clerkCalls: calls,
    });
  }, { signedInAs, mainEmail });
  await page.goto(at);
  const calls = () =>
    page.evaluate(() => (window as unknown as { __clerkCalls: unknown[] }).__clerkCalls);
  return { sent, calls };
}

test('a relative with a card types its code, chooses an email and is let in', async ({
  page,
}) => {
  const { sent, calls } = await open(page);
  const card = page.locator('#card');
  await expect(card.getByRole('heading', { name: 'Have a card?' })).toBeVisible();
  await expect(page.locator('#clerk-form h1')).toHaveText('Sign in');
  await expect(page.locator('#card-or')).toBeVisible();

  // A wrong code is explained, and the page stays where it was.
  await card.getByLabel('Type the code from your card.').fill('k7m 4qq');
  await card.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#card-status')).toHaveText(
    'That code doesn’t match a card. Please check it and try again.',
  );
  await expect(page.locator('#clerk-form h1')).toBeVisible();

  // The right code, typed the way people type.
  await card.getByLabel('Type the code from your card.').fill(' k7m 4qx ');
  await card.getByLabel('Type the code from your card.').press('Enter');
  await expect(card.getByRole('heading', { name: 'Welcome, Tamsin' })).toBeVisible();
  // The ordinary sign-in form is put away while the card is in use.
  await expect(page.locator('#clerk-form')).toBeHidden();
  await expect(page.locator('#card-or')).toBeHidden();
  await expect(page.locator('#card-email')).toBeFocused();

  await page.locator('#card-email').fill('not an address');
  await card.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#card-status')).toHaveText(
    'That email address doesn’t look right. Please check it and try again.',
  );
  await page.locator('#card-email').fill('Tamsin@Example.com');
  await card.getByRole('button', { name: 'Continue' }).click();
  await expect(card.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.locator('#card-proof-sent')).toHaveText(
    'We sent a six-digit code to tamsin@example.com.',
  );
  // It says who the email is from and where else to look.
  await expect(page.locator('#card-proof-hint')).toHaveText(
    new RegExp(
      `^The email comes from ${new URL(page.url()).hostname.replace(/\./g, '\\.')} .* look in spam or junk\\.$`,
    ),
  );
  await expect(page.locator('#card-proof')).toBeFocused();

  await page.locator('#card-proof').fill('111111');
  await card.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#card-status')).toHaveText(
    'That code isn’t right. Please check the email and try again.',
  );
  await card.getByRole('button', { name: 'Send the code again' }).click();
  await expect(page.locator('#card-status')).toHaveText(
    'The email can take a minute. Check your spam folder too.',
  );
  await page.locator('#card-proof').fill('424 242');
  await card.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'FAMILY HOME' })).toBeVisible();

  expect(sent.map((request) => request.step)).toEqual([
    'check',
    'check',
    'email',
    'email',
    'confirm',
  ]);
  expect(sent.at(-1)!.body).toEqual({ code: 'k7m 4qx' });
  expect(sent[3].body.email).toBe('Tamsin@Example.com');
});

test('the sign-in service is asked for one emailed code per request, for the chosen address', async ({
  page,
}) => {
  const { calls } = await open(page);
  await page.locator('#card-code').fill(code);
  await page.locator('#card-code').press('Enter');
  await page.locator('#card-email').fill('tamsin@example.com');
  await page.locator('#card-email').press('Enter');
  await expect(page.locator('#card-proof')).toBeVisible();
  expect(await calls()).toEqual([
    'mountSignIn',
    'unmountSignIn',
    ['create', 'tamsin@example.com'],
    'prepare',
  ]);
  // A different address, after a typing mistake.
  await page.getByRole('button', { name: 'Use a different email address' }).click();
  await expect(page.locator('#card-email')).toBeFocused();
  await page.locator('#card-email').fill('tamsin.p@example.com');
  await page.locator('#card-email').press('Enter');
  await expect(page.locator('#card-proof-sent')).toHaveText(
    'We sent a six-digit code to tamsin.p@example.com.',
  );
  expect((await calls()).slice(4)).toEqual([
    ['create', 'tamsin.p@example.com'],
    'prepare',
  ]);
});

test('a used card, and too many tries, are explained beside the sign-in form', async ({
  page,
}) => {
  await open(page);
  await page.locator('#card-code').fill('R9T-6WD');
  await page.locator('#card-code').press('Enter');
  await expect(page.locator('#card-status')).toHaveText(
    'This card has already been used. Sign in below with the email address you chose (j…@example.com).',
  );
  await expect(page.locator('#clerk-form h1')).toBeVisible();
  await page.locator('#card-code').fill('SLOW-DOWN-2222');
  await page.locator('#card-code').press('Enter');
  await expect(page.locator('#card-status')).toHaveText(
    'Too many tries. Please wait an hour and try again, or contact Carol.',
  );
  await page.locator('#card-code').fill('');
  await page.locator('#card-code').press('Enter');
  await expect(page.locator('#card-status')).toHaveText(
    'Please type the code from your card.',
  );
});

test('a relative who starts with a card can go back to the ordinary sign-in', async ({
  page,
}) => {
  const { calls } = await open(page);
  await page.locator('#card-code').fill(code);
  await page.locator('#card-code').press('Enter');
  await expect(page.locator('#card-welcome')).toHaveText('Welcome, Tamsin');
  await page.getByRole('button', { name: 'Use a different card' }).click();
  await expect(page.locator('#card-code')).toBeFocused();
  await expect(page.locator('#card-code')).toHaveValue('');
  await expect(page.locator('#clerk-form h1')).toHaveText('Sign in');
  await expect(page.locator('#card-or')).toBeVisible();
  expect(await calls()).toEqual(['mountSignIn', 'unmountSignIn', 'mountSignIn']);
});

test('without cards, and on an emailed invitation, the page has no card box', async ({
  page,
}) => {
  await open(page, { cards: false });
  await expect(page.locator('#clerk-form h1')).toHaveText('Sign in');
  await expect(page.locator('#card')).toBeHidden();
  await expect(page.locator('#card-or')).toBeHidden();
  await expect(page.locator('#card-help')).toBeHidden();
  await open(page, { at: '/login/accept-invitation' });
  await expect(page.locator('#clerk-form h1')).toHaveText('Accept your invitation');
  await expect(page.locator('#card')).toBeHidden();
});

test('the card box fits the screen, with fields large enough to tap', async ({
  page,
}) => {
  await open(page);
  await expect(page.locator('#card')).toBeVisible();
  for (const step of ['code', 'email', 'proof']) {
    if (step === 'email') {
      await page.locator('#card-code').fill(code);
      await page.locator('#card-code').press('Enter');
    }
    if (step === 'proof') {
      await page.locator('#card-email').fill('tamsin@example.com');
      await page.locator('#card-email').press('Enter');
    }
    const field = page.locator('#card-' + step);
    await expect(field).toBeVisible();
    if (process.env.CARD_SCREENSHOTS)
      await page.screenshot({
        path: `${process.env.CARD_SCREENSHOTS}/${test.info().project.name}-${step}.png`,
        fullPage: true,
      });
    const box = (await field.boundingBox())!;
    expect(box.height, step).toBeGreaterThanOrEqual(44);
    for (const button of await page.locator('#card button:visible').all())
      expect((await button.boundingBox())!.height, step).toBeGreaterThanOrEqual(44);
    // 16px or more, so a phone does not zoom in on the field.
    expect(
      await field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
      step,
    ).toBeGreaterThanOrEqual(16);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      step,
    ).toBe(true);
  }
});

test('another account signed in on this device is signed out first, and the page stays put', async ({
  page,
}) => {
  const { calls } = await open(page, { signedInAs: 'someone.else@example.com' });
  await expect(page.locator('#status')).toContainText('this account cannot open the collection yet');
  await page.locator('#card-code').fill(code);
  await page.locator('#card-code').press('Enter');
  // The message about the other account goes while the card is in use.
  await expect(page.locator('#status')).toBeEmpty();
  await expect(page.getByRole('button', { name: 'Use another email' })).toBeHidden();
  await page.locator('#card-email').fill('tamsin@example.com');
  await page.locator('#card-email').press('Enter');
  await expect(page.locator('#card-proof')).toBeVisible();
  expect(page.url()).toMatch(/\/login$/);
  expect(await calls()).toEqual(['signOut', ['create', 'tamsin@example.com'], 'prepare']);
  await page.locator('#card-proof').fill('424242');
  await page.locator('#card-proof').press('Enter');
  await expect(page.getByRole('heading', { name: 'FAMILY HOME' })).toBeVisible();
});

test('a relative already signed in with the chosen address needs no second code', async ({
  page,
}) => {
  const { sent, calls } = await open(page, { signedInAs: 'Tamsin@Example.com' });
  await page.locator('#card-code').fill(code);
  await page.locator('#card-code').press('Enter');
  await page.locator('#card-email').fill('tamsin@example.com');
  await page.locator('#card-email').press('Enter');
  await expect(page.getByRole('heading', { name: 'FAMILY HOME' })).toBeVisible();
  expect(sent.map((request) => request.step)).toEqual(['check', 'email', 'confirm']);
  expect(await calls()).toEqual([]);
});

test('an address that belongs to an account with another main address is let in under that one', async ({
  page,
}) => {
  const { sent } = await open(page, { mainEmail: 'Tamsin.Main@Example.com' });
  await page.locator('#card-code').fill(code);
  await page.locator('#card-code').press('Enter');
  await page.locator('#card-email').fill('tamsin.second@example.com');
  await page.locator('#card-email').press('Enter');
  await page.locator('#card-proof').fill('424242');
  await page.locator('#card-proof').press('Enter');
  await expect(page.getByRole('heading', { name: 'FAMILY HOME' })).toBeVisible();
  expect(sent.map((request) => [request.step, request.body.email])).toEqual([
    ['check', undefined],
    ['email', 'tamsin.second@example.com'],
    ['email', 'tamsin.main@example.com'],
    ['confirm', undefined],
  ]);
});

test('a refused last step is explained, and the relative is not told they are in', async ({
  page,
}) => {
  await open(page, { refuseConfirm: true });
  await page.locator('#card-code').fill(code);
  await page.locator('#card-code').press('Enter');
  await page.locator('#card-email').fill('sixth@example.com');
  await page.locator('#card-email').press('Enter');
  await expect(page.locator('#card-status')).toHaveText(
    'This card has tried too many email addresses. Please contact Carol.',
  );
  await page.locator('#card-email').fill('tamsin@example.com');
  await page.locator('#card-email').press('Enter');
  await page.locator('#card-proof').fill('424242');
  await page.locator('#card-proof').press('Enter');
  await expect(page.locator('#card-status')).toHaveText(
    'You’re signed in with a different email address. Please try another address, or contact Carol.',
  );
  await expect(page.locator('#card-status')).not.toContainText('Welcome');
  expect(page.url()).toMatch(/\/login$/);
  // There is a way forward: another address.
  await page.getByRole('button', { name: 'Use a different email address' }).click();
  await expect(page.locator('#card-email')).toBeFocused();
});

test('a blank card is welcomed without a name, and let in', async ({ page }) => {
  const { sent } = await open(page);
  await page.locator('#card-code').fill('t4n 6qw');
  await page.locator('#card-code').press('Enter');
  await expect(page.locator('#card-welcome')).toHaveText('Welcome');
  await expect(page.locator('#card-status')).toHaveText('');
  await page.locator('#card-email').fill('guest@example.com');
  await page.locator('#card-email').press('Enter');
  await expect(page.locator('#card-proof-sent')).toHaveText(
    'We sent a six-digit code to guest@example.com.',
  );
  await page.locator('#card-proof').fill('424242');
  await page.locator('#card-proof').press('Enter');
  await expect(page.getByRole('heading', { name: 'FAMILY HOME' })).toBeVisible();
  expect(sent.map((request) => request.step)).toEqual(['check', 'email', 'confirm']);
});
