import {
  Module,
} from "@nestjs/common";

import {
  HealthController,
} from "./health.controller.js";

import { ConfigModule } from "../config/config.module.js";
import {
  HealthService,
} from "./health.service.js";

@Module({
  controllers: [
    HealthController,
  ],
  imports: [ConfigModule],
  providers: [
    HealthService,
  ],
})
export class HealthModule { }