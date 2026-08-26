import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { gameSlugSchema, submitPlaySchema, type SubmitPlayDto } from '@bobs-momo/shared';
import { Public } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { GameService } from './game.service';

// The only part of the system an anonymous browser can reach. No JwtAuthGuard,
// so nothing behind these three handlers may read req.user or req.scope.
@Controller('public')
export class PublicCrmController {
  constructor(private readonly games: GameService) {}

  @Get('game/:slug/config')
  @Public()
  config(@Param('slug', new ZodValidationPipe(gameSlugSchema)) slug: string, @Req() req: Request) {
    return this.games.publicConfig(slug, clientIp(req));
  }

  @Post('game/:slug/session')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  session(@Param('slug', new ZodValidationPipe(gameSlugSchema)) slug: string, @Req() req: Request) {
    return this.games.startSession(slug, clientIp(req));
  }

  @Post('game/:slug/play')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  play(
    @Param('slug', new ZodValidationPipe(gameSlugSchema)) slug: string,
    @Body(new ZodValidationPipe(submitPlaySchema)) dto: SubmitPlayDto,
    @Req() req: Request,
  ) {
    return this.games.submitPlay(slug, dto, clientIp(req));
  }
}

/** Only ever hashed or used as a rate limit key, never stored as it stands. */
function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
