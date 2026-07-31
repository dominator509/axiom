import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export type CardAction = 'approve' | 'approve_all' | 'reject' | 'edit_caption' | 'change_price' | 'reschedule' | 'regenerate' | 'revise' | 'hold';

export interface CommandResult {
  success: boolean;
  cardId: string;
  action: CardAction;
  timestamp: number;
  error?: string;
}

interface NonceEntry {
  nonce: string;
  expiresAt: number;
}

export class CommandRouter {
  private secret: Buffer;
  private nonces: Map<string, NonceEntry> = new Map();
  private ttlMs: number;
  private auditLog: CommandResult[] = [];

  constructor(secret: string, ttlMinutes: number = 5) {
    this.secret = Buffer.from(secret, 'utf-8');
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  generateNonce(): string {
    return randomBytes(16).toString('hex');
  }

  signCommand(nonce: string, action: CardAction, cardId: string): string {
    // NOTE: timestamp intentionally omitted from payload. Previously included
    // Date.now(), which made signatures non-deterministic: verifyCommand()
    // recomputes the HMAC at verify time and would only match if sign+verify
    // happened in the same millisecond (impossible over a network round-trip).
    const payload = `${nonce}:${action}:${cardId}`;
    const hmac = createHmac('sha256', this.secret);
    hmac.update(payload);
    return hmac.digest('hex');
  }

  verifyCommand(signature: string, nonce: string, action: CardAction, cardId: string): boolean {
    // Check nonce reuse
    const existing = this.nonces.get(nonce);
    if (existing) {
      if (existing.expiresAt > Date.now()) {
        return false; // Nonce still valid — reuse detected
      }
      this.nonces.delete(nonce); // Expired, clean up
    }

    // Verify signature
    const expected = this.signCommand(nonce, action, cardId);
    const expectedBuf = Buffer.from(expected, 'utf-8');
    const sigBuf = Buffer.from(signature, 'utf-8');

    if (expectedBuf.length !== sigBuf.length) return false;

    try {
      const valid = timingSafeEqual(expectedBuf, sigBuf);
      if (!valid) return false;
    } catch {
      return false;
    }

    // Store nonce with expiry
    this.nonces.set(nonce, {
      nonce,
      expiresAt: Date.now() + this.ttlMs,
    });

    return true;
  }

  async processCommand(
    cardId: string,
    action: CardAction,
    _params: Record<string, unknown> = {},
  ): Promise<CommandResult> {
    const result: CommandResult = {
      success: true,
      cardId,
      action,
      timestamp: Date.now(),
    };

    try {
      // This would update content_bundle state in the DB
      // For now we log the command
      this.auditLog.push(result);
    } catch (err) {
      result.success = false;
      result.error = err instanceof Error ? err.message : String(err);
    }

    return result;
  }

  getAuditLog(): CommandResult[] {
    return [...this.auditLog];
  }

  cleanupExpiredNonces(): void {
    const now = Date.now();
    for (const [key, entry] of this.nonces) {
      if (entry.expiresAt <= now) {
        this.nonces.delete(key);
      }
    }
  }
}
