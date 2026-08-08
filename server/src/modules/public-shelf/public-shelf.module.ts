import { Module } from '@nestjs/common';

import { PublicShelfController } from './public-shelf.controller';
import { PublicShelfRepository } from './public-shelf.repository';
import { PublicShelfService } from './public-shelf.service';

@Module({
  controllers: [PublicShelfController],
  providers: [PublicShelfService, PublicShelfRepository],
})
export class PublicShelfModule {}
