// The family's settings for this deployment, from the Worker's environment
// (wrangler.jsonc vars, generated from flyleaf.json). They are the same for
// every request, so fetch() sets them once at the start of each request.
export type SiteSettings = {
  host: string;
  origin: string;
  clerkOrigin: string;
  maintainer: string;
  pdfName: string;
};

let current: SiteSettings | null = null;

export function configure(env: Env): SiteSettings {
  current = {
    host: env.ALLOWED_HOSTS,
    origin: 'https://' + env.ALLOWED_HOSTS,
    clerkOrigin: env.CLERK_FRONTEND_API,
    maintainer: env.MAINTAINER_NAME,
    pdfName: env.BOOK_PDF_NAME,
  };
  return current;
}

export function site(): SiteSettings {
  if (!current) throw new Error('Site settings are read before configure()');
  return current;
}

/** True when an email is in a comma-separated list (ADMIN_EMAILS and so on). */
export function listed(list: string | undefined, email: string): boolean {
  return (list || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .some((entry) => entry && entry === email.toLowerCase());
}

/** Plain text for a PDF file name inside a regular expression. */
export const literal = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
