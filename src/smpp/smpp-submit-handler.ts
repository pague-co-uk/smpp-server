import {
  Injectable,
} from "@nestjs/common";

import {
  instrumentPdu,
  Loggers,
} from "@pague-co-uk/sms-gateway-telemetry";

import type {
  SmppPdu,
} from "smpp";

import {
  SmppSubmitService,
} from "./smpp-submit.service.js";

import { toTelemetrySmppSessionState } from "src/utils/smpp-session-state.util.js";
import {
  SmppSession,
} from "./smpp.session.js";

const SMPP_COMMAND_STATUS = {
  ESME_ROK: 0x00000000,
  ESME_RINVBNDSTS: 0x00000004,
  ESME_RSYSERR: 0x00000008,
} as const;

@Injectable()
export class SmppSubmitHandler {
  private readonly logger = Loggers.smpp;

  constructor(
    private readonly submit:
      SmppSubmitService,
  ) { }

  public register(
    session: SmppSession,
  ): void {
    session.raw.on(
      "submit_sm",
      (pdu: SmppPdu) => {
        void this.handleSubmit(
          session,
          pdu,
        );
      },
    );
  }

  private async handleSubmit(
    session: SmppSession,
    pdu: SmppPdu,
  ): Promise<void> {
    if (
      session.currentState !==
      "BOUND"
    ) {
      session.raw.submit_sm_resp({
        sequence_number:
          pdu.sequence_number,

        command_status:
          SMPP_COMMAND_STATUS.ESME_RINVBNDSTS,

        message_id: "",
      });

      this.logger.warn(
        {
          sessionId:
            session.id,

          sequenceNumber:
            pdu.sequence_number,
        },
        "SMPP submit_sm rejected: session is not bound.",
      );

      return;
    }

    await instrumentPdu(
      {
        session: {
          sessionId:
            session.id,

          systemId:
            session.systemIdentifier,
          state: toTelemetrySmppSessionState(session.currentState)
        },

        pdu: {
          command: "submit_sm",

          sequenceNumber:
            pdu.sequence_number,
        },
      },
      async () => {
        try {
          const result =
            await this.submit.submit(
              session,
              pdu,
            );

          if (!result.accepted) {
            session.raw.submit_sm_resp({
              sequence_number:
                pdu.sequence_number,

              command_status:
                SMPP_COMMAND_STATUS.ESME_RSYSERR,

              message_id: "",
            });

            this.logger.warn(
              {
                sessionId:
                  session.id,

                sequenceNumber:
                  pdu.sequence_number,
              },
              "SMPP submit_sm rejected.",
            );

            return;
          }

          session.raw.submit_sm_resp({
            sequence_number:
              pdu.sequence_number,

            command_status:
              SMPP_COMMAND_STATUS.ESME_ROK,

            message_id:
              result.publicId ??
              result.messageId ??
              "",
          });

          this.logger.info(
            {
              sessionId:
                session.id,

              sequenceNumber:
                pdu.sequence_number,

              messageId:
                result.messageId,

              publicId:
                result.publicId,
            },
            "SMPP submit_sm accepted.",
          );
        } catch (error) {
          session.raw.submit_sm_resp({
            sequence_number:
              pdu.sequence_number,

            command_status:
              SMPP_COMMAND_STATUS.ESME_RSYSERR,

            message_id: "",
          });

          this.logger.error(
            {
              err: error,

              sessionId:
                session.id,

              sequenceNumber:
                pdu.sequence_number,
            },
            "SMPP submit_sm failed unexpectedly.",
          );

          throw error;
        }
      },
    );
  }
}