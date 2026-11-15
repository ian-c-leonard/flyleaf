export function cardProblem(
  status: number,
  body: { error?: string; used?: boolean; hint?: string; wait?: string } | null,
  maintainer: string,
): string;
export function proofProblem(error: unknown): string;
export function startCards(options: {
  maintainer: string;
  pause: () => void;
  resume: () => void;
}): void;
