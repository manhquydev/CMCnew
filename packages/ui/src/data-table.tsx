import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Group,
  Pagination,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronDown, IconChevronUp, IconSearch, IconSelector } from '@tabler/icons-react';
import {
  applySearch,
  applySort,
  pageCount,
  paginate,
  type SortDir,
} from './data-table-utils.js';

/* DataTable — column-driven table wrapper with built-in search, client sort,
   pagination, and explicit loading / error / empty states. Replaces raw <Table>
   plus the hand-rolled load-state branching repeated across panels. */

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Enables header sort; returns the comparable value for a row. */
  sortValue?: (row: T) => unknown;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  getRowKey: (row: T) => string;
  /** Loading -> skeleton rows; error -> retry alert; empty -> emptyState slot. */
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Shown when there are zero rows (after load, no error). */
  emptyState?: ReactNode;
  /** Shown when a search/filter yields zero rows but data exists. */
  noResults?: ReactNode;
  /** Enable the built-in search box; provide text accessor per row. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** Extra filter controls rendered in the toolbar next to search. */
  toolbar?: ReactNode;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  /** Skeleton row count while loading. Default 6. */
  skeletonRows?: number;
  /**
   * Visual density. `compact` (default) is Odoo-grade scan density for list views;
   * `comfortable` keeps the looser default spacing. Compact auto-relaxes to
   * comfortable below the `sm` breakpoint to preserve touch targets on mobile.
   */
  density?: 'comfortable' | 'compact';
}

export function DataTable<T>({
  data,
  columns,
  getRowKey,
  loading = false,
  error = null,
  onRetry,
  emptyState,
  noResults,
  searchText,
  searchPlaceholder = 'Tìm kiếm…',
  toolbar,
  pageSize = 20,
  onRowClick,
  skeletonRows = 6,
  density = 'compact',
}: DataTableProps<T>) {
  // Compact density only ≥ sm; below that, relax to comfortable for touch targets.
  const isWide = useMediaQuery('(min-width: 48em)');
  const compact = density === 'compact' && isWide;
  const compactHeaderStyle = compact
    ? {
        backgroundColor: 'var(--cmc-dt-header-bg)',
        fontSize: 'var(--cmc-dt-header-font)',
        textTransform: 'uppercase' as const,
        letterSpacing: 'var(--cmc-dt-header-ls)',
        color: 'var(--cmc-dt-header-color)',
        fontWeight: 'var(--cmc-weight-semibold)',
      }
    : undefined;
  // Drives Mantine Table's spacing CSS vars from tokens (no magic numbers).
  const compactTableStyle: CSSProperties | undefined = compact
    ? ({
        '--table-vertical-spacing': 'var(--cmc-dt-cell-py)',
        '--table-horizontal-spacing': 'var(--cmc-dt-cell-px)',
        fontSize: 'var(--cmc-dt-font)',
      } as CSSProperties)
    : undefined;
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const filtered = useMemo(() => {
    let rows = data;
    if (searchText) rows = applySearch(rows, query, searchText);
    const col = columns.find((c) => c.key === sortKey);
    if (col?.sortValue) rows = applySort(rows, col.sortValue, sortDir);
    return rows;
  }, [data, query, searchText, columns, sortKey, sortDir]);

  const total = filtered.length;
  const pages = pageCount(total, pageSize);
  const safePage = Math.min(page, pages);
  const paged = useMemo(
    () => paginate(filtered, safePage, pageSize),
    [filtered, safePage, pageSize],
  );

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  const showToolbar = !!searchText || !!toolbar;

  return (
    <Stack>
      {showToolbar && (
        <Group align="flex-end" gap="sm" wrap="wrap">
          {searchText && (
            <TextInput
              aria-label="Tìm kiếm"
              placeholder={searchPlaceholder}
              leftSection={<IconSearch size={14} />}
              value={query}
              onChange={(e) => {
                setQuery(e.currentTarget.value);
                setPage(1);
              }}
              w={260}
            />
          )}
          {toolbar}
        </Group>
      )}

      <Card
        p={0}
        withBorder
        style={{ overflow: 'hidden', ...(compact ? { borderRadius: 'var(--cmc-dt-radius)' } : null) }}
      >
        {error ? (
          <Box p="lg">
            <Alert color="cmcRed" title="Lỗi tải dữ liệu" withCloseButton={false}>
              {error}
              {onRetry && (
                <Button size="xs" variant="subtle" mt="sm" onClick={onRetry}>
                  Thử lại
                </Button>
              )}
            </Alert>
          </Box>
        ) : loading ? (
          <Table style={compactTableStyle}>
            <Table.Thead>
              <Table.Tr>
                {columns.map((c) => (
                  <Table.Th key={c.key} style={{ width: c.width, textAlign: c.align, ...compactHeaderStyle }}>
                    {c.header}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Array.from({ length: skeletonRows }).map((_, r) => (
                <Table.Tr key={r}>
                  {columns.map((c) => (
                    <Table.Td key={c.key}>
                      <Skeleton height={14} radius="sm" />
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : total === 0 ? (
          <Box>{query.trim() ? (noResults ?? <DefaultNoResults />) : emptyState}</Box>
        ) : (
          <Table striped highlightOnHover style={compactTableStyle}>
            <Table.Thead>
              <Table.Tr>
                {columns.map((c) => {
                  const sortable = !!c.sortValue;
                  const isActive = sortKey === c.key;
                  return (
                    <Table.Th
                      key={c.key}
                      style={{
                        width: c.width,
                        textAlign: c.align,
                        cursor: sortable ? 'pointer' : undefined,
                        userSelect: 'none',
                        ...compactHeaderStyle,
                      }}
                      onClick={sortable ? () => toggleSort(c.key) : undefined}
                      aria-sort={
                        isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                      }
                    >
                      <Group gap={4} wrap="nowrap" justify={c.align === 'right' ? 'flex-end' : 'flex-start'}>
                        {c.header}
                        {sortable && <SortGlyph active={isActive} dir={sortDir} />}
                      </Group>
                    </Table.Th>
                  );
                })}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {paged.map((row) => (
                <Table.Tr
                  key={getRowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {columns.map((c) => (
                    <Table.Td key={c.key} style={{ textAlign: c.align }}>
                      {c.render(row)}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      {!loading && !error && total > pageSize && (
        <Group justify="space-between" align="center">
          <Text size="sm" style={{ color: 'var(--cmc-text-muted)' }}>
            {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, total)} / {total}
          </Text>
          <Pagination total={pages} value={safePage} onChange={setPage} size="sm" />
        </Group>
      )}
    </Stack>
  );
}

function SortGlyph({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <IconSelector size={13} color="var(--cmc-text-faint)" />;
  return dir === 'asc' ? (
    <IconChevronUp size={13} color="var(--cmc-brand)" />
  ) : (
    <IconChevronDown size={13} color="var(--cmc-brand)" />
  );
}

function DefaultNoResults() {
  return (
    <Text c="dimmed" size="sm" ta="center" py="xl">
      Không tìm thấy kết quả phù hợp.
    </Text>
  );
}
