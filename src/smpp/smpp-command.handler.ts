import { Injectable } from "@nestjs/common";

import {
  getSmppLifecycle,
  Loggers,
} from "@pague-co-uk/sms-gateway-telemetry";

import type {
  SmppPdu,
} from "smpp";

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
  SmppSession,
} from "./smpp.session.js";

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
  private readonly logger = Loggers.smpp;

  private readonly lifecycle =
    getSmppLifecycle();

  constructor(
    private readonly authorization:
      SmppBindAuthorizationService,

    private readonly submissions:
      SmppSubmitService,
  ) { }

  public register(
    session: SmppSession,
  ): void {
    session.raw.on(
      "pdu",
      (pdu: SmppPdu) => {
        void this.handlePdu(
          session,
          pdu,
        );
      },
    );
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
     *
     * Both handlers listen to the same underlying
     * SMPP session, so bind commands must not be
     * dispatched here.
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

        message_id: "",
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

        message_id: "",
      });

      return;
    }

    try {
      const result =
        await this.submissions.submit(
          session,
          pdu,
        );

      if (!result.accepted) {
        session.sendSubmitSmResponse({
          sequence_number:
            pdu.sequence_number,

          command_status:
            SMPP_COMMAND_STATUS.ESME_RSYSERR,

          message_id: "",
        });

        return;
      }

      session.sendSubmitSmResponse({
        sequence_number:
          pdu.sequence_number,

        command_status:
          SMPP_COMMAND_STATUS.ESME_ROK,

        message_id:
          result.publicId ?? "",
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
        },
        "SMPP submit_sm accepted.",
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

        message_id: "",
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

    /*
     * deliver_sm is normally generated by the gateway
     * towards a RECEIVER or TRANSCEIVER ESME.
     *
     * The actual delivery mechanism will be implemented
     * when the message/status pipeline is wired.
     */
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
    session.sendUnbindResponse({
      sequence_number:
        pdu.sequence_number,

      command_status:
        SMPP_COMMAND_STATUS.ESME_ROK,
    });

    session.setUnbound();

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