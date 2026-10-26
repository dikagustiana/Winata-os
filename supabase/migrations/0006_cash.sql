-- 0006_cash.sql
-- Kas 13 minggu dan afkir indikatif (M4).

create index if not exists cash_plan_week_category_idx on cash_plan (week_start, category) where deleted_at is null;
create index if not exists cash_balance_asof_idx on cash_balance (as_of) where deleted_at is null;

alter table cash_plan drop constraint if exists cash_plan_amount_check;
alter table cash_plan add constraint cash_plan_amount_check check (amount_rp >= 0);
alter table cash_balance drop constraint if exists cash_balance_amount_check;
alter table cash_balance add constraint cash_balance_amount_check check (amount_rp >= 0);
