// Public settings of the hosted backend (Supabase project "my-crm0"). These two values are meant to be public:
// they ship in every browser bundle, and row-level security plus the database guards decide what each user can do.
// Never put a secret (such as the service-role key) here or in any file in this repository.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://npnhoywlxidojqoijqdu.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || 'sb_publishable_BM6fBe4oxyfHRf3EcGbyMQ_w0Np8jNX'
