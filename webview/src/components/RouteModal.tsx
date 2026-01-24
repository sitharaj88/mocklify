import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, postMessage } from '../store';
import { Route, Plus, Trash2, Code, Settings2, Filter, Clock } from 'lucide-react';
import type { RouteConfig, HttpMethod, ResponseConfig } from '../types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Textarea,
  FormGroup,
  Label,
  FormHint,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from './ui';
import { cn } from '../lib/utils';

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

const tabs = [
  { id: 'basic', label: 'Basic', icon: Route },
  { id: 'response', label: 'Response', icon: Code },
  { id: 'matching', label: 'Matching', icon: Filter },
  { id: 'advanced', label: 'Advanced', icon: Settings2 },
];

function getMethodColor(method: HttpMethod): string {
  const colors: Record<HttpMethod, string> = {
    GET: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    POST: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    PUT: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    DELETE: 'bg-red-500/15 text-red-400 border-red-500/30',
    PATCH: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    HEAD: 'bg-surface-500/15 text-surface-400 border-surface-500/30',
    OPTIONS: 'bg-surface-500/15 text-surface-400 border-surface-500/30',
  };
  return colors[method] || colors.GET;
}

export function RouteModal() {
  const { editingRoute, selectedServerId, showRouteModal, setShowRouteModal, setEditingRoute } = useStore();

  const [activeTab, setActiveTab] = useState('basic');

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

      const headers = Object.entries(editingRoute.response.headers || {}).map(([key, value]) => ({
        key,
        value,
      }));
      setResponseHeaders(headers);

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
      setActiveTab('basic');
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

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(responseBody);
    } catch {
      parsedBody = responseBody;
    }

    const headersObj: Record<string, string> = { 'Content-Type': contentType };
    responseHeaders.forEach((h) => {
      if (h.key) headersObj[h.key] = h.value;
    });

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
    <Dialog open={showRouteModal} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-500/15">
              <Route className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <DialogTitle>{isEditing ? 'Edit Route' : 'Create New Route'}</DialogTitle>
              <DialogDescription>
                {isEditing ? 'Update route configuration' : 'Define endpoint behavior and response'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="px-4 sm:px-6 pt-4">
            <TabsList className="w-full grid grid-cols-4">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <tab.icon size={14} className="hidden sm:block" />
                  <tab.icon size={12} className="block sm:hidden" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.label.slice(0, 3)}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="py-4 min-h-[280px] sm:min-h-[320px] overflow-y-auto max-h-[50vh]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15 }}
                >
                  {/* Basic Tab */}
                  <TabsContent value="basic" className="space-y-5 mt-0">
                    <FormGroup>
                      <Label>Route Name</Label>
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Get Users"
                      />
                    </FormGroup>

                    <div className="grid grid-cols-2 gap-4">
                      <FormGroup>
                        <Label required>Method</Label>
                        <Select value={method} onValueChange={(v) => setMethod(v as HttpMethod)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {HTTP_METHODS.map((m) => (
                              <SelectItem key={m} value={m}>
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    'px-1.5 py-0.5 rounded text-xs font-mono font-bold',
                                    getMethodColor(m)
                                  )}>
                                    {m}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormGroup>

                      <FormGroup>
                        <Label required>Status Code</Label>
                        <Select
                          value={statusCode.toString()}
                          onValueChange={(v) => setStatusCode(parseInt(v))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_CODES.map((s) => (
                              <SelectItem key={s.code} value={s.code.toString()}>
                                <span className="font-mono">{s.code}</span>
                                <span className="text-surface-500 ml-2">{s.text}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormGroup>
                    </div>

                    <FormGroup>
                      <Label required>Path</Label>
                      <Input
                        value={path}
                        onChange={(e) => setPath(e.target.value)}
                        placeholder="/api/users/:id"
                        className="font-mono"
                      />
                      <FormHint>
                        Use :param for path parameters, * for single segment, ** for catch-all
                      </FormHint>
                    </FormGroup>
                  </TabsContent>

                  {/* Response Tab */}
                  <TabsContent value="response" className="space-y-5 mt-0">
                    <div className="grid grid-cols-2 gap-4">
                      <FormGroup>
                        <Label>Response Type</Label>
                        <Select value={responseType} onValueChange={(v) => setResponseType(v as any)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="static">Static Response</SelectItem>
                            <SelectItem value="dynamic">Dynamic (Template)</SelectItem>
                            <SelectItem value="proxy">Proxy to Real Server</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormGroup>

                      <FormGroup>
                        <Label>Content Type</Label>
                        <Select value={contentType} onValueChange={setContentType}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="application/json">application/json</SelectItem>
                            <SelectItem value="text/plain">text/plain</SelectItem>
                            <SelectItem value="text/html">text/html</SelectItem>
                            <SelectItem value="application/xml">application/xml</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormGroup>
                    </div>

                    <FormGroup>
                      <Label>Response Body</Label>
                      <Textarea
                        value={responseBody}
                        onChange={(e) => setResponseBody(e.target.value)}
                        rows={8}
                        className="font-mono text-sm"
                        placeholder='{"message": "Hello World"}'
                      />
                      <FormHint>
                        Use {'{{params.id}}'} for path params, {'{{faker.email}}'} for fake data
                      </FormHint>
                    </FormGroup>

                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <Label className="mb-0">Response Headers</Label>
                        <Button type="button" variant="ghost" size="sm" onClick={addHeader}>
                          <Plus size={14} />
                          Add Header
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {responseHeaders.map((header, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input
                              value={header.key}
                              onChange={(e) => {
                                const newHeaders = [...responseHeaders];
                                newHeaders[index].key = e.target.value;
                                setResponseHeaders(newHeaders);
                              }}
                              placeholder="Header Name"
                              className="flex-1"
                            />
                            <Input
                              value={header.value}
                              onChange={(e) => {
                                const newHeaders = [...responseHeaders];
                                newHeaders[index].value = e.target.value;
                                setResponseHeaders(newHeaders);
                              }}
                              placeholder="Header Value"
                              className="flex-1"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeHeader(index)}
                            >
                              <Trash2 size={14} className="text-red-400" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </TabsContent>

                  {/* Matching Tab */}
                  <TabsContent value="matching" className="space-y-5 mt-0">
                    <p className="text-sm text-surface-400">
                      Add conditions that must match for this route to handle the request.
                    </p>

                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <Label className="mb-0">Match Request Headers</Label>
                        <Button type="button" variant="ghost" size="sm" onClick={addMatchHeader}>
                          <Plus size={14} />
                          Add
                        </Button>
                      </div>
                      {matchHeaders.length === 0 ? (
                        <p className="text-xs text-surface-500 py-2">No header conditions</p>
                      ) : (
                        <div className="space-y-2">
                          {matchHeaders.map((header, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <Input
                                value={header.key}
                                onChange={(e) => {
                                  const newHeaders = [...matchHeaders];
                                  newHeaders[index].key = e.target.value;
                                  setMatchHeaders(newHeaders);
                                }}
                                placeholder="Header Name"
                                className="flex-1"
                              />
                              <Input
                                value={header.value}
                                onChange={(e) => {
                                  const newHeaders = [...matchHeaders];
                                  newHeaders[index].value = e.target.value;
                                  setMatchHeaders(newHeaders);
                                }}
                                placeholder="Expected Value"
                                className="flex-1"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeMatchHeader(index)}
                              >
                                <Trash2 size={14} className="text-red-400" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <Label className="mb-0">Match Query Parameters</Label>
                        <Button type="button" variant="ghost" size="sm" onClick={addMatchQuery}>
                          <Plus size={14} />
                          Add
                        </Button>
                      </div>
                      {matchQuery.length === 0 ? (
                        <p className="text-xs text-surface-500 py-2">No query parameter conditions</p>
                      ) : (
                        <div className="space-y-2">
                          {matchQuery.map((query, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <Input
                                value={query.key}
                                onChange={(e) => {
                                  const newQuery = [...matchQuery];
                                  newQuery[index].key = e.target.value;
                                  setMatchQuery(newQuery);
                                }}
                                placeholder="Parameter Name"
                                className="flex-1"
                              />
                              <Input
                                value={query.value}
                                onChange={(e) => {
                                  const newQuery = [...matchQuery];
                                  newQuery[index].value = e.target.value;
                                  setMatchQuery(newQuery);
                                }}
                                placeholder="Expected Value"
                                className="flex-1"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeMatchQuery(index)}
                              >
                                <Trash2 size={14} className="text-red-400" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  {/* Advanced Tab */}
                  <TabsContent value="advanced" className="space-y-5 mt-0">
                    <FormGroup>
                      <Label>Response Delay</Label>
                      <Select value={delayType} onValueChange={(v) => setDelayType(v as any)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No Delay</SelectItem>
                          <SelectItem value="fixed">Fixed Delay</SelectItem>
                          <SelectItem value="random">Random Delay</SelectItem>
                        </SelectContent>
                      </Select>

                      <AnimatePresence>
                        {delayType === 'fixed' && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-3"
                          >
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                value={delayValue}
                                onChange={(e) => setDelayValue(parseInt(e.target.value) || 0)}
                                min={0}
                                className="w-32"
                              />
                              <span className="text-sm text-surface-400">ms</span>
                            </div>
                          </motion.div>
                        )}

                        {delayType === 'random' && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-3"
                          >
                            <div className="grid grid-cols-2 gap-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-surface-400">Min:</span>
                                <Input
                                  type="number"
                                  value={delayMin}
                                  onChange={(e) => setDelayMin(parseInt(e.target.value) || 0)}
                                  min={0}
                                  className="flex-1"
                                />
                                <span className="text-sm text-surface-400">ms</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-surface-400">Max:</span>
                                <Input
                                  type="number"
                                  value={delayMax}
                                  onChange={(e) => setDelayMax(parseInt(e.target.value) || 0)}
                                  min={0}
                                  className="flex-1"
                                />
                                <span className="text-sm text-surface-400">ms</span>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </FormGroup>

                    <FormGroup>
                      <Label>Priority</Label>
                      <Input
                        type="number"
                        value={priority}
                        onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                        className="w-32"
                      />
                      <FormHint>Higher priority routes are matched first (default: 0)</FormHint>
                    </FormGroup>
                  </TabsContent>
                </motion.div>
              </AnimatePresence>
            </div>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit">
              {isEditing ? 'Save Changes' : 'Create Route'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
