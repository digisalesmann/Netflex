/** DI tokens. Constructors use explicit @Inject(TOKEN) so DI never depends on emitted type metadata. */
export const CONFIG = Symbol('CONFIG');
export const PRISMA = Symbol('PRISMA');
export const REDIS = Symbol('REDIS');
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const PAYMENT_ENGINE = Symbol('PAYMENT_ENGINE');
