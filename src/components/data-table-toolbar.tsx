"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface ColumnDef<T extends string> {
  id: T;
  label: string;
  defaultVisible?: boolean;
}

interface DataTableToolbarProps<T extends string> {
  storageKey: string;
  columns: ColumnDef<T>[];
  filters?: Array<{ id: string; label: string }>;
  onColumnsChange: (visible: T[]) => void;
  onFilterChange?: (filterId: string) => void;
  searchPlaceholder?: string;
  onSearchChange?: (q: string) => void;
}

interface SavedPrefs<T extends string> {
  visibleColumns: T[];
  filterId?: string;
}

function readSavedPrefs<T extends string>(
  storageKey: string,
  defaultVisible: T[],
  defaultFilterId: string
): { visible: T[]; filterId: string } {
  if (typeof window === "undefined") {
    return { visible: defaultVisible, filterId: defaultFilterId };
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { visible: defaultVisible, filterId: defaultFilterId };
    const prefs = JSON.parse(raw) as SavedPrefs<T>;
    return {
      visible: prefs.visibleColumns?.length ? prefs.visibleColumns : defaultVisible,
      filterId: prefs.filterId || defaultFilterId,
    };
  } catch {
    return { visible: defaultVisible, filterId: defaultFilterId };
  }
}

export function DataTableToolbar<T extends string>({
  storageKey,
  columns,
  filters = [],
  onColumnsChange,
  onFilterChange,
  searchPlaceholder = "Filter rows…",
  onSearchChange,
}: DataTableToolbarProps<T>) {
  const defaultVisible = useMemo(
    () => columns.filter((c) => c.defaultVisible !== false).map((c) => c.id),
    [columns]
  );
  const defaultFilterId = filters[0]?.id || "all";

  const [visible, setVisible] = useState<T[]>(() =>
    readSavedPrefs(storageKey, defaultVisible, defaultFilterId).visible
  );
  const [filterId, setFilterId] = useState(() =>
    readSavedPrefs(storageKey, defaultVisible, defaultFilterId).filterId
  );
  const [search, setSearch] = useState("");
  const [showCols, setShowCols] = useState(false);
  const syncedParent = useRef(false);

  useEffect(() => {
    if (syncedParent.current) return;
    syncedParent.current = true;
    onColumnsChange(visible);
    onFilterChange?.(filterId);
  }, [visible, filterId, onColumnsChange, onFilterChange]);

  function persist(next: SavedPrefs<T>) {
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function toggleColumn(id: T) {
    const next = visible.includes(id) ? visible.filter((c) => c !== id) : [...visible, id];
    if (!next.length) return;
    setVisible(next);
    onColumnsChange(next);
    persist({ visibleColumns: next, filterId });
  }

  function selectFilter(id: string) {
    setFilterId(id);
    onFilterChange?.(id);
    persist({ visibleColumns: visible, filterId: id });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {onSearchChange && (
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            onSearchChange(e.target.value);
          }}
          placeholder={searchPlaceholder}
          className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm min-w-[180px]"
        />
      )}
      {filters.length > 0 && (
        <select
          value={filterId}
          onChange={(e) => selectFilter(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm"
        >
          {filters.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowCols((v) => !v)}
          className="border border-border rounded-lg px-3 py-1.5 text-sm hover:bg-secondary"
        >
          Columns
        </button>
        {showCols && (
          <div className="absolute z-20 mt-1 right-0 min-w-[160px] rounded-lg border border-border bg-card p-2 shadow-lg">
            {columns.map((c) => (
              <label key={c.id} className="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer hover:bg-secondary rounded">
                <input
                  type="checkbox"
                  checked={visible.includes(c.id)}
                  onChange={() => toggleColumn(c.id)}
                />
                {c.label}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
