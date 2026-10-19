import type { ReactNode } from 'react';
import type { CitationPresentation } from '../lib/citation-presentation';
import '../source-citation.css';

/** Foreground wording is explicit author work; complete canonical detail survives. */
export default function SourceCitationPresentation({
  presentations,
  children,
}: {
  presentations: CitationPresentation[];
  children: ReactNode;
}) {
  if (!presentations.length) return <>{children}</>;
  return (
    <div className="source-citation-presentation">
      {presentations.map((entry) => (
        <section
          className="source-citation-entry"
          key={entry.person + ':' + entry.key}
        >
          <p className="source-citation-title">{entry.title}</p>
          <p>{entry.context}</p>
          {entry.qualifications.map((qualification) => (
            <p className="source-citation-qualification" key={qualification}>
              {qualification}
            </p>
          ))}
        </section>
      ))}
      <details className="source-research-detail">
        <summary>Full reference</summary>
        {children}
      </details>
    </div>
  );
}
