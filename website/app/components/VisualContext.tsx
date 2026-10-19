import { ArrowRightIcon } from '@phosphor-icons/react';
import type { Asset, AtlasData, Source } from '../lib/gedcom';
import {
  visualAncestorPaths,
  visualCaptions,
  visualFor,
  visualLabel,
  visualSources,
} from '../lib/visuals';

export default function VisualContext({
  data,
  asset,
  onPerson,
  onSource,
}: {
  data: AtlasData;
  asset: Asset;
  onPerson: (id: string) => void;
  onSource: (source: Source, path: string) => void;
}) {
  const visual = visualFor(data, asset.path);
  const captions = visualCaptions(data, asset.path);
  const sources = visualSources(data, asset.path);
  const ancestors = visualAncestorPaths(data, asset.path);
  const relations: [string, string[]][] = visual
    ? [
        ['Pictured', visual.subjectIds],
        ['Related people', visual.associatedIds],
        ['Named in the caption', visual.captionPeople],
        ['Remembered', visual.commemoratedIds],
      ]
    : [
        [
          'Related people',
          data.people
            .filter((p) => p.assetIds.includes(asset.id))
            .map((p) => p.id),
        ],
      ];
  return (
    <div className="kin-visual-context">
      {visual && (
        <p className="kin-visual-label">
          {visualLabel(visual)}
          {visual.album === 'alternate' && ' · Another version'}
        </p>
      )}
      {visual?.publicNote && <p>{visual.publicNote}</p>}
      {relations.map(([label, ids]) => {
        const people = data.people.filter((p) => ids.includes(p.id));
        return (
          people.length > 0 && (
            <div className="kin-photo-connections" key={label}>
              <span>{label}</span>
              {people.map((p) => (
                <button key={p.id} onClick={() => onPerson(p.id)}>
                  {p.name}
                  <ArrowRightIcon size={16} />
                </button>
              ))}
            </div>
          )
        );
      })}
      {!!visual?.otherSubjects.length && (
        <p>Also in the photo: {visual.otherSubjects.join('; ')}</p>
      )}
      {!!captions.length && (
        <details className="kin-image-details">
          <summary>Original captions and credits</summary>
          {captions.map((caption) => (
            <div key={caption.id}>
              <p>{caption.title}</p>
              {caption.credit && <p>{caption.credit}</p>}
              {caption.rights && <p>{caption.rights}</p>}
            </div>
          ))}
        </details>
      )}
      {!!sources.length && (
        <details className="kin-image-details">
          <summary>Records</summary>
          {sources.map((source) => (
            <div key={source.id}>
              <button
                className="kin-text-link"
                onClick={() => onSource(source, asset.path)}
              >
                {source.label}
                <ArrowRightIcon size={17} />
              </button>
              {source.archives
                .filter((f) => ancestors.has(f.path))
                .map((file) => (
                  <div key={file.path}>
                    {file.title && <p>{file.title}</p>}
                    {file.locator && <p>{file.locator}</p>}
                  </div>
                ))}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
