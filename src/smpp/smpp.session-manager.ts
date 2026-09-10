import { Injectable } from "@nestjs/common";

import { Loggers } from "@pague-co-uk/sms-gateway-telemetry";

import type { SmppSession as SmppLibrarySession } from "smpp";

import { SmppSession } from "./smpp.session.js";

@Injectable()
export class SmppSessionManager {
  private readonly logger = Loggers.smpp;

  private readonly sessions =
    new Map<string, SmppSession>();

  /**
   * Tracks sessions that currently hold a bind slot
   * for each SMPP account.
   *
   * The Set contains session IDs.
   */
  private readonly boundSessionsByAccount =
    new Map<string, Set<string>>();

  public create(
    session: SmppLibrarySession,
  ): SmppSession {
    const smppSession =
      new SmppSession(session);

    this.sessions.set(
      smppSession.id,
      smppSession,
    );

    session.once(
      "close",
      () => {
        this.releaseBind(
          smppSession.id,
        );

        this.remove(
          smppSession.id,
        );
      },
    );

    this.logger.info(
      {
        sessionId:
          smppSession.id,

        activeSessions:
          this.sessions.size,
      },
      "SMPP session registered.",
    );

    return smppSession;
  }

  public get(
    sessionId: string,
  ): SmppSession | undefined {
    return this.sessions.get(
      sessionId,
    );
  }

  public values(): readonly SmppSession[] {
    return [
      ...this.sessions.values(),
    ];
  }

  /**
   * Atomically checks the account's concurrent-bind
   * limit and reserves a bind slot for the session.
   *
   * There is deliberately no await in this method.
   * The check and reservation therefore execute as one
   * synchronous operation on the Node.js event loop.
   *
   * Returns true when the slot was reserved.
   * Returns false when the account has reached its limit.
   */
  public tryReserveBind(
    sessionId: string,
    accountId: string,
    maxConcurrentBinds: number,
  ): boolean {
    let accountSessions =
      this.boundSessionsByAccount.get(
        accountId,
      );

    if (!accountSessions) {
      accountSessions =
        new Set<string>();

      this.boundSessionsByAccount.set(
        accountId,
        accountSessions,
      );
    }

    /**
     * A session that already holds a reservation
     * is treated as successfully reserved.
     *
     * This makes the operation idempotent.
     */
    if (
      accountSessions.has(
        sessionId,
      )
    ) {
      return true;
    }

    if (
      maxConcurrentBinds <= 0 ||
      accountSessions.size >=
      maxConcurrentBinds
    ) {
      /**
       * Avoid retaining an empty account entry
       * when the reservation cannot be made.
       */
      if (
        accountSessions.size === 0
      ) {
        this.boundSessionsByAccount.delete(
          accountId,
        );
      }

      return false;
    }

    /**
     * The limit check and reservation happen
     * synchronously without an await between them.
     */
    accountSessions.add(
      sessionId,
    );

    this.logger.debug(
      {
        sessionId,
        accountId,
        boundSessions:
          accountSessions.size,
        maxConcurrentBinds,
      },
      "SMPP bind slot reserved.",
    );

    return true;
  }

  /**
   * Releases the bind slot held by a session.
   *
   * Safe to call multiple times.
   */
  public releaseBind(
    sessionId: string,
  ): void {
    for (
      const [
        accountId,
        accountSessions,
      ] of this.boundSessionsByAccount
    ) {
      if (
        !accountSessions.delete(
          sessionId,
        )
      ) {
        continue;
      }

      const boundSessions =
        accountSessions.size;

      if (
        boundSessions === 0
      ) {
        this.boundSessionsByAccount.delete(
          accountId,
        );
      }

      this.logger.debug(
        {
          sessionId,
          accountId,
          boundSessions,
        },
        "SMPP bind slot released.",
      );

      return;
    }
  }

  public remove(
    sessionId: string,
  ): void {
    const removed =
      this.sessions.delete(
        sessionId,
      );

    if (!removed) {
      return;
    }

    this.logger.info(
      {
        sessionId,
        activeSessions:
          this.sessions.size,
      },
      "SMPP session removed.",
    );
  }

  public async closeAll(): Promise<void> {
    const sessions =
      this.values();

    this.logger.info(
      {
        sessionCount:
          sessions.length,
      },
      "Closing SMPP sessions.",
    );

    for (
      const session of sessions
    ) {
      session.close();
    }

    this.sessions.clear();

    this.boundSessionsByAccount.clear();
  }
}