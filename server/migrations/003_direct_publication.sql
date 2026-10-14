begin;
-- Existing databases: direct publication without manual review.
alter table public.templates alter column publication_status set default 'published';
drop policy if exists "Submit own template for review" on public.templates;
drop policy if exists "Publish own template" on public.templates;
create policy "Publish own template" on public.templates for insert to authenticated with check (auth.uid() = author_id and publication_status = 'published');
-- Publish previous pending submissions through the existing privacy validation trigger.
update public.templates set publication_status = 'published' where publication_status = 'pending';
commit;
