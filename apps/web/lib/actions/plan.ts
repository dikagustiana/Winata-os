"use server";

import { D, addDays, defaultForecast } from "@winata/engine";
import { todayJakarta } from "@winata/db";
import type { AppRole } from "@winata/db";
import { actionContext, done, fail, isActionState, isoDate, moneyString, optionalText, refresh, text } from "./common";
import { parseIdNumber } from "@/lib/format";
import type { ActionState } from "@/lib/action-types";

const PLAN_ROLES: AppRole[] = ["marketing", "accounting", "admin"];

export async function saveSalesPlanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(PLAN_ROLES);
    if (isActionState(ctx)) return ctx;
    const customerId = text(form, "customer_id");
    const gradeId = text(form, "grade_id");
    const date = isoDate(form, "date", "Tanggal")!;
    const kind = text(form, "kind") === "order" ? "order" : "forecast";
    if (!customerId || !gradeId) return { error: "Pelanggan dan grade wajib diisi." };
    const kgParsed = parseIdNumber(text(form, "kg"));
    if (!kgParsed.ok || kgParsed.value.lessThan(0)) return { error: kgParsed.ok ? "Kg tidak boleh negatif." : kgParsed.error };
    const price = moneyString(form, "price_per_kg", "Harga per kg", false);

    const existing = await ctx.client
      .from("sales_plan")
      .select("id")
      .eq("customer_id", customerId)
      .eq("date", date)
      .eq("grade_id", gradeId)
      .eq("kind", kind)
      .is("deleted_at", null)
      .maybeSingle();
    const payload = {
      customer_id: customerId,
      date,
      grade_id: gradeId,
      kg: kgParsed.value.toFixed(3),
      price_per_kg: price,
      kind,
      note: optionalText(form, "note"),
      updated_at: new Date().toISOString(),
    };
    const { error } = existing.data
      ? await ctx.client.from("sales_plan").update(payload).eq("id", existing.data.id)
      : await ctx.client.from("sales_plan").insert({ ...payload, created_by: ctx.viewer.id });
    if (error) return { error: error.message };
    refresh(["/rencana", "/outlook", "/"]);
    return done(`${kind === "order" ? "Order" : "Forecast"} tersimpan.`);
  } catch (error) {
    return fail(error);
  }
}

export async function deleteSalesPlanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(PLAN_ROLES);
    if (isActionState(ctx)) return ctx;
    const id = text(form, "plan_id");
    const { error } = await ctx.client.from("sales_plan").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) return { error: error.message };
    refresh(["/rencana", "/outlook"]);
    return done("Rencana dibatalkan.");
  } catch (error) {
    return fail(error);
  }
}

export async function saveMarketPriceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(PLAN_ROLES);
    if (isActionState(ctx)) return ctx;
    const date = isoDate(form, "date", "Tanggal")!;
    const region = text(form, "region") || "Tasikmalaya";
    const price = moneyString(form, "price_per_kg", "Harga per kg", true)!;
    const existing = await ctx.client
      .from("market_price")
      .select("id")
      .eq("date", date)
      .eq("region", region)
      .is("deleted_at", null)
      .maybeSingle();
    const payload = { date, region, price_per_kg: price, note: optionalText(form, "note"), updated_at: new Date().toISOString() };
    const { error } = existing.data
      ? await ctx.client.from("market_price").update(payload).eq("id", existing.data.id)
      : await ctx.client.from("market_price").insert({ ...payload, created_by: ctx.viewer.id });
    if (error) return { error: error.message };
    refresh(["/rencana", "/outlook"]);
    return done("Harga acuan tersimpan.");
  } catch (error) {
    return fail(error);
  }
}

