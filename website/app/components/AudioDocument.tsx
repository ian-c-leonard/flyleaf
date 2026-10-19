import { useEffect, useRef } from 'react';
import { claimAudioPlayback } from '../lib/audio-playback';

/** Unmounting a DOM node alone must not leave a detached recording playing. */
export default function AudioDocument({
  url,
  title,
  onError,
}: {
  url: string;
  title: string;
  onError: () => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const player = ref.current!;
    player.src = url;
    return () => {
      player.pause();
      player.removeAttribute('src');
      player.load();
    };
  }, [url]);
  return (
    <div className="document-audio">
      <h3>{title}</h3>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- Original musical recordings have no supplied caption or transcript track. */}
      <audio
        ref={ref}
        src={url}
        controls
        preload="none"
        aria-label={title}
        onPlay={(event) => claimAudioPlayback(event.currentTarget)}
        onError={onError}
      />
    </div>
  );
}
