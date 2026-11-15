// A family card on the sign-in page. A relative types the code from a printed
// card, is welcomed by name, chooses the email address they will sign in
// with, and types the six-digit code sent to it. The Worker's side is
// worker/cards.ts.
import { loadClerk, destination } from './runtime.js';

/** What to tell a relative when a card step is refused. */
export function cardProblem(status, body, maintainer) {
  const error = body?.error;
  if (body?.used || error === 'used')
    return (
      'This card has already been used. Sign in below with the email address you chose' +
      (body.hint ? ` (${body.hint}).` : '.')
    );
  if (status === 404 && error === 'no-match')
    return 'That code doesn’t match a card. Please check it and try again.';
  if (error === 'too-many-emails')
    return `This card has tried too many email addresses. Please contact ${maintainer}.`;
  if (status === 409 && error === 'busy')
    return 'That didn’t go through. Please try again.';
  if (status === 429)
    return body?.wait === 'day'
      ? `Too many tries today. Please try again tomorrow, or contact ${maintainer}.`
      : `Too many tries. Please wait an hour and try again, or contact ${maintainer}.`;
  if (status === 400 && error === 'email')
    return 'That email address doesn’t look right. Please check it and try again.';
  if (status === 403 && error === 'other-email')
    return `You’re signed in with a different email address. Please try another address, or contact ${maintainer}.`;
  if (status === 503 && error === 'unavailable')
    return `Cards are not ready yet. Please tell ${maintainer}.`;
  return 'That didn’t work. Please check your connection and try again.';
}

/** What to tell a relative when the six-digit code is refused. */
export function proofProblem(error) {
  const codes = Array.isArray(error?.errors)
    ? error.errors.map((problem) => problem?.code)
    : [];
  if (codes.includes('form_code_incorrect'))
    return 'That code isn’t right. Please check the email and try again.';
  if (codes.includes('verification_expired'))
    return 'That code has expired. Choose “Send the code again”.';
  if (
    codes.includes('verification_failed') ||
    codes.includes('too_many_requests') ||
    error?.status === 429
  )
    return 'Too many tries. Please wait a few minutes, then choose “Send the code again”.';
  return 'That didn’t work. Please check your connection and try again.';
}

function send(step, body) {
  return fetch('/api/card/' + step, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
}

/** Show the card box and run its steps. `pause` hides the ordinary sign-in
 * form while a card is in use, and `resume` brings it back. */
export function startCards({ maintainer, pause, resume }) {
  const find = (id) => document.getElementById(id);
  const forms = {
    code: find('card-code-form'),
    email: find('card-email-form'),
    proof: find('card-proof-form'),
  };
  const status = find('card-status');
  let code = '';
  let email = '';
  let firstName = '';
  let busy = false;

  function say(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }
  function show(step) {
    for (const [name, form] of Object.entries(forms))
      form.hidden = name !== step;
    const field = forms[step].querySelector('input');
    if (step !== 'code') field.value = '';
    field.focus();
  }
  // One step at a time: a second press while the first is being checked
  // would send the request twice.
  async function run(form, work) {
    if (busy) return;
    busy = true;
    const buttons = [...form.querySelectorAll('button')];
    for (const button of buttons) button.disabled = true;
    try {
      await work();
    } catch {
      say(cardProblem(0, null, maintainer), true);
    } finally {
      busy = false;
      for (const button of buttons) button.disabled = false;
    }
  }
  const refused = async (response) =>
    say(
      cardProblem(response.status, await response.json().catch(() => null), maintainer),
      true,
    );

  async function sendProof() {
    const clerk = await loadClerk();
    if (clerk.isSignedIn) {
      const current = clerk.user?.primaryEmailAddress?.emailAddress;
      if (current?.toLowerCase() === email) return finish(clerk);
      // Another account is signed in on this device. Stay on this page.
      await clerk.signOut(() => {});
    }
    const attempt = await clerk.client.signIn.create({ identifier: email });
    const factor = attempt.supportedFirstFactors?.find(
      (candidate) => candidate.strategy === 'email_code',
    );
    if (!factor) throw new Error('This site does not email sign-in codes.');
    await attempt.prepareFirstFactor({
      strategy: 'email_code',
      emailAddressId: factor.emailAddressId,
    });
    find('card-proof-email').textContent = email;
    say('The email can take a minute. Check your spam folder too.');
    show('proof');
  }
  async function finish(clerk) {
    // The Worker reads the new sign-in from a cookie; make sure it is set.
    await clerk.session.getToken({ skipCache: true });
    // An address can belong to an account that signs in under another, its
    // main address. The site knows the account by that one, so the card
    // takes it.
    const main = clerk.user?.primaryEmailAddress?.emailAddress?.toLowerCase();
    if (main && main !== email) {
      const moved = await send('email', { code, email: main });
      if (!moved.ok) return refused(moved);
      email = main;
    }
    const response = await send('confirm', { code });
    if (!response.ok) return refused(response);
    for (const form of Object.values(forms)) form.hidden = true;
    say(`Welcome, ${firstName}. Opening the family collection…`);
    location.replace(destination());
  }
  function restart() {
    code = '';
    email = '';
    say('');
    resume();
    forms.code.querySelector('input').value = '';
    show('code');
  }

  forms.code.addEventListener('submit', (event) => {
    event.preventDefault();
    void run(forms.code, async () => {
      const typed = find('card-code').value.trim();
      if (!typed) return say('Please type the code from your card.', true);
      say('Checking your card…');
      const response = await send('check', { code: typed });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.firstName)
        return say(cardProblem(response.status, body, maintainer), true);
      code = typed;
      firstName = body.firstName;
      find('card-welcome').textContent = `Welcome, ${firstName}`;
      say('');
      pause();
      show('email');
    });
  });
  forms.email.addEventListener('submit', (event) => {
    event.preventDefault();
    void run(forms.email, async () => {
      const typed = find('card-email').value.trim();
      if (!typed) return say('Please type your email address.', true);
      say('One moment…');
      const response = await send('email', { code, email: typed });
      if (!response.ok) return refused(response);
      email = (await response.json()).email;
      await sendProof();
    });
  });
  forms.proof.addEventListener('submit', (event) => {
    event.preventDefault();
    void run(forms.proof, async () => {
      const digits = find('card-proof').value.replace(/\D/g, '');
      if (digits.length !== 6)
        return say('Please type the six digits from the email.', true);
      say('Signing you in…');
      const clerk = await loadClerk();
      let done;
      try {
        done = await clerk.client.signIn.attemptFirstFactor({
          strategy: 'email_code',
          code: digits,
        });
      } catch (error) {
        return say(proofProblem(error), true);
      }
      if (done.status !== 'complete')
        return say(`Sign-in needs another step. Please tell ${maintainer}.`, true);
      await clerk.setActive({ session: done.createdSessionId });
      await finish(clerk);
    });
  });
  find('card-resend').addEventListener('click', () => {
    void run(forms.proof, async () => {
      say('Sending the code again…');
      try {
        await sendProof();
      } catch (error) {
        say(proofProblem(error), true);
      }
    });
  });
  find('card-change-email').addEventListener('click', () => {
    say('');
    show('email');
  });
  find('card-restart').addEventListener('click', restart);

  find('card').hidden = false;
  find('card-or').hidden = false;
  find('card-help').hidden = false;
}
