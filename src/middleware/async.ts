import type { NextFunction, Request, Response } from 'express';

/**
 * Оборачивает async-обработчик так, чтобы отклонённый промис попадал в
 * next(err) и обрабатывался централизованным error-middleware.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
