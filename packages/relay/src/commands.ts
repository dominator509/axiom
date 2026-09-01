import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export type CardAction =
  | 'approve'
  | 'approve_all'
  | 'reject'
  | 'edit_caption'
  | 'change_price'
  | 'reschedule'
  | 'regenerate'
  | 'revise'
  | 'hold';

export const CARD_ACTIONS: readonly CardAction[] = [
  'approve',
  'approve_all',
  'reject',
  'edit_caption',
  'change_price',
  'reschedule',
  'regenerate',
  'revise',
  'hold',
];

const ACTION_CODES: Record<CardAction, string> = Object.fromEntries(
  CARD_ACTIONS.map((action, index) => [action, index.toString(36)]),
) as Record<CardAction, string>;
const ACTIONS_BY_CODE = Object.fromEntries(
  CARD_ACTIONS.map((action, index) => [index.toString(36), action]),
) as Record<string, CardAction>;
const COMPACT_TOKEN_MAC_BYTES = 12;
const COMPACT_TOKEN_MAX_LENGTH = 64;

export function isCardAction(value: unknown): value is CardAction {
  return typeof value === 'string' && CARD_ACTIONS.includes(value as CardAction);
}

export interface CommandContext {
  channel: string;
  sourceId: string;
}

export interface CommandResult {
  success: boolean;
  cardId: string;
  action: CardAction;
  timestamp: number;
  error?: string;
}

/**
 * Executes a verified relay command against domain state. Injected by the
 * API layer (which owns the DB); the relay package stays persistence-free.
 * Returns an optional result note. Throwing marks the command failed.
 */
export type CommandExecutor = (
  action: CardAction,
  cardId: string,
  params: Record<string, unknown>,
  context?: CommandContext,
) => Promise<string | void>;

interface NonceEntry {
  nonce: string;
  expiresAt: number;
}

export class CommandRouter {
  private secret: Buffer;
  private nonces: Map<string, NonceEntry> = new Map();
  private ttlMs: number;
  private auditLog: CommandResult[] = [];
  private executor?: CommandExecutor;

  constructor(secret: string, ttlMinutes: number = 5, executor?: CommandExecutor) {
    this.secret = Buffer.from(secret, 'utf-8');
    this.ttlMs = ttlMinutes * 60 * 1000;
    this.executor = executor;
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

  /**
   * Create a compact, one-use command token for provider button payloads.
   * Telegram limits callback_data to 64 bytes, so the UUID form is packed as
   * its 16-byte binary representation instead of its textual form. Non-UUID
   * identifiers remain supported for standalone callers and tests when they
   * fit the provider limit.
   */
  createCommandToken(action: CardAction, cardId: string): string {
    const actionCode = ACTION_CODES[action];
    if (!actionCode) throw new Error(`unsupported relay action: ${action}`);
    if (typeof cardId !== 'string' || cardId.length === 0) {
      throw new Error('relay command card id is required');
    }

    const encodedCardId = encodeCardId(cardId);
    const nonce = randomBytes(8).toString('base64url');
    const payload = `${actionCode}.${encodedCardId}.${nonce}`;
    const mac = this.compactMac(payload);
    const token = `${payload}.${mac}`;
    if (token.length > COMPACT_TOKEN_MAX_LENGTH) {
      throw new Error('relay command token exceeds provider payload limit');
    }
    return token;
  }

  /**
   * Verify and consume a compact provider command token. The returned card
   * and action are taken only from the authenticated payload; callers must
   * never parse provider button text as a command.
   */
  verifyCommandToken(
    token: string,
    expectedAction?: CardAction,
  ): { action: CardAction; cardId: string } | null {
    if (typeof token !== 'string' || token.length === 0 || token.length > COMPACT_TOKEN_MAX_LENGTH) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [actionCode, encodedCardId, nonce, suppliedMac] = parts;
    const action = ACTIONS_BY_CODE[actionCode];
    if (
      !action ||
      (expectedAction && action !== expectedAction) ||
      !encodedCardId ||
      !nonce ||
      !suppliedMac
    ) {
      return null;
    }

    const cardId = decodeCardId(encodedCardId);
    if (!cardId) return null;

    const expectedMac = this.compactMac(`${actionCode}.${encodedCardId}.${nonce}`);
    const expectedBuf = Buffer.from(expectedMac, 'base64url');
    const suppliedBuf = Buffer.from(suppliedMac, 'base64url');
    if (
      suppliedBuf.length !== expectedBuf.length ||
      suppliedBuf.toString('base64url') !== suppliedMac
    ) {
      return null;
    }
    try {
      if (!timingSafeEqual(expectedBuf, suppliedBuf)) return null;
    } catch {
      return null;
    }

    if (!this.consumeNonce(nonce)) return null;
    return { action, cardId };
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
    params: Record<string, unknown> = {},
    context?: CommandContext,
  ): Promise<CommandResult> {
    const result: CommandResult = {
      success: true,
      cardId,
      action,
      timestamp: Date.now(),
    };

    try {
      if (this.executor) {
        const note = context
          ? await this.executor(action, cardId, params, context)
          : await this.executor(action, cardId, params);
        result.error = note ?? undefined;
      } else {
        // No executor injected (e.g. unit tests): record the command in the
        // in-memory audit log. Production wiring always injects the DB
        // executor (see packages/api/src/index.ts initRelay).
        this.auditLog.push(result);
      }
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

  private compactMac(payload: string): string {
    return createHmac('sha256', this.secret)
      .update(payload)
      .digest()
      .subarray(0, COMPACT_TOKEN_MAC_BYTES)
      .toString('base64url');
  }

  private consumeNonce(nonce: string): boolean {
    const existing = this.nonces.get(nonce);
    if (existing) {
      if (existing.expiresAt > Date.now()) return false;
      this.nonces.delete(nonce);
    }
    this.nonces.set(nonce, {
      nonce,
      expiresAt: Date.now() + this.ttlMs,
    });
    return true;
  }
}

function encodeCardId(cardId: string): string {
  const uuid = cardId.match(
    /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i,
  );
  if (uuid) {
    return `u${Buffer.from(uuid.slice(1).join(''), 'hex').toString('base64url')}`;
  }
  return `s${Buffer.from(cardId, 'utf8').toString('base64url')}`;
}

function decodeCardId(encoded: string): string | null {
  if (encoded.length < 2) return null;
  const kind = encoded[0];
  const value = encoded.slice(1);
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;

  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) return null;
    if (kind === 'u') {
      if (decoded.length !== 16) return null;
      const hex = decoded.toString('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    if (kind === 's') {
      const cardId = decoded.toString('utf8');
      return cardId.length > 0 && Buffer.from(cardId, 'utf8').equals(decoded) ? cardId : null;
    }
  } catch {
    return null;
  }
  return null;
}
