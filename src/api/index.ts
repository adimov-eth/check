import crypto from 'crypto'
import type { Request, Response } from 'express'


import express from 'express'
import { requireAuth } from '../middleware/auth'
import { handleError } from '../middleware/error'
import { deleteUser, upsertUser } from '../services/user-service'
import userRoutes from './routes/user'



const verifyWebhook = (req: Request): boolean => {
    const payload = JSON.stringify(req.body)
    const signature = req.headers['svix-signature'] as string
    const timestamp = req.headers['svix-timestamp'] as string
    const secret = process.env.CLERK_WEBHOOK_SECRET?.split('_')[1] ?? ''
    
    const computedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex')
    
    return computedSignature === signature
  }

const app = express()

app.use(express.json())
app.use((req, res, next) => {
  // Capture raw body for webhook verification
  let data = ''
  req.on('data', chunk => { data += chunk })
  req.on('end', () => {
    req.rawBody = data
    next()
  })
})

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.use('/users', requireAuth, userRoutes)

app.post('/webhooks/clerk', async (req: Request, res: Response) => {
  if (!verifyWebhook(req)) return res.status(400).json({ error: 'Invalid signature' })
  
  const event = req.body
  switch (event.type) {
    case 'user.created':
    case 'user.updated':
      await upsertUser({
        id: event.data.id,
        email: event.data.email_addresses[0].email_address,
        name: event.data.first_name,
      })
      break
    case 'user.deleted':
      await deleteUser(event.data.id)
      break
    default:
      console.log(`Unhandled event: ${event.type}`)
  }
  res.json({ success: true })
})

app.use(handleError)

export const startServer = (port: number): void => {
  app.listen(port, () => console.log(`Server running on port ${port}`))
}

