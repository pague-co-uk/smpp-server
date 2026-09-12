import { Injectable } from "@nestjs/common";

import {
  getSmppLifecycle,
  Loggers,
} from "@pague-co-uk/sms-gateway-telemetry";

import type { SmppPdu } from "smpp";

import {
  SMPP_SESSION_STATES,
} from "./smpp.constants.js";

import {
  SmppBindAuthorizationService,
} from "./smpp-bind-authorization.service.js";

import {
  SmppSubmitService,
} from "./smpp-submit.service.js";

import {
  SmppMessageReassembler,
} from "./smpp-message-re-assembler.js";

import {
  SmppSession,
} from "./smpp.session.js";

import {
  SmppSessionManager,
} from "./smpp.session-manager.js";

import {
  toTelemetrySmppSessionState,
} from "../utils/smpp-session-state.util.js";

const SMPP_COMMAND_STATUS = {
  ESME_ROK: 0x00000000,

  ESME_RINVBNDSTS: 0x00000004,

  ESME_RSYSERR: 0x00000008,
} as const;

const SMPP_COMMANDS = {
  SUBMIT_SM: "submit_sm",

  DELIVER_SM: "deliver_sm",

  ENQUIRE_LINK: "enquire_link",

  UNBIND: "unbind",

  BIND_TRANSMITTER: "bind_transmitter",

  BIND_RECEIVER: "bind_receiver",

  BIND_TRANSCEIVER: "bind_transceiver",
} as const;

type SmppCommand =
  | typeof SMPP_COMMANDS.SUBMIT_SM
  | typeof SMPP_COMMANDS.DELIVER_SM
  | typeof SMPP_COMMANDS.ENQUIRE_LINK
  | typeof SMPP_COMMANDS.UNBIND
  | typeof SMPP_COMMANDS.BIND_TRANSMITTER
  | typeof SMPP_COMMANDS.BIND_RECEIVER
  | typeof SMPP_COMMANDS.BIND_TRANSCEIVER;

@Injectable()
export class SmppCommandHandler {
  private readonly logger =
    Loggers.smpp;

  private readonly lifecycle =
    getSmppLifecycle();

  /**
   * One reassembler per SMPP session.
   *
   * A multipart message must never be reassembled
   * across different ESME connections.
   */
  private readonly reassemblers =
    new Map<
      string,
      SmppMessageReassembler
    >();

  /**
   * One expiry timer per SMPP session.
   *
   * The timer periodically asks the session's
   * reassembler to expire incomplete multipart messages.
   */
  private readonly reassemblyTimers =
    new Map<
      string,
      NodeJS.Timeout
    >();

  /**
   * How frequently incomplete multipart messages are
   * checked for expiry.
   *
   * The reassembler itself owns the actual TTL.
   */
  private static readonly REASSEMBLY_EXPIRY_INTERVAL_MS =
    30 * 1000;

  constructor(
    private readonly authorization:
      SmppBindAuthorizationService,

    private readonly submissions:
      SmppSubmitService,

    private readonly sessionManager:
      SmppSessionManager,
  ) { }

  public register(
    session: SmppSession,
  ): void {
    const reassembler =
      new SmppMessageReassembler();

    this.reassemblers.set(
      session.id,
      reassembler,
    );

    this.startReassemblyExpiry(
      session,
      reassembler,
    );

    session.raw.on(
      "pdu",
      (pdu: SmppPdu) => {
        void this.handlePdu(
          session,
          pdu,
        );
      },
    );

    /*
     * The reassembler belongs to this session.
     * Release it as soon as the SMPP connection closes.
     */
    session.raw.on(
      "close",
      () => {
        this.stopReassemblyExpiry(
          session.id,
        );

        reassembler.clear();

        this.reassemblers.delete(
          session.id,
        );

        this.logger.debug(
          {
            sessionId:
              session.id,
          },
          "SMPP message reassembler cleared.",
        );
      },
    );
  }

