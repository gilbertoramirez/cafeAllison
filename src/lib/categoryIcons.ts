/** Ícono de cada categoría del menú (se usa si no hay foto). */
export const CATEGORY_ICON: Record<string, string> = {
  "Bebidas Calientes": "☕",
  "Calientes Sin Café": "🍫",
  "Bebidas Frías": "🧊",
  Café: "☕",
  "Sin Café": "🍫",
  "Barra Fría": "🧊",
  "Frappés Especiales": "🥤",
  Malteadas: "🍓",
  Postres: "🥐",
  Snacks: "🥪",
  Combos: "🍱",
  "Snacks Especiales": "🍗",
};
export const iconFor = (category: string) => CATEGORY_ICON[category] ?? "☕";
