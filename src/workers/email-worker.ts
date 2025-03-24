import { Worker } from 'bullmq'
import { sendEmail } from '../utils'

const processEmailJob = async ({ data }: { data: { userId: string, email: string } }): Promise<void> => {
    await sendEmail(data.email, 'Welcome!', 'Thanks for joining!')
    console.log(`Sent welcome email to ${data.email} (user: ${data.userId})`)
  }
  
  const worker = new Worker('email', processEmailJob, {
    connection: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  })
  
  worker.on('completed', job => console.log(`Email job ${job.id} completed`))
  worker.on('failed', (job, err) => console.error(`Email job ${job?.id} failed: ${err.message}`))
  
  export default worker