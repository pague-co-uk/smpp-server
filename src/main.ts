import "dotenv/config";

import {
  getLogger,
  initTelemetry,
  shutdownTelemetry,
  TelemetryLogger,
} from "@pague-co-uk/sms-gateway-telemetry";

import configuration from "./config/configuration.js";
import { SmppServer } from "./smpp/smpp.server.js";

async function bootstrap(): Promise<void> {
  const config =
    configuration();

  // =========================================================================
  // Telemetry MUST be initialized before Nest creates providers.
  // =========================================================================

  initTelemetry({
    enabled:
      config.telemetry.enabled,

    registerShutdownHooks:
      false,

    service: {
      name:
        config.telemetry.serviceName,

      version:
        config.telemetry.serviceVersion,
    },

    collector: {
      tracesEndpoint:
        config.telemetry.tracesEndpoint,

      metricsEndpoint:
        config.telemetry.metricsEndpoint,

      logsEndpoint:
        config.telemetry.logsEndpoint,
    },

    metrics: {
      exportIntervalMillis:
        config.telemetry
          .exportIntervalMillis,
    },

    logger: {
      level:
        config.log.level,

      transport: {
        stdout:
          config.log.stdout,

        file:
          config.log.file,
      },
    },

    instrumentations: {
      disableFs:
        config.telemetry
          .disableFsInstrumentation,
    },
  });

  const logger =
    getLogger();

  // =========================================================================
  // Nest
  // =========================================================================

  const [
    { NestFactory },
    { AppModule },
  ] = await Promise.all([
    import("@nestjs/core"),
    import("./app.module.js"),
  ]);

  const app =
    await NestFactory.create(
      AppModule,
    );

  app.useLogger(
    new TelemetryLogger(),
  );

  await app.listen(
    config.app.port,
    config.app.host,
  );

  const smppServer =
    app.get(SmppServer);

  smppServer.start();

  logger.info(
    {
      service:
        config.app.name,

      version:
        config.app.version,

      environment:
        config.app.environment,

      host:
        config.app.host,

      port:
        config.app.port,

      healthEndpoint:
        "/health",

      smppHost:
        config.smpp.host,

      smppPort:
        config.smpp.port,
    },
    "SMPP server started successfully.",
  );

  // =========================================================================
  // Shutdown
  // =========================================================================

  const shutdown =
    async (
      signal: string,
    ): Promise<void> => {
      logger.info(
        {
          signal,
        },
        "Shutting down SMPP server.",
      );

      try {
        // Stop accepting new SMPP connections and
        // close existing SMPP sessions first.
        await smppServer.stop();

        // Then shut down the Nest application.
        await app.close();

        // Finally shut down telemetry exporters.
        await shutdownTelemetry();

        process.exit(0);
      } catch (error) {
        logger.error(
          {
            err:
              error,
          },
          "Failed during graceful shutdown.",
        );

        await shutdownTelemetry();

        process.exit(1);
      }
    };

  process.once(
    "SIGINT",
    () => {
      void shutdown(
        "SIGINT",
      );
    },
  );

  process.once(
    "SIGTERM",
    () => {
      void shutdown(
        "SIGTERM",
      );
    },
  );
}

void bootstrap();