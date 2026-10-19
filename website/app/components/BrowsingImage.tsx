import type { ComponentProps } from 'react';

/** A missing derivative must not hide an available original. `onError`
 * hears only when the original fails too. */
export default function BrowsingImage({
  original,
  alt = '',
  onError,
  ...props
}: ComponentProps<'img'> & { original: string }) {
  return (
    <img
      {...props}
      alt={alt}
      onError={(event) => {
        if (original && event.currentTarget.getAttribute('src') !== original)
          event.currentTarget.src = original;
        else onError?.(event);
      }}
    />
  );
}
