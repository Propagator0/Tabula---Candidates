"use client";

import * as React from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  LayoutGrid,
  Save,
  Table2,
  Eye,
  KeyRound,
  Link2,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ColumnInfo,
  DatabaseSchema,
  TableLayout,
  TableSchema,
} from "@/lib/types";
import { typeTextClass } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const CARD_WIDTH = 220;
const HEADER_HEIGHT = 34;
const ROW_HEIGHT = 24;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const CLICK_THRESHOLD_PX = 4;
const DEFAULT_PAN = { x: 60, y: 60 };

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ErDiagramProps {
  schema: DatabaseSchema;
  layouts: TableLayout[];
  onLayoutChange: (tableName: string, x: number, y: number) => void;
  onSaveLayouts: () => void;
  onTableClick: (tableName: string) => void;
  autoLayout: () => void;
}

interface Relationship {
  id: string;
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
}

interface RelPath {
  id: string;
  d: string;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function ErDiagram({
  schema,
  layouts,
  onLayoutChange,
  onSaveLayouts,
  onTableClick,
  autoLayout,
}: ErDiagramProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const [pan, setPan] = React.useState(DEFAULT_PAN);
  const [zoom, setZoom] = React.useState(1);
  const [isPanning, setIsPanning] = React.useState(false);
  const [hoveredRel, setHoveredRel] = React.useState<string | null>(null);
  const [draggingTable, setDraggingTable] = React.useState<string | null>(null);

  // Refs mirroring state, for use inside non-React (DOM) event handlers
  // where we need fresh values without re-binding the listener.
  const zoomRef = React.useRef(zoom);
  const panValueRef = React.useRef(pan);
  React.useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  React.useEffect(() => {
    panValueRef.current = pan;
  }, [pan]);

  /* ----------------------------- lookups ---------------------------- */

  const tableMap = React.useMemo(() => {
    const m = new Map<string, TableSchema>();
    for (const t of schema.tables) m.set(t.name, t);
    return m;
  }, [schema.tables]);

  const layoutMap = React.useMemo(() => {
    const m = new Map<string, TableLayout>();
    for (const l of layouts) m.set(l.tableName, l);
    return m;
  }, [layouts]);

  const relationships = React.useMemo<Relationship[]>(() => {
    const rels: Relationship[] = [];
    for (const t of schema.tables) {
      for (const col of t.columns) {
        if (col.fk && col.fk.table && col.fk.column) {
          rels.push({
            id: `${t.name}.${col.name}->${col.fk.table}.${col.fk.column}`,
            childTable: t.name,
            childColumn: col.name,
            parentTable: col.fk.table,
            parentColumn: col.fk.column,
          });
        }
      }
    }
    return rels;
  }, [schema.tables]);

  const cardHeightFor = React.useCallback(
    (t: TableSchema) => HEADER_HEIGHT + t.columns.length * ROW_HEIGHT,
    []
  );

  /* --------------------------- pan handlers ------------------------- */

  const panDragRef = React.useRef({
    panning: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  const onCanvasPointerDown = React.useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    panDragRef.current = {
      panning: true,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: panValueRef.current.x,
      startPanY: panValueRef.current.y,
    };
    setIsPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onCanvasPointerMove = React.useCallback((e: React.PointerEvent) => {
    if (!panDragRef.current.panning) return;
    const dx = e.clientX - panDragRef.current.startX;
    const dy = e.clientY - panDragRef.current.startY;
    setPan({
      x: panDragRef.current.startPanX + dx,
      y: panDragRef.current.startPanY + dy,
    });
  }, []);

  const onCanvasPointerUp = React.useCallback((e: React.PointerEvent) => {
    if (!panDragRef.current.panning) return;
    panDragRef.current.panning = false;
    setIsPanning(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  /* --------------------- wheel zoom (non-passive) ------------------- */

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const prevZoom = zoomRef.current;
      const prevPan = panValueRef.current;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * factor));
      if (newZoom === prevZoom) return;
      // Keep the world point under the cursor stationary.
      setPan({
        x: cursorX - ((cursorX - prevPan.x) / prevZoom) * newZoom,
        y: cursorY - ((cursorY - prevPan.y) / prevZoom) * newZoom,
      });
      setZoom(newZoom);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  /* ------------------------- card drag state ------------------------ */

  const cardDragRef = React.useRef({
    dragging: false,
    tableName: "",
    startPointerX: 0,
    startPointerY: 0,
    startCardX: 0,
    startCardY: 0,
    moved: false,
  });

  const onCardPointerDown = React.useCallback(
    (e: React.PointerEvent, tableName: string) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // don't start panning the canvas
      const layout = layoutMap.get(tableName);
      if (!layout) return;
      cardDragRef.current = {
        dragging: true,
        tableName,
        startPointerX: e.clientX,
        startPointerY: e.clientY,
        startCardX: layout.x,
        startCardY: layout.y,
        moved: false,
      };
      setDraggingTable(tableName);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [layoutMap]
  );

  const onCardPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!cardDragRef.current.dragging) return;
      const dx = e.clientX - cardDragRef.current.startPointerX;
      const dy = e.clientY - cardDragRef.current.startPointerY;
      if (
        Math.abs(dx) > CLICK_THRESHOLD_PX ||
        Math.abs(dy) > CLICK_THRESHOLD_PX
      ) {
        cardDragRef.current.moved = true;
      }
      const z = zoomRef.current;
      const newX = cardDragRef.current.startCardX + dx / z;
      const newY = cardDragRef.current.startCardY + dy / z;
      onLayoutChange(cardDragRef.current.tableName, newX, newY);
    },
    [onLayoutChange]
  );

  const onCardPointerUp = React.useCallback(
    (e: React.PointerEvent) => {
      if (!cardDragRef.current.dragging) return;
      const wasMoved = cardDragRef.current.moved;
      const tableName = cardDragRef.current.tableName;
      cardDragRef.current.dragging = false;
      cardDragRef.current.moved = false;
      setDraggingTable(null);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!wasMoved) onTableClick(tableName);
    },
    [onTableClick]
  );

