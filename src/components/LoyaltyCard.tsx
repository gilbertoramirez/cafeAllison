import { dateTime } from "@/lib/format";
import type { LoyaltySettings, LoyaltyStatus } from "@/lib/loyaltyRules";

/** Tarjeta de sellos: círculos llenos por cada sello y bebidas gratis disponibles. */
export default function LoyaltyCard({ status, compact = false }: { status: LoyaltyStatus; compact?: boolean }) {
  const filled = Math.min(status.stamps, status.needed);
  return (
    <div className={`rounded-xl bg-cafe-900 text-white ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-center justify-between">
        <p className="font-semibold">☕ Tarjeta de sellos</p>
        <p className="text-sm text-cafe-200">
          {filled}/{status.needed}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-10 gap-1" aria-label={`${filled} de ${status.needed} sellos`}>
        {Array.from({ length: status.needed }, (_, i) => (
          <span
            key={i}
            className={`flex aspect-square items-center justify-center rounded-full text-[11px] ${
              i < filled ? "bg-cafe-300 text-cafe-900" : "border border-dashed border-cafe-500 text-cafe-500"
            }`}
          >
            {i < filled ? "☕" : i === status.needed - 1 ? "🎁" : ""}
          </span>
        ))}
      </div>
      {status.rewards.length > 0 ? (
        <p className="mt-2 rounded-lg bg-white/15 px-2 py-1 text-sm font-semibold">
          🎁 {status.rewards.length === 1 ? "Tienes 1 bebida gratis" : `Tienes ${status.rewards.length} bebidas gratis`} · vence{" "}
          {dateTime(status.rewards[0].expires_at).split(",")[0]}
        </p>
      ) : (
        !compact && (
          <p className="mt-2 text-xs text-cafe-200">
            Te faltan {Math.max(0, status.needed - filled)} para tu bebida gratis.
          </p>
        )
      )}
    </div>
  );
}

export function LoyaltyRulesText({ rules }: { rules: LoyaltySettings }) {
  return (
    <p className="text-xs text-cafe-600">
      1 sello por día en compras desde ${(rules.minPurchase / 100).toFixed(0)} con tu teléfono. Con {rules.needed} sellos te
      regalamos una bebida de hasta 12oz (no incluye frappés especiales ni malteadas). Cada sello dura {rules.stampMonths}{" "}
      {rules.stampMonths === 1 ? "mes" : "meses"} y la bebida gratis {rules.rewardDays} días.
    </p>
  );
}
