export function normalizeCardCode(text: unknown): string;
export function cardCodeShape(text: unknown): boolean;
export function sha256Hex(text: string): Promise<string>;
export function cardCodeHash(text: unknown): Promise<string>;
