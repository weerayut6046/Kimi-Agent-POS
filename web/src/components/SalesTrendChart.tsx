import { fmtMoney } from "@/lib/format";

type SalesTrendPoint = {
  label: string;
  total: number;
};

const WIDTH = 700;
const HEIGHT = 250;
const PADDING = { top: 14, right: 18, bottom: 38, left: 64 };

export default function SalesTrendChart({
  data,
}: {
  data: SalesTrendPoint[];
}) {
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const largestValue = Math.max(0, ...data.map(point => point.total));
  const chartMax = Math.max(1, largestValue);
  const points = data.map((point, index) => ({
    ...point,
    x:
      PADDING.left +
      (data.length <= 1 ? plotWidth / 2 : (plotWidth * index) / (data.length - 1)),
    y: PADDING.top + plotHeight * (1 - point.total / chartMax),
  }));
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const areaPath = points.length
    ? `${linePath} L ${points.at(-1)!.x} ${PADDING.top + plotHeight} L ${points[0].x} ${PADDING.top + plotHeight} Z`
    : "";
  const compactNumber = new Intl.NumberFormat("th-TH", {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  return (
    <figure className="h-full w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-full w-full"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="sales-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7667f7" stopOpacity="0.38" />
            <stop offset="65%" stopColor="#7667f7" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#7667f7" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
          const y = PADDING.top + plotHeight * ratio;
          const value = chartMax * (1 - ratio);
          return (
            <g key={ratio}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y}
                y2={y}
                stroke="#e8e7f0"
                strokeDasharray="3 7"
              />
              <text
                x={PADDING.left - 10}
                y={y + 4}
                textAnchor="end"
                fill="#8b8aa1"
                fontSize="11"
              >
                {compactNumber.format(value)}
              </text>
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill="url(#sales-area)" />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#6d5df4"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {points.map(point => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="4" fill="#18c7bf">
              <title>
                {point.label}: ฿{fmtMoney(point.total)}
              </title>
            </circle>
            <text
              x={point.x}
              y={HEIGHT - 12}
              textAnchor="middle"
              fill="#8b8aa1"
              fontSize="11"
            >
              {point.label}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">
        กราฟยอดขายรวมรายวันย้อนหลัง 7 วัน
      </figcaption>
      <table className="sr-only">
        <caption>ข้อมูลยอดขายรวมรายวันย้อนหลัง 7 วัน</caption>
        <thead>
          <tr>
            <th scope="col">วันที่</th>
            <th scope="col">ยอดขาย</th>
          </tr>
        </thead>
        <tbody>
          {data.map(point => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>฿{fmtMoney(point.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
