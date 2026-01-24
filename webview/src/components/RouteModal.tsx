import { useState, useEffect } from 'react';
import { useStore, postMessage } from '../store';
import { X, Plus, Trash2 } from 'lucide-react';
import type { RouteConfig, HttpMethod, ResponseConfig } from '../types';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
const STATUS_CODES = [
  { code: 200, text: 'OK' },
  { code: 201, text: 'Created' },
  { code: 204, text: 'No Content' },
  { code: 400, text: 'Bad Request' },
  { code: 401, text: 'Unauthorized' },
  { code: 403, text: 'Forbidden' },
  { code: 404, text: 'Not Found' },
  { code: 500, text: 'Internal Server Error' },
];

export function RouteModal() {
  const { editingRoute, selectedServerId, setShowRouteModal, setEditingRoute } = useStore();

  const [activeTab, setActiveTab] = useState<'basic' | 'response' | 'matching' | 'advanced'>('basic');

  // Basic
  const [name, setName] = useState('');
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [path, setPath] = useState('');

  // Response
  const [responseType, setResponseType] = useState<'static' | 'dynamic' | 'proxy'>('static');
  const [statusCode, setStatusCode] = useState(200);
  const [contentType, setContentType] = useState('application/json');
  const [responseBody, setResponseBody] = useState('{\n  \n}');
  const [responseHeaders, setResponseHeaders] = useState<{ key: string; value: string }[]>([]);

  // Matching
  const [matchHeaders, setMatchHeaders] = useState<{ key: string; value: string }[]>([]);
  const [matchQuery, setMatchQuery] = useState<{ key: string; value: string }[]>([]);

  // Advanced
  const [delayType, setDelayType] = useState<'none' | 'fixed' | 'random'>('none');
  const [delayValue, setDelayValue] = useState(0);
  const [delayMin, setDelayMin] = useState(0);
  const [delayMax, setDelayMax] = useState(1000);
  const [priority, setPriority] = useState(0);

  const isEditing = !!editingRoute;

  useEffect(() => {
    if (editingRoute) {
      setName(editingRoute.name);
      setMethod(Array.isArray(editingRoute.method) ? editingRoute.method[0] : editingRoute.method);
      setPath(editingRoute.path);
      setResponseType(editingRoute.response.type as any);
      setStatusCode(editingRoute.response.statusCode);
      setContentType(editingRoute.response.body?.contentType || 'application/json');
      setResponseBody(
        typeof editingRoute.response.body?.content === 'string'
          ? editingRoute.response.body.content
          : JSON.stringify(editingRoute.response.body?.content, null, 2) || '{\n  \n}'
      );

      // Headers
      const headers = Object.entries(editingRoute.response.headers || {}).map(([key, value]) => ({
        key,
        value,
      }));
      setResponseHeaders(headers);

      // Matching
      if (editingRoute.matcher?.headers) {
        setMatchHeaders(
          Object.entries(editingRoute.matcher.headers).map(([key, value]) => ({ key, value }))
        );
      }
      if (editingRoute.matcher?.queryParams) {
        setMatchQuery(
          Object.entries(editingRoute.matcher.queryParams).map(([key, value]) => ({ key, value }))
        );
      }

      // Delay
      if (editingRoute.delay) {
        setDelayType(editingRoute.delay.type);
        if (editingRoute.delay.type === 'fixed') {
          setDelayValue(editingRoute.delay.value || 0);
        } else {
          setDelayMin(editingRoute.delay.min || 0);
          setDelayMax(editingRoute.delay.max || 1000);
        }
      }

      setPriority(editingRoute.priority || 0);
    } else {
      // Reset form
      setName('');
      setMethod('GET');
      setPath('/');
      setResponseType('static');
      setStatusCode(200);
      setContentType('application/json');
      setResponseBody('{\n  \n}');
      setResponseHeaders([]);
      setMatchHeaders([]);
      setMatchQuery([]);
      setDelayType('none');
      setDelayValue(0);
      setDelayMin(0);
      setDelayMax(1000);
      setPriority(0);
    }
  }, [editingRoute]);

  const handleClose = () => {
    setShowRouteModal(false);
    setEditingRoute(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedServerId) {
      alert('No server selected');
      return;
    }

    if (!path.startsWith('/')) {
      alert('Path must start with /');
      return;
    }

    // Parse response body
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(responseBody);
    } catch {
      parsedBody = responseBody;
    }

    // Build headers object
    const headersObj: Record<string, string> = { 'Content-Type': contentType };
    responseHeaders.forEach((h) => {
      if (h.key) headersObj[h.key] = h.value;
    });

    // Build matcher
    const matcher: RouteConfig['matcher'] = {};
    if (matchHeaders.length > 0) {
      matcher.headers = {};
      matchHeaders.forEach((h) => {
        if (h.key) matcher.headers![h.key] = h.value;
      });
    }
    if (matchQuery.length > 0) {
      matcher.queryParams = {};
      matchQuery.forEach((q) => {
        if (q.key) matcher.queryParams![q.key] = q.value;
      });
    }

    const response: ResponseConfig = {
      type: responseType,
      statusCode,
      headers: headersObj,
      body: {
        contentType,
        content: parsedBody,
      },
    };

    const routeData: Partial<RouteConfig> = {
      name: name || path,
      enabled: true,
      method,
      path,
      response,
      matcher: Object.keys(matcher).length > 0 ? matcher : undefined,
      delay:
        delayType === 'none'
          ? undefined
          : delayType === 'fixed'
          ? { type: 'fixed', value: delayValue }
          : { type: 'random', min: delayMin, max: delayMax },
      priority: priority || undefined,
    };

    if (isEditing && editingRoute) {
      postMessage({
        type: 'updateRoute',
        serverId: selectedServerId,
        routeId: editingRoute.id,
        data: routeData,
      });
    } else {
      postMessage({
        type: 'createRoute',
        serverId: selectedServerId,
        data: routeData,
      });
    }

    handleClose();
  };

  const addHeader = () => setResponseHeaders([...responseHeaders, { key: '', value: '' }]);
  const removeHeader = (index: number) =>
    setResponseHeaders(responseHeaders.filter((_, i) => i !== index));

  const addMatchHeader = () => setMatchHeaders([...matchHeaders, { key: '', value: '' }]);
  const removeMatchHeader = (index: number) =>
    setMatchHeaders(matchHeaders.filter((_, i) => i !== index));

  const addMatchQuery = () => setMatchQuery([...matchQuery, { key: '', value: '' }]);
  const removeMatchQuery = (index: number) =>
    setMatchQuery(matchQuery.filter((_, i) => i !== index));

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" style={{ maxWidth: '700px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isEditing ? 'Edit Route' : 'Create New Route'}</h2>
          <button className="btn btn-ghost btn-icon" onClick={handleClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Tabs */}
          <div className="tabs" style={{ margin: '16px 20px 0' }}>
            {(['basic', 'response', 'matching', 'advanced'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div className="modal-body">
            {/* Basic Tab */}
            {activeTab === 'basic' && (
              <>
                <div className="form-group">
                  <label className="form-label">Route Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Get Users"
                  />
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Method *</label>
                    <select
                      className="form-select"
                      value={method}
                      onChange={(e) => setMethod(e.target.value as HttpMethod)}
                    >
                      {HTTP_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Status Code *</label>
                    <select
                      className="form-select"
                      value={statusCode}
                      onChange={(e) => setStatusCode(parseInt(e.target.value))}
                    >
                      {STATUS_CODES.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.code} {s.text}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Path *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="/api/users/:id"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Use :param for path parameters, * for single segment wildcard, ** for catch-all
                  </p>
                </div>
              </>
            )}

            {/* Response Tab */}
            {activeTab === 'response' && (
              <>
                <div className="form-group">
                  <label className="form-label">Response Type</label>
                  <select
                    className="form-select"
                    value={responseType}
                    onChange={(e) => setResponseType(e.target.value as any)}
                  >
                    <option value="static">Static Response</option>
                    <option value="dynamic">Dynamic (Template)</option>
                    <option value="proxy">Proxy to Real Server</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Content Type</label>
                  <select
                    className="form-select"
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                  >
                    <option value="application/json">application/json</option>
                    <option value="text/plain">text/plain</option>
                    <option value="text/html">text/html</option>
                    <option value="application/xml">application/xml</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Response Body</label>
                  <textarea
                    className="form-textarea"
                    value={responseBody}
                    onChange={(e) => setResponseBody(e.target.value)}
                    rows={10}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                    placeholder='{"message": "Hello World"}'
                  />
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Use {'{{params.id}}'} for path params, {'{{faker.email}}'} for fake data
                  </p>
                </div>

                {/* Response Headers */}
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label className="form-label" style={{ margin: 0 }}>
                      Response Headers
                    </label>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={addHeader}>
                      <Plus size={14} /> Add Header
                    </button>
                  </div>
                  {responseHeaders.map((header, index) => (
                    <div key={index} className="form-input-group" style={{ marginBottom: '8px' }}>
                      <input
                        type="text"
                        className="form-input"
                        value={header.key}
                        onChange={(e) => {
                          const newHeaders = [...responseHeaders];
                          newHeaders[index].key = e.target.value;
                          setResponseHeaders(newHeaders);
                        }}
                        placeholder="Header Name"
                      />
                      <input
                        type="text"
                        className="form-input"
                        value={header.value}
                        onChange={(e) => {
                          const newHeaders = [...responseHeaders];
                          newHeaders[index].value = e.target.value;
                          setResponseHeaders(newHeaders);
                        }}
                        placeholder="Header Value"
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        onClick={() => removeHeader(index)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Matching Tab */}
            {activeTab === 'matching' && (
              <>
                <p style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  Add conditions that must match for this route to handle the request.
                </p>

                {/* Match Headers */}
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label className="form-label" style={{ margin: 0 }}>
                      Match Request Headers
                    </label>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={addMatchHeader}>
                      <Plus size={14} /> Add
                    </button>
                  </div>
                  {matchHeaders.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      No header conditions
                    </p>
                  ) : (
                    matchHeaders.map((header, index) => (
                      <div key={index} className="form-input-group" style={{ marginBottom: '8px' }}>
                        <input
                          type="text"
                          className="form-input"
                          value={header.key}
                          onChange={(e) => {
                            const newHeaders = [...matchHeaders];
                            newHeaders[index].key = e.target.value;
                            setMatchHeaders(newHeaders);
                          }}
                          placeholder="Header Name"
                        />
                        <input
                          type="text"
                          className="form-input"
                          value={header.value}
                          onChange={(e) => {
                            const newHeaders = [...matchHeaders];
                            newHeaders[index].value = e.target.value;
                            setMatchHeaders(newHeaders);
                          }}
                          placeholder="Expected Value"
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          onClick={() => removeMatchHeader(index)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Match Query Params */}
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label className="form-label" style={{ margin: 0 }}>
                      Match Query Parameters
                    </label>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={addMatchQuery}>
                      <Plus size={14} /> Add
                    </button>
                  </div>
                  {matchQuery.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      No query parameter conditions
                    </p>
                  ) : (
                    matchQuery.map((query, index) => (
                      <div key={index} className="form-input-group" style={{ marginBottom: '8px' }}>
                        <input
                          type="text"
                          className="form-input"
                          value={query.key}
                          onChange={(e) => {
                            const newQuery = [...matchQuery];
                            newQuery[index].key = e.target.value;
                            setMatchQuery(newQuery);
                          }}
                          placeholder="Parameter Name"
                        />
                        <input
                          type="text"
                          className="form-input"
                          value={query.value}
                          onChange={(e) => {
                            const newQuery = [...matchQuery];
                            newQuery[index].value = e.target.value;
                            setMatchQuery(newQuery);
                          }}
                          placeholder="Expected Value"
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          onClick={() => removeMatchQuery(index)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {/* Advanced Tab */}
            {activeTab === 'advanced' && (
              <>
                <div className="form-group">
                  <label className="form-label">Response Delay</label>
                  <select
                    className="form-select"
                    value={delayType}
                    onChange={(e) => setDelayType(e.target.value as any)}
                    style={{ marginBottom: '8px' }}
                  >
                    <option value="none">No Delay</option>
                    <option value="fixed">Fixed Delay</option>
                    <option value="random">Random Delay</option>
                  </select>

                  {delayType === 'fixed' && (
                    <div className="form-input-group">
                      <input
                        type="number"
                        className="form-input"
                        value={delayValue}
                        onChange={(e) => setDelayValue(parseInt(e.target.value) || 0)}
                        min={0}
                      />
                      <span style={{ padding: '8px', color: 'var(--text-secondary)' }}>ms</span>
                    </div>
                  )}

                  {delayType === 'random' && (
                    <div className="grid-2">
                      <div className="form-input-group">
                        <span style={{ padding: '8px', color: 'var(--text-secondary)' }}>Min:</span>
                        <input
                          type="number"
                          className="form-input"
                          value={delayMin}
                          onChange={(e) => setDelayMin(parseInt(e.target.value) || 0)}
                          min={0}
                        />
                        <span style={{ padding: '8px', color: 'var(--text-secondary)' }}>ms</span>
                      </div>
                      <div className="form-input-group">
                        <span style={{ padding: '8px', color: 'var(--text-secondary)' }}>Max:</span>
                        <input
                          type="number"
                          className="form-input"
                          value={delayMax}
                          onChange={(e) => setDelayMax(parseInt(e.target.value) || 0)}
                          min={0}
                        />
                        <span style={{ padding: '8px', color: 'var(--text-secondary)' }}>ms</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <input
                    type="number"
                    className="form-input"
                    value={priority}
                    onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                    style={{ width: '150px' }}
                  />
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Higher priority routes are matched first (default: 0)
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {isEditing ? 'Save Changes' : 'Create Route'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
