import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import type {
  QueueClient,
} from "@pague-co-uk/sms-gateway-queue-client";

import {
  getComponentLogger,
  recordException,
  withSpan,
} from "@pague-co-uk/sms-gateway-telemetry";

import {
  AppConfigService,
} from "../config/config.service.js";

import {
  QUEUE_CLIENT,
} from "../queue/constants/queue.constants.js";

import {
  SmppSessionManager,
} from "./smpp.session-manager.js";

export interface ClientDlr {
  messageId: string;
  publicId: string;
  providerMessageId: string;
  status: ClientDlrStatus;
}

export type ClientDlrStatus =
  | "SUCCESS"
  | "FAILED"
  | "UNKNOWN";

@Injectable()
export class SmppDeliveryReceiptConsumer
  implements
    OnModuleInit,
    OnModuleDestroy {
  private readonly logger =
    getComponentLogger(
      SmppDeliveryReceiptConsumer.name,
    );

  private running = false;

  constructor(
    @Inject(QUEUE_CLIENT)
    private readonly queue:
      QueueClient,

    private readonly config:
      AppConfigService,

    private readonly sessions:
      SmppSessionManager,
  ) { }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async onModuleInit(): Promise<void> {
    this.running = true;

    const exchange =
      this.config.routing.clientDlrExchange;

    const queue =
      this.config.routing.clientDlrSmppQueue;

    this.logger.info(
      {
        exchange,
        queue,
      },
      "SMPP delivery receipt consumer starting.",
    );

    try {
      await this.queue.connect();

      this.logger.info(
        {
          exchange,
          queue,

          queueClientState:
            this.queue.currentState,
        },
        "SMPP delivery receipt consumer connected to RabbitMQ.",
      );
    } catch (error) {
      recordException(error);

      this.logger.error(
        {
          exchange,
          queue,

          err:
            error,
        },
        "SMPP delivery receipt consumer failed to connect to RabbitMQ.",
      );

      throw error;
    }

    try {
      await this.queue.bindQueueToExchange(
        queue,
        exchange,
        "",
        {
          durable: true,
        },
      );

      this.logger.info(
        {
          exchange,
          queue,
        },
        "SMPP delivery receipt queue bound to client DLR exchange.",
      );
    } catch (error) {
      recordException(error);

      this.logger.error(
        {
          exchange,
          queue,

          err:
            error,
        },
        "SMPP delivery receipt consumer failed to bind queue to client DLR exchange.",
      );

      throw error;
    }

    try {
      const consumer =
        await this.queue.subscribe<ClientDlr>(
          queue,

          async (dlr) => {
            if (!this.running) {
              throw new Error(
                "SMPP delivery receipt consumer is shutting down.",
              );
            }

            await this.handleDeliveryReceipt(
              dlr,
            );
          },
        );

      this.logger.info(
        {
          exchange,
          queue,

          consumerTag:
            consumer.consumerTag,
        },
        "SMPP delivery receipt consumer started successfully.",
      );
    } catch (error) {
      recordException(error);

      this.logger.error(
        {
          exchange,
          queue,

          err:
            error,
        },
        "SMPP delivery receipt consumer failed to subscribe.",
      );

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;

    this.logger.info(
      {
        exchange:
          this.config.routing
            .clientDlrExchange,

        queue:
          this.config.routing
            .clientDlrSmppQueue,
      },
      "SMPP delivery receipt consumer stopped.",
    );
  }

  // ===========================================================================
  // Delivery receipt
  // ===========================================================================

  private async handleDeliveryReceipt(
    dlr: ClientDlr,
  ): Promise<void> {
    await withSpan(
      "SmppDeliveryReceiptConsumer.handleDeliveryReceipt",
      async (span) => {
        span.setAttributes({
          "message.id":
            dlr.messageId,

          "message.public_id":
            dlr.publicId,

          "message.provider_message_id":
            dlr.providerMessageId,

          "delivery.status":
            dlr.status,

          "messaging.destination":
            this.config.routing
              .clientDlrSmppQueue,

          "messaging.exchange":
            this.config.routing
              .clientDlrExchange,
        });

        this.logger.info(
          {
            messageId:
              dlr.messageId,

            publicId:
              dlr.publicId,

            providerMessageId:
              dlr.providerMessageId,

            status:
              dlr.status,

            queue:
              this.config.routing
                .clientDlrSmppQueue,

            exchange:
              this.config.routing
                .clientDlrExchange,
          },
          "Client delivery receipt received.",
        );

        /*
         * Snapshot the active SMPP sessions before attempting
         * correlation. This lets us see whether the originating
         * client is still connected at the moment the DLR arrives.
         */
        this.logger.info(
          {
            messageId:
              dlr.messageId,

            publicId:
              dlr.publicId,

            providerMessageId:
              dlr.providerMessageId,

            status:
              dlr.status,

            activeSessionCount:
              this.sessions.values().length,

            activeSessions:
              this.sessions.getActiveSessionDiagnostics(),
          },
          "Active SMPP sessions during delivery receipt lookup.",
        );

        try {
          const sent =
            await this.sessions.sendDeliveryReceipt(
              dlr,
            );

          if (!sent) {
            this.logger.warn(
              {
                messageId:
                  dlr.messageId,

                publicId:
                  dlr.publicId,

                providerMessageId:
                  dlr.providerMessageId,

                status:
                  dlr.status,
              },
              "Client delivery receipt could not be associated with an active SMPP session.",
            );

            return;
          }

          this.logger.info(
            {
              messageId:
                dlr.messageId,

              publicId:
                dlr.publicId,

              providerMessageId:
                dlr.providerMessageId,

              status:
                dlr.status,
            },
            "Client delivery receipt sent to SMPP session.",
          );
        } catch (error) {
          recordException(error);

          this.logger.error(
            {
              messageId:
                dlr.messageId,

              publicId:
                dlr.publicId,

              providerMessageId:
                dlr.providerMessageId,

              status:
                dlr.status,

              err:
                error,
            },
            "Failed to send client delivery receipt to SMPP session.",
          );

          throw error;
        }
      },
    );
  }
}