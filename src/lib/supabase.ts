import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config'
import { routeRecoveryLink } from './recoveryLink'

// before the client reads the address: a password-reset link always opens the new-password page
routeRecoveryLink()

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
