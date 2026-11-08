/** Déclarations pour les tests TypeScript du relais (implémentation : proxy-guards.mjs). */

export function expandIpv6(address: string): number[] | null;
export function isPrivateAddress(address: string): boolean;
export function assertPublicTarget(url: URL): Promise<void>;
export function parseXtreamServer(value: string | null | undefined): string | null;
