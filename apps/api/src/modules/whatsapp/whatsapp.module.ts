import { Module, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Request, Response } from 'express';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappRawBodyMiddleware } from './whatsapp-raw-body.middleware';
import { MetaCloudWhatsAppService, NullWhatsAppService } from './whatsapp.provider';
import { WhatsappService } from './whatsapp.service';
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from './whatsapp.types';

interface ExpressStack {
  stack: unknown[];
}

interface ExpressAppLike {
  use(handler: (req: Request, res: Response, next: () => void) => void): void;
  router?: ExpressStack;
  _router?: ExpressStack;
}

@Module({
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    WhatsappRawBodyMiddleware,
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: (): WhatsAppProvider =>
        // Read straight from the environment: the enabled and disabled paths
        // must be the same code path everywhere downstream, so this is the only
        // place in the codebase that looks at the flag.
        process.env['WHATSAPP_ENABLED'] === 'true'
          ? new MetaCloudWhatsAppService()
          : new NullWhatsAppService(),
    },
  ],
  exports: [WhatsappService, WHATSAPP_PROVIDER],
})
export class WhatsappModule implements OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly rawBody: WhatsappRawBodyMiddleware,
  ) {}

  // NestFactory registers the JSON body parser before any module middleware, so
  // a middleware bound through MiddlewareConsumer always finds a drained stream
  // and can never see the bytes Meta signed. Binding it here and moving it to
  // the front of the Express stack is what puts it ahead of the parser. It
  // filters on the webhook path itself, so every other route is untouched.
  onModuleInit(): void {
    const adapter = this.adapterHost.httpAdapter as { getInstance?<T>(): T } | undefined;
    const app = adapter?.getInstance?.<ExpressAppLike>();
    if (!app || typeof app.use !== 'function') return;

    const stack = (app.router ?? app._router)?.stack;
    const before = stack?.length ?? -1;

    app.use((req, res, next) => {
      this.rawBody.use(req, res, next);
    });

    // Only reorder if `use` appended exactly the one layer just added.
    // Anything else means a different Express internal shape, and the
    // controller's parsed-body fallback covers that.
    if (!stack || stack.length !== before + 1) return;
    const mine = stack.pop();
    if (mine) stack.unshift(mine);
  }
}
