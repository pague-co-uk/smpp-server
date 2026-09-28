import { randomUUID } from "node:crypto";

import {
  decrementActiveSessions,
  incrementActiveSessions,
  Loggers,
} from "@pague-co-uk/sms-gateway-telemetry";

import type {
  SmppSession as SmppLibrarySession,
} from "smpp";

import {
  SMPP_SESSION_STATES,
  type SmppSessionState,
} from "./smpp.constants.js";

import type {
  SmppBindType,
} from "./types/smpp-bind.types.js";

import type {
  SmppSessionInfo,
} from "./types/smpp.types.js";

interface SmppProxyProtocolSession {
  readonly remoteAddress:
  | string
  | null;

  readonly proxyProtocolProxy:
  | {
    readonly address: string;
    readonly port: number;
  }
  | false
  | null;
}

type SmppLibrarySessionWithProxy =
  SmppLibrarySession &
  SmppProxyProtocolSession;

export type SmppDeliveryReceiptStatus =
  | "SUCCESS"
  | "FAILED"
  | "UNKNOWN";

export interface SmppDeliveryReceipt {
  readonly messageId: string;
  readonly status: SmppDeliveryReceiptStatus;
  readonly providerMessageId: string;
}

export interface SmppSubmittedMessage {
  /**
   * Pague public message ID returned to the ESME
   * in submit_sm_resp.
   */
  readonly messageId: string;

  /**
   * Original submit_sm source addressing.
   */
  readonly sourceAddrTon: number;
  readonly sourceAddrNpi: number;
  readonly sourceAddress: string;

  /**
   * Original submit_sm destination addressing.
   */
  readonly destinationAddrTon: number;
  readonly destinationAddrNpi: number;
  readonly destinationAddress: string;
}

interface StoredSmppSubmittedMessage {
  /**
   * Original SMPP submission metadata.
   */
  readonly message: SmppSubmittedMessage;

  /**
   * Absolute timestamp at which this metadata
   * should no longer be retained in memory.
   */
  readonly expiresAt: number;
}

export class SmppSession {
  private readonly logger =
    Loggers.smpp;

  private readonly sessionId =
    randomUUID();

  private state: SmppSessionState =
    SMPP_SESSION_STATES.CONNECTING;

  private systemId:
    string | undefined;

  private accountId:
    string | undefined;

  private clientId:
    string | undefined;

  private bindType:
    SmppBindType | undefined;

  private active = false;

  /**
   * Configurable lifetime of submitted-message
   * metadata in memory.
   *
   * The value is supplied by AppConfigService and
   * ultimately comes from:
   *
   * SMPP_SUBMITTED_MESSAGE_TTL_MS
   */
  private readonly submittedMessageTtlMs:
    number;

  /**
   * Periodic cleanup timer for expired submitted
   * message metadata.
   *
   * There is deliberately ONE timer per SMPP session,
   * rather than one timer per submitted message.
   */
  private submittedMessageCleanupTimer:
    NodeJS.Timeout | null = null;

  /**
   * Messages accepted through this SMPP session.
   *
   * The key is the Pague public message ID returned
   * to the ESME in submit_sm_resp.
   *
   * The value preserves the original SMPP addressing
   * required when generating a delivery receipt,
   * together with its in-memory expiry time.
   */
  private readonly submittedMessages =
    new Map<
      string,
      StoredSmppSubmittedMessage
    >();

  constructor(
    private readonly session:
      SmppLibrarySession,

    submittedMessageTtlMs:
      number,
  ) {
    if (
      !Number.isFinite(
        submittedMessageTtlMs,
      ) ||
      submittedMessageTtlMs <= 0
    ) {
      throw new Error(
        "SMPP submitted message TTL must be greater than zero.",
      );
    }

    this.submittedMessageTtlMs =
      submittedMessageTtlMs;

    this.registerLifecycleHandlers();
  }

  public get id(): string {
    return this.sessionId;
  }

  public get raw():
    SmppLibrarySession {
    return this.session;
  }

  public get systemIdentifier():
    string | undefined {
    return this.systemId;
  }

  public get currentState():
    SmppSessionState {
    return this.state;
  }

  public get socket() {
    return this.session.socket;
  }

