-- Preserve small observed provider fees without rounding them to six decimals.
-- Observed usage remains revisable; this does not finalize a budget settlement.
begin;
alter table public.collection_jobs alter column observed_cost_usd type numeric(24,12);
commit;
