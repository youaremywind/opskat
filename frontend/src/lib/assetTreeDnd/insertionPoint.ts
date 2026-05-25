import { group_entity } from "../../../wailsjs/go/models";
import type { Row } from "./flattenTree";

export type InsertionPoint =
  | { kind: "before-group"; groupID: number; depth: number }
  | { kind: "into-group-first"; groupID: number; depth: number }
  | { kind: "before-asset"; assetID: number; groupID: number; depth: number }
  | { kind: "after-asset"; assetID: number; groupID: number; depth: number }
  | { kind: "root-end" }
  | { kind: "invalid" };

export interface RowRect {
  top: number;
  bottom: number;
  height: number;
}

export interface ComputeInsertionPointInput {
  rows: Row[];
  rowRects: Map<string, RowRect>;
  pointerY: number;
  active: { kind: "asset" | "group"; id: number };
  groups: group_entity.Group[];
}

export function rowKey(row: Row): string {
  switch (row.kind) {
    case "group-header":
      return `group-${row.groupID}`;
    case "asset":
      return `asset-${row.assetID}`;
    case "empty-placeholder":
      return `empty-${row.groupID}`;
  }
}

function isGroupSelfOrDescendant(targetGroupID: number, ancestorID: number, groups: group_entity.Group[]): boolean {
  if (targetGroupID === ancestorID) return true;
  const byID = new Map(groups.map((g) => [g.ID, g] as const));
  let cur = byID.get(targetGroupID);
  while (cur) {
    const p = cur.ParentID ?? 0;
    if (p === ancestorID) return true;
    if (p === 0) return false;
    cur = byID.get(p);
  }
  return false;
}

export function computeInsertionPoint({
  rows,
  rowRects,
  pointerY,
  active,
  groups,
}: ComputeInsertionPointInput): InsertionPoint {
  if (rows.length === 0) return { kind: "root-end" };

  let hitIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const rect = rowRects.get(rowKey(rows[i]));
    if (!rect) continue;
    if (pointerY >= rect.top && pointerY < rect.bottom) {
      hitIdx = i;
      break;
    }
  }

  if (hitIdx < 0) {
    return { kind: "root-end" };
  }

  const row = rows[hitIdx];
  const rect = rowRects.get(rowKey(row))!;
  const upperHalf = pointerY < rect.top + rect.height / 2;

  switch (row.kind) {
    case "asset": {
      if (active.kind === "group") return { kind: "invalid" };
      if (active.id === row.assetID) return { kind: "invalid" };
      return upperHalf
        ? { kind: "before-asset", assetID: row.assetID, groupID: row.groupID, depth: row.depth }
        : { kind: "after-asset", assetID: row.assetID, groupID: row.groupID, depth: row.depth };
    }
    case "group-header": {
      if (row.groupID === 0) {
        if (active.kind === "group") return { kind: "invalid" };
        return { kind: "into-group-first", groupID: 0, depth: row.depth };
      }
      if (active.kind === "group" && isGroupSelfOrDescendant(row.groupID, active.id, groups)) {
        return { kind: "invalid" };
      }
      return upperHalf
        ? { kind: "before-group", groupID: row.groupID, depth: row.depth }
        : { kind: "into-group-first", groupID: row.groupID, depth: row.depth };
    }
    case "empty-placeholder": {
      if (active.kind === "group" && isGroupSelfOrDescendant(row.groupID, active.id, groups)) {
        return { kind: "invalid" };
      }
      return { kind: "into-group-first", groupID: row.groupID, depth: row.depth };
    }
  }
}
