import type { Session } from './session.types.js';

export interface SessionStoreOptions {
  maxSessions: number;
  idleTtlMs: number;
  now: () => number;
}

// In memory only: sessions are lost on restart and are not shared between server instances.
export class SessionStore {
  // Insertion order is recency order: the first key is the least recently used session.
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly options: SessionStoreOptions) {}

  get size(): number {
    return this.sessions.size;
  }

  add(session: Session): void {
    this.dropStale();
    for (const id of this.sessions.keys()) {
      if (this.sessions.size < this.options.maxSessions) break;
      this.sessions.delete(id);
    }
    this.sessions.set(session.id, session);
  }

  get(id: string): Session | undefined {
    const session = this.sessions.get(id);
    if (session === undefined) return undefined;
    if (this.isStale(session)) {
      this.sessions.delete(id);
      return undefined;
    }
    session.lastUsedAt = this.options.now();
    this.sessions.delete(id);
    this.sessions.set(id, session);
    return session;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  private isStale(session: Session): boolean {
    const now = this.options.now();
    return (
      now - session.lastUsedAt >= this.options.idleTtlMs ||
      now >= session.tokens.refreshExpiresAt
    );
  }

  private dropStale(): void {
    for (const [id, session] of this.sessions) {
      if (this.isStale(session)) this.sessions.delete(id);
    }
  }
}
