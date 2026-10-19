import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type React from 'react';
import type { ReactNode } from 'react';
import { ArrowRightIcon } from '@phosphor-icons/react';
import BrowsingImage from './BrowsingImage';
import { carouselSlots, fitPhoto, tallestPhoto } from '../lib/carousel-layout';
import { useMediaQuery } from '../lib/useDismissible';
import type { useCarousel } from '../lib/useCarousel';

/** One picture in a home carousel. `shape` (width over height) comes from
 * the site's previews; without it the picture is measured once it loads. */
export type CarouselPhoto = {
  key: string;
  src: string;
  original: string;
  shape?: number;
  title: string;
  open: () => void;
};

type Bind = ReturnType<typeof useCarousel>['bind'];
// Matches the slides' fade in family.css.
const FADE = 700;

/** The width of a carousel's track and the sizes its stylesheet sets for
 * this screen (`--kin-<name>`), measured again when the window changes. */
function useTrack<Name extends string>(names: readonly Name[]) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Record<Name | 'width', number> | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const next = { width: element.clientWidth } as Record<
        Name | 'width',
        number
      >;
      for (const name of names)
        next[name] = parseFloat(style.getPropertyValue(`--kin-${name}`)) || 0;
      setSize((previous) =>
        previous &&
        (Object.keys(next) as (Name | 'width')[]).every(
          (key) => previous[key] === next[key],
        )
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, names]);
  return [setElement, size] as const;
}

/** Shapes of pictures the previews do not describe, learnt as they load. */
function useLearntShapes() {
  const [shapes, setShapes] = useState<ReadonlyMap<string, number>>(new Map());
  const learn = useCallback((key: string, image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const shape = image.naturalWidth / image.naturalHeight;
    setShapes((previous) =>
      previous.get(key) === shape
        ? previous
        : new Map(previous).set(key, shape),
    );
  }, []);
  const shapeOf = (photo: CarouselPhoto) =>
    photo.shape ?? shapes.get(photo.key);
  return [shapeOf, learn] as const;
}

/** A crossfade between slides. The new slide fades in only once its picture
 * has loaded, while the one before fades out, so the frame is never empty.
 * Returns the slides to draw, oldest first, and the one in front. */
function useCrossfade(key: string) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState(key);
  const [last, setLast] = useState(key);
  if (key !== last) {
    // A slide that had begun to fade in stays as the one to fade from.
    setLast(key);
    if (ready.has(last)) setShown(last);
  }
  const front = ready.has(key) ? key : ready.has(shown) ? shown : null;
  useEffect(() => {
    if (front === null || front === shown) return;
    const timer = window.setTimeout(() => setShown(front), reduced ? 0 : FADE);
    return () => window.clearTimeout(timer);
  }, [front, shown, reduced]);
  const loaded = useCallback(
    (loadedKey: string) =>
      setReady((previous) =>
        previous.has(loadedKey) ? previous : new Set(previous).add(loadedKey),
      ),
    [],
  );
  const layers = shown !== key && ready.has(shown) ? [shown, key] : [key];
  return { layers, front, loaded };
}

const featuredSizes = ['photo-max', 'mat'] as const;

/** Home's featured photograph. Each picture sits in a mat of its own shape,
 * on a board that keeps the height the tallest picture needs. */
export function FeaturedPhoto({
  slides,
  index,
  controls,
}: {
  slides: (CarouselPhoto & {
    label: string;
    eyebrow: string;
    view: () => void;
  })[];
  index: number;
  controls: ReactNode;
}) {
  const [track, size] = useTrack(featuredSizes);
  const [shapeOf, learn] = useLearntShapes();
  const current = slides[index]?.key ?? '';
  const { layers, front, loaded } = useCrossfade(current);
  // Fetch the next photograph early, so its fade can start on time.
  const next = slides.length > 1 ? slides[(index + 1) % slides.length].src : '';
  useEffect(() => {
    if (next) new Image().src = next;
  }, [next]);
  const shown = slides.find((slide) => slide.key === (front ?? current));
  const box = size && {
    width: size.width - 2 * size.mat,
    height: size['photo-max'],
  };
  return (
    <>
      <div className="kin-carousel-stage">
        <div
          className="kin-carousel-track"
          ref={track}
          style={
            size && box
              ? {
                  height:
                    tallestPhoto(
                      slides.map((slide) => slide.shape),
                      box.width,
                      box.height,
                    ) +
                    2 * size.mat,
                }
              : undefined
          }
        >
          {box &&
            layers.map((key) => {
              const slide = slides.find((s) => s.key === key);
              if (!slide) return null;
              const fit = fitPhoto(shapeOf(slide), box.width, box.height);
              return (
                <button
                  key={key}
                  className="kin-carousel-slide"
                  data-front={key === front}
                  inert={key !== front}
                  onClick={slide.open}
                  aria-label={slide.label}
                >
                  <BrowsingImage
                    original={slide.original}
                    src={slide.src}
                    alt={slide.title}
                    style={fit}
                    onLoad={(event) => {
                      if (!slide.shape) learn(key, event.currentTarget);
                      loaded(key);
                    }}
                    onError={() => loaded(key)}
                  />
                </button>
              );
            })}
        </div>
      </div>
      {shown && (
        <div className="kin-featured-caption">
          <span className="kin-featured-titles">
            {slides.map((slide) => (
              <span
                key={slide.key}
                aria-hidden={slide.key === shown?.key ? undefined : true}
              >
                <small>{slide.eyebrow}</small>
                <strong>{slide.label}</strong>
              </span>
            ))}
          </span>
          <button aria-label="View featured photograph" onClick={shown.view}>
            <ArrowRightIcon size={22} />
          </button>
        </div>
      )}
      {controls}
    </>
  );
}

