export type AssetTreeSortableKind = "asset" | "group";
export type AssetTreeDropZoneKind = "group-drop";
export type AssetTreeDndKind = AssetTreeSortableKind | AssetTreeDropZoneKind;
export type AssetTreeTargetKind = AssetTreeSortableKind | AssetTreeDropZoneKind;

export type AssetTreeDropTarget = { kind: "asset"; containerId: number } | { kind: "container"; containerId: number };

interface GetTargetContainerIdOptions {
  activeKind: AssetTreeSortableKind;
  overKind: AssetTreeTargetKind;
  overId: number;
  getAssetContainerId: (assetId: number) => number | undefined;
  getGroupContainerId: (groupId: number) => number | undefined;
}

export interface AssetTreeSortableItem {
  kind: AssetTreeSortableKind;
  id: number;
}

export interface AssetTreeDndItem {
  kind: AssetTreeDndKind;
  id: number;
}

interface GetMoveBeforeIdOptions {
  sortableIds: string[];
  activeSortableId: string;
  overSortableId: string;
  targetKind: AssetTreeSortableKind;
  targetContainerId: number;
  getContainerId: (item: AssetTreeSortableItem) => number | undefined;
}

export interface OptimisticAsset {
  ID: number;
  GroupID?: number;
  SortOrder?: number;
}

export function parseAssetTreeSortableId(sortableId: string): AssetTreeSortableItem | null {
  const match = /^(asset|group)-(\d+)$/.exec(sortableId);
  if (!match) return null;

  return {
    kind: match[1] as AssetTreeSortableKind,
    id: Number(match[2]),
  };
}

export function parseAssetTreeDndId(dndId: string): AssetTreeDndItem | null {
  const dropZoneMatch = /^group-drop-(\d+)$/.exec(dndId);
  if (dropZoneMatch) {
    return { kind: "group-drop", id: Number(dropZoneMatch[1]) };
  }
  return parseAssetTreeSortableId(dndId);
}

export function getAssetTreeMoveBeforeId({
  sortableIds,
  activeSortableId,
  overSortableId,
  targetKind,
  targetContainerId,
  getContainerId,
}: GetMoveBeforeIdOptions): number | null {
  const activeIndex = sortableIds.indexOf(activeSortableId);
  const overIndex = sortableIds.indexOf(overSortableId);
  if (activeIndex < 0 || overIndex < 0) return null;

  const projectedIds = moveSortableId(sortableIds, activeIndex, overIndex);
  const movedIndex = projectedIds.indexOf(activeSortableId);
  if (movedIndex < 0) return null;

  for (let i = movedIndex + 1; i < projectedIds.length; i += 1) {
    const item = parseAssetTreeSortableId(projectedIds[i]);
    if (!item || item.kind !== targetKind) continue;
    if (getContainerId(item) === targetContainerId) {
      return item.id;
    }
  }

  return 0;
}

export function getAssetTreeTargetContainerId({
  activeKind,
  overKind,
  overId,
  getAssetContainerId,
  getGroupContainerId,
}: GetTargetContainerIdOptions): AssetTreeDropTarget | null {
  if (activeKind === "asset") {
    if (overKind === "asset") {
      const containerId = getAssetContainerId(overId);
      return containerId === undefined ? null : { kind: "asset", containerId };
    }
    return { kind: "container", containerId: overId };
  }

  if (overKind === "asset") {
    const containerId = getAssetContainerId(overId);
    return containerId === undefined || containerId === 0 ? null : { kind: "container", containerId };
  }
  if (overId === 0) return null;

  const containerId = getGroupContainerId(overId);
  return containerId === undefined ? null : { kind: "asset", containerId };
}

export function reorderAssetsOptimistically<T extends OptimisticAsset>(
  assets: T[],
  movedID: number,
  targetGroupID: number,
  beforeID: number
): T[] {
  const moving = assets.find((asset) => asset.ID === movedID);
  if (!moving) return assets;

  const moved = { ...moving, GroupID: targetGroupID } as T;
  const withoutMoved = assets.filter((asset) => asset.ID !== movedID);
  const targetSiblings = withoutMoved.filter((asset) => (asset.GroupID || 0) === targetGroupID);
  const orderedTarget: T[] = [];
  let inserted = false;

  for (const asset of targetSiblings) {
    if (!inserted && beforeID !== 0 && asset.ID === beforeID) {
      orderedTarget.push(moved);
      inserted = true;
    }
    orderedTarget.push(asset);
  }
  if (!inserted) orderedTarget.push(moved);

  const normalizedTarget = orderedTarget.map((asset, index) => ({
    ...asset,
    GroupID: targetGroupID,
    SortOrder: (index + 1) * 10,
  })) as T[];

  const next: T[] = [];
  let targetBlockInserted = false;
  for (const asset of withoutMoved) {
    if ((asset.GroupID || 0) === targetGroupID) {
      if (!targetBlockInserted) {
        next.push(...normalizedTarget);
        targetBlockInserted = true;
      }
      continue;
    }
    next.push(asset);
  }

  if (!targetBlockInserted) next.push(...normalizedTarget);
  return next;
}

function moveSortableId(sortableIds: string[], fromIndex: number, toIndex: number): string[] {
  const next = [...sortableIds];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