/** R-33: forecast default dari rata-rata keluar 4 minggu terakhir per hari dalam minggu. */
export async function generateForecastAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(PLAN_ROLES);
    if (isActionState(ctx)) return ctx;
    const customerId = text(form, "customer_id");
    const gradeId = text(form, "grade_id");
    const fromDate = isoDate(form, "from_date", "Mulai") ?? todayJakarta();
    const days = 14;
    if (!customerId || !gradeId) return { error: "Pelanggan dan grade wajib diisi." };
    const historyStart = addDays(fromDate, -28);
    const history = ((await ctx.client
      .from("outbound")
      .select("id,date,status")
      .gte("date", historyStart)
      .lt("date", fromDate)
      .in("status", ["dikirim", "diterima"])
      .is("deleted_at", null)).data as Array<{ id: string; date: string }>) ?? [];

    const lines = ((await ctx.client
      .from("outbound_line")
      .select("outbound_id,grade_id,kg_doc,kg_delivered")
      .eq("grade_id", gradeId)
      .is("deleted_at", null)).data as Array<{ outbound_id: string; kg_doc: string; kg_delivered: string | null }>) ?? [];
    const outboundIds = new Set(history.map((row) => row.id));
    const byOutbound = new Map<string, string>();
    for (const outbound of history) byOutbound.set(outbound.id, outbound.date);
    const points = lines
      .filter((line) => outboundIds.has(line.outbound_id))
      .map((line) => ({ date: byOutbound.get(line.outbound_id)!, kg: line.kg_delivered ?? line.kg_doc }));

    const forecast = defaultForecast(points, fromDate, days);
    let saved = 0;
    for (const point of forecast) {
      const existing = await ctx.client
        .from("sales_plan")
        .select("id")
        .eq("customer_id", customerId)
        .eq("date", point.date)
        .eq("grade_id", gradeId)
        .eq("kind", "forecast")
        .is("deleted_at", null)
        .maybeSingle();
      const payload = { kg: point.kg, kind: "forecast", updated_at: new Date().toISOString() };
      const { error } = existing.data
        ? await ctx.client.from("sales_plan").update(payload).eq("id", existing.data.id)
        : await ctx.client
            .from("sales_plan")
            .insert({ ...payload, customer_id: customerId, date: point.date, grade_id: gradeId, created_by: ctx.viewer.id });
      if (error) return { error: error.message };
      saved += 1;
    }
    refresh(["/rencana", "/outlook"]);
    return done(`${saved} hari forecast default dibuat (rata-rata 4 minggu).`);
  } catch (error) {
    return fail(error);
  }
}

export async function saveCashPlanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["accounting", "admin"]);
    if (isActionState(ctx)) return ctx;
    const weekStart = isoDate(form, "week_start", "Minggu")!;
    const category = text(form, "category");
    const direction = text(form, "direction") === "in" ? "in" : "out";
    if (!category) return { error: "Kategori wajib diisi." };
    const amount = moneyString(form, "amount_rp", "Jumlah Rp", true)!;
    if (D(amount).lessThan(0)) return { error: "Jumlah tidak boleh negatif." };
    const { error } = await ctx.client.from("cash_plan").insert({
      week_start: weekStart,
      category,
      direction,
      amount_rp: amount,
      note: optionalText(form, "note"),
      created_by: ctx.viewer.id,
    });
    if (error) return { error: error.message };
    refresh(["/rekon", "/outlook"]);
    return done("Rencana kas tersimpan.");
  } catch (error) {
    return fail(error);
  }
}

export async function saveCashBalanceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["accounting", "admin"]);
    if (isActionState(ctx)) return ctx;
    const asOf = isoDate(form, "as_of", "Per tanggal")!;
    const amount = moneyString(form, "amount_rp", "Saldo awal", true)!;
    const existing = await ctx.client.from("cash_balance").select("id").eq("as_of", asOf).is("deleted_at", null).maybeSingle();
    const payload = { as_of: asOf, amount_rp: amount, note: optionalText(form, "note"), updated_at: new Date().toISOString() };
    const { error } = existing.data
      ? await ctx.client.from("cash_balance").update(payload).eq("id", existing.data.id)
      : await ctx.client.from("cash_balance").insert({ ...payload, created_by: ctx.viewer.id });
    if (error) return { error: error.message };
    refresh(["/rekon", "/outlook"]);
    return done("Saldo awal kas tersimpan.");
  } catch (error) {
    return fail(error);
  }
}
