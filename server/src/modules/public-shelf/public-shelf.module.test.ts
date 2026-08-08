import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { PublicShelfController } from './public-shelf.controller';
import { PublicShelfModule } from './public-shelf.module';
import { PublicShelfRepository } from './public-shelf.repository';
import { PublicShelfService } from './public-shelf.service';

describe('PublicShelfModule', () => {
  it('registers the controller with cohesive providers', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PublicShelfModule)).toEqual([PublicShelfController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PublicShelfModule)).toEqual([PublicShelfService, PublicShelfRepository]);
  });
});
