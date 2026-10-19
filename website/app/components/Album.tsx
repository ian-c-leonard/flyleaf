import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  DownloadSimpleIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from '@phosphor-icons/react';
import type { Source } from '../lib/gedcom';
import { audioDuration, type Album as AlbumData } from '../lib/albums';
import BrowsingImage from './BrowsingImage';
import { claimAudioPlayback } from '../lib/audio-playback';
import '../album.css';

/** A file's format as readers know it: "MP3", "WAV", "PDF". */
const format = (path: string) =>
  (path.split('.').pop() || '').toUpperCase().replace('JPEG', 'JPG');
/** One format name when every file shares it, else "". */
const sharedFormat = (paths: string[]) =>
  new Set(paths.map(format)).size === 1 ? format(paths[0]) : '';

type AlbumProps = {
  album: AlbumData;
  resolveFile: (path: string) => string;
  onPerson: (id: string) => void;
  onSource: (source: Source, path?: string) => void;
};

export function AlbumLink({
  album,
  resolveFile,
  onOpen,
}: {
  album: AlbumData;
  resolveFile: (path: string) => string;
  onOpen: (id: string) => void;
}) {
  return (
    <button className="kin-music-link" onClick={() => onOpen(album.id)}>
      <BrowsingImage
        original={resolveFile(album.cover)}
        src={resolveFile(album.cover)}
        alt=""
        loading="lazy"
      />
      <span>
        <small>{album.artist}</small>
        <strong>{album.title}</strong>
        <span>
          Listen to the album <PlayIcon size={17} aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}

export default function Album({
  album,
  resolveFile,
  onPerson,
  onSource,
}: AlbumProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const separateOriginals = album.tracks.some((t) => t.original !== t.audio);
  const listening = sharedFormat(album.tracks.map((t) => t.audio));
  const originals = sharedFormat(album.tracks.map((t) => t.original));
  const artworkFormat = sharedFormat(album.artwork.map((a) => a.original));
  const selected = useRef(0);
  const playback = useRef({ attempt: 0 });
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const track = album.tracks[index];
  const firstTrack = album.tracks[0].audio;
  useEffect(() => {
    const player = audio.current!;
    const pending = playback.current;
    // Selection changes the source synchronously inside the click, preserving
    // Safari's user gesture. Arrival sets a source but never starts playback.
    player.src = resolveFile(firstTrack);
    return () => {
      pending.attempt++;
      player.pause();
      player.removeAttribute('src');
      player.load();
    };
  }, [firstTrack, resolveFile]);

  async function play() {
    const player = audio.current;
    if (!player) return;
    const request = ++playback.current.attempt;
    setError('');
    try {
      await player.play();
    } catch (e) {
      if (
        request !== playback.current.attempt ||
        (e instanceof DOMException && e.name === 'AbortError')
      )
        return;
      setLoading(false);
      setPlaying(false);
      setError(
        'This track could not play. Try again, or download the recording below.',
      );
    }
  }
  function choose(next: number) {
    const player = audio.current;
    if (!player || next < 0 || next >= album.tracks.length) return;
    if (
      selected.current === next &&
      !player.paused &&
      !player.ended &&
      !player.error
    ) {
      playback.current.attempt++;
      player.pause();
      return;
    }
    if (selected.current !== next || player.error) {
      playback.current.attempt++;
      player.pause();
      player.src = resolveFile(album.tracks[next].audio);
      selected.current = next;
      setIndex(next);
      player.load();
    }
    void play();
  }
  function openArtwork(path: string) {
    onSource(album.sourceRecord, path);
  }
  return (
    <article className="kin-music" aria-labelledby="album-title">
      <button
        className="kin-text-link kin-music-person"
        onClick={() => onPerson(album.person)}
      >
        <ArrowLeftIcon size={18} aria-hidden="true" /> {album.artist}’s family
        page
      </button>
      <div className="kin-music-main">
        <div className="kin-music-sleeve">
          <button
            onClick={() => openArtwork(album.cover)}
            aria-label="Enlarge the original album cover"
          >
            <BrowsingImage
              original={resolveFile(album.cover)}
              src={resolveFile(album.cover)}
              alt={`${album.artist}, ${album.title} — original album cover`}
            />
          </button>
          <p>{album.artworkDate}</p>
        </div>
        <div className="kin-music-listening">
          <header>
            <p className="kin-music-artist">{album.artist}</p>
            <h1 id="album-title">{album.title}</h1>
            <p>{album.introduction}</p>
          </header>
          <section className="kin-music-player" aria-label="Album player">
            <div className="kin-music-now" aria-live="polite">
              <span>
                {track.number} / {album.tracks.length}
              </span>
              <strong>{track.title}</strong>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- Original musical recordings have no supplied caption or transcript track. */}
            <audio
              ref={audio}
              controls
              preload="metadata"
              onPlay={(event) => claimAudioPlayback(event.currentTarget)}
              aria-label={`Play ${track.title}`}
              onPlaying={() => {
                setPlaying(true);
                setLoading(false);
                setError('');
              }}
              onPause={() => {
                setPlaying(false);
                setLoading(false);
              }}
              onWaiting={() => setLoading(true)}
              onCanPlay={() => setLoading(false)}
              onError={() => {
                setPlaying(false);
                setLoading(false);
                setError(
                  'This track could not load. Try again, or download the recording below.',
                );
              }}
              onEnded={() => {
                setPlaying(false);
                if (selected.current + 1 < album.tracks.length)
                  choose(selected.current + 1);
              }}
            />
            <div className="kin-music-transport">
              <button onClick={() => choose(index - 1)} disabled={index === 0}>
                <SkipBackIcon size={18} aria-hidden="true" /> Previous
              </button>
              <output>
                {loading ? 'Loading track…' : playing ? 'Playing' : 'Paused'}
              </output>
              <button
                onClick={() => choose(index + 1)}
                disabled={index === album.tracks.length - 1}
              >
                Next <SkipForwardIcon size={18} aria-hidden="true" />
              </button>
            </div>
            {error && (
              <div className="kin-music-error" role="alert">
                <p>{error}</p>
                <button onClick={() => choose(index)}>
                  Try this track again
                </button>
              </div>
            )}
          </section>
          <div className="kin-music-track-heading">
            <h2>Tracks</h2>
            <span>
              {audioDuration(album.tracks.reduce((s, t) => s + t.duration, 0))}{' '}
              total
            </span>
          </div>
          <ol className="kin-music-tracks">
            {album.tracks.map((t, n) => (
              <li key={t.number} data-selected={index === n}>
                <button
                  className="kin-music-track"
                  aria-current={index === n ? 'true' : undefined}
                  aria-label={`${playing && index === n ? 'Pause' : 'Play'} track ${t.number}: ${t.title}`}
                  onClick={() => choose(n)}
                >
                  <span className="kin-music-number">{t.number}</span>
                  {playing && index === n ? (
                    <PauseIcon size={17} aria-hidden="true" />
                  ) : (
                    <PlayIcon size={17} aria-hidden="true" />
                  )}
                  <span>{t.title}</span>
                  <time>{audioDuration(t.duration)}</time>
                </button>
              </li>
            ))}
          </ol>
          <details className="kin-music-downloads">
            <summary>Download the recordings</summary>
            {separateOriginals && (
              <p>
                {`${listening ? `${listening} files` : 'The first files'} are smaller listening copies. ${originals ? `${originals} files` : 'The others'} preserve the original ${album.medium ? `${album.medium} ` : ''}audio.`}
              </p>
            )}
            <ol>
              {album.tracks.map((t) => (
                <li key={t.number}>
                  <span>
                    {t.number}. {t.title}
                  </span>
                  <a
                    href={resolveFile(t.audio) + '?download'}
                    download
                    aria-label={`Download ${t.title} as ${format(t.audio)}`}
                  >
                    {format(t.audio)}
                  </a>
                  {t.original !== t.audio && (
                    <a
                      href={resolveFile(t.original) + '?download'}
                      download
                      aria-label={`Download ${t.title} as original ${format(t.original)}`}
                    >
                      {format(t.original)}{' '}
                      <small>({Math.ceil(t.originalBytes / 1000000)} MB)</small>
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </details>
        </div>
      </div>
      <section className="kin-music-credits" aria-labelledby="album-credits">
        <h2 id="album-credits">Credits from the original artwork</h2>
        <div className="kin-music-credit-columns">
          <div>
            <h3>Performers</h3>
            <dl>
              {album.performers.map((p) => (
                <div key={p.name}>
                  <dt>{p.name}</dt>
                  <dd>{p.role}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3>Production</h3>
            <dl>
              {album.production.map((p) => (
                <div key={p.name}>
                  <dt>{p.name}</dt>
                  <dd>{p.role}</dd>
                </div>
              ))}
            </dl>
            <p>{album.recording}</p>
          </div>
        </div>
        <details>
          <summary>Song credits as printed on the original artwork</summary>
          <p>
            {`These names come from the ${album.medium ? `${album.medium} ` : 'album’s '}artwork. The list may not be complete.`}
          </p>
          <ol>
            {album.tracks.map((t) => (
              <li key={t.number}>
                <span>{t.title}</span>
                <span>{t.writingCredit}</span>
              </li>
            ))}
          </ol>
        </details>
      </section>
      <section className="kin-music-artwork" aria-labelledby="album-artwork">
        <h2 id="album-artwork">Original artwork</h2>
        <p>
          {`Open a page to enlarge it, or download the original ${artworkFormat || 'file'}.`}
        </p>
        <div className="kin-music-artwork-grid">
          {album.artwork.map((a) => (
            <figure key={a.original}>
              <button
                aria-label={`Enlarge ${a.title}`}
                onClick={() => openArtwork(a.image)}
              >
                <BrowsingImage
                  original={resolveFile(a.image)}
                  src={resolveFile(a.image)}
                  alt={a.title}
                  loading="lazy"
                />
              </button>
              <figcaption>
                <h3>{a.title}</h3>
                <a href={resolveFile(a.original) + '?download'} download>
                  <DownloadSimpleIcon size={17} aria-hidden="true" /> Original{' '}
                  {format(a.original)}
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </article>
  );
}
