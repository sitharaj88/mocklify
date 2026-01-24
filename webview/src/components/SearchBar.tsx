import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const STATUS_CODES = ['2xx', '3xx', '4xx', '5xx'];

export const SearchBar: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    searchFilters,
    setSearchQuery,
    setMethodFilter,
    setStatusFilter,
    setTagsFilter,
    clearFilters,
    getAllTags,
    activeView,
  } = useStore();

  const allTags = getAllTags();
  const showFilters = activeView === 'routes' || activeView === 'logs';

  // Keyboard shortcut: Cmd/Ctrl + K to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        if (searchFilters.query) {
          setSearchQuery('');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchFilters.query, setSearchQuery]);

  if (!showFilters) return null;

  return (
    <div className="flex flex-col gap-3 p-4 border-b border-border bg-background/50">
      {/* Search Input */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search... (⌘K)"
          value={searchFilters.query}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-10 py-2 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {searchFilters.query && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Method Filter */}
        <select
          value={searchFilters.method || ''}
          onChange={(e) => setMethodFilter(e.target.value || null)}
          className="px-3 py-1.5 bg-input border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Methods</option>
          {HTTP_METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>

        {/* Status Filter (only for logs) */}
        {activeView === 'logs' && (
          <select
            value={searchFilters.status || ''}
            onChange={(e) => setStatusFilter(e.target.value || null)}
            className="px-3 py-1.5 bg-input border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Status</option>
            {STATUS_CODES.map((status) => (
              <option key={status} value={status.charAt(0) + '00'}>
                {status} {getStatusLabel(status)}
              </option>
            ))}
          </select>
        )}

        {/* Tags Filter (only for routes) */}
        {activeView === 'routes' && allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => {
                  const isSelected = searchFilters.tags.includes(tag);
                  setTagsFilter(
                    isSelected
                      ? searchFilters.tags.filter((t) => t !== tag)
                      : [...searchFilters.tags, tag]
                  );
                }}
                className={`px-2 py-1 text-xs rounded-full transition-colors ${
                  searchFilters.tags.includes(tag)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Clear Filters */}
        {(searchFilters.query ||
          searchFilters.method ||
          searchFilters.status ||
          searchFilters.tags.length > 0) && (
          <button
            onClick={clearFilters}
            className="ml-auto px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear Filters
          </button>
        )}
      </div>
    </div>
  );
};

function getStatusLabel(status: string): string {
  switch (status) {
    case '2xx':
      return 'Success';
    case '3xx':
      return 'Redirect';
    case '4xx':
      return 'Client Error';
    case '5xx':
      return 'Server Error';
    default:
      return '';
  }
}
