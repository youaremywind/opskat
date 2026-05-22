import { describe, expect, it } from "vitest";
import {
  getAssetTreeMoveBeforeId,
  getAssetTreeTargetContainerId,
  parseAssetTreeDndId,
  reorderAssetsOptimistically,
  type AssetTreeSortableItem,
  type AssetTreeSortableKind,
} from "@/lib/assetTreeReorder";

function beforeId({
  sortableIds,
  activeSortableId,
  overSortableId,
  targetKind,
  targetContainerId,
  containers,
}: {
  sortableIds: string[];
  activeSortableId: string;
  overSortableId: string;
  targetKind: AssetTreeSortableKind;
  targetContainerId: number;
  containers: Array<[string, number]>;
}) {
  const containerBySortableId = new Map(containers);
  return getAssetTreeMoveBeforeId({
    sortableIds,
    activeSortableId,
    overSortableId,
    targetKind,
    targetContainerId,
    getContainerId: (item: AssetTreeSortableItem) => containerBySortableId.get(`${item.kind}-${item.id}`),
  });
}

describe("getAssetTreeMoveBeforeId", () => {
  it("maps an asset drag downward to the next sibling beforeID", () => {
    expect(
      beforeId({
        sortableIds: ["asset-1", "asset-2", "asset-3"],
        activeSortableId: "asset-1",
        overSortableId: "asset-2",
        targetKind: "asset",
        targetContainerId: 10,
        containers: [
          ["asset-1", 10],
          ["asset-2", 10],
          ["asset-3", 10],
        ],
      })
    ).toBe(3);
  });

  it("maps an asset drag to the end to beforeID 0", () => {
    expect(
      beforeId({
        sortableIds: ["asset-1", "asset-2"],
        activeSortableId: "asset-1",
        overSortableId: "asset-2",
        targetKind: "asset",
        targetContainerId: 10,
        containers: [
          ["asset-1", 10],
          ["asset-2", 10],
        ],
      })
    ).toBe(0);
  });

  it("keeps upward asset drags mapped to the hovered sibling beforeID", () => {
    expect(
      beforeId({
        sortableIds: ["asset-1", "asset-2", "asset-3"],
        activeSortableId: "asset-3",
        overSortableId: "asset-2",
        targetKind: "asset",
        targetContainerId: 10,
        containers: [
          ["asset-1", 10],
          ["asset-2", 10],
          ["asset-3", 10],
        ],
      })
    ).toBe(2);
  });

  it("moves an ungrouped asset before a grouped asset when crossing into that group", () => {
    expect(
      beforeId({
        sortableIds: ["group-10", "asset-2", "group-0", "asset-1"],
        activeSortableId: "asset-1",
        overSortableId: "asset-2",
        targetKind: "asset",
        targetContainerId: 10,
        containers: [
          ["asset-1", 0],
          ["asset-2", 10],
        ],
      })
    ).toBe(2);
  });

  it("maps a group drag downward to the next sibling beforeID", () => {
    expect(
      beforeId({
        sortableIds: ["group-1", "asset-10", "group-2", "group-3"],
        activeSortableId: "group-1",
        overSortableId: "group-2",
        targetKind: "group",
        targetContainerId: 0,
        containers: [
          ["group-1", 0],
          ["asset-10", 1],
          ["group-2", 0],
          ["group-3", 0],
        ],
      })
    ).toBe(3);
  });

  it("maps a group drag to the end to beforeID 0", () => {
    expect(
      beforeId({
        sortableIds: ["group-1", "group-2"],
        activeSortableId: "group-1",
        overSortableId: "group-2",
        targetKind: "group",
        targetContainerId: 0,
        containers: [
          ["group-1", 0],
          ["group-2", 0],
        ],
      })
    ).toBe(0);
  });

  it("keeps upward group drags mapped to the hovered sibling beforeID", () => {
    expect(
      beforeId({
        sortableIds: ["group-1", "group-2", "group-3"],
        activeSortableId: "group-3",
        overSortableId: "group-2",
        targetKind: "group",
        targetContainerId: 0,
        containers: [
          ["group-1", 0],
          ["group-2", 0],
          ["group-3", 0],
        ],
      })
    ).toBe(2);
  });
});

describe("getAssetTreeTargetContainerId", () => {
  const assetContainer = new Map([
    [1, 0],
    [2, 10],
  ]);
  const groupParent = new Map([
    [10, 0],
    [11, 10],
  ]);

  it("treats dropping an asset on a folder as moving into that folder", () => {
    expect(
      getAssetTreeTargetContainerId({
        activeKind: "asset",
        overKind: "group",
        overId: 11,
        getAssetContainerId: (id) => assetContainer.get(id),
        getGroupContainerId: (id) => groupParent.get(id),
      })
    ).toEqual({ kind: "container", containerId: 11 });
  });

  it("treats dropping an asset on the ungrouped bucket as moving out of a folder", () => {
    expect(
      getAssetTreeTargetContainerId({
        activeKind: "asset",
        overKind: "group",
        overId: 0,
        getAssetContainerId: (id) => assetContainer.get(id),
        getGroupContainerId: (id) => groupParent.get(id),
      })
    ).toEqual({ kind: "container", containerId: 0 });
  });

  it("treats dropping an asset on another asset as reordering inside that asset folder", () => {
    expect(
      getAssetTreeTargetContainerId({
        activeKind: "asset",
        overKind: "asset",
        overId: 2,
        getAssetContainerId: (id) => assetContainer.get(id),
        getGroupContainerId: (id) => groupParent.get(id),
      })
    ).toEqual({ kind: "asset", containerId: 10 });
  });

  it("treats dropping an asset on a folder content dropzone as moving into that folder", () => {
    expect(
      getAssetTreeTargetContainerId({
        activeKind: "asset",
        overKind: "group-drop",
        overId: 1,
        getAssetContainerId: (id) => assetContainer.get(id),
        getGroupContainerId: (id) => groupParent.get(id),
      })
    ).toEqual({ kind: "container", containerId: 1 });
  });

  it("rejects dropping a group into the virtual ungrouped folder", () => {
    expect(
      getAssetTreeTargetContainerId({
        activeKind: "group",
        overKind: "group",
        overId: 0,
        getAssetContainerId: (id) => assetContainer.get(id),
        getGroupContainerId: (id) => groupParent.get(id),
      })
    ).toBeNull();
  });
});

describe("parseAssetTreeDndId", () => {
  it("parses folder content dropzone ids", () => {
    expect(parseAssetTreeDndId("group-drop-1")).toEqual({ kind: "group-drop", id: 1 });
  });
});

describe("reorderAssetsOptimistically", () => {
  it("moves an asset into the target folder tail immediately", () => {
    const next = reorderAssetsOptimistically(
      [
        { ID: 1, GroupID: 0, SortOrder: 10, Name: "root" },
        { ID: 2, GroupID: 10, SortOrder: 10, Name: "first" },
        { ID: 3, GroupID: 10, SortOrder: 20, Name: "last" },
      ],
      1,
      10,
      0
    );

    expect(next.filter((asset) => asset.GroupID === 10).map((asset) => asset.ID)).toEqual([2, 3, 1]);
    expect(next.find((asset) => asset.ID === 1)?.GroupID).toBe(10);
  });
});
