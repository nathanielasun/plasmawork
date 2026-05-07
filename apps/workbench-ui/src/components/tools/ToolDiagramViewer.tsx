import { useMemo, useState } from "react";
import { Card, Pill } from "../ui";

interface DiagramNodeInput {
  id?: unknown;
  label?: unknown;
  x?: unknown;
  y?: unknown;
}

interface DiagramEdgeInput {
  source?: unknown;
  target?: unknown;
  label?: unknown;
}

interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface DiagramEdge {
  source: string;
  target: string;
  label?: string;
}

interface DiagramSpec {
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

interface ToolDiagramViewerProps {
  title?: string;
  value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNode(raw: DiagramNodeInput, index: number, count: number): DiagramNode {
  const angle = (Math.PI * 2 * index) / Math.max(count, 1);
  const id = typeof raw.id === "string" ? raw.id : `node-${index + 1}`;
  return {
    id,
    label: typeof raw.label === "string" ? raw.label : id,
    x: typeof raw.x === "number" ? raw.x : 250 + Math.cos(angle) * 160,
    y: typeof raw.y === "number" ? raw.y : 180 + Math.sin(angle) * 105,
  };
}

function normalizeDiagram(value: unknown): DiagramSpec | null {
  if (!isRecord(value)) return null;
  const rawNodes = Array.isArray(value.nodes) ? value.nodes : [];
  const rawEdges = Array.isArray(value.edges) ? value.edges : [];
  const nodes = rawNodes
    .filter(isRecord)
    .map((node, index) => normalizeNode(node, index, rawNodes.length));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = rawEdges
    .filter(isRecord)
    .map((edge): DiagramEdge | null => {
      const raw = edge as DiagramEdgeInput;
      if (typeof raw.source !== "string" || typeof raw.target !== "string") return null;
      if (!nodeIds.has(raw.source) || !nodeIds.has(raw.target)) return null;
      return {
        source: raw.source,
        target: raw.target,
        label: typeof raw.label === "string" ? raw.label : undefined,
      };
    })
    .filter((edge): edge is DiagramEdge => edge !== null);
  if (nodes.length === 0) return null;
  return {
    title: typeof value.title === "string" ? value.title : "Structured diagram",
    nodes,
    edges,
  };
}

export default function ToolDiagramViewer({
  title = "Diagram",
  value,
}: ToolDiagramViewerProps) {
  const [zoom, setZoom] = useState(1);
  const spec = useMemo(() => normalizeDiagram(value), [value]);

  if (!spec) {
    return (
      <Card nested title={title} subtitle="Diagram renderer accepts structured nodes/edges JSON only.">
        <p className="placeholder">Unsupported diagram payload. Raw HTML and scripts are refused.</p>
        <pre className="tool-json-preview">
          <code>{JSON.stringify(value, null, 2)}</code>
        </pre>
      </Card>
    );
  }

  const nodeById = new Map(spec.nodes.map((node) => [node.id, node]));
  const viewWidth = 500 / zoom;
  const viewHeight = 360 / zoom;

  return (
    <Card
      nested
      title={title}
      subtitle={spec.title}
      action={
        <div className="action-row">
          <button type="button" onClick={() => setZoom((current) => Math.min(current + 0.25, 2))}>
            Zoom in
          </button>
          <button type="button" onClick={() => setZoom((current) => Math.max(current - 0.25, 0.5))}>
            Zoom out
          </button>
          <button type="button" onClick={() => setZoom(1)}>
            Reset
          </button>
        </div>
      }
    >
      <div className="tool-diagram-shell">
        <svg
          className="tool-diagram-svg"
          role="img"
          aria-label={spec.title}
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <marker id="tool-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" />
            </marker>
          </defs>
          {spec.edges.map((edge) => {
            const source = nodeById.get(edge.source);
            const target = nodeById.get(edge.target);
            if (!source || !target) return null;
            const key = `${edge.source}->${edge.target}`;
            return (
              <g key={key}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className="tool-diagram-edge"
                  markerEnd="url(#tool-arrow)"
                />
                {edge.label && (
                  <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 6} className="tool-diagram-label">
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
          {spec.nodes.map((node) => (
            <g key={node.id}>
              <circle cx={node.x} cy={node.y} r="28" className="tool-diagram-node" />
              <text x={node.x} y={node.y + 4} textAnchor="middle" className="tool-diagram-node-label">
                {node.label.slice(0, 18)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="token-cloud">
        <Pill kind="diagnostic">{spec.nodes.length} nodes</Pill>
        <Pill kind="validation">{spec.edges.length} edges</Pill>
        <Pill kind="draft">zoom {Math.round(zoom * 100)}%</Pill>
      </div>
    </Card>
  );
}
