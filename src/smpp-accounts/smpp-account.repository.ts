import {
  Inject,
  Injectable,
} from "@nestjs/common";

import {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { DATABASE } from "../database/database.constants.js";
import { DatabaseRepository } from "../database/database.repository.js";

@Injectable()
export class SmppAccountRepository
  extends DatabaseRepository {

  constructor(
    @Inject(DATABASE)
    db:
      | PrismaClient
      | Prisma.TransactionClient,
  ) {
    super(db);
  }

  public async findForAuthentication(
    systemId: string,
  ) {
    return this.db.smppAccount.findUnique({
      where: {
        systemId,
      },

      select: {
        id: true,
        publicId: true,
        clientId: true,
        systemId: true,
        passwordHash: true,
        status: true,
        maxConcurrentBinds: true,
        enquireLinkInterval: true,

        ipAllowlist: {
          select: {
            ipAddress: true,
          },

          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });
  }
}