  /* --------------------------- fit-to-view -------------------------- */

  const fitToView = React.useCallback(() => {
    const el = containerRef.current;
    if (!el || layouts.length === 0) {
      setZoom(1);
      setPan(DEFAULT_PAN);
      return;
    }
    const rect = el.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const l of layouts) {
      const t = tableMap.get(l.tableName);
      const h = t ? cardHeightFor(t) : HEADER_HEIGHT;
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + CARD_WIDTH);
      maxY = Math.max(maxY, l.y + h);
    }
    if (!isFinite(minX)) {
      setZoom(1);
      setPan(DEFAULT_PAN);
      return;
    }
    const padding = 60;
    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    const containerW = rect.width - padding * 2;
    const containerH = rect.height - padding * 2;
    if (containerW <= 0 || containerH <= 0) return;
    const newZoom = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Math.min(containerW / bboxW, containerH / bboxH))
    );
    const newPanX =
      padding + (containerW - bboxW * newZoom) / 2 - minX * newZoom;
    const newPanY =
      padding + (containerH - bboxH * newZoom) / 2 - minY * newZoom;
    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [layouts, tableMap, cardHeightFor]);

  const zoomBy = React.useCallback((factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const prevZoom = zoomRef.current;
    const prevPan = panValueRef.current;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * factor));
    if (newZoom === prevZoom) return;
    setPan({
      x: cx - ((cx - prevPan.x) / prevZoom) * newZoom,
      y: cy - ((cy - prevPan.y) / prevZoom) * newZoom,
    });
    setZoom(newZoom);
  }, []);

  /* ----------------------- relationship paths ----------------------- */

  const relPaths = React.useMemo<RelPath[]>(() => {
    const paths: RelPath[] = [];
    for (const rel of relationships) {
      const childTable = tableMap.get(rel.childTable);
      const parentTable = tableMap.get(rel.parentTable);
      const childLayout = layoutMap.get(rel.childTable);
      const parentLayout = layoutMap.get(rel.parentTable);
      if (!childTable || !parentTable || !childLayout || !parentLayout) continue;

      const childIdx = childTable.columns.findIndex(
        (c) => c.name === rel.childColumn
      );
      const parentIdx = parentTable.columns.findIndex(
        (c) => c.name === rel.parentColumn
      );
      if (childIdx < 0 || parentIdx < 0) continue;

      const childCenterY =
        childLayout.y + HEADER_HEIGHT + childIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
      const parentCenterY =
        parentLayout.y +
        HEADER_HEIGHT +
        parentIdx * ROW_HEIGHT +
        ROW_HEIGHT / 2;

      const childCenterX = childLayout.x + CARD_WIDTH / 2;
      const parentCenterX = parentLayout.x + CARD_WIDTH / 2;

      // Pick the closer edges so lines don't wrap around unnecessarily.
      const childSide: "left" | "right" =
        parentCenterX >= childCenterX ? "right" : "left";
      const parentSide: "left" | "right" =
        childSide === "right" ? "left" : "right";

      const startX =
        childSide === "right" ? childLayout.x + CARD_WIDTH : childLayout.x;
      const endX =
        parentSide === "right" ? parentLayout.x + CARD_WIDTH : parentLayout.x;

      const start = { x: startX, y: childCenterY };
      const end = { x: endX, y: parentCenterY };
      const offset = Math.max(50, Math.abs(end.x - start.x) * 0.4);
      const cp1x = childSide === "right" ? start.x + offset : start.x - offset;
      const cp2x = parentSide === "right" ? end.x + offset : end.x - offset;

      const d = `M ${start.x} ${start.y} C ${cp1x} ${start.y}, ${cp2x} ${end.y}, ${end.x} ${end.y}`;
      paths.push({ id: rel.id, d });
    }
    return paths;
  }, [relationships, tableMap, layoutMap]);

  /* --------------------------- empty state -------------------------- */

  if (schema.tables.length === 0) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-grid bg-background">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="rounded-full bg-muted p-4">
            <Database className="size-8 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold text-foreground">
              No tables yet
            </p>
            <p className="text-sm text-muted-foreground">
              Create a table to start designing your schema.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------ render ---------------------------- */

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {/* Canvas — handles pan + wheel zoom */}
      <div
        ref={containerRef}
        className={cn(
          "absolute inset-0 bg-grid select-none touch-none",
          isPanning ? "cursor-grabbing" : "cursor-grab"
        )}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerUp}
      >
        {/* World — single transformed wrapper. All children use world coords. */}
        <div
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {/* Relationship lines (SVG in world coords) */}
          <svg
            className="absolute left-0 top-0 overflow-visible"
            style={{
              width: 1,
              height: 1,
              overflow: "visible",
              pointerEvents: "none",
            }}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="er-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="9"
                markerHeight="9"
                orient="auto-start-reverse"
                markerUnits="userSpaceOnUse"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  fill="var(--type-fk)"
                  opacity="0.85"
                />
              </marker>
            </defs>
            {relPaths.map(({ id, d }) => {
              const hovered = hoveredRel === id;
              return (
                <g key={id}>
                  {/* Visible line — purely visual, no pointer events */}
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--type-fk)"
                    strokeWidth={hovered ? 3 : 1.5}
                    strokeOpacity={hovered ? 0.9 : 0.5}
                    strokeLinecap="round"
                    markerEnd="url(#er-arrow)"
                    style={{ pointerEvents: "none" }}
                  />
                  {/* Wide invisible hit-area on top — receives hover events */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    style={{ pointerEvents: "stroke", cursor: "pointer" }}
                    onMouseEnter={() => setHoveredRel(id)}
                    onMouseLeave={() =>
                      setHoveredRel((h) => (h === id ? null : h))
                    }
                  />
                </g>
              );
            })}
          </svg>

          {/* Table cards */}
          {schema.tables.map((table) => {
            const layout = layoutMap.get(table.name);
            if (!layout) return null;
            const isView = table.type === "view";
            const isDragging = draggingTable === table.name;
            return (
              <div
                key={table.name}
                className={cn(
                  "absolute rounded-lg border bg-card shadow-sm transition-all duration-150",
                  "z-10 hover:z-20 hover:shadow-lg hover:-translate-y-0.5 hover:ring-1 hover:ring-primary/40",
                  isDragging && "shadow-lg ring-2 ring-primary/50 scale-[1.02]"
                )}
                style={{
                  left: layout.x,
                  top: layout.y,
                  width: CARD_WIDTH,
                  zIndex: isDragging ? 30 : undefined,
                  cursor: isDragging ? "grabbing" : "grab",
                  touchAction: "none",
                }}
                onPointerDown={(e) => onCardPointerDown(e, table.name)}
                onPointerMove={onCardPointerMove}
                onPointerUp={onCardPointerUp}
                onPointerCancel={onCardPointerUp}
              >
                {/* Accent strip */}
                <div
                  className={cn(
                    "h-1 rounded-t-lg",
                    isView
                      ? "bg-gradient-to-r from-[var(--type-text)] to-[var(--chart-2)]"
                      : "bg-gradient-to-r from-primary to-primary/60"
                  )}
                />
                {/* Header */}
                <div
                  className="flex items-center gap-2 border-b bg-primary/5 px-3"
                  style={{ height: HEADER_HEIGHT }}
                >
                  {isView ? (
                    <Eye className="size-3.5 shrink-0 text-primary" />
                  ) : (
                    <Table2 className="size-3.5 shrink-0 text-primary" />
                  )}
                  <span className="flex-1 truncate font-mono text-sm font-semibold text-foreground">
                    {table.name}
                  </span>
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                    {table.rowCount} rows
                  </span>
                </div>

                {/* Columns */}
                <div className="py-1">
                  {table.columns.map((col) => (
                    <ColumnRow
                      key={`${table.name}.${col.cid}`}
                      col={col}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating toolbar */}
      <div
        className="absolute left-3 top-3 z-50 flex items-center gap-1 rounded-lg border bg-card/80 p-1 shadow-sm backdrop-blur"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <ToolbarButton label="Zoom in" onClick={() => zoomBy(1.2)}>
          <ZoomIn className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          <ZoomOut className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Fit to view" onClick={fitToView}>
          <Maximize2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Auto layout" onClick={autoLayout}>
          <LayoutGrid className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Save layout" onClick={onSaveLayouts}>
          <Save className="size-4" />
        </ToolbarButton>
        <div
          className="px-2 font-mono text-xs tabular-nums text-muted-foreground"
          aria-label={`Zoom level ${Math.round(zoom * 100)} percent`}
        >
          {Math.round(zoom * 100)}%
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function ColumnRow({ col }: { col: ColumnInfo }) {
  const isPk = col.pk === 1;
  const isFk = !!col.fk;
  const isNotNull = col.notNull === 1 && !isPk;
  return (
    <div
      className="group flex items-center gap-2 px-3 transition-colors hover:bg-accent/40 border-b border-border/30 last:border-b-0"
      style={{ height: ROW_HEIGHT }}
    >
      <span className="flex w-3.5 shrink-0 items-center justify-center">
        {isPk ? (
          <KeyRound className="size-3 tint-pk" />
        ) : isFk ? (
          <Link2 className="size-3 tint-fk" />
        ) : null}
      </span>
      <span
        className={cn(
          "flex-1 truncate font-mono text-xs",
          isPk ? "tint-pk font-semibold" : "text-foreground"
        )}
      >
        {col.name}
      </span>
      {isNotNull && (
        <span
          className="size-1 rounded-full bg-muted-foreground/40"
          title="NOT NULL"
        />
      )}
      <span
        className={cn(
          "shrink-0 font-mono text-[10px]",
          typeTextClass(col.type)
        )}
      >
        {col.type || "blob"}
      </span>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export default ErDiagram;
