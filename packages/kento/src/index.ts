export { Application, compose } from '@kento/core'
export { Router } from '@kento/router'
export { cors } from '@kento/cors'
export { bodyParser } from '@kento/bodyparser'
export { helmet } from '@kento/helmet'
export { compress } from '@kento/compress'
export { rateLimit } from '@kento/ratelimit'
export { createLogger, Logger, loggerMiddleware } from '@kento/logger'
export { BunRuntimeApp, createBunRuntime, listen as listenBun } from '@kento/runtime-bun'
export { NodeRuntime, createNodeRuntime, listen as listenNode } from '@kento/runtime-node'

export type {
  KentoOptions,
  KentoPlatform,
  KentoContext,
  KentoRequest,
  KentoResponse,
  Middleware,
  Next,
  DefaultState,
  DefaultContext,
  ParameterizedContext,
  Runtime,
  ServerHandle,
  ListenOptions,
} from '@kento/core'
export type {
  RouterOptions,
  LayerOptions,
  RouterMiddleware,
  RouterParameterMiddleware,
  RouterContext,
} from '@kento/router'
export type { CorsOptions } from '@kento/cors'
export type { BodyParserOptions } from '@kento/bodyparser'
export type { CompressOptions } from '@kento/compress'
export type { RateLimitOptions } from '@kento/ratelimit'
export type { LoggerOptions, LoggerMiddlewareOptions, LevelName } from '@kento/logger'
export type {
  BunListenOptions,
  BunRuntimeListenOptions,
  BunRuntimePlatform,
  BunRuntimeServerHandle,
} from '@kento/runtime-bun'
export type {
  NodeListenOptions,
  NodeRuntimeOptions,
  NodeRuntimePlatform,
  NodeRuntimeServerHandle,
} from '@kento/runtime-node'

import { Application } from '@kento/core'
import type { Runtime, ListenOptions, ServerHandle } from '@kento/core'
import { Router } from '@kento/router'
import { cors } from '@kento/cors'
import { bodyParser } from '@kento/bodyparser'
import { helmet } from '@kento/helmet'
import { compress } from '@kento/compress'
import { rateLimit } from '@kento/ratelimit'
import { createLogger, Logger, loggerMiddleware } from '@kento/logger'
import { BunRuntimeApp, createBunRuntime, listen as listenBun } from '@kento/runtime-bun'
import { NodeRuntime, createNodeRuntime, listen as listenNode } from '@kento/runtime-node'

// Register the built-in runtime adapters
Application._runtimeRegistry = async (
  runtime: Runtime,
  app: Application,
  options: ListenOptions
): Promise<ServerHandle> => {
  if (runtime === 'bun') {
    return listenBun(app, {
      port: options.port,
      hostname: options.hostname,
    }) as unknown as ServerHandle
  }
  // default: node
  return listenNode(app, {
    port: options.port,
    hostname: options.hostname,
    trustProxy: options.trustProxy,
  })
}

export default class Kento extends Application {
  static Router = Router
  static cors = cors
  static bodyParser = bodyParser
  static helmet = helmet
  static compress = compress
  static rateLimit = rateLimit
  static createLogger = createLogger
  static Logger = Logger
  static loggerMiddleware = loggerMiddleware
  static BunRuntimeApp = BunRuntimeApp
  static NodeRuntime = NodeRuntime
  static createBunRuntime = createBunRuntime
  static createNodeRuntime = createNodeRuntime
  static listenBun = listenBun
  static listenNode = listenNode
}
