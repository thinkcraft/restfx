export interface Route {
  readonly method: string;
  readonly path: string;
  readonly specificity: number;
  readonly resource: object;
  readonly handler: Function;
  readonly middlewares: readonly RouteMiddleware[];
}

export interface RouteMiddleware {
  readonly resource: object;
  readonly handler: Function;
}