  public get remoteAddress():
    string | undefined {
    const session =
      this.session as
      SmppLibrarySessionWithProxy;

    return (
      session.remoteAddress ??
      this.socket.remoteAddress ??
      undefined
    );
  }

  public get proxyAddress():
    string | undefined {
    const session =
      this.session as
      SmppLibrarySessionWithProxy;

    if (
      !session.proxyProtocolProxy
    ) {
      return undefined;
    }

    return session
      .proxyProtocolProxy
      .address;
  }

  public get authenticatedAccountId():
    string | undefined {
    return this.accountId;
  }

  public get authenticatedClientId():
    string | undefined {
    return this.clientId;
  }

  public get authenticatedSystemId():
    string | undefined {
    return this.systemId;
  }

  public get currentBindType():
    SmppBindType | undefined {
    return this.bindType;
  }

  public setConnected(): void {
    if (
      this.state ===
      SMPP_SESSION_STATES.CLOSED
    ) {
      return;
    }

    this.state =
      SMPP_SESSION_STATES.CONNECTED;

    this.activate();

    this.startSubmittedMessageCleanup();

    this.logger.info(
      {
        sessionId:
          this.sessionId,

        remoteAddress:
          this.remoteAddress,

        proxyAddress:
          this.proxyAddress,

        remotePort:
          this.socket.remotePort,

        submittedMessageTtlMs:
          this.submittedMessageTtlMs,
      },
      "SMPP session connected.",
    );
  }

  public setBound(options: {
    readonly systemId: string;
    readonly accountId: string;
    readonly clientId: string;
    readonly bindType: SmppBindType;
  }): void {
    if (
      this.state ===
      SMPP_SESSION_STATES.CLOSED
    ) {
      return;
    }

    this.systemId =
      options.systemId;

    this.accountId =
      options.accountId;

    this.clientId =
      options.clientId;

    this.bindType =
      options.bindType;

    this.state =
      SMPP_SESSION_STATES.BOUND;

    this.logger.info(
      {
        sessionId:
          this.sessionId,

        systemId:
          options.systemId,

        accountId:
          options.accountId,

        clientId:
          options.clientId,

        bindType:
          options.bindType,

        remoteAddress:
          this.remoteAddress,
      },
      "SMPP session bound.",
    );
  }

  public setUnbound(): void {
    if (
      this.state ===
      SMPP_SESSION_STATES.CLOSED
    ) {
      return;
    }

    this.state =
      SMPP_SESSION_STATES.UNBOUND;

    this.logger.info(
      {
        sessionId:
          this.sessionId,

        systemId:
          this.systemId,

        accountId:
          this.accountId,

        clientId:
          this.clientId,

        bindType:
          this.bindType,

        remoteAddress:
          this.remoteAddress,
      },
      "SMPP session unbound.",
    );
  }

  /**
   * Register a message that was accepted through this
   * SMPP session.
   *
   * The message ID is the Pague public message ID
   * returned to the ESME in submit_sm_resp.
   *
   * The metadata is retained only for the configured TTL,
   * unless it is removed earlier after a successful DLR.
   */
  public trackSubmittedMessage(
    message: SmppSubmittedMessage,
  ): void {
    if (!message.messageId) {
      return;
    }

    const expiresAt =
      Date.now() +
      this.submittedMessageTtlMs;

    this.submittedMessages.set(
      message.messageId,
      {
        message,
        expiresAt,
      },
    );
  }

  /**
   * Determine whether this session submitted a message.
   *
   * Expired metadata is removed before returning false.
   */
  public hasSubmittedMessage(
    messageId: string,
  ): boolean {
    return (
      this.getSubmittedMessage(
        messageId,
      ) !== undefined
    );
  }

  /**
   * Retrieve the original SMPP submission metadata.
   *
   * If the metadata has expired, it is removed
   * immediately and undefined is returned.
   */
  public getSubmittedMessage(
    messageId: string,
  ):
    | SmppSubmittedMessage
    | undefined {
    const stored =
      this.submittedMessages.get(
        messageId,
      );

    if (!stored) {
      return undefined;
    }

    if (
      stored.expiresAt <=
      Date.now()
    ) {
      this.submittedMessages.delete(
        messageId,
      );

      return undefined;
    }

    return stored.message;
  }

