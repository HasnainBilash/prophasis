import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Relation } from '../shared/types';
import { useActions } from './actions';
import { handle, type MoreBox } from './layout';

export type MoreNode = Node<{ more: MoreBox }, 'more'>;

const what: Record<Relation, [string, string]> = {
  calls: ['call', 'calls'],
  calledBy: ['caller', 'callers'],
  usedBy: ['use', 'uses'],
  extends: ['type', 'types'],
  contains: ['member', 'members'],
};

/** Stands in for cards an expansion left out; clicking loads them. */
export function MoreCard({ data }: NodeProps<MoreNode>) {
  const { ownerId, relation, count } = data.more;
  const actions = useActions();
  const [one, many] = what[relation];
  const pending = actions.isPending(ownerId, relation);
  return (
    <div className="more-card">
      <Handle type="target" position={Position.Left} id={handle.in} className="handle" />
      <Handle type="source" position={Position.Right} id={handle.out} className="handle" />
      <span>
        + {count} more {count === 1 ? one : many}
      </span>
      <button
        type="button"
        className="chip"
        disabled={pending}
        title={`Add the ${count} ${count === 1 ? one : many} left out to keep the graph readable`}
        onClick={(event) => {
          event.stopPropagation();
          actions.expand(ownerId, relation, true);
        }}
      >
        {pending && <span className="spinner" aria-hidden="true" />}
        Show all
      </button>
    </div>
  );
}
