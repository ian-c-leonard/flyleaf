import type {
  ArchiveFile,
  Asset,
  AtlasData,
  Representation,
} from './gedcom.ts';
import { safeRelativePath } from './local-assets.ts';
import { visualFor } from './visuals.ts';

export interface PhotoFiles {
  displayedLabel: string;
  original?: ArchiveFile;
  complete?: Asset;
}

const raster = /\.(?:jpe?g|png|webp|gif)$/i;
const photographicFile = /\.(?:jpe?g|png|webp|gif|hei[cf])$/i;

function completeFrame(relation: Representation) {
  if (relation.role !== 'derived') return false;
  try {
    return JSON.parse(relation.recipe)?.completeFrame === true;
  } catch {
    return false;
  }
}

/** Resolve declared versions, never neighbouring filenames or shared subjects.
 * A crop can lead through a complete-frame display copy to its recorded source
 * photograph. Composites, ambiguous parents and cycles supply no such claim. */
export function photoFiles(data: AtlasData, asset: Asset): PhotoFiles {
  const relations = data.representations || [];
  const incoming = (path: string) => relations.filter((r) => r.child === path);
  const first = incoming(asset.path);
  const result: PhotoFiles = {
    displayedLabel: first.some((r) => r.role === 'crop')
      ? 'Download this close-up'
      : first.length
        ? 'Download this version'
        : 'Download image',
  };
  if (visualFor(data, asset.path)?.content !== 'photograph') return result;

  let path = asset.path;
  let cropped = false;
  let complete: Asset | undefined;
  const seen = new Set<string>();
  while (!seen.has(path) && safeRelativePath(path)) {
    seen.add(path);
    if (visualFor(data, path)?.content === 'artwork')
      return { displayedLabel: result.displayedLabel };
    const parents = incoming(path);
    if (parents.length > 1) return result;
    const relation = parents[0];
    if (relation && relation.role !== 'crop' && !completeFrame(relation))
      return result;

    // The first uncropped photographic ancestor is viewable only when its
    // exact file already has an approved visual asset. HEIC originals remain
    // downloads; their declared complete-frame raster copy stays the viewer.
    if (cropped && (!relation || completeFrame(relation))) {
      const visual = visualFor(data, path);
      const candidate =
        visual && data.assets.find((a) => a.id === visual.assetId);
      if (visual?.content === 'photograph' && candidate && raster.test(path))
        complete ||= candidate;
    }
    if (!relation) {
      const files = data.sources.flatMap((source) =>
        source.archives.filter((file) => file.path === path),
      );
      if (
        photographicFile.test(path) &&
        files.length > 0 &&
        files.every((file) => file.kind === 'photograph')
      )
        result.original = files[0];
      if (result.original) result.complete = complete;
      return result;
    }
    cropped ||= relation.role === 'crop';
    path = relation.parent;
  }
  // Do not keep a partial result from an unresolved cyclic chain.
  return { displayedLabel: result.displayedLabel };
}

/** A viewer scope is supplied by the actual gallery, not source-file adjacency.
 * Preserve its order; never put a download-only original in the carousel. */
export function imageSequence(
  data: AtlasData,
  imageId: string,
  supplied: readonly string[],
) {
  const current = data.assets.find((asset) => asset.id === imageId);
  if (!current || !raster.test(current.path) || !safeRelativePath(current.path))
    return [];
  const ids = [...new Set(supplied)].filter((id) => {
    const asset = data.assets.find((entry) => entry.id === id);
    return asset && raster.test(asset.path) && safeRelativePath(asset.path);
  });
  return ids.includes(imageId) ? ids : [imageId];
}