  /**
   * Remove submitted-message metadata from memory.
   *
   * This is normally called immediately after a
   * delivery receipt has been successfully sent.
   */
  public removeSubmittedMessage(
    messageId: string,
  ): boolean {
    return this.submittedMessages.delete(
      messageId,
    );
  }

  /**
   * Return the number of submitted-message metadata
   * entries currently retained in memory.
   *
   * Useful for diagnostics and future metrics.
   */
  public getSubmittedMessageCount():
    number {
    return this.submittedMessages.size;
  }

  /**
   * Send a delivery receipt to the ESME.
   *
   * The metadata is removed immediately after the
   * deliver_sm is successfully accepted by the SMPP
   * library.
   *
   * If deliver_sm fails, the metadata is retained so
   * that a later retry can still reconstruct the
   * original addressing.
   */
  public sendDeliveryReceipt(
    receipt: SmppDeliveryReceipt,
  ): void {
    if (
      this.state !==
      SMPP_SESSION_STATES.BOUND
    ) {
      throw new Error(
        `Cannot send delivery receipt on SMPP session ${this.sessionId}: session is not bound.`,
      );
    }

    const submittedMessage =
      this.getSubmittedMessage(
        receipt.messageId,
      );

    if (!submittedMessage) {
      throw new Error(
        `Cannot send delivery receipt for message ${receipt.messageId}: original SMPP submission was not found on session ${this.sessionId}.`,
      );
    }

    const status =
      this.toSmppDeliveryStatus(
        receipt.status,
      );

    const shortMessage =
      [
        `id:${receipt.messageId}`,
        "sub:001",
        "dlvrd:001",
        `stat:${status}`,
        "err:000",
        "text:",
      ].join(" ");

    /*
     * The delivery receipt travels back to the ESME.
     *
     * Therefore:
     *
     *   source      = original destination
     *   destination = original source
     *
     * The original TON/NPI values are preserved.
     */
    const sent =
      this.session.deliver_sm({
        service_type: "",

        source_addr_ton:
          submittedMessage.destinationAddrTon,

        source_addr_npi:
          submittedMessage.destinationAddrNpi,

        source_addr:
          submittedMessage.destinationAddress,

        dest_addr_ton:
          submittedMessage.sourceAddrTon,

        dest_addr_npi:
          submittedMessage.sourceAddrNpi,

        destination_addr:
          submittedMessage.sourceAddress,

        esm_class: 0x04,

        protocol_id: 0,

        priority_flag: 0,

        schedule_delivery_time: "",

        validity_period: "",

        registered_delivery: 0,

        replace_if_present_flag: 0,

        data_coding: 0,

        sm_default_msg_id: 0,

        short_message: shortMessage,
      });

    if (!sent) {
      throw new Error(
        `Failed to send delivery receipt for message ${receipt.messageId} on SMPP session ${this.sessionId}.`,
      );
    }

    /*
     * The metadata has now served its purpose.
     *
     * Delete it immediately rather than retaining it
     * until the SMPP session closes or the TTL expires.
     */
    this.removeSubmittedMessage(
      receipt.messageId,
    );

    this.logger.info(
      {
        sessionId:
          this.sessionId,

        clientId:
          this.clientId,

        accountId:
          this.accountId,

        systemId:
          this.systemId,

        messageId:
          receipt.messageId,

        providerMessageId:
          receipt.providerMessageId,

        status:
          receipt.status,

        sourceAddress:
          submittedMessage.destinationAddress,

        sourceAddrTon:
          submittedMessage.destinationAddrTon,

        sourceAddrNpi:
          submittedMessage.destinationAddrNpi,

        destinationAddress:
          submittedMessage.sourceAddress,

        destinationAddrTon:
          submittedMessage.sourceAddrTon,

        destinationAddrNpi:
          submittedMessage.sourceAddrNpi,

        remainingSubmittedMessages:
          this.submittedMessages.size,
      },
      "SMPP delivery receipt sent.",
    );
  }

  public close(): void {
    if (
      this.state ===
      SMPP_SESSION_STATES.CLOSED
    ) {
      return;
    }

    this.session.close();
  }

  public sendSubmitSmResponse(
    options: {
      readonly sequence_number: number;
      readonly command_status: number;
      readonly message_id: string;
    },
  ): void {
    this.session.submit_sm_resp(
      options,
    );
  }

