import { useLayoutEffect, useRef, useState } from 'react';
import {
  MinusIcon,
  PlusIcon,
} from '@phosphor-icons/react';

export default function ImageDocument({
  url,
  title,
  onError,
}: {
  url: string;
  title: string;
  onError: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [fit, setFit] = useState<'page' | 'width'>('page');
  const [manualScale, setManualScale] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => {
      // The phone Details view hides this viewport. Keep its last usable size
      // so returning to the image cannot briefly turn a zero-size measurement
      // into a one-pixel fit. ResizeObserver measures it again when visible.
      if (element.clientWidth > 0 && element.clientHeight > 0)
        setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const availableWidth = Math.max(1, size.width - 32);
  const availableHeight = Math.max(1, size.height - 32);
  const fitWidth = natural.width ? availableWidth / natural.width : 1;
  const fitPage = natural.height
    ? Math.min(fitWidth, availableHeight / natural.height, 1)
    : 1;
  const scale = manualScale ?? (fit === 'page' ? fitPage : fitWidth);
  const chooseFit = (next: 'page' | 'width') => {
    setFit(next);
    setManualScale(null);
    viewport.current?.scrollTo({ top: 0, left: 0 });
  };
  return (
    <div className="document-image-viewer">
      <div className="document-image-toolbar" aria-label="Image size">
        <button
          aria-pressed={manualScale === null && fit === 'page'}
          onClick={() => chooseFit('page')}
        >
          Fit image
        </button>
        <button
          aria-pressed={manualScale === null && fit === 'width'}
          onClick={() => chooseFit('width')}
        >
          Fit width
        </button>
        <span className="document-image-zoom">
          <button
            onClick={() =>
              setManualScale(Math.max(Math.min(fitPage, 0.01), scale / 1.25))
            }
            aria-label="Zoom document out"
          >
            <MinusIcon size={18} />
          </button>
          <output aria-label="Image zoom">
            {natural.width ? Math.round(scale * 100) + '%' : '…'}
          </output>
          <button
            onClick={() =>
              setManualScale(Math.min(Math.max(5, fitWidth), scale * 1.25))
            }
            aria-label="Zoom document in"
          >
            <PlusIcon size={18} />
          </button>
        </span>
      </div>
      <div className="document-image-scroll" ref={viewport}>
        <div
          className="document-image-canvas"
          style={
            natural.width
              ? {
                  width: Math.max(size.width, natural.width * scale + 32),
                  height: Math.max(size.height, natural.height * scale + 32),
                }
              : undefined
          }
        >
          <img
            src={url}
            alt={title}
            style={
              natural.width
                ? {
                    width: natural.width * scale,
                    height: natural.height * scale,
                  }
                : { visibility: 'hidden' }
            }
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={onError}
          />
        </div>
      </div>
    </div>
  );
}
