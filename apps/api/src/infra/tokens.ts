/** DI tokens. Constructors use explicit @Inject(TOKEN) so DI never depends on emitted type metadata. */
export const CONFIG = Symbol('CONFIG');
export const PRISMA = Symbol('PRISMA');
export const REDIS = Symbol('REDIS');
