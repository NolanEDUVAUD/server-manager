import { cn } from "../utils";

interface SparklineProps {
  /** Valeurs en pourcentage (0-100), de la plus ancienne à la plus récente */
  values: number[];
  className?: string;
}

/**
 * Mini-graphique SVG sans dépendance. L'échelle verticale est fixe (0-100 %)
 * pour que deux serveurs soient comparables d'un coup d'œil.
 */
export function Sparkline({ values, className }: SparklineProps) {
  if (values.length < 2) {
    return <div className={cn("h-8", className)} />;
  }

  const step = 100 / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(100 - Math.min(100, Math.max(0, v))).toFixed(2)}`)
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn("h-8 w-full overflow-visible", className)}
      role="img"
      aria-label="Historique"
    >
      <polygon points={`0,100 ${points} 100,100`} fill="currentColor" fillOpacity={0.12} />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}
