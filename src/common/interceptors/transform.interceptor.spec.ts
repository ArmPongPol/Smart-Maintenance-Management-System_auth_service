import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { ResponseMessage } from '../decorators/response-message.decorator';
import { SkipTransform } from '../decorators/skip-transform.decorator';
import { StandardResponse } from '../interfaces/standard-response.interface';
import { TransformInterceptor } from './transform.interceptor';

class TestController {
  plain(this: void) {}

  @ResponseMessage('User created')
  withMessage(this: void) {}

  @SkipTransform()
  skipped(this: void) {}
}

@SkipTransform()
class SkippedController {
  handler(this: void) {}
}

type Handler = () => void;

const createContext = ({
  handler = TestController.prototype.plain,
  controller = TestController,
  type = 'http',
  statusCode = 200,
}: {
  handler?: Handler;
  controller?: new () => unknown;
  type?: string;
  statusCode?: number;
} = {}) =>
  ({
    getType: () => type,
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getResponse: () => ({ statusCode }),
    }),
  }) as unknown as ExecutionContext;

const handlerOf = <T>(data: T): CallHandler<T> => ({ handle: () => of(data) });

describe('TransformInterceptor', () => {
  let interceptor: TransformInterceptor<unknown>;

  const run = (context: ExecutionContext, data: unknown) =>
    firstValueFrom(interceptor.intercept(context, handlerOf(data)));

  beforeEach(() => {
    interceptor = new TransformInterceptor(new Reflector());
  });

  it('wraps data in the standard envelope', async () => {
    const result = await run(createContext({ statusCode: 201 }), { id: 1 });

    expect(result).toEqual({
      status: 201,
      message: 'Success',
      data: { id: 1 },
    });
  });

  it('uses the message from @ResponseMessage', async () => {
    const result = (await run(
      createContext({ handler: TestController.prototype.withMessage }),
      { id: 1 },
    )) as StandardResponse<unknown>;

    expect(result.message).toBe('User created');
  });

  it('returns raw data when the handler has @SkipTransform', async () => {
    const result = await run(
      createContext({ handler: TestController.prototype.skipped }),
      { id: 1 },
    );

    expect(result).toEqual({ id: 1 });
  });

  it('returns raw data when the controller has @SkipTransform', async () => {
    const result = await run(
      createContext({
        handler: SkippedController.prototype.handler,
        controller: SkippedController,
      }),
      { id: 1 },
    );

    expect(result).toEqual({ id: 1 });
  });

  it('returns raw data for non-http contexts', async () => {
    const result = await run(createContext({ type: 'rpc' }), { id: 1 });

    expect(result).toEqual({ id: 1 });
  });

  it('maps undefined data to null', async () => {
    const result = (await run(
      createContext(),
      undefined,
    )) as StandardResponse<unknown>;

    expect(result.data).toBeNull();
  });

  it('passes StreamableFile through untouched', async () => {
    const file = new StreamableFile(Buffer.from('file'));

    const result = await run(createContext(), file);

    expect(result).toBe(file);
  });
});
