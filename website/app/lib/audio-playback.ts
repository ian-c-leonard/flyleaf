/** A reader may open an archive recording over the album. Starting either
 * player transfers playback, so two versions never play over one another. */
export function claimAudioPlayback(player: HTMLAudioElement): void {
  for (const other of player.ownerDocument.querySelectorAll('audio'))
    if (other !== player && !other.paused) other.pause();
}
