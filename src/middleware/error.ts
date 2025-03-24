import { NextFunction, Request, Response } from 'express'

export const handleError = (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal Server Error' })
}