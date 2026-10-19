import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  FilePlusIcon,
  PaperPlaneTiltIcon,
  PencilSimpleLineIcon,
  XIcon,
} from '@phosphor-icons/react';
import { lifespan, type AtlasData } from '../lib/gedcom';
import { sha256 } from '../lib/previews';
import {
  newDraft,
  readDraft,
  readDrafts,
  forgetDraft,
  saveDraft,
  submissionRequest,
  SubmissionError,
} from '../lib/submissions';
import type {
  Draft,
  DraftFile,
  SubmissionDetail,
  SubmissionList,
  SubmissionSummary,
} from '../lib/submissions';
import policy from '../../shared/submission-policy.json';
import '../submissions.css';
import { maintainerPronoun, onLiveSite, site } from '../lib/settings';
import { calendarDate } from '../lib/date-display';
import { sitePath } from '../lib/paths';

// The person who reviews what the family shares.
const me = site.maintainer.firstName;

const date = (value: number) => {
  const day = new Date(value);
  return calendarDate(
    [
      day.getFullYear(),
      String(day.getMonth() + 1).padStart(2, '0'),
      String(day.getDate()).padStart(2, '0'),
    ].join('-'),
  );
};
const size = (bytes: number) =>
  bytes < 1_000_000
    ? `${Math.ceil(bytes / 1000)} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
const status = {
  uploading: 'Upload unfinished',
  received: `Received by ${me}`,
  reviewed: `Reviewed by ${me}`,
};
const kindLabel = (item: { kind?: string }) =>
  item.kind === 'correction' ? 'Suggested correction · ' : '';

export default function ShareSomething({
  data,
  visible,
  imported,
  correctionFor = '',
}: {
  data: AtlasData;
  visible: boolean;
  imported: boolean;
  /** A person to start a suggested correction about. */
  correctionFor?: string;
}) {
  const [list, setList] = useState<SubmissionList | null>(null);
  const [mode, setMode] = useState<'write' | 'mine' | 'review'>('write');
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [selected, setSelected] = useState<SubmissionDetail | null>(null);
  const [receipt, setReceipt] = useState<SubmissionDetail | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'person' | 'source'>('person');
  const filesInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const loaded = useRef(false);
  const errorFocus = useRef<HTMLDivElement>(null);
  const receiptFocus = useRef<HTMLHeadingElement>(null);
  const detailFocus = useRef<HTMLHeadingElement>(null);
  const formFocus = useRef<HTMLFormElement>(null);
  const [focusTarget, setFocusTarget] = useState<
    'error' | 'receipt' | 'detail' | 'form' | null
  >(null);
  useEffect(() => {
    if (busy || !focusTarget || !visible) return;
    const target = {
      error: errorFocus.current,
      receipt: receiptFocus.current,
      detail: detailFocus.current,
      form: formFocus.current,
    }[focusTarget];
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      setFocusTarget(null);
    }
  }, [busy, focusTarget, visible, mode, receipt, selected, error]);
  const available = onLiveSite() && !imported;
  function remember(next: Draft, userId = list?.viewer.userId) {
    setDraft(next);
    if (userId) {
      try {
        saveDraft(userId, next);
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    }
  }
  function showError(error: unknown) {
    setError(
      error instanceof Error
        ? error.message
        : 'Sharing did not finish. Please try again.',
    );
    setAuthError(error instanceof SubmissionError && error.status === 401);
    setFocusTarget('error');
  }
  useEffect(() => {
    if (!visible || !available || loaded.current) return;
    let active = true;
    void submissionRequest<SubmissionList>('')
      .then((result) => {
        if (!active) return;
        setList(result);
        setDraft(readDraft(result.viewer.userId));
        loaded.current = true;
      })
      .catch((error) => {
        if (active) showError(error);
      });
    return () => {
      active = false;
    };
  }, [visible, available]);
  const startedCorrection = useRef('');
  useEffect(() => {
    if (!correctionFor) {
      startedCorrection.current = '';
      return;
    }
    if (!visible || !list || startedCorrection.current === correctionFor)
      return;
    startedCorrection.current = correctionFor;
    const person = data.people.find((p) => p.id === correctionFor);
    if (!person) return;
    setMode('write');
    setSelected(null);
    setReceipt(null);
    if (
      draft.kind === 'correction' &&
      draft.association?.id === person.id &&
      !draft.locked
    )
      return;
    remember({
      ...newDraft(),
      kind: 'correction',
      title: `Correction for ${person.name}`,
      association: { kind: 'person', id: person.id, label: person.name },
    });
    setFocusTarget('form');
    // The guard above means a later draft edit never restarts the correction.
  }, [
    visible,
    list,
    correctionFor,
    data,
    draft.kind,
    draft.association?.id,
    draft.locked,
  ]);
  async function openList(next: 'mine' | 'review', more = false) {
    setBusy('Opening submissions…');
    setError('');
    setSelected(null);
    try {
      const result = await submissionRequest<SubmissionList>(
        (next === 'review' ? '?scope=review' : '?scope=mine') +
          (more && list?.next ? '&before=' + list.next : ''),
      );
      if (!loaded.current) {
        setDraft(readDraft(result.viewer.userId));
        loaded.current = true;
      }
      setList(
        more && list
          ? { ...result, items: [...list.items, ...result.items] }
          : result,
      );
      setMode(next);
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  }
  async function openSubmission(item: SubmissionSummary) {
    setBusy('Opening submission…');
    setError('');
    try {
      setSelected(await submissionRequest<SubmissionDetail>('/' + item.id));
      setFocusTarget('detail');
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  }
  async function chooseFiles(files: FileList | null) {
    if (!files || inFlight.current) return;
    inFlight.current = true;
    setBusy('Checking your files…');
    setError('');
    try {
      const next = draft.files.map((file) => ({ ...file }));
      for (const file of Array.from(files)) {
        if (!file.size || file.size > policy.maxFileBytes)
          throw Error(
            `${file.name} is empty or over 50 MB. Please choose another file.`,
          );
        const digest = await sha256(await file.arrayBuffer());
        const existing = next.find(
          (f) =>
            f.name === file.name &&
            f.bytes === file.size &&
            f.sha256 === digest,
        );
        if (existing) {
          existing.file = file;
          continue;
        }
        if (draft.locked)
          throw Error(
            `${file.name} is not one of the files in this submission. Please choose the same files again.`,
          );
        if (next.length >= policy.maxFiles)
          throw Error('Please send up to eight files at a time.');
        if (
          next.reduce((sum, f) => sum + f.bytes, 0) + file.size >
          policy.maxSubmissionBytes
        )
          throw Error('Please send up to 150 MB in one submission.');
        next.push({
          id: crypto.randomUUID(),
          name: file.name,
          bytes: file.size,
          sha256: digest,
          mediaType: file.type,
          file,
        });
      }
      remember({ ...draft, files: next });
    } catch (error) {
      showError(error);
    } finally {
      inFlight.current = false;
      setBusy('');
      if (filesInput.current) filesInput.current.value = '';
    }
  }
  async function send() {
    if (inFlight.current || !list) return;
    inFlight.current = true;
    setBusy('Saving your submission…');
    setError('');
    setAuthError(false);
    const fixed = { ...draft, locked: true };
    let created = false;
    try {
      remember(fixed);
      const manifest = {
        id: fixed.id,
        ...(fixed.kind === 'correction' && { kind: 'correction' }),
        title: fixed.title,
        text: fixed.text,
        link: fixed.link,
        association: fixed.association,
        files: fixed.files.map(({ id, name, bytes, sha256, mediaType }) => ({
          id,
          name,
          bytes,
          sha256,
          mediaType,
        })),
      };
      const saved = await submissionRequest<SubmissionDetail>(
        '',
        'POST',
        manifest,
      );
      created = true;
      for (const [index, file] of saved.files.entries()) {
        if (file.uploaded) continue;
        const chosen = fixed.files.find((f) => f.id === file.id)?.file;
        if (!chosen)
          throw Error(
            `Choose ${file.name} again to finish sending it. Your message has been saved.`,
          );
        setBusy(`Sending file ${index + 1} of ${saved.files.length}…`);
        await submissionRequest(
          '/' + saved.id + '/files/' + file.id,
          'PUT',
          chosen,
        );
        fixed.files = fixed.files.map((f) =>
          f.id === file.id ? { ...f, uploaded: true } : f,
        );
        remember({ ...fixed });
      }
      setBusy('Confirming everything arrived…');
      const finished = await submissionRequest<SubmissionDetail>(
        '/' + saved.id + '/complete',
        'POST',
      );
      setReceipt(finished);
      setFocusTarget('receipt');
      forgetDraft(list.viewer.userId, finished.id);
      remember(newDraft());
    } catch (error) {
      // These responses guarantee validation failed before inserting anything.
      if (
        !created &&
        error instanceof SubmissionError &&
        [400, 413, 415, 429, 507].includes(error.status)
      )
        remember({ ...fixed, locked: false });
      showError(error);
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }
  function resume(item: SubmissionDetail) {
    remember({
      id: item.id,
      kind: item.kind,
      title: item.title,
      text: item.text,
      link: item.link,
      association: item.association,
      locked: true,
      files: item.files.map((f) => ({
        ...f,
        file:
          draft.id === item.id
            ? draft.files.find((d) => d.id === f.id)?.file
            : undefined,
      })),
    });
    setSelected(null);
    setReceipt(null);
    setMode('write');
    setError('');
    setFocusTarget('form');
  }
  async function review(item: SubmissionDetail) {
    setBusy('Saving review…');
    setError('');
    try {
      await submissionRequest('/' + item.id + '/review', 'POST', {
        reviewed: !item.reviewedAt,
      });
      const updated = await submissionRequest<SubmissionDetail>('/' + item.id);
      setSelected(updated);
      if (receipt?.id === item.id) setReceipt(updated);
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  }
  if (!visible) return null;
  const correction = mode === 'write' && draft.kind === 'correction';
  const suggestions = (
    kind === 'person'
      ? data.people.map((p) => ({
          id: p.id,
          label: p.name,
          dates: lifespan(p),
        }))
      : data.sources.map((s) => ({ id: s.id, label: s.label, dates: '' }))
  )
    .filter(
      (item) =>
        query.trim() &&
        item.label.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .slice(0, 8);
  function details(item: SubmissionDetail) {
    return (
      <article className="kin-submission-detail">
        <span className="kin-eyebrow">
          {kindLabel(item)}
          {status[item.status]}
        </span>
        <h2 ref={detailFocus} tabIndex={-1}>
          {item.title}
        </h2>
        <p className="kin-submission-meta">
          From {item.contributor.email} · {date(item.createdAt)}
        </p>
        {item.association && (
          <p>
            About {item.association.label} <small>(suggested connection)</small>
          </p>
        )}
        <p className="kin-submission-wording">{item.text}</p>
        {item.link && (
          <p>
            <a href={item.link} target="_blank" rel="noopener noreferrer">
              Open the shared link <ArrowRightIcon size={15} />
            </a>
          </p>
        )}
        {!!item.files.length && (
          <ul className="kin-submission-files">
            {item.files.map((file) => (
              <li key={file.id}>
                <div>
                  <strong>{file.name}</strong>
                  <small>
                    {size(file.bytes)} ·{' '}
                    {file.uploaded ? 'Saved' : 'Not sent yet'}
                  </small>
                </div>
                {file.uploaded && (
                  <a
                    href={file.downloadUrl}
                    aria-label={`Download ${file.name}`}
                  >
                    <DownloadSimpleIcon size={20} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="kin-submission-actions">
          <a
            className="kin-button kin-button-quiet"
            href={'/api/submissions/' + item.id + '?download=1'}
          >
            <DownloadSimpleIcon size={18} /> Save submission record
          </a>
          {item.status === 'uploading' &&
            item.contributor.userId === list?.viewer.userId && (
              <button
                className="kin-button"
                disabled={!!busy}
                onClick={() => resume(item)}
              >
                Finish sending <ArrowRightIcon size={18} />
              </button>
            )}
          {item.receivedAt && list?.viewer.reviewer && (
            <button
              className="kin-button"
              disabled={!!busy}
              onClick={() => void review(item)}
            >
              {item.reviewedAt ? 'Return to review queue' : 'Mark reviewed'}
            </button>
          )}
        </div>
        {list?.viewer.reviewer && (
          <p className="kin-submission-note">
            “Reviewed” means you have read this submission. Adding it to the
            family history is a separate step.
          </p>
        )}
      </article>
    );
  }
  return (
    <section className="kin-share">
      <header className="kin-share-heading">
        {correction ? (
          <>
            <span className="kin-eyebrow">Help us get it right</span>
            <h1>Suggest a correction</h1>
            <p>
              {`Spotted a wrong name, date or relationship? Tell ${me} what should change. ${maintainerPronoun}’ll check it, then fix the website and the book.`}
            </p>
          </>
        ) : (
          <>
            <span className="kin-eyebrow">
              The family has more of the story
            </span>
            <h1>Share something</h1>
            <p>
              {`A name on the back of a photograph. A story you remember. A letter tucked away. Send it to ${me} and help this history grow.`}
            </p>
          </>
        )}
      </header>
      {!available ? (
        site.sharing ? (
          // A Worker site seen at another address, such as the dev server.
          <p>
            Sharing works on the family website.{' '}
            <a href={new URL(sitePath('#view=share'), site.origin).href}>
              {`Open ${new URL(site.origin).host}`}
            </a>
          </p>
        ) : (
          <p>
            {`This website does not take contributions. To share something, write to ${me}.`}{' '}
            <a href={`mailto:${site.maintainer.email}`}>{`Email ${me}`}</a>
          </p>
        )
      ) : (
        <>
          <nav className="kin-submission-tabs" aria-label="Contributions">
            <button
              aria-current={mode === 'write' ? 'page' : undefined}
              disabled={!!busy}
              onClick={() => {
                setMode('write');
                setSelected(null);
                setReceipt(null);
                setError('');
                setFocusTarget('form');
              }}
            >
              Send something
            </button>
            <button
              aria-current={mode === 'mine' ? 'page' : undefined}
              disabled={!!busy}
              onClick={() => void openList('mine')}
            >
              Your submissions
            </button>
            {list?.viewer.reviewer && (
              <button
                aria-current={mode === 'review' ? 'page' : undefined}
                disabled={!!busy}
                onClick={() => void openList('review')}
              >
                Family inbox
              </button>
            )}
          </nav>
          {!!error && (
            <div
              role="alert"
              className="kin-submission-error"
              ref={errorFocus}
              tabIndex={-1}
            >
              {error}
              {authError && (
                <p>
                  <a href={`${site.origin}/login?returnTo=%2F%23view%3Dshare`}>
                    Sign in again
                  </a>
                </p>
              )}
              {!list && (
                <button onClick={() => void openList('mine')}>Reconnect</button>
              )}
            </div>
          )}
          <output className="kin-submission-progress" aria-live="polite">
            {busy || (!list && !error ? 'Loading…' : '')}
          </output>
          {mode === 'write' &&
            (receipt ? (
              <div className="kin-submission-receipt">
                <CheckIcon size={32} />
                <h2 ref={receiptFocus} tabIndex={-1}>
                  {receipt.kind === 'correction'
                    ? 'Thank you. Your correction is safely received.'
                    : 'Thank you. It’s safely received.'}
                </h2>
                <p>
                  Your message and{' '}
                  {receipt.files.length
                    ? `${receipt.files.length} ${receipt.files.length === 1 ? 'file are' : 'files are'}`
                    : 'details are'}{' '}
                  {`saved for ${me} to review.`}
                </p>
                {details(receipt)}
                <button
                  className="kin-button"
                  onClick={() => {
                    setReceipt(null);
                    setFocusTarget('form');
                  }}
                >
                  Share something else <ArrowRightIcon size={18} />
                </button>
              </div>
            ) : (
              <div className="kin-share-layout">
                <form
                  className="kin-share-form"
                  ref={formFocus}
                  tabIndex={-1}
                  aria-label="Share a memory, correction or file"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                  }}
                >
                  <fieldset disabled={!!busy || !list || draft.locked}>
                    <div className="kin-share-kind">
                      <button
                        type="button"
                        aria-pressed={!correction}
                        onClick={() => remember({ ...draft, kind: 'share' })}
                      >
                        <FilePlusIcon size={18} /> Share something new
                      </button>
                      <button
                        type="button"
                        aria-pressed={correction}
                        onClick={() =>
                          remember({ ...draft, kind: 'correction' })
                        }
                      >
                        <PencilSimpleLineIcon size={18} /> Suggest a correction
                      </button>
                    </div>
                    <label htmlFor="share-title">Give it a short title</label>
                    <input
                      id="share-title"
                      required
                      maxLength={policy.maxTitleLength}
                      placeholder={
                        correction
                          ? 'For example, Grandpa’s birth year'
                          : 'For example, Grandma’s wedding photograph'
                      }
                      value={draft.title}
                      onChange={(e) =>
                        remember({ ...draft, title: e.target.value })
                      }
                    />
                    <label htmlFor="share-text">
                      {correction
                        ? 'What should change?'
                        : 'What would you like us to know?'}
                    </label>
                    <textarea
                      id="share-text"
                      rows={8}
                      maxLength={policy.maxTextLength}
                      placeholder={
                        correction
                          ? 'Say what the site shows now and what it should say. Tell us how you know, such as a certificate, a family Bible or your own memory.'
                          : 'Tell the story in your own words. If you’re unsure about a name, date or detail, say so.'
                      }
                      value={draft.text}
                      onChange={(e) =>
                        remember({ ...draft, text: e.target.value })
                      }
                    />
                    <label htmlFor="share-link">
                      A link, if you have one <small>optional</small>
                    </label>
                    <input
                      id="share-link"
                      type="url"
                      maxLength={2048}
                      placeholder="https://"
                      value={draft.link}
                      onChange={(e) =>
                        remember({ ...draft, link: e.target.value })
                      }
                    />
                    <label htmlFor="share-about">
                      {correction
                        ? 'Who or what needs correcting?'
                        : 'Who or what is this about?'}{' '}
                      <small>optional</small>
                    </label>
                    {draft.association ? (
                      <p className="kin-submission-association">
                        {draft.association.label}
                        <button
                          type="button"
                          aria-label="Remove suggested connection"
                          onClick={() =>
                            remember({ ...draft, association: null })
                          }
                        >
                          <XIcon size={18} />
                        </button>
                      </p>
                    ) : (
                      <>
                        <div className="kin-association-search">
                          <select
                            aria-label="Connection type"
                            value={kind}
                            onChange={(e) =>
                              setKind(e.target.value as 'person' | 'source')
                            }
                          >
                            <option value="person">Person</option>
                            <option value="source">Record</option>
                          </select>
                          <input
                            id="share-about"
                            type="search"
                            placeholder="Search by name or title"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                        {query.trim() && (
                          <ul className="kin-association-results">
                            {suggestions.map((s) => (
                              <li key={s.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    remember({
                                      ...draft,
                                      association: {
                                        kind,
                                        id: s.id,
                                        label: s.label,
                                      },
                                    });
                                    setQuery('');
                                  }}
                                >
                                  {s.label}
                                  {s.dates && <small>{s.dates}</small>}
                                </button>
                              </li>
                            ))}
                            {!suggestions.length && (
                              <li>
                                No match yet. You can describe the connection in
                                your message.
                              </li>
                            )}
                          </ul>
                        )}
                      </>
                    )}
                  </fieldset>
                  {draft.locked && (
                    <p className="kin-submission-note">
                      These details are kept for this submission. You can finish
                      sending the remaining files below.
                    </p>
                  )}
                  <div className="kin-attach">
                    <label htmlFor="share-files">
                      <FilePlusIcon size={24} />
                      <strong>
                        {draft.locked
                          ? 'Choose the unsent files again'
                          : 'Add photographs or documents'}
                      </strong>
                      <span>
                        Up to eight files · 50 MB each · 150 MB altogether
                      </span>
                    </label>
                    <input
                      ref={filesInput}
                      id="share-files"
                      type="file"
                      multiple
                      disabled={!!busy || !list}
                      onChange={(e) => void chooseFiles(e.target.files)}
                    />
                  </div>
                  {!!draft.files.length && (
                    <ul className="kin-submission-files">
                      {draft.files.map((file: DraftFile) => (
                        <li key={file.id}>
                          <div>
                            <strong>{file.name}</strong>
                            <small>
                              {size(file.bytes)} ·{' '}
                              {file.uploaded
                                ? 'Saved'
                                : file.file
                                  ? 'Ready to send'
                                  : 'Choose this file again'}
                            </small>
                          </div>
                          {!draft.locked && (
                            <button
                              type="button"
                              aria-label={`Remove ${file.name}`}
                              disabled={!!busy}
                              onClick={() =>
                                remember({
                                  ...draft,
                                  files: draft.files.filter(
                                    (f) => f.id !== file.id,
                                  ),
                                })
                              }
                            >
                              <XIcon size={19} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="kin-submission-note">
                    {storageError
                      ? 'This browser could not keep a draft. Please keep this page open until sending finishes.'
                      : 'Your message is kept in this tab. If you reload, choose any unsent files again.'}
                  </p>
                  <button
                    className="kin-button"
                    disabled={
                      !!busy ||
                      !list ||
                      (!draft.text.trim() && !draft.link && !draft.files.length)
                    }
                    type="submit"
                  >
                    <PaperPlaneTiltIcon size={18} />
                    {draft.locked ? 'Finish sending' : `Send to ${me}`}
                  </button>
                  {(draft.title || draft.text || draft.files.length > 0) && (
                    <button
                      type="button"
                      className="kin-text-link kin-keep-draft"
                      disabled={!!busy || !list}
                      onClick={() => {
                        remember(newDraft());
                        setError('');
                        setFocusTarget('form');
                      }}
                    >
                      Keep this draft and start another{' '}
                      <ArrowRightIcon size={17} />
                    </button>
                  )}
                </form>
                <aside className="kin-share-aside">
                  <EnvelopeSimpleIcon size={28} />
                  {correction ? (
                    <>
                      <h2>Small fixes matter</h2>
                      <p>
                        One wrong date can mislead everyone who reads the book
                        later. Your correction helps the whole family.
                      </p>
                      <p>
                        {`If you have a certificate, letter or family Bible page, add a photo of it. It helps ${me} make the change quickly.`}
                      </p>
                    </>
                  ) : (
                    <>
                      <h2>A place for what you know</h2>
                      <p>
                        You don’t need a complete story. Small details often
                        help us connect the rest.
                      </p>
                      <p>
                        For photographs, include names, the place and an
                        approximate date if you know them. A picture of the
                        writing on the back can be just as useful.
                      </p>
                    </>
                  )}
                  <p>
                    {`Your submission goes privately to ${me}. ${maintainerPronoun}’ll check it, then add it to the website or book.`}
                  </p>
                  <p className="kin-submission-note">
                    Your files are kept exactly as you send them.
                  </p>
                </aside>
              </div>
            ))}
          {mode !== 'write' &&
            (selected ? (
              <>
                <button
                  className="kin-text-link"
                  onClick={() => void openList(mode)}
                  disabled={!!busy}
                >
                  <ArrowLeftIcon size={17} /> Back to submissions
                </button>
                {details(selected)}
              </>
            ) : (
              <div className="kin-submission-list">
                {mode === 'mine' &&
                  list &&
                  readDrafts(list.viewer.userId).length > 0 && (
                    <section className="kin-local-drafts">
                      <h2>Drafts in this tab</h2>
                      <p className="kin-submission-note">
                        Your message is kept here while you work. After a
                        reload, choose any unsent files again.
                      </p>
                      {readDrafts(list.viewer.userId).map((saved) => (
                        <button
                          className="kin-text-link"
                          key={saved.id}
                          disabled={!!busy}
                          onClick={() => {
                            remember({
                              ...saved,
                              files: saved.files.map((file) => ({
                                ...file,
                                file:
                                  draft.id === saved.id
                                    ? draft.files.find((f) => f.id === file.id)
                                        ?.file
                                    : undefined,
                              })),
                            });
                            setSelected(null);
                            setReceipt(null);
                            setMode('write');
                            setError('');
                            setFocusTarget('form');
                          }}
                        >
                          {saved.title || 'Untitled memory'}{' '}
                          <ArrowRightIcon size={17} />
                        </button>
                      ))}
                    </section>
                  )}
                <h2>
                  {mode === 'review' ? 'From the family' : 'What you’ve shared'}
                </h2>
                {list && !list.items.length && (
                  <p>
                    {mode === 'review'
                      ? 'No contributions have arrived yet.'
                      : 'Things you send will appear here.'}
                  </p>
                )}
                {list?.items.map((item) => (
                  <button
                    key={item.id}
                    disabled={!!busy}
                    onClick={() => void openSubmission(item)}
                  >
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {kindLabel(item)}
                        {date(item.createdAt)}
                        {mode === 'review'
                          ? ' · ' + item.contributor.email
                          : ''}
                      </small>
                    </span>
                    <span>
                      {status[item.status]} <ArrowRightIcon size={17} />
                    </span>
                  </button>
                ))}
                {list?.next && (
                  <button
                    className="kin-button"
                    disabled={!!busy}
                    onClick={() => void openList(mode, true)}
                  >
                    Earlier submissions
                  </button>
                )}
              </div>
            ))}
        </>
      )}
    </section>
  );
}