  /**
   * Start the expiry scheduler for a session.
   */
  private startReassemblyExpiry(
    session: SmppSession,
    reassembler: SmppMessageReassembler,
  ): void {
    const timer =
      setInterval(
        () => {
          this.expireReassembly(
            session,
            reassembler,
          );
        },
        SmppCommandHandler.REASSEMBLY_EXPIRY_INTERVAL_MS,
      );

    /*
     * Do not allow the timer to keep the Node.js process
     * alive during shutdown.
     */
    timer.unref();

    this.reassemblyTimers.set(
      session.id,
      timer,
    );
  }

  /**
   * Stop the expiry scheduler for a session.
   */
  private stopReassemblyExpiry(
    sessionId: string,
  ): void {
    const timer =
      this.reassemblyTimers.get(
        sessionId,
      );

    if (!timer) {
      return;
    }

    clearInterval(timer);

    this.reassemblyTimers.delete(
      sessionId,
    );
  }

  /**
   * Expire incomplete multipart messages for a session
   * and reject every submit_sm PDU that belongs to an
   * expired logical message.
   */
  private expireReassembly(
    session: SmppSession,
    reassembler: SmppMessageReassembler,
  ): void {
    /*
     * A closed session cannot receive SMPP responses.
     *
     * Its close handler will clear the reassembler.
     */
    if (
      session.currentState ===
      SMPP_SESSION_STATES.CLOSED
    ) {
      return;
    }

    const expired =
      reassembler.expire();

    if (
      expired.length === 0
    ) {
      return;
    }

    for (
      const message of expired
    ) {
      const sequenceNumbers =
        message.acknowledgementParts.map(
          (part) =>
            part.sequence_number,
        );

      this.logger.warn(
        {
          sessionId:
            session.id,

          clientId:
            session.authenticatedClientId,

          accountId:
            session.authenticatedAccountId,

          systemId:
            session.authenticatedSystemId,

          referenceNumber:
            message.referenceNumber,

          totalSegments:
            message.totalSegments,

          receivedSegments:
            message.parts.length,

          sequenceNumbers,
        },
        "SMPP multipart message expired before all segments were received.",
      );

      /*
       * Reject every original submit_sm PDU that was
       * received for this logical message.
       */
      this.sendSubmitSmResponses(
        session,
        message.acknowledgementParts,
        SMPP_COMMAND_STATUS.ESME_RSYSERR,
        "",
      );
    }
  }

  private async handlePdu(
    session: SmppSession,
    pdu: SmppPdu,
  ): Promise<void> {
    const command =
      this.normalizeCommand(
        pdu.command,
      );

    if (!command) {
      this.logger.warn(
        {
          sessionId:
            session.id,

          command:
            pdu.command,

          sequenceNumber:
            pdu.sequence_number,
        },
        "Unsupported SMPP command received.",
      );

      return;
    }

    /*
     * Bind commands are handled exclusively by
     * SmppBindHandler.
     */
    if (
      command ===
      SMPP_COMMANDS.BIND_TRANSMITTER ||
      command ===
      SMPP_COMMANDS.BIND_RECEIVER ||
      command ===
      SMPP_COMMANDS.BIND_TRANSCEIVER
    ) {
      return;
    }

    try {
      await this.lifecycle.execute(
        {
          pdu: {
            command,

            sequenceNumber:
              pdu.sequence_number,
          },

          session: {
            sessionId:
              session.id,

            systemId:
              session.authenticatedSystemId,

            state:
              toTelemetrySmppSessionState(
                session.currentState,
              ),
          },
        },
        async () => {
          await this.dispatch(
            session,
            pdu,
            command,
          );

          return {
            result: "ok",
          };
        },
      );
    } catch (error) {
      this.logger.error(
        {
          err: error,

          sessionId:
            session.id,

          command,

          sequenceNumber:
            pdu.sequence_number,
        },
        "SMPP command processing failed.",
      );
    }
  }

