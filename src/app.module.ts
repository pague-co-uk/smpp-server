import {
  Module,
} from "@nestjs/common";

import { ConfigModule } from "./config/config.module.js";
import {
  HealthModule,
} from "./health/health.module.js";
import { SmppModule } from "./smpp/smpp.module.js";
import { QueueModule } from "./queue/queue.module.js";

@Module({
  imports: [
    HealthModule, ConfigModule, SmppModule, QueueModule
  ],

  controllers: [],

  providers: [],
})
export class AppModule { }