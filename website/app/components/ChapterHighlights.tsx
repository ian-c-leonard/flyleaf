import { ArrowRightIcon } from '@phosphor-icons/react';
import type { ReadingSection } from '../lib/native-book';
import BrowsingImage from './BrowsingImage';
import { sitePath } from '../lib/paths';

export default function ChapterHighlights({
  sections,
  onRead,
  imageUrl,
}: {
  sections: ReadingSection[];
  onRead: (anchor: string) => void;
  imageUrl: (path: string) => string;
}) {
  if (!sections.length) return null;
  return (
    <div className="kin-story-grid chapter-highlights">
      {sections.map((section) => (
        <button
          className="kin-story-card"
          key={section.anchor}
          onClick={() => onRead(section.anchor)}
        >
          {section.image && (
            <div className="kin-story-card-image">
              <BrowsingImage
                original={sitePath('data/') + section.image}
                src={imageUrl(section.image)}
                alt=""
                loading="lazy"
              />
            </div>
          )}
          <div className="kin-story-card-copy">
            <span className="kin-eyebrow">From the family book</span>
            <span className="kin-story-card-title">{section.title}</span>
            <p>{section.excerpt}</p>
            <span className="kin-card-cta">
              Read in the chapter <ArrowRightIcon size={18} />
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
