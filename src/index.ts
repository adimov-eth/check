import { startServer } from './api'
import { initSchema } from './database/schema'

initSchema()
startServer(Number(process.env.PORT ?? 3000))