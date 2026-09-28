import { Injectable } from "@nestjs/common";

import {
  Loggers,
} from "@pague-co-uk/sms-gateway-telemetry";

import type {
  SmppSession as SmppLibrarySession,
} from "smpp";

import {
  ClientDlr,
} from "./smpp-delivery-receipt.consumer.js";

import { AppConfigService } from "../config/config.service.js";
import {
  SmppSession,
} from "./smpp.session.js";

interface SmppSessionSocketDiagnostics {
  readonly remoteAddress: string | null;
  readonly remotePort: number | null;
  readonly localAddress: string | null;
  readonly localPort: number | null;
}

interface ActiveSmppSessionDiagnostics {
  readonly sessionId: string;
  readonly clientId: string | null;
  readonly accountId: string | null;
  readonly systemId: string | null;
  readonly remoteAddress: string | null;
  readonly remotePort: number | null;
  readonly localAddress: string | null;
  readonly localPort: number | null;
  readonly submittedMessageCount: number;
}

@Injectable()
export class SmppSessionManager {
  private readonly logger =
    Loggers.smpp;

  private readonly sessions =
    new Map<
      string,
      SmppSession
    >();

  /**
   * Tracks sessions that currently hold a bind slot
   * for each SMPP account.
   *
   * The Set contains session IDs.
   */
  private readonly boundSessionsByAccount =
    new Map<
      string,
      Set<string>
    >();

  constructor(
    private readonly config:
      AppConfigService,
  ) { }

