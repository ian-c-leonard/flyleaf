import { useEffect, useState } from 'react';
import { ArrowClockwiseIcon, XIcon } from '@phosphor-icons/react';
import Modal from './Modal';

type Card = {
  name: string;
  blank: number;
  person: string;
  email: string;
  state: 'signed-in' | 'email-chosen' | 'unused';
  signedInAt: number | null;
};

const order = { 'signed-in': 0, 'email-chosen': 1, unused: 2 } as const;
const words = {
  'signed-in': 'Signed in',
  'email-chosen': 'Has typed an email, not yet signed in',
  unused: 'Card not used yet',
} as const;

/** The maintainer's list for the day the cards are handed out: who has
 * signed in, who is part-way, and who has not started. It shows no code. */
export default function CardStatus({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setFailed(false);
    fetch('/api/cards', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ cards: Card[] }>) : null))
      .then((value) => {
        if (!current) return;
        if (value && Array.isArray(value.cards)) setCards(value.cards);
        else setFailed(true);
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [attempt]);
  const label = (card: Card) =>
    card.name || (card.blank ? `Blank card ${card.blank}` : 'A card');
  const sorted = [...(cards || [])].sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      (b.signedInAt || 0) - (a.signedInAt || 0) ||
      label(a).localeCompare(label(b), undefined, { numeric: true }),
  );
  const count = (state: Card['state']) =>
    sorted.filter((card) => card.state === state).length;
  return (
    <Modal label="Family cards" onClose={onClose} className="kin-modal">
      <section className="kin-cards">
        <div className="kin-modal-top">
          <span className="kin-eyebrow">For you only</span>
          <button aria-label="Close the card list" onClick={onClose}>
            <XIcon size={24} />
          </button>
        </div>
        <h2>Family cards</h2>
        {failed ? (
          <p role="alert">The card list could not be read. Try again.</p>
        ) : !cards ? (
          <p>Reading the cards…</p>
        ) : (
          <>
            <p>
              {count('signed-in')} signed in · {count('email-chosen')} part-way
              · {count('unused')} not used yet
            </p>
            <ul>
              {sorted.map((card, i) => (
                <li key={i} data-state={card.state}>
                  <strong>{label(card)}</strong>
                  <span>{words[card.state]}</span>
                  {card.email && <small>{card.email}</small>}
                  {card.blank > 0 && card.name && (
                    <small>Blank card {card.blank}</small>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <button
          className="kin-text-link"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Check again <ArrowClockwiseIcon size={18} />
        </button>
        <h3>If someone is stuck</h3>
        <ol>
          <li>
            <strong>The code is not accepted.</strong> Read it again with
            them. A code never has O, I, L, S, B or Z, and never 0, 1, 2, 5
            or 8. Capitals and the dash do not matter.
          </li>
          <li>
            <strong>No email arrives.</strong> Wait a minute, then look in
            spam or junk. “Send the code again” sends a new one. “Use a
            different email address” lets them try another.
          </li>
          <li>
            <strong>They signed out by mistake.</strong> They sign in with
            their email address, below the card box. The card is not needed
            again.
          </li>
          <li>
            <strong>A card is lost, or someone has none.</strong> Give them a
            blank card and write their name on it. Note the card’s number
            and name it afterwards.
          </li>
        </ol>
      </section>
    </Modal>
  );
}
