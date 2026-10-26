-- 0005_outlook.sql
-- Index dan integritas outlook (M3). Tabel projection_daily dibuat di 0001.

create index if not exists projection_daily_flock_idx on projection_daily (flock_id, date);
create index if not exists projection_daily_house_date_idx on projection_daily (house_id, date);
create index if not exists sales_plan_customer_date_idx on sales_plan (customer_id, date) where deleted_at is null;
create index if not exists market_price_date_idx on market_price (date) where deleted_at is null;

alter table projection_daily drop constraint if exists projection_daily_kg_check;
alter table projection_daily add constraint projection_daily_kg_check check (kg_proj >= 0);
alter table projection_daily drop constraint if exists projection_daily_factor_check;
alter table projection_daily add constraint projection_daily_factor_check check (
  calibration_factor is null or (calibration_factor >= 0 and calibration_factor <= 5)
);

alter table hdp_standard drop constraint if exists hdp_standard_source_check;
alter table hdp_standard add constraint hdp_standard_source_check check (length(source) > 0);
