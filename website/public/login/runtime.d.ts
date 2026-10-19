export interface FamilyClerk {
  isSignedIn: boolean;
  session: {
    getToken(options?: { skipCache?: boolean }): Promise<string | null>;
  } | null;
  signOut(options?: { redirectUrl: string }): Promise<void>;
  addListener(listener: (state: { session: unknown }) => void): () => void;
}
export function loadClerk(): Promise<FamilyClerk>;
export function allowedSession(): Promise<boolean>;
export function destination(
  search?: string,
  origin?: string,
  hash?: string,
): string;
export function trustedSignIn(
  config: {
    publishableKey?: string;
    frontendApi?: string;
    clerkVersion?: string;
    uiVersion?: string;
  },
  host: string,
): boolean;