const stackSizes = [
  'photo-max',
  'print-width',
  'overlap',
  'mat',
  'room',
] as const;

/** The album's fan of three prints, each the shape of its photograph. The
 * fan moves along by one: the first print slides away and the next one
 * slides in, so nothing jumps. */
export function PhotoStack({
  photos,
  index,
  bind,
}: {
  photos: CarouselPhoto[];
  index: number;
  bind: Bind;
}) {
  const [track, size] = useTrack(stackSizes);
  const [shapeOf, learn] = useLearntShapes();
  const print =
    size && Math.min(size['print-width'], (size.width + 2 * size.overlap) / 3);
  const box = size &&
    print && { width: print - 2 * size.mat, height: size['photo-max'] };
  return (
    <div
      className="kin-album-stack"
      ref={track}
      style={
        size && print && box
          ? ({
              height:
                tallestPhoto(
                  photos.map((photo) => photo.shape),
                  box.width,
                  box.height,
                ) +
                2 * (size.mat + size.room),
              '--kin-step': `${print - size.overlap}px`,
              '--kin-shift': (3 - Math.min(3, photos.length)) / 2,
            } as React.CSSProperties)
          : undefined
      }
      {...bind}
    >
      {box &&
        carouselSlots(photos.length, index, 3).map(({ item, slot }) => {
          const photo = photos[item];
          return (
            <button
              key={photo.key}
              data-slot={slot}
              inert={slot < 0 || slot > 2}
              onClick={photo.open}
              aria-label={photo.title}
            >
              <BrowsingImage
                original={photo.original}
                src={photo.src}
                alt={photo.title}
                loading="lazy"
                style={fitPhoto(shapeOf(photo), box.width, box.height)}
                onLoad={(event) => {
                  if (!photo.shape) learn(photo.key, event.currentTarget);
                }}
              />
            </button>
          );
        })}
    </div>
  );
}

const shelfSizes = ['photo-max', 'columns', 'gap', 'mat'] as const;

/** Home's family records: four documents, each in a mat of its own shape,
 * standing on one line above their titles. Like the album, the row moves
 * along by one. Its height is the tallest document and the longest title. */
export function RecordShelf({
  records,
  index,
  bind,
}: {
  records: CarouselPhoto[];
  index: number;
  bind: Bind;
}) {
  const [track, size] = useTrack(shelfSizes);
  const [shapeOf, learn] = useLearntShapes();
  const [measurer, setMeasurer] = useState<HTMLDivElement | null>(null);
  const [caption, setCaption] = useState(0);
  useLayoutEffect(() => {
    if (!measurer) return;
    const measure = () => setCaption(measurer.offsetHeight);
    measure();
    // Titles wrap differently as the width changes and the fonts arrive.
    const observer = new ResizeObserver(measure);
    observer.observe(measurer);
    return () => observer.disconnect();
  }, [measurer]);
  const visible = 4;
  const columns = size ? Math.max(1, Math.round(size.columns)) : 1;
  const rows = Math.ceil(Math.min(records.length, visible) / columns);
  const width = size ? (size.width - size.gap * (columns - 1)) / columns : 0;
  const box = size && {
    width: width - 2 * size.mat,
    height: size['photo-max'],
  };
  const area =
    size && box
      ? tallestPhoto(
          records.map((record) => record.shape),
          box.width,
          box.height,
        ) +
        2 * size.mat
      : 0;
  const tile = area + caption;
  // The mat is the image's own border.
  const matted = (shape: number | undefined) => {
    const fit = fitPhoto(shape, box?.width ?? 0, box?.height ?? 0);
    const mat = 2 * (size?.mat ?? 0);
    return { width: fit.width + mat, height: fit.height + mat };
  };
  const gap = size?.gap ?? 0;
  // The record that has gone and the one to come wait half a place away.
  const place = (slot: number) => {
    const [column, row] =
      slot < 0
        ? [-0.5, 0]
        : slot >= visible
          ? [columns - 0.5, rows - 1]
          : [slot % columns, Math.floor(slot / columns)];
    return `translate(${column * (width + gap)}px, ${row * (tile + gap)}px)`;
  };
  return (
    <div
      className="kin-records-grid"
      ref={track}
      style={size ? { height: rows * tile + (rows - 1) * gap } : undefined}
      {...bind}
    >
      {box && (
        <div
          className="kin-records-measure"
          ref={setMeasurer}
          style={{ width }}
          aria-hidden="true"
        >
          {records.map((record) => (
            <span key={record.key}>{record.title}</span>
          ))}
        </div>
      )}
      {box &&
        carouselSlots(records.length, index, visible).map(({ item, slot }) => {
          const record = records[item];
          return (
            <button
              key={record.key}
              data-slot={slot}
              inert={slot < 0 || slot >= visible}
              onClick={record.open}
              style={{ width, height: tile, transform: place(slot) }}
            >
              <span className="kin-records-print" style={{ height: area }}>
                <BrowsingImage
                  original={record.original}
                  src={record.src}
                  alt=""
                  loading="lazy"
                  style={matted(shapeOf(record))}
                  onLoad={(event) => {
                    if (!record.shape) learn(record.key, event.currentTarget);
                  }}
                />
              </span>
              <span className="kin-records-title">{record.title}</span>
            </button>
          );
        })}
    </div>
  );
}