  public sendDeliverSmResponse(
    options: {
      readonly sequence_number: number;
      readonly command_status: number;
    },
  ): void {
    this.session.deliver_sm_resp(
      options,
    );
  }

  public sendEnquireLinkResponse(
    options: {
      readonly sequence_number: number;
      readonly command_status: number;
    },
  ): void {
    this.session.enquire_link_resp(
      options,
    );
  }

  public sendUnbindResponse(
    options: {
      readonly sequence_number: number;
      readonly command_status: number;
    },
  ): void {
    this.session.unbind_resp(
      options,
    );
  }

  public info(): SmppSessionInfo {
    return {
      sessionId:
        this.sessionId,

      state:
        this.state,

      systemId:
        this.systemId,

      remoteAddress:
        this.remoteAddress,

      remotePort:
        this.socket.remotePort,
    };
  }

  private registerLifecycleHandlers(): void {
    this.session.on(
      "connect",
      () => {
        this.setConnected();
      },
    );

    this.session.on(
      "close",
      () => {
        this.handleClose();
      },
    );

    this.session.on(
      "error",
      (error: Error) => {
        this.logger.error(
          {
            err: error,

            sessionId:
              this.sessionId,

            remoteAddress:
              this.remoteAddress,
          },
          "SMPP session error.",
        );
      },
    );
  }

  private activate(): void {
    if (this.active) {
      return;
    }

    this.active = true;

    incrementActiveSessions();
  }

  private deactivate(): void {
    if (!this.active) {
      return;
    }

    this.active = false;

    decrementActiveSessions();
  }

  private handleClose(): void {
    this.stopSubmittedMessageCleanup();

    this.deactivate();

    this.submittedMessages.clear();

    this.state =
      SMPP_SESSION_STATES.CLOSED;

    this.logger.info(
      {
        sessionId:
          this.sessionId,

        systemId:
          this.systemId,

        accountId:
          this.accountId,

        clientId:
          this.clientId,

        bindType:
          this.bindType,

        remoteAddress:
          this.remoteAddress,
      },
      "SMPP session closed.",
    );
  }

  private startSubmittedMessageCleanup(): void {
    this.stopSubmittedMessageCleanup();

    /*
     * Clean at most once every 60 seconds.
     *
     * For short TTLs we clean more frequently so that
     * expired entries don't remain in memory unnecessarily.
     *
     * For long TTLs we cap the interval at 60 seconds
     * so memory doesn't retain expired entries for a
     * significant period after their expiry.
     */
    const cleanupIntervalMs =
      Math.min(
        Math.max(
          Math.floor(
            this.submittedMessageTtlMs /
            2,
          ),
          1000,
        ),
        60000,
      );

    this.submittedMessageCleanupTimer =
      setInterval(
        () => {
          this.cleanupExpiredSubmittedMessages();
        },
        cleanupIntervalMs,
      );
  }

  private stopSubmittedMessageCleanup(): void {
    if (
      this.submittedMessageCleanupTimer
    ) {
      clearInterval(
        this.submittedMessageCleanupTimer,
      );

      this.submittedMessageCleanupTimer =
        null;
    }
  }

  private cleanupExpiredSubmittedMessages(): void {
    if (
      this.submittedMessages.size ===
      0
    ) {
      return;
    }

    const now =
      Date.now();

    let removedCount = 0;

    for (
      const [
        messageId,
        stored,
      ] of this.submittedMessages
    ) {
      if (
        stored.expiresAt <=
        now
      ) {
        this.submittedMessages.delete(
          messageId,
        );

        removedCount++;
      }
    }

    if (
      removedCount === 0
    ) {
      return;
    }

    this.logger.debug(
      {
        sessionId:
          this.sessionId,

        removedCount,

        remainingSubmittedMessages:
          this.submittedMessages.size,

        submittedMessageTtlMs:
          this.submittedMessageTtlMs,
      },
      "Expired SMPP submitted-message metadata removed.",
    );
  }

  private toSmppDeliveryStatus(
    status: SmppDeliveryReceiptStatus,
  ):
    | "DELIVRD"
    | "UNDELIV"
    | "UNKNOWN" {
    switch (status) {
      case "SUCCESS":
        return "DELIVRD";

      case "FAILED":
        return "UNDELIV";

      case "UNKNOWN":
        return "UNKNOWN";
    }
  }
}