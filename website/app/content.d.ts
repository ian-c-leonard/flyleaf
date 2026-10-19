// Types for the family's site content files. The build resolves each one to
// the family's own file or Flyleaf's empty default (see vite.config.ts), so
// type checking never depends on a particular family's data.
declare module '@content/albums.json' {
  const value: import('./lib/content-types.ts').AlbumDefinition[];
  export default value;
}
declare module '@content/changelog.json' {
  const value: import('./lib/changelog.ts').Release[];
  export default value;
}
declare module '@content/display-copy.json' {
  const value: import('./lib/content-types.ts').DisplayCopy;
  export default value;
}
declare module '@content/family-collections.json' {
  const value: import('./lib/content-types.ts').FamilyCollection[];
  export default value;
}
declare module '@content/family-recipes.json' {
  /** Checked by validateRecipeCatalog; null when the family has no recipe book. */
  const value: unknown;
  export default value;
}
declare module '@content/geography.json' {
  /** Checked by validateGeography. */
  const value: unknown;
  export default value;
}
declare module '@content/home-records.json' {
  const value: import('./lib/content-types.ts').HomeRecord[];
  export default value;
}
declare module '@content/name-aliases.json' {
  const value: import('./lib/content-types.ts').NameAliases;
  export default value;
}
declare module '@content/place-readings.json' {
  const value: import('./lib/places.ts').PlaceReading[];
  export default value;
}
declare module '@content/recipe-index.json' {
  const value: import('./lib/family-recipes.ts').RecipeIndex;
  export default value;
}
