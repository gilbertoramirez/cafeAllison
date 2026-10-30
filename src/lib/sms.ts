/**
 * Envío de mensajes (código de verificación) con Twilio por SMS o WhatsApp.
 * Variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_FROM
 * (número de Twilio, p. ej. "+15551234567" para SMS o "whatsapp:+14155238886" para WhatsApp).
 */
export function smsEnabled() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

export async function sendMessage(phone10: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const from = process.env.TWILIO_FROM!;
  const to = (from.startsWith("whatsapp:") ? "whatsapp:" : "") + "+52" + phone10;
  // TWILIO_API_BASE solo para pruebas locales con un Twilio simulado
  const api = process.env.TWILIO_API_BASE || "https://api.twilio.com";
  const res = await fetch(`${api}/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) {
    console.error("Twilio", res.status, await res.text().catch(() => ""));
    throw new Error("No se pudo enviar el código. Intenta de nuevo o canjea en la caja.");
  }
}
