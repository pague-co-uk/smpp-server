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
   * Message IDs accepted through this SMPP session.
   *
   * The key is the Pague public message ID returned to
   * the ESME in submit_sm_resp.
   */
  private readonly submittedMessages =
    new Set<string>();

  constructor(
    private readonly session:
      SmppLibrarySession,
  ) {
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
   * The publicId is the message_id returned to the ESME
   * in submit_sm_resp.
   */
  public trackSubmittedMessage(
    publicId: string,
  ): void {
    if (!publicId) {
      return;
    }

    this.submittedMessages.add(
      publicId,
    );
  }

  /**
   * Determine whether this session submitted a message.
   */
  public hasSubmittedMessage(
    publicId: string,
  ): boolean {
    return this.submittedMessages.has(
      publicId,
    );
  }

  /**
   * Send a delivery receipt to the ESME.
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

    this.session.deliver_sm({
      service_type: "",
      source_addr_ton: 0,
      source_addr_npi: 0,
      source_addr: "",
      dest_addr_ton: 0,
      dest_addr_npi: 0,
      destination_addr: "",
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

  private toSmppDeliveryStatus(
    status: SmppDeliveryReceiptStatus,
  ): "DELIVRD" | "UNDELIV" | "UNKNOWN" {
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