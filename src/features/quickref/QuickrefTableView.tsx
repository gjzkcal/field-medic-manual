import type { JSX } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { conditionLabel } from "@/features/settings/mod-conditions";
import type { VisibleRow } from "@/features/quickref/filter";
import { quickrefHref } from "@/features/quickref/link";
import { SeverityBadge } from "@/features/quickref/QuickrefCard";
import { toSeverity } from "@/features/quickref/severity";

/**
 * 表の表示。多くの行を見比べるためのもので、関連リンクは症状から行（カード）を開いて見る。
 * 幅が要るので、小窓では出さない。
 */
export function QuickrefTableView({ rows }: { rows: readonly VisibleRow[] }): JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">重症度</TableHead>
          <TableHead className="w-56">症状</TableHead>
          <TableHead>処置</TableHead>
          <TableHead className="w-48">物品</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ row }) => {
          const condition = conditionLabel(row);
          return (
            <TableRow key={row.id} className="align-top">
              <TableCell>
                <SeverityBadge severity={toSeverity(row.severity)} />
              </TableCell>
              <TableCell className="whitespace-normal">
                <Link
                  to={quickrefHref(row.id)}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.symptom}
                </Link>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge variant="outline">{row.category}</Badge>
                  {condition !== null && <Badge variant="secondary">{condition}</Badge>}
                </div>
              </TableCell>
              <TableCell className="whitespace-normal">
                <ol className="list-decimal pl-5">
                  {row.treatment.map((step, i) => (
                    <li key={`${String(i)}:${step}`}>{step}</li>
                  ))}
                </ol>
              </TableCell>
              <TableCell className="whitespace-normal">{row.items.join("、")}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
