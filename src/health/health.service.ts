import {
  Injectable,
} from "@nestjs/common";

import {
  AppConfigService,
} from "../config/config.service.js";

@Injectable()
export class HealthService {
  constructor(
    private readonly config:
      AppConfigService,
  ) { }

  public check() {
    const start =
      performance.now();

    const latency =
      Math.round(
        performance.now() - start,
      );

    return {
      status: "healthy",

      service:
        this.config.app.name,

      version:
        this.config.app.version,

      environment:
        this.config.app.environment,

      uptime:
        Math.round(
          process.uptime(),
        ),

      timestamp:
        new Date().toISOString(),

      latency,
    };
  }
}