  public create(
    session: SmppLibrarySession,
  ): SmppSession {
    const smppSession =
      new SmppSession(
        session,
        this.config.smpp.submittedMessageTtlMs,
      );

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

        submittedMessageTtlMs:
          this.config.smpp
            .submittedMessageTtlMs,
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

  public values():
    readonly SmppSession[] {
    return [
      ...this.sessions.values(),
    ];
  }

  /**
   * Returns diagnostic information for every
   * currently active SMPP session.
   *
   * This is intentionally read-only and exists
   * to make session/message correlation visible
   * while troubleshooting DLR delivery.
   */
  public getActiveSessionDiagnostics():
    readonly ActiveSmppSessionDiagnostics[] {
    return [
      ...this.sessions.values(),
    ].map(
      (session) => {
        const socket =
          this.getSessionSocketDiagnostics(
            session,
          );

        return {
          sessionId:
            session.id,

          clientId:
            session.authenticatedClientId ??
            null,

          accountId:
            session.authenticatedAccountId ??
            null,

          systemId:
            session.authenticatedSystemId ??
            null,

          remoteAddress:
            socket.remoteAddress,

          remotePort:
            socket.remotePort,

          localAddress:
            socket.localAddress,

          localPort:
            socket.localPort,

          submittedMessageCount:
            session.getSubmittedMessageCount(),
        };
      },
    );
  }

  /**
   * Logs all currently active sessions and indicates
   * which session, if any, owns the supplied publicId.
   *
   * This is specifically useful when investigating
   * delivery-receipt correlation.
   */
  public logSessionOwnership(
    publicId: string,
  ): void {
    const sessions =
      [
        ...this.sessions.values(),
      ].map(
        (session) => {
          const socket =
            this.getSessionSocketDiagnostics(
              session,
            );

          const ownsMessage =
            session.hasSubmittedMessage(
              publicId,
            );

          return {
            sessionId:
              session.id,

            clientId:
              session.authenticatedClientId ??
              null,

            accountId:
              session.authenticatedAccountId ??
              null,

            systemId:
              session.authenticatedSystemId ??
              null,

            remoteAddress:
              socket.remoteAddress,

            remotePort:
              socket.remotePort,

            localAddress:
              socket.localAddress,

            localPort:
              socket.localPort,

            ownsMessage,

            submittedMessageCount:
              session.getSubmittedMessageCount(),
          };
        },
      );

    this.logger.info(
      {
        publicId,

        activeSessionCount:
          sessions.length,

        sessions,
      },
      "SMPP session ownership diagnostic.",
    );
  }

  /**
   * Gets diagnostic socket information from the
   * underlying SMPP library session.
   *
   * The local SmppSession abstraction does not expose
   * socket address properties, so we deliberately read
   * these values defensively from the underlying session.
   */
  private getSessionSocketDiagnostics(
    session: SmppSession,
  ): SmppSessionSocketDiagnostics {
    const candidate =
      session as unknown as {
        session?: {
          socket?: {
            remoteAddress?: unknown;
            remotePort?: unknown;
            localAddress?: unknown;
            localPort?: unknown;
          };
        };
        socket?: {
          remoteAddress?: unknown;
          remotePort?: unknown;
          localAddress?: unknown;
          localPort?: unknown;
        };
      };

    const socket =
      candidate.socket ??
      candidate.session?.socket;

    return {
      remoteAddress:
        typeof socket?.remoteAddress ===
          "string"
          ? socket.remoteAddress
          : null,

      remotePort:
        typeof socket?.remotePort ===
          "number"
          ? socket.remotePort
          : null,

      localAddress:
        typeof socket?.localAddress ===
          "string"
          ? socket.localAddress
          : null,

      localPort:
        typeof socket?.localPort ===
          "number"
          ? socket.localPort
          : null,
    };
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
      ] of this
        .boundSessionsByAccount
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

  public async sendDeliveryReceipt(
    receipt: ClientDlr,
  ): Promise<boolean> {
    this.logger.info(
      {
        messageId:
          receipt.messageId,

        publicId:
          receipt.publicId,

        providerMessageId:
          receipt.providerMessageId,

        status:
          receipt.status,

        activeSessionCount:
          this.sessions.size,
      },
      "Beginning SMPP delivery receipt session lookup.",
    );

    /*
     * This is the most important diagnostic log.
     *
     * It records every active SMPP session and whether
     * that session currently owns the DLR publicId.
     */
    this.logSessionOwnership(
      receipt.publicId,
    );

    for (
      const session of
      this.sessions.values()
    ) {
      const ownsMessage =
        session.hasSubmittedMessage(
          receipt.publicId,
        );

      this.logger.debug(
        {
          sessionId:
            session.id,

          clientId:
            session.authenticatedClientId,

          accountId:
            session.authenticatedAccountId,

          systemId:
            session.authenticatedSystemId,

          publicId:
            receipt.publicId,

          providerMessageId:
            receipt.providerMessageId,

          ownsMessage,

          submittedMessageCount:
            session.getSubmittedMessageCount(),
        },
        "Checking SMPP session for delivery receipt ownership.",
      );

      if (!ownsMessage) {
        continue;
      }

      this.logger.info(
        {
          sessionId:
            session.id,

          clientId:
            session.authenticatedClientId,

          accountId:
            session.authenticatedAccountId,

          systemId:
            session.authenticatedSystemId,

          publicId:
            receipt.publicId,

          providerMessageId:
            receipt.providerMessageId,

          status:
            receipt.status,

          submittedMessageCount:
            session.getSubmittedMessageCount(),
        },
        "Matching SMPP session found for delivery receipt.",
      );

      session.sendDeliveryReceipt({
        messageId:
          receipt.publicId,

        providerMessageId:
          receipt.providerMessageId,

        status:
          receipt.status,
      });

      /*
       * SmppSession.sendDeliveryReceipt()
       * removes the submitted-message metadata
       * immediately after deliver_sm succeeds.
       *
       * We deliberately do not remove it here because
       * SmppSession owns the metadata lifecycle.
       */
      this.logger.info(
        {
          sessionId:
            session.id,

          clientId:
            session.authenticatedClientId,

          accountId:
            session.authenticatedAccountId,

          systemId:
            session.authenticatedSystemId,

          publicId:
            receipt.publicId,

          providerMessageId:
            receipt.providerMessageId,

          status:
            receipt.status,

          remainingSubmittedMessages:
            session.getSubmittedMessageCount(),
        },
        "SMPP delivery receipt routed to client session.",
      );

      return true;
    }

    this.logger.warn(
      {
        messageId:
          receipt.messageId,

        publicId:
          receipt.publicId,

        providerMessageId:
          receipt.providerMessageId,

        status:
          receipt.status,

        activeSessionCount:
          this.sessions.size,

        activeSessions:
          this.getActiveSessionDiagnostics(),
      },
      "No active SMPP session found for delivery receipt.",
    );

    return false;
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