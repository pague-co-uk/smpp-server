import {
  Module,
} from "@nestjs/common";

import { ConfigModule } from "./config/config.module.js";
import {
  HealthModule,
} from "./health/health.module.js";
import { SmppModule } from "./smpp/smpp.module.js";

@Module({
  imports: [
    HealthModule, ConfigModule, SmppModule
  ],

  controllers: [],

  providers: [],
})
export class AppModule { }