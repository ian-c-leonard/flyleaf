# Security

Flyleaf builds private family websites, so a security problem can expose
living relatives. Please report one privately, not in a public issue.

## How to report a problem

Use GitHub's private vulnerability reporting: open the repository's
**Security** tab, then **Report a vulnerability**. Only the maintainer sees
the report. If that does not work, email the maintainer at the address on
their GitHub profile.

Say what you found, how to reproduce it, and what it could expose. Use the
sample family or a few invented people. Never send a real family's tree,
settings, credentials or relatives' email addresses.

The maintainer reads every report and replies as soon as possible.

## What counts

- A way into a private (Worker) site without an invitation, or a way to
  read another relative's submissions.
- A way for a family's tree, story text or uploaded file to run code in a
  reader's browser, or to read files during a build.
- A deploy that publishes files the family did not mean to publish.

Problems in a family's own Cloudflare or Clerk setup are not Flyleaf's to
fix. Report them anyway if Flyleaf's docs led you there.
