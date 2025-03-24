import { Queue } from 'bullmq'

interface EmailJobData {
  userId: string
  email: string
}

export const emailQueue = new Queue<EmailJobData>('email', {
  connection: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
})