import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import type { Arrow } from './layout';

export type CallEdgeType = Edge<{ arrow: Arrow }, 'call'>;

/** A call arrow: a smooth curve in the caller's colour, with its order number. */
export function CallEdge(props: EdgeProps<CallEdgeType>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } =
    props;
  const arrow = data?.arrow;
  let path: string;
  let labelX: number;
  let labelY: number;

  if (arrow?.sameCard) {
    // Both ends are rows of one class card: loop out to the right and back.
    const reach = 56 + Math.min(Math.abs(targetY - sourceY) / 4, 40);
    path = `M ${sourceX} ${sourceY} C ${sourceX + reach} ${sourceY}, ${targetX + reach} ${targetY}, ${targetX} ${targetY}`;
    labelX = Math.max(sourceX, targetX) + reach * 0.75;
    labelY = (sourceY + targetY) / 2;
  } else if (targetX < sourceX - 20) {
    // A backward arrow (a call cycle): curve underneath both cards instead of
    // leaving to the right and crossing them.
    const below = Math.max(sourceY, targetY) + 110;
    const midX = (sourceX + targetX) / 2;
    path = `M ${sourceX} ${sourceY} C ${sourceX + 70} ${sourceY}, ${sourceX + 70} ${below}, ${midX} ${below} S ${targetX - 70} ${targetY}, ${targetX} ${targetY}`;
    labelX = midX;
    labelY = below;
  } else {
    [path, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  }

  const edge = arrow?.edge;
  const lines = edge?.callLines.join(', ') ?? '';
  const tip = edge?.order
    ? `Call ${edge.order} in code order · line ${lines}`
    : `Called on line ${lines}`;

  return (
    <>
      <g className={`call-edge from-${arrow?.callerKind ?? 'function'}`}>
        <title>{tip}</title>
        <BaseEdge path={path} markerEnd={markerEnd} interactionWidth={16} />
      </g>
      {edge && edge.order > 0 && (
        <EdgeLabelRenderer>
          <div
            className={`badge from-${arrow.callerKind}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={tip}
          >
            {edge.order}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
