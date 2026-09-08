import { Module } from "@nestjs/common";

import { ConfigModule } from "../config/config.module.js";
import { DatabaseModule } from "../database/database.module.js";

import { SmppAccountRepository } from "../smpp-accounts/smpp-account.repository.js";

import { SecretHasher } from "../security/secret-hasher.service.js";
import { SmppAuthenticationService } from "./smpp-authentication.service.js";
import { SmppBindHandler } from "./smpp-bind.handler.js";
import { SmppServer } from "./smpp.server.js";
import { SmppSessionManager } from "./smpp.session-manager.js";
import { SmppIpAllowlistService } from "./validation/smpp-ip-allowlist.service.js";


@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
  ],

  providers: [
    SecretHasher,
    SmppAccountRepository,
    SmppIpAllowlistService,
    SmppAuthenticationService,
    SmppBindHandler,
    SmppSessionManager,
    SmppServer,
  ],

  exports: [
    SmppServer,
    SmppSessionManager,
  ],
})
export class SmppModule { }