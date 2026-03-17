// Hand-written type declarations for the corresponding .ts module.
export function formatPair(pair: string): string;

export function formatSummary(args?: {
	pair?: string;
	timeframe?: string;
	latest?: number;
	totalItems?: number;
	keyPoints?: unknown;
	volumeStats?: unknown;
	extra?: string;
}): string;
