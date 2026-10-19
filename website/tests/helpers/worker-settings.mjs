// Invented Worker settings for tests, so they do not depend on the current
// family's flyleaf.json. Each value has the shape a real family's has.
export const workerSettings = {
  // pk_live_ + base64 of "clerk.example.family$", as Clerk encodes its keys.
  CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuZXhhbXBsZS5mYW1pbHkk',
  CLERK_SECRET_KEY: 'sk_live_isolated_local_fixture_not_a_real_credential',
  ALLOWED_EMAILS: 'ada@example.org',
  ALLOWED_HOSTS: 'example.family',
  SUBMISSIONS_OPEN: 'true',
  CLERK_FRONTEND_API: 'https://clerk.example.family',
  MAINTAINER_NAME: 'Ada',
  BOOK_PDF_NAME: 'example-family.pdf',
};
