import React from 'react';
import './setup';
import { Icon } from './components';
import { useI18n } from './useI18n';
import type { QaRequest } from './buildReq';

// ── QA Touchstone — GraphQL editor + schema explorer (mock introspection) ──
const { useState: useStateGQ } = React;

// mock introspection 的 schema 形狀（window.QA.GRAPHQL_SCHEMA；canned 資料）。
interface GqlField {
  name: string;
  args?: string;
  type?: string;
}
interface GqlSchemaType {
  name: string;
  kind: string;
  fields: GqlField[];
}
interface GqlSchema {
  endpoint?: string;
  types: GqlSchemaType[];
}

export interface GqlTypeProps {
  t: GqlSchemaType;
  onInsert?: (fieldName: string) => void;
}

// One expandable type in the schema explorer.
function GqlType({ t, onInsert }: GqlTypeProps) {
  const { t: tr } = useI18n();
  const [open, setOpen] = useStateGQ(t.name === 'Query');
  return (
    <div className="gql-type">
      <button className="gql-type-head" onClick={() => setOpen((o) => !o)}>
        <Icon name="chevron" size={12} className="gql-type-chev" data-open={open ? '1' : '0'} />
        <span className="gql-type-kind" data-kind={t.kind}>
          {t.kind === 'ENUM' ? 'enum' : 'type'}
        </span>
        <span className="gql-type-name">{t.name}</span>
        <span className="gql-type-count">{t.fields.length}</span>
      </button>
      {open && (
        <div className="gql-fields">
          {t.fields.map((f) => (
            <button
              key={f.name}
              className="gql-field"
              onClick={() => onInsert && onInsert(f.name)}
              title={tr('graphql.insertField')}
            >
              <span className="gql-field-name">{f.name}</span>
              {f.args && <span className="gql-field-args">{f.args}</span>}
              {f.type && <span className="gql-field-type">{f.type}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface SchemaExplorerProps {
  schema: GqlSchema;
}

function SchemaExplorer({ schema }: SchemaExplorerProps) {
  const { t } = useI18n();
  const [q, setQ] = useStateGQ('');
  const types = schema.types.filter(
    (t) =>
      !q ||
      t.name.toLowerCase().includes(q.toLowerCase()) ||
      t.fields.some((f) => f.name.toLowerCase().includes(q.toLowerCase()))
  );
  return (
    <div className="gql-schema">
      <div className="gql-schema-head">
        <span>
          <Icon name="layers" size={12} /> {t('graphql.schema')}
        </span>
        <span className="qa-meta">{schema.endpoint}</span>
      </div>
      <div className="qa-search gql-schema-search">
        <Icon name="search" size={12} />
        <input placeholder={t('graphql.filter')} value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button onClick={() => setQ('')} aria-label={t('common.clear')}>
            <Icon name="x" size={11} />
          </button>
        )}
      </div>
      <div className="gql-schema-scroll">
        {types.map((t) => (
          <GqlType key={t.name} t={t} />
        ))}
        {!types.length && <div className="qa-empty-mini">{t('graphql.noMatches')}</div>}
      </div>
    </div>
  );
}

export interface GraphQLEditorProps {
  req: QaRequest;
  patch: (delta: Partial<QaRequest>) => void;
}

// The Body-tab content shown when bodyMode === 'graphql'.
function GraphQLEditor({ req, patch }: GraphQLEditorProps) {
  const { t } = useI18n();
  const [showSchema, setShowSchema] = useStateGQ(true);
  const [sub, setSub] = useStateGQ('query'); // query | variables
  const schema = window.QA.GRAPHQL_SCHEMA;
  let varErr = '';
  if ((req.gqlVars || '').trim()) {
    try {
      JSON.parse(req.gqlVars);
    } catch {
      varErr = t('graphql.invalidJson');
    }
  }
  return (
    <div className="gql">
      <div className="gql-main">
        <div className="gql-bar">
          <div className="qa-segs qa-segs--mini">
            <button data-active={sub === 'query' ? '1' : '0'} onClick={() => setSub('query')}>
              {t('graphql.query')}
            </button>
            <button
              data-active={sub === 'variables' ? '1' : '0'}
              onClick={() => setSub('variables')}
            >
              {t('graphql.variables')}
              {(req.gqlVars || '').trim() ? ' •' : ''}
            </button>
          </div>
          <button className="qa-hist-expbtn" onClick={() => setShowSchema((s) => !s)}>
            <Icon name="layers" size={12} />{' '}
            {showSchema ? t('graphql.hideSchema') : t('graphql.showSchema')}
          </button>
        </div>
        {sub === 'query' && (
          <textarea
            className="qa-code-input gql-editor"
            spellCheck="false"
            value={req.gqlQuery || ''}
            onChange={(e) => patch({ gqlQuery: e.target.value })}
            placeholder={'query {\n  users {\n    id\n    name\n  }\n}'}
          />
        )}
        {sub === 'variables' && (
          <>
            <textarea
              className="qa-code-input gql-editor"
              spellCheck="false"
              value={req.gqlVars || ''}
              onChange={(e) => patch({ gqlVars: e.target.value })}
              placeholder={'{\n  "id": "7301"\n}'}
            />
            {varErr && (
              <div className="rn-data-err">
                <Icon name="x" size={12} /> {varErr}
              </div>
            )}
          </>
        )}
      </div>
      {showSchema && <SchemaExplorer schema={schema} />}
    </div>
  );
}

Object.assign(window, { GraphQLEditor, SchemaExplorer });

export { GraphQLEditor, SchemaExplorer };
