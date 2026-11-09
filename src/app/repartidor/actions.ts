"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { markDelivered, markOnTheWay, planRoute, type RouteResult } from "@/lib/deliveryRoute";
import { driverLogin, endDriverSession, requireDriver, startDriverSession } from "@/lib/drivers";

export async function driverSignIn(_prev: string | null, formData: FormData): Promise<string | null> {
  const r = await driverLogin(String(formData.get("phone") ?? ""), String(formData.get("pin") ?? "").trim());
  if (typeof r === "string") return r;
  await startDriverSession(r);
  redirect("/repartidor");
}

export async function driverSignOut() {
  await endDriverSession();
  redirect("/repartidor/login");
}

export async function driverPlanRoute(orderIds: number[], returnToCafe: boolean): Promise<RouteResult> {
  await requireDriver();
  return planRoute(orderIds, returnToCafe);
}

export async function driverOnTheWay(orderIds: number[]) {
  const d = await requireDriver();
  await markOnTheWay(orderIds, d.id);
  revalidatePath("/repartidor");
}

export async function driverDelivered(orderId: number) {
  const d = await requireDriver();
  await markDelivered(orderId, d.id);
  revalidatePath("/repartidor");
}
