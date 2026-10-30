import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY no está configurada");
  if (!client) {
    // Solo para pruebas locales: STRIPE_API_HOST=localhost:12111 apunta a un Stripe simulado
    const mock = process.env.STRIPE_API_HOST;
    client = mock
      ? new Stripe(key, { host: mock.split(":")[0], port: Number(mock.split(":")[1] ?? 80), protocol: "http" })
      : new Stripe(key);
  }
  return client;
}
