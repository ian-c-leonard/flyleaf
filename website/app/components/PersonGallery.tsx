import type { ReactNode } from 'react';
import type { AtlasData } from '../lib/gedcom';
import { personGallery, type PersonGalleryEntry } from '../lib/visuals';
import '../person-gallery.css';

/** The caller supplies the shared image viewer/original-source controls.
 * This component never substitutes a captioned or related face for a portrait. */
export default function PersonGallery({
  data,
  personId,
  renderPicture,
}: {
  data: AtlasData;
  personId: string;
  renderPicture: (
    entry: PersonGalleryEntry,
    orderedAssetIds: readonly string[],
  ) => ReactNode;
}) {
  const { depicted, captioned, related, all } = personGallery(data, personId);
  if (!all.length) return null;
  const orderedAssetIds = all.map((entry) => entry.asset.id);
  const pictures = (entries: PersonGalleryEntry[]) => (
    <div className="kin-photo-grid">
      {entries.map((entry) => renderPicture(entry, orderedAssetIds))}
    </div>
  );
  const collection = (entries: PersonGalleryEntry[]) => (
    <>
      {pictures(entries.slice(0, 6))}
      {entries.length > 6 && (
        <details className="kin-gallery-more">
          <summary>
            View {entries.length - 6} more{' '}
            {entries.length - 6 === 1 ? 'picture' : 'pictures'}
          </summary>
          {pictures(entries.slice(6))}
        </details>
      )}
    </>
  );
  return (
    <section className="kin-person-pictures kin-person-gallery">
      {(depicted.length > 0 || captioned.length > 0) && (
        <h3>Photographs and portraits</h3>
      )}
      {depicted.length > 0 && collection(depicted)}
      {captioned.length > 0 && (
        <section className="kin-gallery-captioned">
          <h4>Group photographs</h4>
          <p>Named in the caption. We may not know who is who.</p>
          {collection(captioned)}
        </section>
      )}
      {related.length > 0 && (
        <details className="kin-gallery-context">
          <summary>More pictures ({related.length})</summary>
          <p>
            Places and things linked to this person. They may not be in the
            picture.
          </p>
          {pictures(related)}
        </details>
      )}
    </section>
  );
}
