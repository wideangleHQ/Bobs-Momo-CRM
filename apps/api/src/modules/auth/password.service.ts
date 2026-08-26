import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// Chapter 13. Tuned so a hash costs roughly 100ms on the Railway container.
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB, the OWASP floor
  timeCost: 2,
  parallelism: 1,
};

// The most common passwords a QSR account actually gets given.
const DENY_LIST = new Set([
  'password', 'password1', 'password123', '1234567890', 'qwertyuiop',
  'bobsmomo', 'bobsmomo123', 'momo123456', 'admin12345', 'welcome123',
  'changeme123', 'iloveyou123', 'letmein123', 'abcd123456',
]);

const WORDS = [
  'momo', 'steam', 'chilli', 'ginger', 'kite', 'river', 'mango', 'copper',
  'lantern', 'saffron', 'pepper', 'basil', 'walnut', 'cotton', 'indigo',
  'harbour', 'meadow', 'falcon', 'cedar', 'amber',
];

@Injectable()
export class PasswordService {
  /**
   * Verified against this when the user does not exist, so a login attempt for
   * an unknown account costs the same wall clock time as a real one. Not
   * optional: without it, response timing enumerates usernames.
   */
  private dummyHash: string | null = null;

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  async burnTime(plain: string): Promise<void> {
    this.dummyHash ??= await this.hash('dummy-password-for-timing-parity');
    await this.verify(this.dummyHash, plain);
  }

  /** Returns a reason when the password is unusable, null when it is fine. */
  weakness(password: string, username: string): string | null {
    const lower = password.toLowerCase();
    if (DENY_LIST.has(lower)) return 'That password is too common';
    if (username.length >= 3 && lower.includes(username.toLowerCase())) {
      return 'Password cannot contain the username';
    }
    if (/^(.)\1+$/.test(password)) return 'Password cannot be one repeated character';
    return null;
  }

  /** "momo-7431-kite". Read out loud by a manager, so no ambiguous glyphs. */
  generateTemporary(): string {
    const pick = (): string => WORDS[Math.floor(Math.random() * WORDS.length)] as string;
    const digits = String(1000 + Math.floor(Math.random() * 9000));
    return `${pick()}-${digits}-${pick()}`;
  }
}
