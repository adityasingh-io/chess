export const PATTERNS: Record<string, RegExp>;
export const SECRET_NAMES: string[];
export function findings(text: string, secrets: Record<string, string>): string[];
export function secretValues(envText: string, env: Record<string, string | undefined>): Record<string, string>;
