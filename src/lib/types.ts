export type Product = {
  id: number;
  name: string;
  description: string;
  category: string;
  price: number;
  cost: number;
  track_stock: number;
  stock: number;
  min_stock: number;
  image_url: string;
  active: number;
  sort: number;
};

export type Supply = {
  id: number;
  name: string;
  unit: string;
  qty: number;
  min_qty: number;
  cost_per_unit: number;
};

export type OrderStatus = "nuevo" | "preparando" | "listo" | "en_camino" | "entregado" | "cancelado";
export type PaymentMethod = "efectivo" | "tarjeta" | "transferencia" | "stripe" | "whatsapp";

export type Order = {
  id: number;
  token: string;
  channel: "mostrador" | "web" | "whatsapp";
  status: OrderStatus;
  customer_name: string;
  phone: string;
  delivery_type: "domicilio" | "recoger" | "mostrador";
  address: string;
  address_ref: string;
  lat: number | null;
  lng: number | null;
  notes: string;
  payment_method: PaymentMethod;
  payment_status: "pendiente" | "pagado" | "reembolsado";
  cash_given: number | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  stripe_session_id: string | null;
  created_at: string;
  paid_at: string | null;
};

export type OrderItem = {
  id: number;
  order_id: number;
  product_id: number | null;
  name: string;
  unit_price: number;
  unit_cost: number;
  qty: number;
};

export type Expense = {
  id: number;
  date: string;
  category: string;
  description: string;
  amount: number;
  status: "pagado" | "pendiente";
  recurring: "none" | "monthly" | "weekly";
  paid_at: string | null;
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  nuevo: "Nuevo",
  preparando: "Preparando",
  listo: "Listo para entregar",
  en_camino: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta (terminal)",
  transferencia: "Transferencia",
  stripe: "Pago en línea",
  whatsapp: "Acordado por WhatsApp",
};

export const EXPENSE_CATEGORIES: Record<string, string> = {
  renta: "Renta",
  resurtido: "Resurtido / insumos",
  servicios: "Luz, agua, gas, internet",
  nomina: "Sueldos",
  mantenimiento: "Mantenimiento",
  marketing: "Publicidad",
  impuestos: "Impuestos y comisiones",
  otros: "Otros",
};
