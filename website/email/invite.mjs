// Prepare personal family invitations. This script never sends email.
//
//   node website/email/invite.mjs                      write previews to email/out/
//   node website/email/invite.mjs --create-invitations create Clerk invitation
//                                                      links (Clerk sends nothing)
//   node website/email/invite.mjs --eml                also write each email as
//                                                      an .eml file to open in a
//                                                      mail program, check and send
//
// Run it from Flyleaf's folder with the family named, as for every other
// script: FLYLEAF_FAMILY=../my-family node website/email/invite.mjs
//
// The letter and the invitee list live in the family's email folder
// (paths.email in flyleaf.json, default email/). Without a letter of its own,
// a family gets the plain one beside this script. In the letter, {{name}}
// takes a value: firstName, inviteUrl, familyName, maintainerFirstName and
// origin. The HTML letter gets each value escaped.
//
// Invitees live in <email folder>/invitees.local.json (keep it out of git):
//   [{ "email": "...", "firstName": "Ada", "person": "ada-penhallow" }]
// Each address must also be added to auth.allowed_emails and auth.viewer_people
// in flyleaf.json, then wrangler.jsonc regenerated (scripts/write-wrangler.mjs)
// and published; the script prints the exact values.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { familyRoot, readSettings } from '../flyleaf-settings.mjs';
import { isMain } from '../scripts/is-main.mjs';

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** The letter with each {{name}} replaced by its value: escaped for the HTML
 * letter, as written for the plain-text one. */
export function fill(template, values, { html = false } = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = values[key] ?? '';
    return html ? escapeHtml(value) : String(value);
  });
}

const ascii = (text) => /^[\x20-\x7e]*$/.test(text);
// Words outside plain ASCII, encoded for a header (RFC 2047).
const encoded = (text) =>
  ascii(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;

/** One header line. A value with a line break could add headers of its own,
 * so it stops the script. In From and To, only the name before <address> is
 * encoded, so mail programs still find the address. */
function header(name, value) {
  if (/[\r\n]/.test(value))
    throw new Error(`The email's ${name} has a line break in it: ${JSON.stringify(value)}`);
  if (name !== 'From' && name !== 'To') return `${name}: ${encoded(value)}`;
  const named = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(value);
  if (!named || !named[1]) return `${name}: ${value.trim()}`;
  const words = named[1].replace(/^"(.*)"$/, '$1');
  const shown = ascii(words) ? `"${words.replace(/(["\\])/g, '\\$1')}"` : encoded(words);
  return `${name}: ${shown} <${named[2]}>`;
}

const base64Lines = (text) =>
  Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/.{76}/g, '$&\r\n');

/** A complete email, with the plain-text and HTML letters as alternatives.
 * Mail programs open an .eml file as a message to check and send; X-Unsent
 * asks those that support it to open it as a draft. */
export function emlMessage({ from, to, subject, text, html, boundary = randomUUID() }) {
  const mark = `flyleaf-${boundary}`;
  return [
    header('From', from),
    header('To', to),
    header('Subject', subject),
    'MIME-Version: 1.0',
    'X-Unsent: 1',
    `Content-Type: multipart/alternative; boundary="${mark}"`,
    '',
    `--${mark}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(text),
    `--${mark}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(html),
    `--${mark}--`,
    '',
  ].join('\r\n');
}

if (isMain(import.meta.url)) {
  const engineLetters = fileURLToPath(new URL('.', import.meta.url));
  const args = new Set(process.argv.slice(2));
  const settings = readSettings();
  const here = path.resolve(familyRoot(), settings.paths?.email || 'email');
  const letter = (name) =>
    readFileSync(
      existsSync(path.join(here, name)) ? path.join(here, name) : path.join(engineLetters, name),
      'utf8',
    );
  const from = settings.email.from;
  const subject = settings.email.invitation_subject;
  const redirect = settings.site.origin + '/login/accept-invitation';
  const credentials = settings.deploy.credentials_dir.replace(/^~(?=\/)/, homedir());

  console.log(`Family: ${settings.family.name} (${familyRoot()})`);
  const invitees = JSON.parse(readFileSync(path.join(here, 'invitees.local.json'), 'utf8'));
  const html = letter('family-invitation.html');
  const text = letter('family-invitation.txt');

  const clerkSecret = () => {
    const env = readFileSync(path.join(credentials, 'clerk.env'), 'utf8');
    return env.match(/^CLERK_SECRET_KEY=(.*)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
  };

  const invitation = async (email) => {
    const response = await fetch('https://api.clerk.com/v1/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clerkSecret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_address: email,
        redirect_url: redirect,
        notify: false,
        ignore_existing: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json();
    if (!response.ok || !body.url) throw new Error(`Clerk invitation failed for ${email}`);
    return body.url;
  };

  mkdirSync(path.join(here, 'out'), { recursive: true });
  for (const person of invitees) {
    const inviteUrl = args.has('--create-invitations')
      ? await invitation(person.email)
      : settings.site.origin + '/login';
    const values = {
      firstName: person.firstName,
      inviteUrl,
      familyName: settings.family.name,
      maintainerFirstName: settings.maintainer.first_name,
      origin: settings.site.origin,
    };
    const page = fill(html, values, { html: true });
    const body = fill(text, values);
    const file = path.join(here, 'out', `${person.email}.html`);
    writeFileSync(file, page);
    console.log('Preview written:', path.relative(process.cwd(), file));
    if (args.has('--eml')) {
      const eml = path.join(here, 'out', `${person.email}.eml`);
      writeFileSync(
        eml,
        emlMessage({ from, to: person.email, subject, text: body, html: page }),
      );
      console.log('Email written:', path.relative(process.cwd(), eml));
    }
  }

  console.log('\nAdd to flyleaf.json, run scripts/write-wrangler.mjs, then publish:');
  console.log('  auth.allowed_emails: add', invitees.map((p) => p.email).join(', '));
  console.log('  auth.viewer_people: add', invitees.map((p) => `"${p.email}": "${p.person}"`).join(', '));
}