  private async dispatch(
    session: SmppSession,
    pdu: SmppPdu,
    command: SmppCommand,
  ): Promise<void> {
    switch (command) {
      case SMPP_COMMANDS.SUBMIT_SM:
        await this.handleSubmitSm(
          session,
          pdu,
        );
        return;

      case SMPP_COMMANDS.DELIVER_SM:
        await this.handleDeliverSm(
          session,
          pdu,
        );
        return;

      case SMPP_COMMANDS.ENQUIRE_LINK:
        this.handleEnquireLink(
          session,
          pdu,
        );
        return;

      case SMPP_COMMANDS.UNBIND:
        this.handleUnbind(
          session,
          pdu,
        );
        return;

      case SMPP_COMMANDS.BIND_TRANSMITTER:
      case SMPP_COMMANDS.BIND_RECEIVER:
      case SMPP_COMMANDS.BIND_TRANSCEIVER:
        return;
    }
  }

  private async handleSubmitSm(
    session: SmppSession,
    pdu: SmppPdu,
  ): Promise<void> {
    if (
      session.currentState !==
      SMPP_SESSION_STATES.BOUND
    ) {
      this.logger.warn(
        {
          sessionId:
            session.id,

          sequenceNumber:
            pdu.sequence_number,
        },
        "submit_sm rejected because the SMPP session is not bound.",
      );

      session.sendSubmitSmResponse({
        sequence_number:
          pdu.sequence_number,

        command_status:
          SMPP_COMMAND_STATUS.ESME_RINVBNDSTS,

        message_id:
          "",
      });

      return;
    }

    if (
      !this.authorization.canSubmitSm(
        session.currentBindType,
      )
    ) {
      this.logger.warn(
        {
          sessionId:
            session.id,

          systemId:
            session.authenticatedSystemId,

          bindType:
            session.currentBindType,

          sequenceNumber:
            pdu.sequence_number,
        },
        "submit_sm rejected because the bind type does not permit submission.",
      );

      session.sendSubmitSmResponse({
        sequence_number:
          pdu.sequence_number,

        command_status:
          SMPP_COMMAND_STATUS.ESME_RINVBNDSTS,

        message_id:
          "",
      });

      return;
    }

    const reassembler =
      this.reassemblers.get(
        session.id,
      );

    if (!reassembler) {
      this.logger.error(
        {
          sessionId:
            session.id,

          sequenceNumber:
            pdu.sequence_number,
        },
        "SMPP message reassembler is not registered for the session.",
      );

      session.sendSubmitSmResponse({
        sequence_number:
          pdu.sequence_number,

        command_status:
          SMPP_COMMAND_STATUS.ESME_RSYSERR,

        message_id:
          "",
      });

      return;
    }

    try {
      const reassembly =
        reassembler.accept(
          pdu,
        );

      /*
       * Multipart message is incomplete.
       *
       * Do not call the Control Plane API and do not
       * acknowledge the PDU yet.
       */
      if (
        reassembly.pending
      ) {
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

            sequenceNumber:
              pdu.sequence_number,

            duplicate:
              reassembly.duplicate,

            pendingCount:
              reassembler.pendingCount,
          },
          reassembly.duplicate
            ? "Duplicate SMPP submit_sm segment received and retained for acknowledgement."
            : "SMPP submit_sm segment buffered awaiting remaining segments.",
        );

        return;
      }

      /*
       * A duplicate cannot be submitted as a second logical
       * segment. If the logical message is already complete,
       * the duplicate would belong to a new logical message
       * and would therefore be processed through a separate
       * reassembly lifecycle.
       *
       * This branch primarily protects against an unexpected
       * reassembler state.
       */
      if (
        reassembly.duplicate
      ) {
        this.logger.debug(
          {
            sessionId:
              session.id,

            sequenceNumber:
              pdu.sequence_number,
          },
          "Duplicate SMPP submit_sm segment ignored.",
        );

        return;
      }

