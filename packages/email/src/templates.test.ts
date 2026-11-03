import { describe, expect, it } from 'vitest';
import { FakeMailer } from './mailer.js';
import { signInCodeEmail } from './templates.js';

const brand = {
  lodgeName: 'ND Lodge',
  webUrl: 'https://wifi.example.com/',
  supportEmail: 'help@example.com',
  supportPhone: '+234 704 033 2279',
};

describe('sign-in code email', () => {
  const m = signInCodeEmail({ brand, to: 'amara@example.com', code: '482913', minutes: 5 });

  it('puts the code in the subject, HTML and plain text', () => {
    expect(m.subject).toBe('482913 is your ND Lodge Wi-Fi sign-in code');
    expect(m.html).toContain('482913');
    expect(m.text).toMatch(/^482913$/m);
    expect(m.text).toContain('Expires in 5 minutes');
  });

  it('links to the site without a double slash and includes the lodge contacts', () => {
    expect(m.html).toContain('https://wifi.example.com/legal/privacy');
    expect(m.html).not.toContain('example.com//');
    expect(m.html).toContain('mailto:help@example.com');
    expect(m.html).toContain('tel:+2347040332279');
  });

  it('escapes every dynamic value', () => {
    const x = signInCodeEmail({
      brand: { ...brand, lodgeName: '<script>alert(1)</script>' },
      to: '"x"@example.com',
      code: '000000',
      minutes: 5,
    });
    expect(x.html).not.toContain('<script>');
    expect(x.html).toContain('&lt;script&gt;');
    expect(x.html).toContain('&quot;x&quot;@example.com');
  });
});

describe('FakeMailer', () => {
  it('finds the latest code per address and refuses production', async () => {
    const mailer = new FakeMailer('test');
    const one = signInCodeEmail({ brand, to: 'a@example.com', code: '111111', minutes: 5 });
    const two = signInCodeEmail({ brand, to: 'a@example.com', code: '222222', minutes: 5 });
    await mailer.send('a@example.com', one);
    await mailer.send('a@example.com', two);
    expect(mailer.lastCode('A@example.com ')).toBe('222222');
    expect(mailer.count('a@example.com')).toBe(2);
    expect(() => new FakeMailer('production')).toThrow();
  });
});
