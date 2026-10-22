export interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
}
export const WAGERING = Symbol('WAGERING');
export const QUERIES = Symbol('QUERIES');
export const READY = Symbol('READY');
