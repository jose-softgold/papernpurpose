import { useEffect, useMemo, useState, type ReactNode } from 'react'

export const DATA_GRID_PAGE_SIZES = [10, 25, 50] as const

export type DataGridPageSize = (typeof DATA_GRID_PAGE_SIZES)[number]

function visiblePages(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const set = new Set<number>([1, total, current])
  if (current - 1 > 1) set.add(current - 1)
  if (current + 1 < total) set.add(current + 1)

  const sorted = [...set].sort((a, b) => a - b)
  const out: Array<number | 'ellipsis'> = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] !== sorted[i - 1] + 1) out.push('ellipsis')
    out.push(sorted[i])
  }
  return out
}

interface DataGridPagerProps {
  from: number
  to: number
  total: number
  page: number
  pageCount: number
  pageSize: number
  onPage: (page: number) => void
  onPageSize: (size: DataGridPageSize) => void
}

function DataGridPager({
  from,
  to,
  total,
  page,
  pageCount,
  pageSize,
  onPage,
  onPageSize,
}: DataGridPagerProps) {
  const pages = visiblePages(page, pageCount)

  return (
    <div className="pc-datagrid-pager">
      <div className="d-flex flex-wrap align-items-center gap-2">
        <span className="text-muted small text-nowrap">
          {from}–{to} of {total}
        </span>
        <label className="d-flex align-items-center gap-2 mb-0 small text-muted">
          <span className="d-none d-sm-inline">Rows</span>
          <select
            className="form-select"
            value={pageSize}
            onChange={e => onPageSize(Number(e.target.value) as DataGridPageSize)}
            aria-label="Rows per page"
          >
            {DATA_GRID_PAGE_SIZES.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      {pageCount > 1 && (
        <nav aria-label="Table pagination">
          <ul className="pagination mb-0">
            <li className={`page-item${page <= 1 ? ' disabled' : ''}`}>
              <button
                type="button"
                className="page-link"
                disabled={page <= 1}
                onClick={() => onPage(page - 1)}
                aria-label="Previous page"
              >
                Prev
              </button>
            </li>
            {pages.map((n, i) =>
              n === 'ellipsis' ? (
                <li key={`e-${i}`} className="page-item disabled d-none d-sm-block">
                  <span className="page-link">…</span>
                </li>
              ) : (
                <li key={n} className={`page-item d-none d-sm-block${n === page ? ' active' : ''}`}>
                  <button
                    type="button"
                    className="page-link"
                    onClick={() => onPage(n)}
                    aria-label={`Page ${n}`}
                    aria-current={n === page ? 'page' : undefined}
                  >
                    {n}
                  </button>
                </li>
              ),
            )}
            <li className={`page-item${page >= pageCount ? ' disabled' : ''}`}>
              <button
                type="button"
                className="page-link"
                disabled={page >= pageCount}
                onClick={() => onPage(page + 1)}
                aria-label="Next page"
              >
                Next
              </button>
            </li>
          </ul>
        </nav>
      )}
    </div>
  )
}

interface DataGridProps<T> {
  items: T[]
  children: (pageItems: T[]) => ReactNode
  empty?: ReactNode
  tableClassName?: string
  /** Change this when a filter/search changes so the grid returns to page 1 */
  resetKey?: string | number | boolean
}

export default function DataGrid<T>({
  items,
  children,
  empty,
  tableClassName = 'table table-hover align-middle mb-0',
  resetKey,
}: DataGridProps<T>) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<DataGridPageSize>(10)

  useEffect(() => {
    setPage(1)
  }, [resetKey, pageSize])

  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, pageCount)

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage)
  }, [page, currentPage])

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, currentPage, pageSize])

  if (total === 0) return <>{empty ?? null}</>

  const start = (currentPage - 1) * pageSize
  const from = start + 1
  const to = Math.min(start + pageSize, total)

  return (
    <div className="pc-datagrid">
      <div className="table-responsive">
        <table className={tableClassName}>
          {children(pageItems)}
        </table>
      </div>
      <DataGridPager
        from={from}
        to={to}
        total={total}
        page={currentPage}
        pageCount={pageCount}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={setPageSize}
      />
    </div>
  )
}
