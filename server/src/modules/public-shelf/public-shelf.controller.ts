import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import { Body, Controller, Get, Headers, NotFoundException, Param, ParseIntPipe, Put, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { imageContentTypeFromPath } from '../../common/image-content-type';
import type { RequestUser } from '../../common/types/request-user';
import { UpdatePublicShelfDto } from './dto/update-public-shelf.dto';
import { PublicShelfService } from './public-shelf.service';

@Controller('public-shelf')
export class PublicShelfController {
  constructor(private readonly service: PublicShelfService) {}

  @Get('me')
  getMyShelf(@CurrentUser() user: RequestUser) {
    return this.service.getMyShelf(user.id);
  }

  @Put('me')
  async updateMyShelf(@CurrentUser() user: RequestUser, @Body() dto: UpdatePublicShelfDto) {
    await this.service.updateMyShelf(user.id, dto.bookIds);
  }

  @Get(':userId')
  @Public()
  getPublicShelf(@Param('userId', ParseIntPipe) userId: number) {
    return this.service.getPublicShelf(userId);
  }

  @Get(':userId/cover/:bookId')
  @Public()
  async getPublicCover(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('bookId', ParseIntPipe) bookId: number,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const coverPath = await this.service.getPublicCoverPath(userId, bookId);
    if (!coverPath) throw new NotFoundException(`No cover for book ${bookId}`);

    const { mtimeMs } = await stat(coverPath);
    const etag = `"${Math.floor(mtimeMs)}"`;
    const cacheControl = 'public, max-age=31536000, immutable';

    if (ifNoneMatch === etag) {
      reply.status(304).header('Cache-Control', cacheControl).header('ETag', etag).send();
      return;
    }

    reply.header('Cache-Control', cacheControl);
    reply.header('ETag', etag);
    reply.type(imageContentTypeFromPath(coverPath));
    reply.send(createReadStream(coverPath));
  }
}