      /*
       * Normal single-part message.
       */
      if (
        !reassembly.complete ||
        !reassembly.reassembled
      ) {
        const result =
          await this.submissions.submit(
            session,
            pdu,
          );

        if (!result.accepted) {
          this.logger.error(
            {
              sessionId:
                session.id,

              clientId:
                session.authenticatedClientId,

              accountId:
                session.authenticatedAccountId,

              systemId:
                session.authenticatedSystemId,

              sequenceNumber:
                pdu.sequence_number,
            },
            "SMPP submit_sm was rejected.",
          );

          session.sendSubmitSmResponse({
            sequence_number:
              pdu.sequence_number,

            command_status:
              SMPP_COMMAND_STATUS.ESME_RSYSERR,

            message_id:
              "",
          });

          return;
        }

        const messageId =
          result.publicId ?? "";

        session.sendSubmitSmResponse({
          sequence_number:
            pdu.sequence_number,

          command_status:
            SMPP_COMMAND_STATUS.ESME_ROK,

          message_id:
            messageId,
        });

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

            bindType:
              session.currentBindType,

            sequenceNumber:
              pdu.sequence_number,

            messageId,
          },
          "SMPP submit_sm accepted.",
        );

        return;
      }

      const reassembled =
        reassembly.message;

      if (!reassembled) {
        throw new Error(
          "SMPP reassembler reported a complete message without a reassembled message.",
        );
      }

      const sequenceNumbers =
        reassembled.parts.map(
          (part) =>
            part.sequence_number,
        );

      const acknowledgementSequenceNumbers =
        reassembled.acknowledgementParts.map(
          (part) =>
            part.sequence_number,
        );

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

          referenceNumber:
            reassembled.referenceNumber,

          totalSegments:
            reassembled.totalSegments,

          segmentCount:
            reassembled.parts.length,

          sequenceNumbers,

          acknowledgementSequenceNumbers,

          dataCoding:
            reassembled.pdu.data_coding,
        },
        "SMPP multipart message fully reassembled.",
      );

      /*
       * Exactly ONE API request is made for the entire
       * multipart logical message.
       */
      const result =
        await this.submissions.submit(
          session,
          reassembled.pdu,
        );

      if (!result.accepted) {
        this.logger.error(
          {
            sessionId:
              session.id,

            clientId:
              session.authenticatedClientId,

            accountId:
              session.authenticatedAccountId,

            systemId:
              session.authenticatedSystemId,

            referenceNumber:
              reassembled.referenceNumber,

            totalSegments:
              reassembled.totalSegments,

            sequenceNumbers:
              acknowledgementSequenceNumbers,
          },
          "Reassembled SMPP message was rejected.",
        );

        /*
         * The logical message was rejected.
         *
         * Reject EVERY original submit_sm PDU, including
         * duplicate segments.
         */
        this.sendSubmitSmResponses(
          session,
          reassembled.acknowledgementParts,
          SMPP_COMMAND_STATUS.ESME_RSYSERR,
          "",
        );

        return;
      }

      const messageId =
        result.publicId ?? "";

      /*
       * The API accepted ONE logical message.
       *
       * Acknowledge EVERY original submit_sm PDU, including
       * duplicate segments.
       */
      this.sendSubmitSmResponses(
        session,
        reassembled.acknowledgementParts,
        SMPP_COMMAND_STATUS.ESME_ROK,
        messageId,
      );

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

          bindType:
            session.currentBindType,

          referenceNumber:
            reassembled.referenceNumber,

          totalSegments:
            reassembled.totalSegments,

          sequenceNumbers,

          acknowledgementSequenceNumbers,

          messageId,
        },
        "SMPP multipart message accepted.",
      );
    } catch (error) {
      this.logger.error(
        {
          err: error,

          sessionId:
            session.id,

          clientId:
            session.authenticatedClientId,

          accountId:
            session.authenticatedAccountId,

          systemId:
            session.authenticatedSystemId,

          sequenceNumber:
            pdu.sequence_number,
        },
        "SMPP submit_sm failed.",
      );

      session.sendSubmitSmResponse({
        sequence_number:
          pdu.sequence_number,

        command_status:
          SMPP_COMMAND_STATUS.ESME_RSYSERR,

        message_id:
          "",
      });
    }
  }

  private sendSubmitSmResponses(
    session: SmppSession,
    parts: readonly SmppPdu[],
    commandStatus: number,
    messageId: string,
  ): void {
    for (
      const part of parts
    ) {
      session.sendSubmitSmResponse({
        sequence_number:
          part.sequence_number,

        command_status:
          commandStatus,

        message_id:
          messageId,
      });
    }
  }

  private async handleDeliverSm(
    session: SmppSession,
    pdu: SmppPdu,
  ): Promise<void> {
    if (
      session.currentState !==
      SMPP_SESSION_STATES.BOUND
    ) {
      this.logger.warn(
        {
          sessionId:
            session.id,

          sequenceNumber:
            pdu.sequence_number,
        },
        "deliver_sm rejected because the SMPP session is not bound.",
      );

      session.sendDeliverSmResponse({
        sequence_number:
          pdu.sequence_number,

        command_status:
          SMPP_COMMAND_STATUS.ESME_RINVBNDSTS,
      });

      return;
    }

    if (
      !this.authorization.canDeliverSm(
        session.currentBindType,
      )
    ) {
      this.logger.warn(
        {
          sessionId:
            session.id,

          systemId:
            session.authenticatedSystemId,

          bindType:
            session.currentBindType,

          sequenceNumber:
            pdu.sequence_number,
        },
        "deliver_sm rejected because the bind type does not permit delivery.",
      );

      session.sendDeliverSmResponse({
        sequence_number:
          pdu.sequence_number,

        command_status:
          SMPP_COMMAND_STATUS.ESME_RINVBNDSTS,
      });

      return;
    }

    this.logger.info(
      {
        sessionId:
          session.id,

        accountId:
          session.authenticatedAccountId,

        clientId:
          session.authenticatedClientId,

        systemId:
          session.authenticatedSystemId,

        bindType:
          session.currentBindType,

        sequenceNumber:
          pdu.sequence_number,
      },
      "deliver_sm received; inbound delivery handling is not yet implemented.",
    );

    session.sendDeliverSmResponse({
      sequence_number:
        pdu.sequence_number,

      command_status:
        SMPP_COMMAND_STATUS.ESME_RSYSERR,
    });
  }

  private handleEnquireLink(
    session: SmppSession,
    pdu: SmppPdu,
  ): void {
    session.sendEnquireLinkResponse({
      sequence_number:
        pdu.sequence_number,

      command_status:
        SMPP_COMMAND_STATUS.ESME_ROK,
    });

    this.logger.debug(
      {
        sessionId:
          session.id,

        sequenceNumber:
          pdu.sequence_number,
      },
      "SMPP enquire_link responded.",
    );
  }

  private handleUnbind(
    session: SmppSession,
    pdu: SmppPdu,
  ): void {
    if (
      session.currentState !==
      SMPP_SESSION_STATES.BOUND
    ) {
      session.sendUnbindResponse({
        sequence_number:
          pdu.sequence_number,

        command_status:
          SMPP_COMMAND_STATUS.ESME_RINVBNDSTS,
      });

      this.logger.warn(
        {
          sessionId:
            session.id,

          sequenceNumber:
            pdu.sequence_number,
        },
        "SMPP unbind rejected because the session is not bound.",
      );

      return;
    }

    this.sessionManager.releaseBind(
      session.id,
    );

    session.setUnbound();

    session.sendUnbindResponse({
      sequence_number:
        pdu.sequence_number,

      command_status:
        SMPP_COMMAND_STATUS.ESME_ROK,
    });

    this.logger.info(
      {
        sessionId:
          session.id,

        systemId:
          session.authenticatedSystemId,

        accountId:
          session.authenticatedAccountId,

        clientId:
          session.authenticatedClientId,
      },
      "SMPP unbind processed.",
    );
  }

  private normalizeCommand(
    command: string,
  ): SmppCommand | undefined {
    switch (command) {
      case SMPP_COMMANDS.SUBMIT_SM:
      case SMPP_COMMANDS.DELIVER_SM:
      case SMPP_COMMANDS.ENQUIRE_LINK:
      case SMPP_COMMANDS.UNBIND:
      case SMPP_COMMANDS.BIND_TRANSMITTER:
      case SMPP_COMMANDS.BIND_RECEIVER:
      case SMPP_COMMANDS.BIND_TRANSCEIVER:
        return command;

      default:
        return undefined;
    }
  }
}