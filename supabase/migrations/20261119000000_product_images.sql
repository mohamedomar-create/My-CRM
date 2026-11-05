-- Product photos live in Storage, not in the database: a product keeps only its photo's path. Each file is the small
-- WebP the browser made from whatever picture was chosen (at most 800 px, a few dozen KB), so the bucket takes nothing
-- else and nothing large. A company's people see and change only the files under their company's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 307200, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "product images: the company's people see them" on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and private.is_member((storage.foldername(name))[1]));
create policy "product images: the company's people add them" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and private.is_member((storage.foldername(name))[1]) and name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(webp|jpg)$');
create policy "product images: the company's people remove them" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and private.is_member((storage.foldername(name))[1]));
