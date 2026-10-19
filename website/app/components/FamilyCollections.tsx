import { useState } from 'react';
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  FileTextIcon,
} from '@phosphor-icons/react';
import collections from '@content/family-collections.json';
import recipeContents from '@content/family-recipes.json';
import type { AtlasData, Source } from '../lib/gedcom';
import {
  familyRecipeBook,
  recipeVolumesForSource,
  type RecipeCatalog,
} from '../lib/family-recipes';
import FamilyRecipeReader from './FamilyRecipeReader';
import '../family-recipes.css';

const recipeCatalog = familyRecipeBook(recipeContents);

function RecipeCollection({
  catalog,
  source,
  onSource,
}: {
  catalog: RecipeCatalog;
  source: Source;
  onSource: (source: Source, path?: string) => void;
}) {
  const [reader, setReader] = useState<{
    volume: string;
    trigger: HTMLElement;
  } | null>(null);
  const volumes = recipeVolumesForSource(source, catalog);
  const letter = volumes.find((volume) => volume.kind === 'letter');
  const letterImage =
    catalog.letterImage &&
    source.archives.some((file) => file.path === catalog.letterImage)
      ? catalog.letterImage
      : '';
  return (
    <>
      <p className="family-recipe-credit">{catalog.labels.credit}</p>
      {letter && (
        <button
          className="family-recipe-letter"
          onClick={(event) =>
            setReader({ volume: letter.id, trigger: event.currentTarget })
          }
        >
          <FileTextIcon size={21} />
          <span>
            <strong>{catalog.labels.letter}</strong>
            <small>{catalog.labels.letterDetail}</small>
          </span>
          <ArrowRightIcon size={19} />
        </button>
      )}
      <div className="family-recipe-shelf">
        {volumes
          .filter((volume) => volume.kind === 'volume')
          .map((volume) => (
            <div className="family-recipe-volume-entry" key={volume.id}>
              <BookOpenTextIcon size={23} aria-hidden="true" />
              <h4>{volume.file.title || volume.shortTitle}</h4>
              <p>{volume.summary}</p>
              <button
                onClick={(event) =>
                  setReader({ volume: volume.id, trigger: event.currentTarget })
                }
              >
                Browse {volume.shortTitle}
                <ArrowRightIcon size={17} />
              </button>
              <small>
                {volume.pages} pages · {volume.categories.length} categories
              </small>
            </div>
          ))}
      </div>
      <button
        className="family-recipe-source-link"
        onClick={() => onSource(source)}
      >
        View the collection’s source details
      </button>
      {reader && (
        <FamilyRecipeReader
          initialVolume={reader.volume}
          volumes={volumes}
          letterImage={letterImage}
          labels={catalog.labels}
          trigger={reader.trigger}
          onClose={() => setReader(null)}
          onSource={(path) => onSource(source, path)}
        />
      )}
    </>
  );
}

/** Curated entry points into existing archive sources. File titles, ordering,
 * credits and originals stay on the canonical source, not in this component. */
export default function FamilyCollections({
  data,
  personId,
  onSource,
}: {
  data: AtlasData;
  personId: string;
  onSource: (source: Source, path?: string) => void;
}) {
  return collections
    .filter((collection) => collection.people.includes(personId))
    .map((collection) => {
      const source = data.sources.find(
        (candidate) => candidate.pointer === collection.source,
      );
      // A collection must not point into files outside the current edition.
      if (!source?.archives.length) return null;
      return (
        <section className="kin-family-collection" key={collection.id}>
          <h3>{collection.title}</h3>
          <p>{collection.description}</p>
          {recipeCatalog &&
          collection.source === recipeCatalog.source &&
          recipeVolumesForSource(source, recipeCatalog).length ? (
            <RecipeCollection
              catalog={recipeCatalog}
              source={source}
              onSource={onSource}
            />
          ) : (
            <div className="kin-collection-files">
              {source.archives.map((file) => (
                <button
                  key={file.path}
                  onClick={() => onSource(source, file.path)}
                >
                  <BookOpenTextIcon size={21} aria-hidden="true" />
                  <span>
                    <strong>{file.title || source.label}</strong>
                    <small>{file.nature}</small>
                  </span>
                  <ArrowRightIcon size={19} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </section>
      );
    });
}
