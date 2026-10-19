import { loadClerk } from '../../public/login/runtime.js';
import { onLiveSite } from './settings.ts';
import { randomId } from './random-id.ts';
export type Association = {
  kind: 'person' | 'source';
  id: string;
  label: string;
} | null;
export type SubmissionKind = 'share' | 'correction';
export type SubmissionFile = {
  id: string;
  name: string;
  bytes: number;
  sha256: string;
  mediaType: string;
  uploaded: boolean;
  downloadUrl: string;
};
export type SubmissionSummary = {
  id: string;
  kind: SubmissionKind;
  title: string;
  contributor: { userId: string; email: string };
  createdAt: number;
  receivedAt: number | null;
  reviewedAt: number | null;
  status: 'uploading' | 'received' | 'reviewed';
};
export type SubmissionDetail = SubmissionSummary & {
  text: string;
  link: string;
  association: Association;
  files: SubmissionFile[];
};
export type SubmissionList = {
  viewer: { userId: string; email: string; reviewer: boolean };
  items: SubmissionSummary[];
  next: string | null;
};
export type DraftFile = {
  id: string;
  name: string;
  bytes: number;
  sha256: string;
  mediaType: string;
  uploaded?: boolean;
  file?: File;
};
export type Draft = {
  id: string;
  kind?: SubmissionKind;
  title: string;
  text: string;
  link: string;
  association: Association;
  files: DraftFile[];
  locked: boolean;
};
export const newDraft = (): Draft => ({
  id: randomId(),
  title: '',
  text: '',
  link: '',
  association: null,
  files: [],
  locked: false,
});
export class SubmissionError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function submissionRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    // Fresh cookie before writing. Never follow a provider redirect with a file.
    if (onLiveSite()) {
      const clerk = await loadClerk();
      if (
        !clerk.session ||
        !(await clerk.session.getToken({ skipCache: true }))
      )
        throw new SubmissionError(
          'Please sign in again, then try again. Your message is kept in this tab.',
          401,
        );
    }
    if (body && !(body instanceof File))
      headers['Content-Type'] = 'application/json';
  }
  const options: RequestInit = {
    method,
    credentials: 'same-origin',
    redirect: 'error',
    headers,
  };
  if (method !== 'GET')
    options.body =
      body instanceof File ? body : body ? JSON.stringify(body) : undefined;
  let response: Response;
  try {
    response = await fetch('/api/submissions' + path, options);
  } catch {
    throw new SubmissionError(
      'The connection was interrupted. Try again to finish sending.',
      0,
    );
  }
  const result = await response.json().catch(() => null);
  const message =
    result &&
    typeof result === 'object' &&
    'error' in result &&
    typeof result.error === 'string'
      ? result.error
      : '';
  if (!response.ok)
    throw new SubmissionError(
      message ||
        (response.status === 401
          ? 'Please sign in again, then try again. Your message is kept in this tab.'
          : 'Sharing did not finish. Please try again.'),
      response.status,
    );
  return result as T;
}
export function saveDraft(userId: string, draft: Draft) {
  const value = JSON.stringify({
    ...draft,
    files: draft.files.map(({ file: _file, ...metadata }) => metadata),
  });
  if (draft.title || draft.text || draft.link || draft.files.length)
    sessionStorage.setItem(`family-contribution:${userId}:${draft.id}`, value);
  sessionStorage.setItem('family-contribution:' + userId, value);
}
export function readDraft(userId: string): Draft {
  try {
    const draft = JSON.parse(
      sessionStorage.getItem('family-contribution:' + userId) || 'null',
    );
    if (
      draft &&
      typeof draft.id === 'string' &&
      Array.isArray(draft.files) &&
      typeof draft.text === 'string'
    ) {
      return draft;
    }
  } catch {
    /* Storage may be disabled; the open form still works. */
  }
  return newDraft();
}
export function readDrafts(userId: string): Draft[] {
  try {
    return Object.keys(sessionStorage)
      .filter((key) => key.startsWith(`family-contribution:${userId}:`))
      .flatMap((key) => {
        try {
          const draft = JSON.parse(sessionStorage.getItem(key) || 'null');
          return draft &&
            typeof draft.id === 'string' &&
            typeof draft.text === 'string' &&
            Array.isArray(draft.files)
            ? [draft as Draft]
            : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
export function forgetDraft(userId: string, id: string) {
  try {
    sessionStorage.removeItem(`family-contribution:${userId}:${id}`);
  } catch {
    /* Received originals and wording are already stored on the server. */
  }
}
