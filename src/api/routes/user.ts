import type { Request, Response } from 'express'
import { Router } from 'express'
import { getUserId } from '../../middleware/auth'
import { getUser } from '../../services/user-service'

const router = Router()

router.get('/me', async (req: Request, res: Response) => {
  const userId = getUserId(req)
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })
  
  const user = await getUser(userId)
  if (!user) return res.status(404).json({ error: 'User not found' })
  
  res.json(user)
})

export default router