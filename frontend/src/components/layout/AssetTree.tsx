import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Server,
  Plus,
  FolderPlus,
  Search,
  Loader2,
  Eye,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  Pencil,
  Copy,
  Trash2,
  TerminalSquare,
  ExternalLink,
  Settings2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Button,
  ScrollArea,
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
  AlertDialogAction,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@opskat/ui";
import { getIconComponent, getIconColor } from "@/components/asset/IconPicker";
import { filterAssets } from "@/lib/assetSearch";
import {
  getAssetTreeMoveBeforeId,
  getAssetTreeTargetContainerId,
  parseAssetTreeDndId,
  reorderAssetsOptimistically,
} from "@/lib/assetTreeReorder";
import { type AssetTreeSortableItem, type AssetTreeTargetKind } from "@/lib/assetTreeReorder";
import { getAssetType } from "@/lib/assetTypes";
import { getAssetTypeOptions, matchSelectedTypes } from "@/lib/assetTypes/options";
import { AssetTypeFilterButton } from "@/components/asset/AssetTypeFilterButton";
import { useAssetStore } from "@/stores/assetStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { useExtensionStore } from "@/extension";
import { useActiveAssetIds } from "@/hooks/useActiveAssetIds";
import { MoveAsset } from "../../../wailsjs/go/system/System";
import { MoveGroup, ReorderAsset, ReorderGroup } from "../../../wailsjs/go/system/System";
import { asset_entity, group_entity } from "../../../wailsjs/go/models";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface AssetTreeProps {
  collapsed: boolean;
  sidebarHidden?: boolean;
  onShowSidebar?: () => void;
  onAddAsset: (groupId?: number) => void;
  onAddGroup: () => void;
  onEditGroup: (group: group_entity.Group) => void;
  onGroupDetail: (group: group_entity.Group) => void;
  onEditAsset: (asset: asset_entity.Asset) => void;
  onCopyAsset: (asset: asset_entity.Asset) => void;
  onConnectAsset: (asset: asset_entity.Asset) => void;
  onConnectAssetInNewTab?: (asset: asset_entity.Asset) => void;
  onOpenFileManager?: (asset: asset_entity.Asset) => void;
  onSelectAsset: (asset: asset_entity.Asset) => void;
  onOpenInfoTab?: (type: "asset" | "group", id: number, name: string, icon?: string) => void;
}

const FILTER_LS_KEY = "asset_tree_type_filter";
const HIDE_EMPTY_LS_KEY = "asset_tree_hide_empty_groups";

function loadFilter(): string[] {
  try {
    const raw = localStorage.getItem(FILTER_LS_KEY);
    if (!raw) return [];
    if (raw === '"all"' || raw === "all") return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      return parsed as string[];
    }
    return [];
  } catch {
    return [];
  }
}

function saveFilter(value: string[]) {
  localStorage.setItem(FILTER_LS_KEY, JSON.stringify(value));
}

function loadHideEmpty(): boolean {
  return localStorage.getItem(HIDE_EMPTY_LS_KEY) === "true";
}

function saveHideEmpty(value: boolean) {
  localStorage.setItem(HIDE_EMPTY_LS_KEY, value ? "true" : "false");
}

