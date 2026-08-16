import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AuthService } from './auth.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  public constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('anonymous')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建或恢复匿名会话' })
  @ApiCreatedResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeAuthAnonymous' } })
  public createAnonymous(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.authService.createAnonymous(request, reply);
  }

  @Get('session')
  @ApiOperation({ summary: '读取当前会话' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeAuthSession' } })
  public getSession(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.authService.getSession(request, reply);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '撤销当前会话' })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/SuccessEnvelopeAuthLogout' } })
  public logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.authService.logout(request, reply);
  }
}
