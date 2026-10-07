import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { FlowNode, MemberRow, Relation } from '../shared/types';
import { displayName, kindInfo, useActions } from './actions';
import { handle, type Direction } from './layout';

/** `dimmed`: another card is hovered and this one is not on its path. */
export type CardNode = Node<{ node: FlowNode; isRoot: boolean; dimmed: boolean }, 'card'>;

export function Card({ data }: NodeProps<CardNode>) {
  const { node, isRoot, dimmed } = data;
  const actions = useActions();
  const classLike = node.members !== undefined;
  const kind = kindInfo[node.kind];

  const reveal = () => actions.reveal(node.id);
  const onKey = (event: KeyboardEvent) => {
    // Only when the card itself has focus, not one of its buttons.
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter') {
      reveal();
      return;
    }
    const direction = arrowKeys[event.key];
    if (direction) {
      event.preventDefault();
      event.stopPropagation();
      actions.move(node.id, direction);
    }
  };

  return (
    <div
      className={`card kind-${node.kind}${isRoot ? ' root' : ''}${classLike ? ' class-card' : ''}${dimmed ? ' dimmed' : ''}`}
      onClick={reveal}
      onKeyDown={onKey}
      tabIndex={0}
      data-card-id={node.id}
      role="group"
      aria-label={`${kind.label} ${node.name}, ${node.filePath} line ${node.line}`}
      title={`Open ${node.name} in the editor`}
    >
      <Handle type="target" position={Position.Left} id={handle.in} className="handle" />
      <Handle type="source" position={Position.Right} id={handle.out} className="handle" />

      <div className="card-head">
        <div className="card-kind">
          <span className="glyph" aria-hidden="true">
            {kind.glyph}
          </span>
          <span>{isRoot ? `start · ${kind.label}` : kind.label}</span>
          {node.isRecursive && (
            <span
              className="tag"
              title="Calls itself, directly or through other functions (recursion)"
            >
              ↻ recursive
            </span>
          )}
          {node.isExternal && (
            <span className="tag" title="Library or standard-library code, outside your workspace">
              library
            </span>
          )}
          <button
            type="button"
            className="explain-btn"
            title="Explain this in plain language. Sends its code to a language model, after asking. Right-click the card to explain a path."
            onClick={(event) => {
              event.stopPropagation();
              actions.explain(node.id);
            }}
          >
            ✦ Explain
          </button>
        </div>
        <div className="card-name">{displayName(node)}</div>
        {node.docComment && (
          <div className="card-doc" title={node.docComment}>
            {node.docComment}
          </div>
        )}
        <div className="card-path">
          {node.filePath} · line {node.line}
        </div>
        {!classLike && <div className="card-sig">{node.signature || ' '}</div>}
      </div>

      {classLike && <Rows node={node} />}

      <div className="card-actions">
        {!classLike && (
          <Chip node={node} relation="calls" label="Calls →" tip="Show what this calls" />
        )}
        <Chip
          node={node}
          relation="calledBy"
          label="← Called by"
          tip={classLike ? 'Show where this class is created or called' : 'Show what calls this'}
        />
        <Chip
          node={node}
          relation="usedBy"
          label="Used by"
          tip="Show the functions and classes that refer to this (calls, types, imports in code)"
        />
        {classLike && (
          <Chip
            node={node}
            relation="extends"
            label="Extends"
            tip="Show the types this extends or implements, and the types that extend it"
          />
        )}
      </div>
    </div>
  );
}

const arrowKeys: Record<string, Direction | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

function Chip(props: { node: FlowNode; relation: Relation; label: string; tip: string }) {
  const { node, relation } = props;
  const actions = useActions();
  const done = node.expanded.includes(relation);
  const pending = actions.isPending(node.id, relation);
  const onClick = (event: MouseEvent) => {
    event.stopPropagation();
    toggle(actions, node.id, relation, done, pending);
  };
  return (
    <button
      type="button"
      className={`chip${done ? ' done' : ''}${pending ? ' pending' : ''}`}
      onClick={onClick}
      aria-pressed={done}
      disabled={pending}
      title={done ? hideTip(props.tip) : props.tip}
    >
      {pending && <span className="spinner" aria-hidden="true" />}
      {props.label}
    </button>
  );
}

function Rows({ node }: { node: FlowNode }) {
  const members = node.members ?? [];
  return (
    <div className="rows">
      {members.map((member) => (
        <Row key={member.id} member={member} />
      ))}
      {node.hiddenMembers ? (
        <div className="row more">+ {node.hiddenMembers} more members</div>
      ) : null}
      {members.length === 0 && !node.hiddenMembers && <div className="row more">No members</div>}
    </div>
  );
}

function Row({ member }: { member: MemberRow }) {
  const actions = useActions();
  const info = kindInfo[member.kind];
  const expandable = member.kind !== 'field';
  const own = actions.nodeById(member.id);

  const reveal = (event: MouseEvent) => {
    event.stopPropagation();
    actions.reveal(member.id);
  };
  const button = (relation: Relation, text: string, tip: string) => {
    const done = own?.expanded.includes(relation) ?? false;
    const pending = actions.isPending(member.id, relation);
    return (
      <button
        type="button"
        className={`row-btn${done ? ' done' : ''}`}
        title={done ? hideTip(tip) : tip}
        aria-label={`${tip}: ${member.name}`}
        aria-pressed={done}
        disabled={pending}
        onClick={(event) => {
          event.stopPropagation();
          toggle(actions, member.id, relation, done, pending);
        }}
      >
        {pending ? <span className="spinner" aria-hidden="true" /> : text}
      </button>
    );
  };

  return (
    <div
      className={`row kind-${member.kind}${own?.expanded.length ? ' active' : ''}`}
      onClick={reveal}
      title={`Open ${member.name} in the editor`}
    >
      {expandable && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id={handle.rowIn(member.id)}
            className="handle"
          />
          <Handle
            type="source"
            position={Position.Right}
            id={handle.rowOut(member.id)}
            className="handle"
          />
          <Handle
            type="target"
            position={Position.Right}
            id={handle.rowLoop(member.id)}
            className="handle"
          />
        </>
      )}
      <span className="glyph small" aria-hidden="true">
        {info.glyph}
      </span>
      <span className="row-name">{member.name}</span>
      {own?.isRecursive && <span title="Recursive">↻</span>}
      <span className="row-line">{member.line}</span>
      {expandable && (
        <span className="row-btns">
          {button('calledBy', '←', 'Show what calls this')}
          {button('calls', '→', 'Show what this calls')}
        </span>
      )}
    </div>
  );
}

/** A used button hides what it showed; an unused one loads it. */
function toggle(
  actions: ReturnType<typeof useActions>,
  nodeId: string,
  relation: Relation,
  done: boolean,
  pending: boolean,
): void {
  if (pending) {
    return;
  }
  if (done) {
    actions.collapse(nodeId, relation);
  } else {
    actions.expand(nodeId, relation);
  }
}

/** "Show what this calls" becomes "Hide what this calls". */
function hideTip(tip: string): string {
  return tip.replace(/^Show/, 'Hide');
}
