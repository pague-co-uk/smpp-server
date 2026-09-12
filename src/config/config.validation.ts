import Joi from "joi";

export const configValidationSchema =
  Joi.object({
    // =========================================================================
    // Application
    // =========================================================================

    NODE_ENV:
      Joi.string()
        .valid(
          "development",
          "test",
          "production",
        )
        .default("development"),

    APP_NAME:
      Joi.string()
        .default("smpp-server"),

    APP_VERSION:
      Joi.string()
        .default("1.0.0"),

    APP_HOST:
      Joi.string()
        .default("0.0.0.0"),

    APP_PORT:
      Joi.number()
        .integer()
        .min(1)
        .max(65535)
        .default(9005),

    // =========================================================================
    // API
    // =========================================================================

    API_PREFIX:
      Joi.string()
        .default(""),

    CONTROL_PLANE_API_BASE_URL:
      Joi.string()
        .uri({
          scheme: [
            "http",
            "https",
          ],
        })
        .custom(
          (value: string) =>
            value.replace(
              /\/+$/,
              "",
            ),
        )
        .required(),

    MESSAGING_API_KEY:
      Joi.string()
        .trim()
        .min(1)
        .required(),

    // =========================================================================
    // SMPP
    // =========================================================================

    SMPP_HOST:
      Joi.string()
        .default("0.0.0.0"),

    SMPP_PORT:
      Joi.number()
        .integer()
        .min(1)
        .max(65535)
        .default(2775),

    SMPP_MAX_SESSIONS:
      Joi.number()
        .integer()
        .min(1)
        .default(1000),

    SMPP_ENQUIRE_LINK_INTERVAL_MS:
      Joi.number()
        .integer()
        .min(1000)
        .default(30000),

    SMPP_SESSION_TIMEOUT_MS:
      Joi.number()
        .integer()
        .min(1000)
        .default(60000),

    // =========================================================================
    // Logging
    // =========================================================================

    LOG_LEVEL:
      Joi.string()
        .valid(
          "trace",
          "debug",
          "info",
          "warn",
          "error",
          "fatal",
        )
        .default("info"),

    LOG_STDOUT:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(true),

    LOG_FILE_ENABLED:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(false),

    LOG_FILE_PATH:
      Joi.string()
        .default(
          "/var/log/pague/smpp-server/application.log",
        ),

    // =========================================================================
    // OpenTelemetry
    // =========================================================================

    OTEL_ENABLED:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(false),

    OTEL_SERVICE_NAME:
      Joi.string()
        .default("smpp-server"),

    OTEL_SERVICE_VERSION:
      Joi.string()
        .default("1.0.0"),

    OTEL_TRACES_ENDPOINT:
      Joi.string()
        .allow("")
        .default(""),

    OTEL_METRICS_ENDPOINT:
      Joi.string()
        .allow("")
        .default(""),

    OTEL_LOGS_ENDPOINT:
      Joi.string()
        .allow("")
        .default(""),

    OTEL_EXPORT_INTERVAL_MILLIS:
      Joi.number()
        .integer()
        .min(100)
        .default(10000),

    OTEL_DISABLE_FS_INSTRUMENTATION:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(false),
  });