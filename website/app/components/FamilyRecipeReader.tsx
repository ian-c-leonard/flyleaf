import { useMemo, useState } from 'react';
import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  XIcon,
} from '@phosphor-icons/react';
import recipeIndex from '@content/recipe-index.json';
import type {
  AvailableRecipeVolume,
  RecipeIndex,
  RecipeLabels,
} from '../lib/family-recipes';
import { recipeCategoryAtPage, searchRecipes } from '../lib/family-recipes';
import { localFileUrl } from '../lib/archive';
import Modal from './Modal';
import PdfDocument from './PdfDocument';
import '../family-recipes.css';
import { sitePath } from '../lib/paths';

export default function FamilyRecipeReader({
  volumes,
  initialVolume,
  letterImage,
  labels,
  trigger,
  onClose,
  onSource,
}: {
  volumes: AvailableRecipeVolume[];
  initialVolume: string;
  letterImage: string;
  labels: RecipeLabels;
  trigger: HTMLElement;
  onClose: () => void;
  onSource: (path: string) => void;
}) {
  const [selected, setSelected] = useState(initialVolume);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const found = useMemo(
    () => searchRecipes(recipeIndex as RecipeIndex, volumes, query),
    [volumes, query],
  );
  const volume = volumes.find((item) => item.id === selected) || volumes[0];
  if (!volume) return null;
  const page = pages[volume.id] || 1;
  const category = recipeCategoryAtPage(volume, page);
  const changePage = (value: number) =>
    setPages((current) => ({ ...current, [volume.id]: value }));
  const openRecipe = (id: string, value: number) => {
    setSelected(id);
    setPages((current) => ({ ...current, [id]: value }));
    setQuery('');
  };
  const searching = query.trim().length > 0;
  const openSource = (path: string) => {
    onClose();
    onSource(path);
  };
  const url = localFileUrl(sitePath('data/'), volume.file.path);
  const title = volume.file.title || volume.shortTitle;
  return (
    <Modal
      label={labels.title}
      className="family-recipe-dialog"
      insideSelector=".family-recipe-reader"
      onClose={onClose}
      returnFocus={() => trigger}
    >
      <section
        className={`family-recipe-reader${volume.kind === 'letter' ? ' is-letter' : ''}`}
        aria-labelledby="family-recipe-title"
      >
        <header className="family-recipe-header">
          <div>
            <h2 id="family-recipe-title">{title}</h2>
            <p>{volume.file.locator}</p>
          </div>
          <button aria-label="Close recipes" data-dismiss-modal>
            <XIcon size={22} />
          </button>
        </header>
        <fieldset className="family-recipe-volumes">
          <legend className="family-recipe-sr-only">Choose a volume</legend>
          {volumes.map((item) => (
            <button
              key={item.id}
              aria-pressed={item.id === volume.id}
              onClick={() => setSelected(item.id)}
            >
              {item.shortTitle}
            </button>
          ))}
        </fieldset>
        <div className="family-recipe-tools">
          <p>{labels.compiledBy}</p>
          <div>
            <a href={url} download>
              <DownloadSimpleIcon size={17} /> Download original PDF
            </a>
            <button onClick={() => openSource(volume.file.path)}>
              <ArrowSquareOutIcon size={17} /> Source details
            </button>
            {volume.kind === 'letter' && letterImage && (
              <button onClick={() => openSource(letterImage)}>
                View letter image
              </button>
            )}
          </div>
        </div>
        <label className="family-recipe-search">
          <MagnifyingGlassIcon size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.searchPlaceholder}
            aria-label={labels.searchLabel}
            enterKeyHint="search"
          />
        </label>
        {searching && (
          <div className="family-recipe-results" aria-live="polite">
            <p>
              {found.length === 0
                ? 'No recipe by that name. Try one word, like “cake”.'
                : found.length === 1
                  ? '1 recipe'
                  : found.length > 80
                    ? `First 80 of ${found.length} recipes. Add a word to narrow it.`
                    : `${found.length} recipes`}
            </p>
            <ul>
              {found.slice(0, 80).map((recipe) => (
                <li key={`${recipe.volume}-${recipe.page}-${recipe.name}`}>
                  <button
                    onClick={() => openRecipe(recipe.volume, recipe.page)}
                  >
                    <span>{recipe.name}</span>
                    <span>
                      {[
                        volumes.find((item) => item.id === recipe.volume)
                          ?.shortTitle,
                        recipe.category,
                        `page ${recipe.page}`,
                        recipe.credit,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!searching && volume.categories.length > 0 && (
          <label className="family-recipe-category-select">
            <span>Category</span>
            <select
              aria-label="Recipe category"
              value={category?.page || ''}
              onChange={(event) => changePage(Number(event.target.value) || 1)}
            >
              <option value="">Original contents · page 1</option>
              {volume.categories.map((entry) => (
                <option key={entry.label} value={entry.page}>
                  {entry.label} · page {entry.page}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="family-recipe-body" hidden={searching}>
          {volume.categories.length > 0 && (
            <nav
              className="family-recipe-categories"
              aria-label="Recipe categories"
            >
              <h3>Categories</h3>
              <p>
                Each opens its first page. Some begin partway down the page.
              </p>
              <button
                className="family-recipe-contents-link"
                aria-current={!category ? 'page' : undefined}
                onClick={() => changePage(1)}
              >
                <span>Original contents</span>
                <span>1</span>
              </button>
              {volume.categories.map((entry) => (
                <button
                  key={entry.label}
                  aria-current={category === entry ? 'page' : undefined}
                  onClick={() => changePage(entry.page)}
                >
                  <span>{entry.label}</span>
                  <span>{entry.page}</span>
                </button>
              ))}
            </nav>
          )}
          <div className="family-recipe-document">
            <output className="family-recipe-page-context" aria-live="polite">
              {category
                ? category.label
                : volume.kind === 'letter'
                  ? labels.letterContext
                  : 'Original table of contents'}
              {' · '}
              {volume.shortTitle}
            </output>
            <PdfDocument
              key={volume.file.path}
              title={title}
              url={url}
              pageNumber={page}
              onPageChange={changePage}
            />
          </div>
        </div>
      </section>
    </Modal>
  );
}