function afterDragCleanupFrame() {
  return new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

export function AssetTree({
  collapsed,
  sidebarHidden,
  onShowSidebar,
  onAddAsset,
  onAddGroup,
  onEditGroup,
  onGroupDetail,
  onEditAsset,
  onCopyAsset,
  onConnectAsset,
  onConnectAssetInNewTab,
  onOpenFileManager,
  onSelectAsset,
  onOpenInfoTab,
}: AssetTreeProps) {
  const { t } = useTranslation();
  const {
    assets,
    groups,
    selectedAssetId,
    collapsedGroupIds,
    fetchAssets,
    fetchGroups,
    deleteAsset,
    deleteGroup,
    refresh,
  } = useAssetStore();
  const connectingAssetIds = useTerminalStore((s) => s.connectingAssetIds);
  const extensions = useExtensionStore((s) => s.extensions);
  const activeAssetIds = useActiveAssetIds();
  const [filter, setFilter] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>(loadFilter);
  const [hideEmptyGroups, setHideEmptyGroups] = useState<boolean>(loadHideEmpty);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: number;
    assetCount: number;
    childGroupCount: number;
  } | null>(null);
  const [deleteAssetConfirm, setDeleteAssetConfirm] = useState<asset_entity.Asset | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<{
    group: group_entity.Group;
    position: { x: number; y: number };
  } | null>(null);
  const [dragPreviewAsset, setDragPreviewAsset] = useState<asset_entity.Asset | null>(null);

  useEffect(() => {
    fetchAssets();
    fetchGroups();
  }, [fetchAssets, fetchGroups]);

  useEffect(() => {
    saveFilter(selectedTypes);
  }, [selectedTypes]);

  useEffect(() => {
    saveHideEmpty(hideEmptyGroups);
  }, [hideEmptyGroups]);

  const typeOptions = useMemo(() => getAssetTypeOptions(extensions), [extensions]);

  const typeFilteredAssets = matchSelectedTypes(assets, selectedTypes, typeOptions);
  const filteredAssets = filter
    ? filterAssets(typeFilteredAssets, groups, { query: filter }).map((r) => r.asset)
    : typeFilteredAssets;

  // Group assets by GroupID
  const groupedAssets = new Map<number, asset_entity.Asset[]>();
  for (const asset of filteredAssets) {
    const gid = asset.GroupID || 0;
    if (!groupedAssets.has(gid)) groupedAssets.set(gid, []);
    groupedAssets.get(gid)!.push(asset);
  }

  const rawChildGroups = (parentId: number) => groups.filter((g) => (g.ParentID || 0) === parentId);

  const countAssetsInGroup = (groupId: number): number => {
    let count = (groupedAssets.get(groupId) || []).length;
    for (const child of rawChildGroups(groupId)) {
      count += countAssetsInGroup(child.ID);
    }
    return count;
  };

  const hasSearchFilter = filter.trim().length > 0;
  const hasTypeFilter = selectedTypes.length > 0;
  const shouldHideEmptyGroups = hideEmptyGroups || hasSearchFilter || hasTypeFilter;

  const childGroups = (parentId: number) => {
    const all = rawChildGroups(parentId);
    return shouldHideEmptyGroups ? all.filter((g) => countAssetsInGroup(g.ID) > 0) : all;
  };

  const visibleRootGroups = childGroups(0);
  const rootAssets = groupedAssets.get(0) || [];
  const treeIsEmpty = visibleRootGroups.length === 0 && rootAssets.length === 0;
  const isFilteredEmpty = filteredAssets.length === 0 && (hasSearchFilter || hasTypeFilter);

  const countDescendantGroups = (groupId: number): number => {
    let count = 0;
    for (const child of rawChildGroups(groupId)) {
      count += 1 + countDescendantGroups(child.ID);
    }
    return count;
  };

  const handleDeleteGroup = (id: number) => {
    const directAssetCount = (groupedAssets.get(id) || []).length;
    const childGroupCount = countDescendantGroups(id);
    if (directAssetCount > 0 || childGroupCount > 0) {
      setDeleteConfirm({ id, assetCount: directAssetCount, childGroupCount });
    } else {
      deleteGroup(id, false).catch((e) => toast.error(String(e)));
    }
  };

  const handleMoveAsset = async (id: number, direction: string) => {
    try {
      await MoveAsset(id, direction);
      await refresh();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleMoveGroup = async (id: number, direction: string) => {
    try {
      await MoveGroup(id, direction);
      await refresh();
    } catch (e) {
      toast.error(String(e));
    }
  };

  // 5px 移动门槛 → 单击/双击不被误识别成拖动
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // 拖动用的扁平 id 列表:DFS 顺序展开所有可见分组与资产
  const sortableIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (parentId: number) => {
      for (const g of childGroups(parentId)) {
        ids.push(`group-${g.ID}`);
        if (!collapsedGroupIds.includes(g.ID)) {
          walk(g.ID);
          for (const a of groupedAssets.get(g.ID) || []) {
            ids.push(`asset-${a.ID}`);
          }
        }
      }
    };
    walk(0);
    if ((groupedAssets.get(0) || []).length > 0) {
      ids.push("group-0");
      if (!collapsedGroupIds.includes(0)) {
        for (const a of groupedAssets.get(0) || []) {
          ids.push(`asset-${a.ID}`);
        }
      }
    }
    return ids;
    // childGroups / groupedAssets 每次渲染都是新引用,但底层依赖 groups/assets/hideEmptyGroups
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, assets, collapsedGroupIds, hideEmptyGroups, selectedTypes, filter]);

  const handleDragStart = (e: DragStartEvent) => {
    const item = parseAssetTreeDndId(String(e.active.id));
    if (item?.kind !== "asset") {
      setDragPreviewAsset(null);
      return;
    }
    setDragPreviewAsset(assets.find((asset) => asset.ID === item.id) ?? null);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragPreviewAsset(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeStr = String(active.id);
    const overStr = String(over.id);
    const activeItem = parseAssetTreeDndId(activeStr);
    const overItem = parseAssetTreeDndId(overStr);
    if (!activeItem || !overItem || activeItem.kind === "group-drop") return;
    const { kind: activeKind, id: activeId } = activeItem;
    const { kind: overKind, id: overId } = overItem;
    let appliedOptimisticAssetMove = false;

    try {
      if (activeKind === "asset") {
        const target = getAssetTreeTargetContainerId({
          activeKind: "asset",
          overKind: overKind as AssetTreeTargetKind,
          overId,
          getAssetContainerId: (assetId) => assets.find((a) => a.ID === assetId)?.GroupID ?? 0,
          getGroupContainerId: (groupId) => groups.find((g) => g.ID === groupId)?.ParentID ?? 0,
        });
        if (!target) return;

        if (target.kind === "asset") {
          const targetGroupID = target.containerId;
          const assetGroupById = new Map(assets.map((a) => [a.ID, a.GroupID ?? 0] as const));
          const beforeID = getAssetTreeMoveBeforeId({
            sortableIds,
            activeSortableId: activeStr,
            overSortableId: overStr,
            targetKind: "asset",
            targetContainerId: targetGroupID,
            getContainerId: (item: AssetTreeSortableItem) =>
              item.kind === "asset" ? assetGroupById.get(item.id) : undefined,
          });
          if (beforeID === null) return;
          await afterDragCleanupFrame();
          useAssetStore.setState((state) => ({
            assets: reorderAssetsOptimistically(state.assets, activeId, targetGroupID, beforeID),
          }));
          appliedOptimisticAssetMove = true;
          await ReorderAsset(activeId, targetGroupID, beforeID);
        } else {
          await afterDragCleanupFrame();
          useAssetStore.setState((state) => ({
            assets: reorderAssetsOptimistically(state.assets, activeId, target.containerId, 0),
          }));
          appliedOptimisticAssetMove = true;
          await ReorderAsset(activeId, target.containerId, 0);
        }
      } else if (activeKind === "group") {
        if (activeId === 0) return; // 未分组桶不可拖
        if (overKind === "group") {
          if (overId === 0) {
            // 拖到未分组桶 → 不支持把分组放进"未分组"里
            return;
          }
          const overGroup = groups.find((g) => g.ID === overId);
          const targetParentID = overGroup?.ParentID ?? 0;
          const groupParentById = new Map(groups.map((g) => [g.ID, g.ParentID ?? 0] as const));
          const beforeID = getAssetTreeMoveBeforeId({
            sortableIds,
            activeSortableId: activeStr,
            overSortableId: overStr,
            targetKind: "group",
            targetContainerId: targetParentID,
            getContainerId: (item: AssetTreeSortableItem) =>
              item.kind === "group" ? groupParentById.get(item.id) : undefined,
          });
          if (beforeID === null) return;
          await ReorderGroup(activeId, targetParentID, beforeID);
        } else if (overKind === "asset") {
          const overAsset = assets.find((a) => a.ID === overId);
          if (!overAsset || overAsset.GroupID === 0) return;
          // 拖到资产所在分组下,作为该分组末位子分组
          await ReorderGroup(activeId, overAsset.GroupID, 0);
        }
      }
      await refresh();
    } catch (err) {
      if (appliedOptimisticAssetMove) {
        void refresh();
      }
      toast.error(String(err));
    }
  };

  const handleConfirmDelete = async (deleteAssets: boolean) => {
    if (!deleteConfirm) return;
    try {
      await deleteGroup(deleteConfirm.id, deleteAssets);
    } catch (e) {
      toast.error(String(e));
    }
    setDeleteConfirm(null);
  };

  const handleGroupContextMenuClose = useCallback(() => setGroupContextMenu(null), []);

  const handleGroupContextMenu = useCallback((group: group_entity.Group, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setGroupContextMenu({ group, position: { x: event.clientX, y: event.clientY } });
  }, []);

  const renderGroupContextMenu = (group: group_entity.Group) => (
    <GroupContextMenuContent
      group={group}
      t={t}
      onAddAsset={onAddAsset}
      onEditGroup={onEditGroup}
      onMoveGroup={handleMoveGroup}
      onDeleteGroup={handleDeleteGroup}
      onClose={handleGroupContextMenuClose}
    />
  );

  if (collapsed) return null;

  return (
    <div className="flex h-full w-full flex-col border-r border-panel-divider bg-sidebar">
      <div className="flex flex-col gap-1.5 px-3 pt-2 pb-2 border-b border-panel-divider">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {sidebarHidden && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onShowSidebar}
                title={t("panel.showSidebar")}
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
            )}
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("asset.title")}
            </span>
          </div>
          <div className="flex gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onAddGroup()}
                  aria-label={t("asset.addGroup")}
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("asset.addGroup")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onAddAsset()}
                  aria-label={t("asset.addAsset")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("asset.addAsset")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("asset.search")}
              className="h-7 w-full rounded-md border border-sidebar-border bg-sidebar pl-7 pr-2 text-xs outline-none focus-visible:border-ring/70 focus-visible:ring-1 focus-visible:ring-ring/45 placeholder:text-muted-foreground/60 transition-colors duration-150"
            />
          </div>
          <AssetTypeFilterButton
            value={selectedTypes}
            options={typeOptions}
            onChange={setSelectedTypes}
            hideEmptyGroups={hideEmptyGroups}
            onHideEmptyGroupsChange={setHideEmptyGroups}
          />
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragCancel={() => setDragPreviewAsset(null)}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <div className="p-2 space-y-0.5 isolate">
              {visibleRootGroups.map((group) => (
                <GroupItem
                  key={group.ID}
                  group={group}
                  assets={groupedAssets.get(group.ID) || []}
                  allGroupedAssets={groupedAssets}
                  childGroups={childGroups}
                  countAssetsInGroup={countAssetsInGroup}
                  selectedAssetId={selectedAssetId}
                  activeAssetIds={activeAssetIds}
                  connectingAssetIds={connectingAssetIds}
                  onSelectAsset={onSelectAsset}
                  onAddAsset={onAddAsset}
                  onEditAsset={onEditAsset}
                  onCopyAsset={onCopyAsset}
                  onConnectAsset={onConnectAsset}
                  onConnectAssetInNewTab={onConnectAssetInNewTab}
                  onOpenFileManager={onOpenFileManager}
                  onEditGroup={onEditGroup}
                  onGroupDetail={onGroupDetail}
                  onDeleteAsset={(asset: asset_entity.Asset) => setDeleteAssetConfirm(asset)}
                  onMoveAsset={handleMoveAsset}
                  onOpenInfoTab={onOpenInfoTab}
                  onGroupContextMenu={handleGroupContextMenu}
                  depth={0}
                  t={t}
                />
              ))}
              {rootAssets.length > 0 && (
                <GroupItem
                  group={
                    new group_entity.Group({
                      ID: 0,
                      Name: t("asset.ungrouped"),
                    })
                  }
                  assets={rootAssets}
                  allGroupedAssets={groupedAssets}
                  childGroups={() => []}
                  countAssetsInGroup={() => rootAssets.length}
                  selectedAssetId={selectedAssetId}
                  activeAssetIds={activeAssetIds}
                  connectingAssetIds={connectingAssetIds}
                  onSelectAsset={onSelectAsset}
                  onAddAsset={onAddAsset}
                  onEditAsset={onEditAsset}
                  onCopyAsset={onCopyAsset}
                  onConnectAsset={onConnectAsset}
                  onConnectAssetInNewTab={onConnectAssetInNewTab}
                  onOpenFileManager={onOpenFileManager}
                  onEditGroup={onEditGroup}
                  onGroupDetail={onGroupDetail}
                  onDeleteAsset={(asset) => setDeleteAssetConfirm(asset)}
                  onMoveAsset={handleMoveAsset}
                  onOpenInfoTab={onOpenInfoTab}
                  onGroupContextMenu={handleGroupContextMenu}
                  depth={0}
                  t={t}
                />
              )}
              {treeIsEmpty && (
                <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Server className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium text-sidebar-foreground">
                      {t(isFilteredEmpty ? "asset.noMatchTitle" : "asset.emptyTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t(isFilteredEmpty ? "asset.noMatchDesc" : "asset.emptyDesc")}
                    </p>
                  </div>
                  {isFilteredEmpty ? (
                    <div className="flex flex-wrap justify-center gap-1">
                      {hasSearchFilter && (
                        <Button variant="ghost" size="xs" onClick={() => setFilter("")}>
                          {t("asset.clearSearch")}
                        </Button>
                      )}
                      {hasTypeFilter && (
                        <Button variant="ghost" size="xs" onClick={() => setSelectedTypes([])}>
                          {t("asset.clearTypeFilter")}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Button variant="outline" size="xs" onClick={() => onAddAsset()}>
                      <Plus className="h-3 w-3" />
                      {t("asset.addAsset")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {dragPreviewAsset ? (
              <AssetDragPreview asset={dragPreviewAsset} active={activeAssetIds.has(dragPreviewAsset.ID)} />
            ) : null}
          </DragOverlay>
        </DndContext>
      </ScrollArea>
      {groupContextMenu && (
        <ContextMenu open onOpenChange={(open) => !open && handleGroupContextMenuClose()}>
          <ContextMenuContent
            alignToStylePosition
            style={{
              position: "fixed",
              left: groupContextMenu.position.x,
              top: groupContextMenu.position.y,
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {renderGroupContextMenu(groupContextMenu.group)}
          </ContextMenuContent>
        </ContextMenu>
      )}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent onOverlayClick={() => setDeleteConfirm(null)}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("asset.deleteGroupTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm?.assetCount
                ? t("asset.deleteGroupDescDetailed", {
                    assetCount: deleteConfirm.assetCount,
                    childGroupCount: deleteConfirm.childGroupCount,
                  })
                : t("asset.deleteGroupDescChildrenOnly", { childGroupCount: deleteConfirm?.childGroupCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("action.cancel")}</AlertDialogCancel>
            {deleteConfirm?.assetCount ? (
              <>
                <AlertDialogAction onClick={() => handleConfirmDelete(false)}>
                  {t("asset.moveToUngrouped")}
                </AlertDialogAction>
                <AlertDialogAction variant="destructive" onClick={() => handleConfirmDelete(true)}>
                  {t("asset.deleteAssets")}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction variant="destructive" onClick={() => handleConfirmDelete(false)}>
                {t("asset.deleteGroupOnly")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ConfirmDialog
        open={!!deleteAssetConfirm}
        onOpenChange={(open) => !open && setDeleteAssetConfirm(null)}
        title={t("asset.deleteAssetTitle")}
        description={t("asset.deleteAssetDesc", { name: deleteAssetConfirm?.Name })}
        cancelText={t("action.cancel")}
        confirmText={t("action.delete")}
        onConfirm={() => {
          if (deleteAssetConfirm) {
            deleteAsset(deleteAssetConfirm.ID);
          }
          setDeleteAssetConfirm(null);
        }}
      />
    </div>
  );
}

function GroupContextMenuContent({
  group,
  t,
  onAddAsset,
  onEditGroup,
  onMoveGroup,
  onDeleteGroup,
  onClose,
}: {
  group: group_entity.Group;
  t: (key: string) => string;
  onAddAsset: (groupId: number) => void;
  onEditGroup: (group: group_entity.Group) => void;
  onMoveGroup: (id: number, direction: string) => void;
  onDeleteGroup: (id: number) => void;
  onClose: () => void;
}) {
  const run = (action: () => void) => {
    action();
    onClose();
  };
  const isUngrouped = group.ID === 0;

  return (
    <>
      <ContextMenuItem onClick={() => run(() => onAddAsset(group.ID))}>
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        {t("asset.addAsset")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={isUngrouped} onClick={() => run(() => onEditGroup(group))}>
        <Settings2 className="h-3.5 w-3.5 mr-1.5" />
        {t("asset.editGroupSettings")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={isUngrouped} onClick={() => run(() => onMoveGroup(group.ID, "up"))}>
        <ArrowUp className="h-3.5 w-3.5 mr-1.5" />
        {t("asset.moveUp")}
      </ContextMenuItem>
      <ContextMenuItem disabled={isUngrouped} onClick={() => run(() => onMoveGroup(group.ID, "down"))}>
        <ArrowDown className="h-3.5 w-3.5 mr-1.5" />
        {t("asset.moveDown")}
      </ContextMenuItem>
      <ContextMenuItem disabled={isUngrouped} onClick={() => run(() => onMoveGroup(group.ID, "top"))}>
        <ChevronsUp className="h-3.5 w-3.5 mr-1.5" />
        {t("asset.moveTop")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={isUngrouped}
        className="text-destructive"
        onClick={() => run(() => onDeleteGroup(group.ID))}
      >
        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
        {t("action.delete")}
      </ContextMenuItem>
    </>
  );
}

function DynamicIcon({ icon, className, style }: { icon?: string; className?: string; style?: React.CSSProperties }) {
  return React.createElement(icon ? getIconComponent(icon) : Folder, { className, style });
}

function AssetDragPreview({ asset, active }: { asset: asset_entity.Asset; active: boolean }) {
  return (
    <div className="flex min-w-36 max-w-56 items-center gap-1.5 rounded-md border bg-popover px-2 py-1.5 text-sm shadow-lg">
      <DynamicIcon
        icon={asset.Icon || undefined}
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        style={asset.Icon ? { color: getIconColor(asset.Icon) } : undefined}
      />
      {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />}
      <span className="truncate text-popover-foreground">{asset.Name}</span>
    </div>
  );
}

function GroupItem({
  group,
  assets,
  allGroupedAssets,
  childGroups,
  countAssetsInGroup,
  selectedAssetId,
  activeAssetIds,
  connectingAssetIds,
  onSelectAsset,
  onAddAsset,
  onEditAsset,
  onCopyAsset,
  onConnectAsset,
  onConnectAssetInNewTab,
  onOpenFileManager,
  onEditGroup,
  onGroupDetail,
  onDeleteAsset,
  onMoveAsset,
  onOpenInfoTab,
  onGroupContextMenu,
  depth,
  t,
}: {
  group: group_entity.Group;
  assets: asset_entity.Asset[];
  allGroupedAssets: Map<number, asset_entity.Asset[]>;
  childGroups: (parentId: number) => group_entity.Group[];
  countAssetsInGroup: (groupId: number) => number;
  selectedAssetId: number | null;
  activeAssetIds: Set<number>;
  connectingAssetIds: Set<number>;
  onSelectAsset: (asset: asset_entity.Asset) => void;
  onAddAsset: (groupId: number) => void;
  onEditAsset: (asset: asset_entity.Asset) => void;
  onCopyAsset: (asset: asset_entity.Asset) => void;
  onConnectAsset: (asset: asset_entity.Asset) => void;
  onConnectAssetInNewTab?: (asset: asset_entity.Asset) => void;
  onOpenFileManager?: (asset: asset_entity.Asset) => void;
  onEditGroup: (group: group_entity.Group) => void;
  onGroupDetail: (group: group_entity.Group) => void;
  onDeleteAsset: (asset: asset_entity.Asset) => void;
  onMoveAsset: (id: number, direction: string) => void;
  onOpenInfoTab?: (type: "asset" | "group", id: number, name: string, icon?: string) => void;
  onGroupContextMenu: (group: group_entity.Group, event: React.MouseEvent) => void;
  depth: number;
  t: (key: string) => string;
}) {
  /* eslint-disable react-hooks/refs */
  const expanded = useAssetStore((s) => !s.collapsedGroupIds.includes(group.ID));
  const toggleGroupCollapsed = useAssetStore((s) => s.toggleGroupCollapsed);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const children = group.ID > 0 ? childGroups(group.ID) : [];
  const totalCount = countAssetsInGroup(group.ID);
  const isUngrouped = group.ID === 0;

  const sortable = useSortable({
    id: `group-${group.ID}`,
    disabled: isUngrouped ? { draggable: true, droppable: false } : false,
  });
  const contentDrop = useDroppable({ id: `group-drop-${group.ID}` });
  const groupRowStyle: React.CSSProperties = {
    paddingLeft: `${8 + depth * 12}px`,
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : undefined,
    position: "relative",
    zIndex: sortable.isDragging ? 20 : undefined,
  };

  const groupActivatorProps = !isUngrouped
    ? {
        ...sortable.attributes,
        ...sortable.listeners,
      }
    : {};

  const groupRowContent = (
    <div
      // dnd-kit's setNodeRef is a callback, not a React ref.
      ref={sortable.setNodeRef}
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium outline-none hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-sidebar-ring/60 cursor-pointer transition-colors duration-150"
      style={groupRowStyle}
      onClick={() => toggleGroupCollapsed(group.ID)}
      onContextMenu={(e) => onGroupContextMenu(group, e)}
      {...groupActivatorProps}
    >
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <DynamicIcon
        icon={group.Icon}
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        style={group.Icon ? { color: getIconColor(group.Icon) } : undefined}
      />
      <span className="truncate text-sidebar-foreground">{group.Name}</span>
      <span className="ml-auto text-xs text-muted-foreground">{totalCount}</span>
    </div>
  );

  return (
    <div>
      {groupRowContent}
      {expanded && (
        <div className="tree-group-content">
          {children.map((child) => (
            <GroupItem
              key={child.ID}
              group={child}
              assets={allGroupedAssets.get(child.ID) || []}
              allGroupedAssets={allGroupedAssets}
              childGroups={childGroups}
              countAssetsInGroup={countAssetsInGroup}
              selectedAssetId={selectedAssetId}
              activeAssetIds={activeAssetIds}
              connectingAssetIds={connectingAssetIds}
              onSelectAsset={onSelectAsset}
              onAddAsset={onAddAsset}
              onEditAsset={onEditAsset}
              onCopyAsset={onCopyAsset}
              onConnectAsset={onConnectAsset}
              onConnectAssetInNewTab={onConnectAssetInNewTab}
              onOpenFileManager={onOpenFileManager}
              onEditGroup={onEditGroup}
              onGroupDetail={onGroupDetail}
              onDeleteAsset={onDeleteAsset}
              onMoveAsset={onMoveAsset}
              onOpenInfoTab={onOpenInfoTab}
              onGroupContextMenu={onGroupContextMenu}
              depth={depth + 1}
              t={t}
            />
          ))}
          {assets.map((asset) => (
            <AssetRow
              key={asset.ID}
              asset={asset}
              depth={depth}
              selectedAssetId={selectedAssetId}
              activeAssetIds={activeAssetIds}
              connectingAssetIds={connectingAssetIds}
              clickTimerRef={clickTimerRef}
              onSelectAsset={onSelectAsset}
              onEditAsset={onEditAsset}
              onCopyAsset={onCopyAsset}
              onConnectAsset={onConnectAsset}
              onConnectAssetInNewTab={onConnectAssetInNewTab}
              onOpenFileManager={onOpenFileManager}
              onDeleteAsset={onDeleteAsset}
              onMoveAsset={onMoveAsset}
              onOpenInfoTab={onOpenInfoTab}
              t={t}
            />
          ))}
          {assets.length === 0 && children.length === 0 && (
            <div
              ref={contentDrop.setNodeRef}
              className={`pr-2 py-1 text-xs text-muted-foreground cursor-pointer hover:underline ${
                contentDrop.isOver ? "bg-sidebar-accent" : ""
              }`}
              style={{ paddingLeft: `${20 + (depth + 1) * 12}px` }}
              onClick={() => onAddAsset(group.ID)}
            >
              + {t("asset.addAsset")}
            </div>
          )}
          {(assets.length > 0 || children.length > 0) && (
            <div
              ref={contentDrop.setNodeRef}
              data-asset-tree-dropzone={`group-${group.ID}-tail`}
              className="relative h-4"
              style={{ marginLeft: `${20 + (depth + 1) * 12}px` }}
            >
              <div
                data-asset-tree-drop-indicator
                className={`pointer-events-none absolute left-0 right-2 top-1/2 h-px -translate-y-1/2 rounded-full bg-primary transition-opacity ${
                  contentDrop.isOver ? "opacity-100" : "opacity-0"
                }`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssetRow({
  asset,
  depth,
  selectedAssetId,
  activeAssetIds,
  connectingAssetIds,
  clickTimerRef,
  onSelectAsset,
  onEditAsset,
  onCopyAsset,
  onConnectAsset,
  onConnectAssetInNewTab,
  onOpenFileManager,
  onDeleteAsset,
  onMoveAsset,
  onOpenInfoTab,
  t,
}: {
  asset: asset_entity.Asset;
  depth: number;
  selectedAssetId: number | null;
  activeAssetIds: Set<number>;
  connectingAssetIds: Set<number>;
  clickTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  onSelectAsset: (asset: asset_entity.Asset) => void;
  onEditAsset: (asset: asset_entity.Asset) => void;
  onCopyAsset: (asset: asset_entity.Asset) => void;
  onConnectAsset: (asset: asset_entity.Asset) => void;
  onConnectAssetInNewTab?: (asset: asset_entity.Asset) => void;
  onOpenFileManager?: (asset: asset_entity.Asset) => void;
  onDeleteAsset: (asset: asset_entity.Asset) => void;
  onMoveAsset: (id: number, direction: string) => void;
  onOpenInfoTab?: (type: "asset" | "group", id: number, name: string, icon?: string) => void;
  t: (key: string) => string;
}) {
  /* eslint-disable react-hooks/refs */
  const AssetIcon = asset.Icon ? getIconComponent(asset.Icon) : Server;
  const isConnecting = connectingAssetIds.has(asset.ID);
  const sortable = useSortable({ id: `asset-${asset.ID}` });
  const style: React.CSSProperties = {
    paddingLeft: `${20 + (depth + 1) * 12}px`,
    opacity: sortable.isDragging ? 0.5 : undefined,
  };
  const assetActivatorProps = {
    ...sortable.attributes,
    ...sortable.listeners,
  };

  return (
    <div
      // dnd-kit's setNodeRef should live on the same node that receives the sortable transform.
      ref={sortable.setNodeRef}
      className="relative"
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        zIndex: sortable.isDragging ? 20 : undefined,
      }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`flex items-center gap-1.5 rounded-md pr-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring/60 cursor-pointer select-none transition-colors duration-150 ${
              selectedAssetId === asset.ID
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "hover:bg-sidebar-accent"
            }`}
            style={style}
            {...assetActivatorProps}
            onClick={() => {
              if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
              clickTimerRef.current = setTimeout(() => {
                clickTimerRef.current = null;
                onSelectAsset(asset);
              }, 200);
            }}
            onDoubleClick={() => {
              if (clickTimerRef.current) {
                clearTimeout(clickTimerRef.current);
                clickTimerRef.current = null;
              }
              onSelectAsset(asset);
              const def = getAssetType(asset.Type);
              if (def?.canConnect && (def.connectAction === "query" || !isConnecting)) {
                onConnectAsset(asset);
              }
            }}
          >
            {isConnecting ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground animate-spin" />
            ) : (
              <AssetIcon
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                style={asset.Icon ? { color: getIconColor(asset.Icon) } : undefined}
              />
            )}
            {activeAssetIds.has(asset.ID) && <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />}
            <span className="truncate text-sidebar-foreground">{asset.Name}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {getAssetType(asset.Type)?.canConnect && (
            <ContextMenuItem onClick={() => onConnectAsset(asset)} disabled={isConnecting}>
              {isConnecting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <TerminalSquare className="h-3.5 w-3.5 mr-1.5" />
              )}
              {t("asset.connect")}
            </ContextMenuItem>
          )}
          {getAssetType(asset.Type)?.canConnectInNewTab && onConnectAssetInNewTab && (
            <ContextMenuItem onClick={() => onConnectAssetInNewTab(asset)} disabled={isConnecting}>
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              {t("asset.connectInNewTab")}
            </ContextMenuItem>
          )}
          {asset.Type === "ssh" && onOpenFileManager && (
            <ContextMenuItem onClick={() => onOpenFileManager(asset)}>
              <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
              {t("sftp.fileManager")}
            </ContextMenuItem>
          )}
          {onOpenInfoTab && (
            <ContextMenuItem onClick={() => onOpenInfoTab("asset", asset.ID, asset.Name, asset.Icon)}>
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              {t("action.editPermission")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => onEditAsset(asset)}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            {t("action.edit")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCopyAsset(asset)}>
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            {t("action.copy")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onMoveAsset(asset.ID, "up")}>
            <ArrowUp className="h-3.5 w-3.5 mr-1.5" />
            {t("asset.moveUp")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onMoveAsset(asset.ID, "down")}>
            <ArrowDown className="h-3.5 w-3.5 mr-1.5" />
            {t("asset.moveDown")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onMoveAsset(asset.ID, "top")}>
            <ChevronsUp className="h-3.5 w-3.5 mr-1.5" />
            {t("asset.moveTop")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive" onClick={() => onDeleteAsset(asset)}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            {t("action.delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
