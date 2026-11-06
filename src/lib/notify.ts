/** Avisos al celular con ntfy (https://ntfy.sh): pedidos nuevos y cada cambio de un pedido. */
import { after } from "next/server";
import { all, get } from "./db";
import { money } from "./format";
import { getSettings } from "./settings";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_LABEL,
  type Order,
  type OrderStatus,
} from "./types";
import { siteUrl } from "./url";

export type NtfySettings = {
  server: string;
  topic: string;
  newOrders: boolean;
  updates: boolean;
  pos: boolean;
};

export type NtfyMessage = {
  title: string;
  message: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  click?: string;
};

export type OrderEvent =
  | { kind: "nuevo" }
  | { kind: "pagado" }
  | { kind: "estado"; status: OrderStatus };

const code = (id: number) => `#${String(id).padStart(4, "0")}`;

/** Envía un mensaje al tema configurado. Nunca lanza error: devuelve el problema como texto. */
export async function sendNtfy(
  cfg: NtfySettings,
  msg: NtfyMessage,
): Promise<string | null> {
  if (!cfg.topic) return "Falta el nombre del tema";
  try {
    const res = await fetch(cfg.server.replace(/\/$/, ""), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.NTFY_TOKEN
          ? { Authorization: `Bearer ${process.env.NTFY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ topic: cfg.topic, ...msg }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok)
      return `ntfy respondió ${res.status}: ${(await res.text()).slice(0, 200)}`;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function adminLink() {
  try {
    return `${await siteUrl()}/admin/pedidos`;
  } catch {
    return undefined;
  }
}

/**
 * Aviso de un pedido (nuevo, pagado o cambio de estado), según lo que esté activado en Ajustes.
 * Se envía después de responder, para no hacer esperar a la caja ni al cliente.
 */
export async function notifyOrder(orderId: number, event: OrderEvent) {
  const send = () => sendOrderNotice(orderId, event);
  try {
    after(send);
  } catch {
    await send(); // fuera de una petición (p. ej. scripts)
  }
}

async function sendOrderNotice(orderId: number, event: OrderEvent) {
  try {
    const { ntfy: cfg } = await getSettings();
    if (!cfg.topic) return;
    if (event.kind === "nuevo" ? !cfg.newOrders : !cfg.updates) return;
    const o = await get<Order>("SELECT * FROM orders WHERE id = ?", [orderId]);
    if (!o) return;
    const counter = o.channel === "mostrador";
    if (counter && !cfg.pos) return;

    const items = await all<{ name: string; qty: number; notes: string }>(
      "SELECT name, qty, notes FROM order_items WHERE order_id = ? ORDER BY id",
      [orderId],
    );
    const who = [
      o.customer_name || (counter ? "Mostrador" : "Cliente"),
      o.delivery_type === "domicilio"
        ? "🛵 A domicilio"
        : o.delivery_type === "recoger"
          ? "🏪 Para recoger"
          : null,
      `${PAYMENT_LABEL[o.payment_method] ?? o.payment_method}${o.payment_status === "pagado" ? " (pagado)" : ""}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const list = items
      .map((i) => `${i.qty} × ${i.name}${i.notes ? ` (${i.notes})` : ""}`)
      .join("\n");

    let msg: NtfyMessage;
    if (event.kind === "nuevo") {
      msg = counter
        ? {
            title: `🧾 Venta en caja ${code(o.id)} · ${money(o.total)}`,
            message: `${who}\n${list}`,
            priority: 2,
            tags: ["receipt"],
          }
        : {
            title: `🛎️ Nuevo pedido ${code(o.id)} · ${money(o.total)}`,
            message: [who, list, o.notes ? `Notas: ${o.notes}` : ""]
              .filter(Boolean)
              .join("\n"),
            priority: 5,
            tags: ["bell"],
          };
    } else if (event.kind === "pagado") {
      msg = {
        title: `💵 Pedido ${code(o.id)} pagado · ${money(o.total)}`,
        message: who,
        priority: 3,
        tags: ["moneybag"],
      };
    } else if (event.status === "cancelado") {
      msg = {
        title: `❌ Pedido ${code(o.id)} cancelado · ${money(o.total)}`,
        message: [who, o.cancel_reason ? `Motivo: ${o.cancel_reason}` : ""]
          .filter(Boolean)
          .join("\n"),
        priority: 4,
        tags: ["x"],
      };
    } else {
      msg = {
        title: `📦 Pedido ${code(o.id)}: ${ORDER_STATUS_LABEL[event.status]}`,
        message: `${who}\n${list}`,
        priority: 3,
        tags: ["package"],
      };
    }
    const click = await adminLink();
    const err = await sendNtfy(cfg, { ...msg, click });
    if (err) console.error("ntfy", err);
  } catch (e) {
    console.error("ntfy", e);
  }
}
