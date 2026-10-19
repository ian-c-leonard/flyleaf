// The family's public settings, fixed when the site is built (see
// flyleaf-settings.mjs). Tests receive the same object through
// tests/helpers/settings.mjs.
export type SiteSettings = {
  id: string;
  origin: string;
  familyName: string;
  maintainer: {
    name: string;
    firstName: string;
    email: string;
    pronoun: string;
  };
  pdfName: string;
  bookDescription: string;
  /** The title of the book chapter the site shows on its own "About the
   * research" tab, apart from the reading order. Empty: no such tab. */
  researchTab: string;
  tagline: string;
  /** One sentence about the family album on Home, such as "Portraits,
   * school days, homes and gardens." Empty: built from the album's pictures. */
  albumIntro: string;
  /** One sentence about the archive on Home. Empty: a general sentence. */
  archiveIntro: string;
  /** Words in file paths that the archive's opening view shows first, with
   * the recordings and the recipe book. */
  archiveFirst: string[];
  hosting: 'worker' | 'static';
  /** Relatives can send photographs, memories and corrections. */
  sharing: boolean;
  /** The footer says "Built with Flyleaf", with a link to flyleaf.family. */
  credit: boolean;
  photos: {
    /** Title words that mark a family occasion, beyond the built-in ones. */
    occasionWords: string[];
    /** School yearbook names; a portrait titled with one is dated by it. */
    yearbookNames: string[];
    /** Other title words that date a portrait by its title, such as
     * "senior" for a school year. */
    datedWords: string[];
  };
  names: {
    /** Show married women as "Given (Maiden) Married"; otherwise everyone
     * appears under their recorded name. */
    marriedSurnames: boolean;
  };
};

declare const __FLYLEAF_SITE__: SiteSettings | undefined;

function notLoaded(): never {
  throw new Error(
    'Site settings are not loaded. Node scripts must import flyleaf-globals.mjs first.',
  );
}

export const site: SiteSettings =
  typeof __FLYLEAF_SITE__ === 'undefined' ? notLoaded() : __FLYLEAF_SITE__;

/** True on the family's own live address, where sign-in and sharing work.
 * A static site has neither. */
export const onLiveSite = () =>
  site.hosting !== 'static' && location.origin === site.origin;

/** The maintainer's pronoun, capitalised to start a sentence: "He", "They". */
export const maintainerPronoun =
  site.maintainer.pronoun.charAt(0).toUpperCase() +
  site.maintainer.pronoun.slice(1);
