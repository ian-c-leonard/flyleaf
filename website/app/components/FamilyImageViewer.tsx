import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadSimpleIcon,
  ImageIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { Asset, AtlasData, Source } from '../lib/gedcom';
import { imageSequence, photoFiles } from '../lib/photo-files';
import { visualFor } from '../lib/visuals';
import Modal from './Modal';
import VisualContext from './VisualContext';
import '../image-viewer.css';

type Swipe = { id: number; x: number; y: number; at: number };

function ViewerImage({
  asset,
  url,
  title,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  asset: Asset;
  url: string;
  title: string;
  onPointerDown: (event: PointerEvent<HTMLImageElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLImageElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLImageElement>) => void;
  onPointerCancel: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <output className="kin-image-unavailable">
      This image could not be displayed. You can download its file below.
    </output>
  ) : (
    <img
      src={url}
      alt={title}
      data-image-file={asset.path}
      draggable={false}
      onError={() => setFailed(true)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}

/** Gallery order and file provenance are independent: next/previous follows
 * the supplied visible collection; complete/original follows declared versions. */
export default function FamilyImageViewer({
  data,
  image,
  orderedAssetIds,
  resolveFile,
  onSelect,
  onPerson,
  onSource,
  onClose,
  returnFocus,
  fallbackFocus,
}: {
  data: AtlasData;
  image: Asset;
  orderedAssetIds: readonly string[];
  resolveFile: (path: string) => string;
  onSelect: (id: string) => void;
  onPerson: (id: string) => void;
  onSource: (source: Source, path: string) => void;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
  fallbackFocus: () => HTMLElement | null;
}) {
  const title = visualFor(data, image.path)?.title || image.title;
  const files = photoFiles(data, image);
  const sequence = imageSequence(data, image.id, orderedAssetIds);
  const position = sequence.indexOf(image.id);
  const previous = sequence[position - 1];
  const next = sequence[position + 1];
  const swipe = useRef<Swipe | null>(null);
  const view = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<{
    from: string;
    to: string;
    portrait: boolean;
  } | null>(null);
  useEffect(() => {
    if (expanded && image.id !== expanded.to) setExpanded(null);
  }, [image.id, expanded]);
  useLayoutEffect(() => {
    const dialog = view.current?.closest('dialog');
    dialog?.scrollTo({ top: 0, behavior: 'instant' });
    // Replacing a complete-frame button or caption link must not leave keyboard
    // focus on the obscured page. The Modal retains the original gallery opener.
    if (dialog && !dialog.contains(document.activeElement)) {
      dialog
        .querySelector<HTMLButtonElement>('.kin-image-close')
        ?.focus({ preventScroll: true });
    }
  }, [image.id]);
  const select = (id: string | undefined) => {
    if (!id) return;
    setExpanded(null);
    onSelect(id);
  };
  const down = (event: PointerEvent<HTMLImageElement>) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) {
      swipe.current = null;
      return;
    }
    // Keep edge gestures available to the browser. Only a single-finger swipe
    // on the photograph changes images; caption scrolling and pinch stay native.
    if (event.clientX < 16 || event.clientX > innerWidth - 16) return;
    swipe.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
    };
  };
  const move = (event: PointerEvent<HTMLImageElement>) => {
    const gesture = swipe.current;
    if (!gesture || event.pointerId !== gesture.id) return;
    const x = Math.abs(event.clientX - gesture.x);
    const y = Math.abs(event.clientY - gesture.y);
    if (y > 12 && y > x) swipe.current = null;
  };
  const up = (event: PointerEvent<HTMLImageElement>) => {
    const gesture = swipe.current;
    swipe.current = null;
    if (!gesture || event.pointerId !== gesture.id) return;
    const x = event.clientX - gesture.x;
    const y = Math.abs(event.clientY - gesture.y);
    if (
      Math.abs(x) < 48 ||
      Math.abs(x) < y * 2 ||
      event.timeStamp - gesture.at > 1500
    )
      return;
    const destination = x < 0 ? next : previous;
    if (destination) {
      event.preventDefault();
      select(destination);
    }
  };
  return (
    <Modal
      label={title}
      returnFocus={returnFocus}
      fallbackFocus={fallbackFocus}
      insideSelector=".kin-image-view > img, .kin-image-caption, .kin-image-close, .kin-image-viewer-toolbar, .kin-image-unavailable"
      onClose={onClose}
      className="kin-image-modal"
      onKeyDown={(event) => {
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          !(event.target instanceof Element) ||
          event.target.closest(
            'input, select, textarea, [contenteditable="true"]',
          )
        )
          return;
        const destination =
          event.key === 'ArrowLeft'
            ? previous
            : event.key === 'ArrowRight'
              ? next
              : undefined;
        if (destination) {
          event.preventDefault();
          select(destination);
        }
      }}
    >
      <section
        className={`kin-image-view${sequence.length > 1 ? '' : ' kin-image-single'}`}
        ref={view}
      >
        {sequence.length > 1 && (
          <nav
            className="kin-image-viewer-toolbar"
            aria-label="Image navigation"
          >
            <button
              onClick={() => select(previous)}
              disabled={!previous}
              aria-label="Previous image"
            >
              <ArrowLeftIcon size={19} /> Previous
            </button>
            <span aria-live="polite">
              {position + 1} of {sequence.length}
            </span>
            <button
              onClick={() => select(next)}
              disabled={!next}
              aria-label="Next image"
            >
              Next <ArrowRightIcon size={19} />
            </button>
          </nav>
        )}
        <button
          className="kin-image-close"
          aria-label="Close image"
          data-dismiss-modal
          onClick={onClose}
        >
          <XIcon />
        </button>
        <ViewerImage
          key={image.id}
          asset={image}
          title={title}
          url={resolveFile(image.path)}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => {
            swipe.current = null;
          }}
        />
        <div className="kin-image-caption">
          <h2>{title}</h2>
          {image.credit && <p>{image.credit}</p>}
          <div className="kin-image-file-actions">
            {files.original && (
              <a
                className="kin-text-link"
                href={resolveFile(files.original.path)}
                download
              >
                <DownloadSimpleIcon size={17} /> Download original file
              </a>
            )}
            {files.original?.path !== image.path && (
              <a
                className="kin-text-link"
                href={resolveFile(image.path)}
                download
              >
                <DownloadSimpleIcon size={17} /> {files.displayedLabel}
              </a>
            )}
            {files.complete && (
              <button
                className="kin-text-link"
                onClick={() => {
                  setExpanded({
                    from: image.id,
                    to: files.complete!.id,
                    portrait: visualFor(data, image.path)?.role === 'portrait',
                  });
                  onSelect(files.complete!.id);
                }}
              >
                <ImageIcon size={17} /> See the whole photograph
              </button>
            )}
            {expanded && (
              <button
                className="kin-text-link"
                onClick={() => select(expanded.from)}
              >
                <ArrowLeftIcon size={17} /> Back to the close-up
              </button>
            )}
          </div>
          <VisualContext
            key={image.id}
            data={data}
            asset={image}
            onPerson={onPerson}
            onSource={onSource}
          />
        </div>
      </section>
    </Modal>
  );
}
