"use client";

export default function PrintPageButton({ label = "🖨️ Imprimir" }: { label?: string }) {
  return (
    <button type="button" className="btn-secondary print:hidden" onClick={() => window.print()}>
      {label}
    </button>
  );
}
