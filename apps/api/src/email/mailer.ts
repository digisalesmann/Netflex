export {
  FakeMailer,
  MailError,
  ResendMailer,
  UnconfiguredMailer,
  type Mailer,
} from '@netflex/email';

/** Nest injection token for the mailer. */
export const MAILER = Symbol('MAILER');
